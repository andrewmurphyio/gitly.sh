/**
 * Lightweight User-Agent parser for device/browser/OS extraction.
 * Minimal regex-based approach to keep bundle size down.
 */

export interface ParsedUA {
  deviceType: 'mobile' | 'tablet' | 'desktop'
  browser: string
  os: string
}

export function parseUserAgent(ua: string | null): ParsedUA {
  if (!ua) {
    return { deviceType: 'desktop', browser: 'Unknown', os: 'Unknown' }
  }

  return {
    deviceType: detectDeviceType(ua),
    browser: detectBrowser(ua),
    os: detectOS(ua),
  }
}

function detectDeviceType(ua: string): 'mobile' | 'tablet' | 'desktop' {
  const lower = ua.toLowerCase()
  
  // Tablets first (before mobile check catches them)
  if (/ipad|tablet|playbook|silk/i.test(ua) || 
      (lower.includes('android') && !lower.includes('mobile'))) {
    return 'tablet'
  }
  
  // Mobile devices
  if (/mobile|iphone|ipod|android.*mobile|blackberry|windows phone|opera mini|iemobile/i.test(ua)) {
    return 'mobile'
  }
  
  return 'desktop'
}

function detectBrowser(ua: string): string {
  // Order matters: check specific browsers before generic ones
  
  // Edge (new Chromium-based)
  if (/edg\//i.test(ua)) return 'Edge'
  
  // Opera (check before Chrome since Opera includes Chrome in UA)
  if (/opr\//i.test(ua) || /opera/i.test(ua)) return 'Opera'
  
  // Samsung Browser
  if (/samsungbrowser/i.test(ua)) return 'Samsung Browser'
  
  // UC Browser
  if (/ucbrowser/i.test(ua)) return 'UC Browser'
  
  // Firefox
  if (/firefox|fxios/i.test(ua)) return 'Firefox'
  
  // Safari (check before Chrome since Chrome on iOS reports Safari)
  if (/safari/i.test(ua) && !/chrome|chromium|crios/i.test(ua)) return 'Safari'
  
  // Chrome (including Chrome on iOS as CriOS)
  if (/chrome|chromium|crios/i.test(ua)) return 'Chrome'
  
  // IE
  if (/msie|trident/i.test(ua)) return 'IE'
  
  return 'Other'
}

function detectOS(ua: string): string {
  // iOS (check before Mac since iPad can report Mac in recent versions)
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS'
  
  // Android
  if (/android/i.test(ua)) return 'Android'
  
  // Windows
  if (/windows/i.test(ua)) return 'Windows'
  
  // macOS
  if (/macintosh|mac os x/i.test(ua)) return 'macOS'
  
  // Linux
  if (/linux/i.test(ua)) return 'Linux'
  
  // Chrome OS
  if (/cros/i.test(ua)) return 'ChromeOS'
  
  return 'Other'
}

/**
 * Hash an IP address for unique visitor tracking.
 * Uses SHA-256 with a secret pepper and daily salt to prevent:
 * - Long-term tracking (daily rotation)
 * - Pre-computation attacks (secret pepper)
 * 
 * @param ip - The visitor's IP address
 * @param date - Date string for daily rotation (YYYY-MM-DD)
 * @param secret - Secret pepper from environment variable (HASH_SECRET)
 */
export async function hashIP(ip: string, date: string, secret: string): Promise<string> {
  // Salt includes secret pepper to prevent pre-computation attacks
  // Even if attacker knows the IP, they can't compute expected hashes without the secret
  const salt = `gitly.sh:${secret}:${date}`
  const data = new TextEncoder().encode(`${salt}:${ip}`)
  const hash = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hash))
  // Return first 16 chars (64 bits) - enough for uniqueness, saves storage
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}
