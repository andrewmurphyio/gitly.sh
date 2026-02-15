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
 * Uses HMAC-SHA256 with a secret key and daily salt to prevent:
 * - Long-term tracking (daily rotation)
 * - Pre-computation attacks (secret pepper)
 * 
 * @param ip - The IP address to hash
 * @param date - Date string (YYYY-MM-DD) for daily rotation
 * @param secret - Secret pepper from HASH_SECRET env var
 */
export async function hashIP(ip: string, date: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  
  // Import the secret as an HMAC key
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  
  // Message includes date for daily rotation
  const message = `gitly.sh:${date}:${ip}`
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  
  const hashArray = Array.from(new Uint8Array(signature))
  // Return first 16 chars (64 bits) - enough for uniqueness, saves storage
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}
