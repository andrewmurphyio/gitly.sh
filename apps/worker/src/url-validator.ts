/**
 * URL Validation for SSRF Protection
 *
 * Validates URLs before server-side fetching to prevent:
 * - Internal network probing
 * - Cloud metadata access (AWS/GCP/Azure)
 * - Localhost/loopback access
 * - Private IP range access
 * - DNS rebinding attacks (partial - hostname validation)
 */

// IPv4 private/reserved ranges
const PRIVATE_IPV4_RANGES = [
  // 10.0.0.0/8
  { start: 0x0a000000, end: 0x0affffff },
  // 127.0.0.0/8 (loopback)
  { start: 0x7f000000, end: 0x7fffffff },
  // 169.254.0.0/16 (link-local, includes AWS metadata)
  { start: 0xa9fe0000, end: 0xa9feffff },
  // 172.16.0.0/12
  { start: 0xac100000, end: 0xac1fffff },
  // 192.168.0.0/16
  { start: 0xc0a80000, end: 0xc0a8ffff },
  // 0.0.0.0/8
  { start: 0x00000000, end: 0x00ffffff },
  // 100.64.0.0/10 (carrier-grade NAT)
  { start: 0x64400000, end: 0x647fffff },
  // 192.0.0.0/24 (IETF protocol assignments)
  { start: 0xc0000000, end: 0xc00000ff },
  // 192.0.2.0/24 (TEST-NET-1)
  { start: 0xc0000200, end: 0xc00002ff },
  // 198.51.100.0/24 (TEST-NET-2)
  { start: 0xc6336400, end: 0xc63364ff },
  // 203.0.113.0/24 (TEST-NET-3)
  { start: 0xcb007100, end: 0xcb0071ff },
  // 224.0.0.0/4 (multicast)
  { start: 0xe0000000, end: 0xefffffff },
  // 240.0.0.0/4 (reserved)
  { start: 0xf0000000, end: 0xffffffff },
]

// Blocked hostnames (case-insensitive)
const BLOCKED_HOSTNAMES = [
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
]

// Blocked hostname suffixes (internal TLDs, cloud metadata)
const BLOCKED_HOSTNAME_SUFFIXES = [
  '.local',
  '.localhost',
  '.internal',
  '.corp',
  '.lan',
  '.home.arpa',
  '.intranet',
  // Cloud metadata hostnames
  'metadata.google.internal',
  'metadata.goog',
]

// Cloud metadata IP addresses (explicit blocking)
const CLOUD_METADATA_IPS = [
  '169.254.169.254', // AWS, GCP, Azure
  '169.254.170.2',   // AWS ECS
  'fd00:ec2::254',   // AWS IMDSv6
]

export interface UrlValidationResult {
  valid: boolean
  error?: string
}

/**
 * Parse IPv4 address string to 32-bit integer
 */
function parseIPv4(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null

  let result = 0
  for (const part of parts) {
    const num = parseInt(part, 10)
    if (isNaN(num) || num < 0 || num > 255 || part !== String(num)) {
      return null
    }
    result = (result << 8) | num
  }
  return result >>> 0 // Ensure unsigned
}

/**
 * Check if an IPv4 address (as integer) is in a private/reserved range
 */
function isPrivateIPv4(ipInt: number): boolean {
  return PRIVATE_IPV4_RANGES.some(
    (range) => ipInt >= range.start && ipInt <= range.end
  )
}

/**
 * Check if a string looks like an IPv4 address
 */
function isIPv4Address(hostname: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)
}

/**
 * Check if a string looks like an IPv6 address (including bracketed)
 */
function isIPv6Address(hostname: string): boolean {
  // Remove brackets if present
  const cleanHost = hostname.replace(/^\[|\]$/g, '')
  // Simple IPv6 pattern (includes ::, mixed notation)
  return /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/.test(cleanHost) ||
         /^([0-9a-fA-F]{0,4}:){2,6}(\d{1,3}\.){3}\d{1,3}$/.test(cleanHost) ||
         cleanHost === '::' ||
         cleanHost.startsWith('::') ||
         cleanHost.endsWith('::')
}

/**
 * Check if IPv6 address is loopback or link-local
 */
function isPrivateIPv6(hostname: string): boolean {
  const cleanHost = hostname.replace(/^\[|\]$/g, '').toLowerCase()

  // Loopback
  if (cleanHost === '::1' || cleanHost === '0:0:0:0:0:0:0:1') {
    return true
  }

  // Link-local (fe80::/10)
  if (cleanHost.startsWith('fe8') || cleanHost.startsWith('fe9') ||
      cleanHost.startsWith('fea') || cleanHost.startsWith('feb')) {
    return true
  }

  // Unique local (fc00::/7)
  if (cleanHost.startsWith('fc') || cleanHost.startsWith('fd')) {
    return true
  }

  // Unspecified
  if (cleanHost === '::' || cleanHost === '0:0:0:0:0:0:0:0') {
    return true
  }

  // IPv4-mapped IPv6 (::ffff:x.x.x.x) - check the IPv4 part
  // Dotted notation: ::ffff:127.0.0.1
  const v4MappedMatch = cleanHost.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i)
  if (v4MappedMatch) {
    const ipInt = parseIPv4(v4MappedMatch[1])
    if (ipInt !== null && isPrivateIPv4(ipInt)) {
      return true
    }
  }

  // URL.hostname normalizes ::ffff:127.0.0.1 to ::ffff:7f00:1 (hex notation)
  // Match ::ffff:XXXX:XXXX pattern and convert back to IPv4
  const v4MappedHexMatch = cleanHost.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i)
  if (v4MappedHexMatch) {
    const high = parseInt(v4MappedHexMatch[1], 16)
    const low = parseInt(v4MappedHexMatch[2], 16)
    const ipInt = (high << 16) | low
    if (isPrivateIPv4(ipInt >>> 0)) {
      return true
    }
  }

  return false
}

/**
 * Check if hostname resolves to or represents a blocked internal address
 */
function isBlockedHostname(hostname: string): boolean {
  const lowerHost = hostname.toLowerCase()

  // Direct hostname match
  if (BLOCKED_HOSTNAMES.includes(lowerHost)) {
    return true
  }

  // Suffix match (e.g., .local, .internal)
  if (BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => lowerHost.endsWith(suffix))) {
    return true
  }

  // Cloud metadata IPs
  if (CLOUD_METADATA_IPS.includes(lowerHost)) {
    return true
  }

  return false
}

/**
 * Validate a URL for safe server-side fetching
 *
 * @param url - The URL string to validate
 * @returns Validation result with error message if invalid
 */
export function validateUrlForFetch(url: string): UrlValidationResult {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { valid: false, error: 'Invalid URL format' }
  }

  // Only allow HTTPS
  if (parsed.protocol !== 'https:') {
    return { valid: false, error: 'Only HTTPS URLs are allowed' }
  }

  const hostname = parsed.hostname.toLowerCase()

  // Block credentials in URL
  if (parsed.username || parsed.password) {
    return { valid: false, error: 'URLs with credentials are not allowed' }
  }

  // Check for blocked hostnames
  if (isBlockedHostname(hostname)) {
    return { valid: false, error: 'Internal or metadata hostnames are not allowed' }
  }

  // Check IPv4 literals
  if (isIPv4Address(hostname)) {
    const ipInt = parseIPv4(hostname)
    if (ipInt === null) {
      return { valid: false, error: 'Invalid IPv4 address' }
    }
    if (isPrivateIPv4(ipInt)) {
      return { valid: false, error: 'Private IP addresses are not allowed' }
    }
  }

  // Check IPv6 literals (may be in brackets in URL)
  // Note: URL.hostname strips the brackets, but we handle both cases
  const cleanHostname = hostname.replace(/^\[|\]$/g, '')
  if (isIPv6Address(cleanHostname) || isIPv6Address(hostname)) {
    if (isPrivateIPv6(cleanHostname) || isPrivateIPv6(hostname)) {
      return { valid: false, error: 'Private IPv6 addresses are not allowed' }
    }
  }

  // Block numeric hostname variations that could bypass checks
  // e.g., decimal notation: http://2130706433/ = http://127.0.0.1/
  if (/^\d+$/.test(hostname)) {
    return { valid: false, error: 'Numeric hostnames are not allowed' }
  }

  // Block octal/hex IP representations
  // e.g., 0x7f.0x0.0x0.0x1, 0177.0.0.1
  if (/^(0x[0-9a-f]+\.?)+$/i.test(hostname) || /^(0\d+\.?)+$/.test(hostname)) {
    return { valid: false, error: 'Octal/hex IP notation is not allowed' }
  }

  return { valid: true }
}

/**
 * Safely fetch a URL with SSRF protections
 *
 * @param url - The URL to fetch (must pass validation)
 * @param options - Additional fetch options
 * @returns Fetch response
 * @throws Error if URL fails validation or fetch fails
 */
export async function safeFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const validation = validateUrlForFetch(url)
  if (!validation.valid) {
    throw new Error(`URL validation failed: ${validation.error}`)
  }

  // Prevent redirects to internal addresses by manually following
  // and validating each redirect
  const response = await fetch(url, {
    ...options,
    redirect: 'manual',
  })

  // Handle redirects safely
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location')
    if (!location) {
      throw new Error('Redirect without Location header')
    }

    // Resolve relative URLs
    const redirectUrl = new URL(location, url).toString()

    // Validate the redirect target
    const redirectValidation = validateUrlForFetch(redirectUrl)
    if (!redirectValidation.valid) {
      throw new Error(`Redirect blocked: ${redirectValidation.error}`)
    }

    // Follow the redirect (limit depth to prevent infinite loops)
    // Note: In production, you'd want to track depth across recursive calls
    return fetch(redirectUrl, {
      ...options,
      redirect: 'manual',
    })
  }

  return response
}
