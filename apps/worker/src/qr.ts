import { Context } from 'hono'
import QRCode from 'qrcode'
import { PhotonImage, SamplingFilter, resize, watermark } from '@cf-wasm/photon/workerd'

type Bindings = {
  LINKS: KVNamespace
}

interface QROptions {
  size: number
  format: 'png' | 'svg'
  logo?: string
  logoSize: number
}

/**
 * Validates that a logo URL is safe to fetch server-side.
 * Prevents SSRF attacks by enforcing HTTPS and blocking internal/private IPs.
 */
function isAllowedLogoUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    
    // Only allow HTTPS
    if (parsed.protocol !== 'https:') {
      return false
    }
    
    const hostname = parsed.hostname.toLowerCase()
    
    // Block localhost variants
    if (hostname === 'localhost' || hostname === '[::1]') {
      return false
    }
    
    // Check for IP addresses
    const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
    if (ipv4Match) {
      const octets = ipv4Match.slice(1).map(Number)
      const [a, b, c, d] = octets
      
      // Validate octets
      if (octets.some(o => o > 255)) {
        return false
      }
      
      // Block private/internal IP ranges (RFC 1918, RFC 3927, RFC 5737, etc.)
      if (
        a === 10 ||                                    // 10.0.0.0/8 (private)
        (a === 172 && b >= 16 && b <= 31) ||          // 172.16.0.0/12 (private)
        (a === 192 && b === 168) ||                    // 192.168.0.0/16 (private)
        a === 127 ||                                   // 127.0.0.0/8 (loopback)
        (a === 169 && b === 254) ||                    // 169.254.0.0/16 (link-local, metadata)
        a === 0 ||                                     // 0.0.0.0/8 (this network)
        (a === 100 && b >= 64 && b <= 127) ||         // 100.64.0.0/10 (carrier-grade NAT)
        (a === 192 && b === 0 && c === 0) ||          // 192.0.0.0/24 (IETF protocol)
        (a === 192 && b === 0 && c === 2) ||          // 192.0.2.0/24 (TEST-NET-1)
        (a === 198 && b === 51 && c === 100) ||       // 198.51.100.0/24 (TEST-NET-2)
        (a === 203 && b === 0 && c === 113) ||        // 203.0.113.0/24 (TEST-NET-3)
        (a >= 224 && a <= 239) ||                      // 224.0.0.0/4 (multicast)
        (a >= 240)                                     // 240.0.0.0/4 (reserved/broadcast)
      ) {
        return false
      }
    }
    
    // Block IPv6 addresses entirely (too many edge cases for internal ranges)
    if (hostname.startsWith('[') || hostname.includes(':')) {
      return false
    }
    
    // Block common cloud metadata hostnames
    const blockedHostnames = [
      'metadata.google.internal',
      'metadata.goog',
      'metadata',
    ]
    if (blockedHostnames.includes(hostname)) {
      return false
    }
    
    return true
  } catch {
    return false
  }
}

function parseOptions(c: Context): QROptions {
  const size = Math.min(1024, Math.max(64, parseInt(c.req.query('size') || '256', 10)))
  const format = c.req.query('format') === 'svg' ? 'svg' : 'png'
  const logoParam = c.req.query('logo')
  const logoSize = Math.min(0.35, Math.max(0.15, parseFloat(c.req.query('logo_size') || '0.25')))

  // Validate logo URL if provided - reject unsafe URLs
  const logo = logoParam && isAllowedLogoUrl(logoParam) ? logoParam : undefined

  return { size, format, logo, logoSize }
}

export async function handleQR(c: Context<{ Bindings: Bindings }>) {
  const slug = c.req.param('slug')
  
  // Verify the link exists
  const url = await c.env.LINKS.get(slug)
  if (!url) {
    return c.notFound()
  }

  const options = parseOptions(c)
  const targetUrl = `https://gitly.sh/${slug}`

  // Use higher error correction when logo is present
  const errorCorrectionLevel = options.logo ? 'H' : 'M'

  try {
    if (options.format === 'svg') {
      const svg = await QRCode.toString(targetUrl, {
        type: 'svg',
        width: options.size,
        errorCorrectionLevel,
        margin: 2,
      })

      // If logo requested, embed it in SVG
      let finalSvg = svg
      if (options.logo) {
        finalSvg = embedLogoInSvg(svg, options.logo, options.size, options.logoSize)
      }

      return c.body(finalSvg, 200, {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=3600',
      })
    } else {
      // PNG output with optional logo compositing via photon
      const buffer = await QRCode.toBuffer(targetUrl, {
        type: 'png',
        width: options.size,
        errorCorrectionLevel,
        margin: 2,
      })

      let outputBytes: Uint8Array

      if (options.logo) {
        try {
          outputBytes = await compositeLogoOnQR(buffer, options.logo, options.size, options.logoSize)
        } catch (logoError) {
          console.error('Logo compositing failed:', logoError)
          // Fall back to QR without logo
          outputBytes = new Uint8Array(buffer)
        }
      } else {
        outputBytes = new Uint8Array(buffer)
      }

      return new Response(outputBytes, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=3600',
        },
      })
    }
  } catch (error) {
    console.error('QR generation failed:', error)
    return c.json({ error: 'Failed to generate QR code' }, 500)
  }
}

/**
 * Composite a logo onto a QR code PNG using photon WASM
 */
async function compositeLogoOnQR(
  qrBuffer: Buffer,
  logoUrl: string,
  size: number,
  logoSizeRatio: number
): Promise<Uint8Array> {
  // Defense-in-depth: validate URL again before fetching
  if (!isAllowedLogoUrl(logoUrl)) {
    throw new Error('Invalid logo URL: must be HTTPS from a public host')
  }
  
  // Fetch the logo image
  const logoResponse = await fetch(logoUrl)
  if (!logoResponse.ok) {
    throw new Error(`Failed to fetch logo: ${logoResponse.status}`)
  }
  
  const logoBytes = new Uint8Array(await logoResponse.arrayBuffer())
  
  // Load QR code as PhotonImage
  const qrImage = PhotonImage.new_from_byteslice(new Uint8Array(qrBuffer))
  
  // Load logo as PhotonImage
  let logoImage: PhotonImage
  try {
    logoImage = PhotonImage.new_from_byteslice(logoBytes)
  } catch (e) {
    qrImage.free()
    throw new Error('Failed to decode logo image')
  }
  
  // Calculate target logo dimensions
  const logoPixels = Math.round(size * logoSizeRatio)
  const padding = Math.round(logoPixels * 0.15) // 15% padding for white background
  
  // Resize logo to target size
  const resizedLogo = resize(
    logoImage,
    logoPixels,
    logoPixels,
    SamplingFilter.Lanczos3 // High quality resize
  )
  logoImage.free()
  
  // Create white background for logo
  const bgSize = logoPixels + padding * 2
  const whiteBackground = createWhiteImage(bgSize, bgSize)
  
  // Composite logo onto white background (centered)
  // watermark takes bigint for x,y coordinates
  watermark(whiteBackground, resizedLogo, BigInt(padding), BigInt(padding))
  resizedLogo.free()
  
  // Calculate center position on QR code
  const centerX = Math.round((size - bgSize) / 2)
  const centerY = Math.round((size - bgSize) / 2)
  
  // Composite the logo-with-background onto the QR code
  watermark(qrImage, whiteBackground, BigInt(centerX), BigInt(centerY))
  whiteBackground.free()
  
  // Get output bytes as PNG
  const outputBytes = qrImage.get_bytes()
  qrImage.free()
  
  return outputBytes
}

/**
 * Create a white RGBA image of given dimensions
 * Uses PhotonImage constructor which takes raw RGBA pixels
 */
function createWhiteImage(width: number, height: number): PhotonImage {
  // Create a white pixel array (RGBA)
  const pixels = new Uint8Array(width * height * 4)
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 255     // R
    pixels[i + 1] = 255 // G
    pixels[i + 2] = 255 // B
    pixels[i + 3] = 255 // A
  }
  
  return new PhotonImage(pixels, width, height)
}

function embedLogoInSvg(svg: string, logoUrl: string, size: number, logoSize: number): string {
  const logoPixels = Math.round(size * logoSize)
  const logoOffset = Math.round((size - logoPixels) / 2)
  const padding = Math.round(logoPixels * 0.1)
  
  // Create a white background rect and image element for the logo
  const logoElements = `
    <rect 
      x="${logoOffset - padding}" 
      y="${logoOffset - padding}" 
      width="${logoPixels + padding * 2}" 
      height="${logoPixels + padding * 2}" 
      fill="white"
    />
    <image 
      href="${escapeXml(logoUrl)}" 
      x="${logoOffset}" 
      y="${logoOffset}" 
      width="${logoPixels}" 
      height="${logoPixels}"
      preserveAspectRatio="xMidYMid meet"
    />
  `
  
  // Insert before closing </svg> tag
  return svg.replace('</svg>', `${logoElements}</svg>`)
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
