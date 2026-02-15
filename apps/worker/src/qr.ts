import { Context } from 'hono'
import QRCode from 'qrcode'
import { PhotonImage, SamplingFilter, resize, watermark } from '@cf-wasm/photon/workerd'
import { validateUrlForFetch, safeFetch } from './url-validator'

// Maximum logo file size (2MB) - prevents DoS via oversized image URLs
const MAX_LOGO_SIZE = 2 * 1024 * 1024

// Allowed image Content-Type values for logo uploads
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const

// Magic bytes signatures for image format validation (defense-in-depth)
const IMAGE_MAGIC_BYTES: Record<string, { bytes: number[]; offset?: number }> = {
  'image/png': { bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }, // PNG signature
  'image/jpeg': { bytes: [0xff, 0xd8, 0xff] }, // JPEG SOI marker
  'image/gif': { bytes: [0x47, 0x49, 0x46, 0x38] }, // "GIF8" (GIF87a or GIF89a)
  'image/webp': { bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 }, // "WEBP" at offset 8 (after RIFF header)
}

/**
 * Validate that image bytes match the expected magic signature for the content type.
 * Returns true if the bytes match the expected format, false otherwise.
 */
function validateImageMagicBytes(bytes: Uint8Array, contentType: string): boolean {
  const signature = IMAGE_MAGIC_BYTES[contentType]
  if (!signature) return false

  const offset = signature.offset ?? 0
  if (bytes.length < offset + signature.bytes.length) return false

  return signature.bytes.every((byte, i) => bytes[offset + i] === byte)
}

/**
 * Fetch a logo with size limit and content-type validation.
 * Checks Content-Length and Content-Type headers before downloading,
 * then validates magic bytes after download for defense-in-depth.
 * @throws Error if logo exceeds MAX_LOGO_SIZE or has invalid content type
 */
async function fetchLogoWithSizeLimit(logoUrl: string): Promise<Response> {
  const response = await safeFetch(logoUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch logo: ${response.status}`)
  }

  // Validate Content-Type header against allowlist
  const rawContentType = response.headers.get('content-type')
  const contentType = rawContentType?.split(';')[0]?.trim()
  if (!contentType || !ALLOWED_IMAGE_TYPES.includes(contentType as typeof ALLOWED_IMAGE_TYPES[number])) {
    throw new Error(`Invalid logo content-type: ${contentType ?? 'none'}`)
  }

  // Check Content-Length header if available (early rejection)
  const contentLength = response.headers.get('content-length')
  if (contentLength) {
    const size = parseInt(contentLength, 10)
    if (!isNaN(size) && size > MAX_LOGO_SIZE) {
      throw new Error(`Logo too large: ${size} bytes (max ${MAX_LOGO_SIZE})`)
    }
  }

  return response
}

type Bindings = {
  LINKS: KVNamespace
}

interface QROptions {
  size: number
  format: 'png' | 'svg'
  logo?: string
  logoSize: number
}

function parseOptions(c: Context): QROptions {
  const size = Math.min(1024, Math.max(64, parseInt(c.req.query('size') || '256', 10)))
  const format = c.req.query('format') === 'svg' ? 'svg' : 'png'
  const logo = c.req.query('logo')
  const logoSize = Math.min(0.35, Math.max(0.15, parseFloat(c.req.query('logo_size') || '0.25')))

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

      // If logo requested, fetch it server-side and embed as data URI
      // This prevents viewer IP leakage from client-side logo fetches
      let finalSvg = svg
      if (options.logo) {
        try {
          const logoDataUri = await fetchLogoAsDataUri(options.logo)
          finalSvg = embedLogoInSvg(svg, logoDataUri, options.size, options.logoSize)
        } catch (logoError) {
          console.warn('Logo fetch failed for SVG, using QR without logo:', logoError)
          // Fall back to QR without logo
        }
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
  // Validate and fetch the logo image with SSRF protection, size limit, and content-type validation
  const logoResponse = await fetchLogoWithSizeLimit(logoUrl)
  
  const logoBuffer = await logoResponse.arrayBuffer()
  
  // Verify actual size after download (Content-Length can be spoofed or missing)
  if (logoBuffer.byteLength > MAX_LOGO_SIZE) {
    throw new Error(`Logo exceeds maximum size: ${logoBuffer.byteLength} bytes (max ${MAX_LOGO_SIZE})`)
  }
  
  const logoBytes = new Uint8Array(logoBuffer)
  
  // Defense-in-depth: Validate magic bytes match the declared content-type
  const contentType = logoResponse.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
  if (!validateImageMagicBytes(logoBytes, contentType)) {
    throw new Error(`Logo file signature does not match content-type: ${contentType}`)
  }
  
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

/**
 * Convert an ArrayBuffer to base64 string using chunked approach.
 * Avoids stack overflow on large images (>100KB) that occurs with spread operator.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode.apply(null, chunk as unknown as number[])
  }
  return btoa(binary)
}

/**
 * Fetch a logo image and convert it to a base64 data URI.
 * This prevents viewer IP leakage by proxying the logo through the server.
 * Enforces size limits and validates content-type to prevent malicious file processing.
 */
async function fetchLogoAsDataUri(logoUrl: string): Promise<string> {
  const response = await fetchLogoWithSizeLimit(logoUrl)

  const rawContentType = response.headers.get('content-type')
  const contentType = rawContentType?.split(';')[0]?.trim() || 'image/png'
  const arrayBuffer = await response.arrayBuffer()
  
  // Verify actual size after download (Content-Length can be spoofed or missing)
  if (arrayBuffer.byteLength > MAX_LOGO_SIZE) {
    throw new Error(`Logo exceeds maximum size: ${arrayBuffer.byteLength} bytes (max ${MAX_LOGO_SIZE})`)
  }
  
  // Defense-in-depth: Validate magic bytes match the declared content-type
  const bytes = new Uint8Array(arrayBuffer)
  if (!validateImageMagicBytes(bytes, contentType)) {
    throw new Error(`Logo file signature does not match content-type: ${contentType}`)
  }
  
  const base64 = arrayBufferToBase64(arrayBuffer)

  return `data:${contentType};base64,${base64}`
}

/**
 * Embed a logo into an SVG QR code.
 * @param logoDataUri - A data URI (base64-encoded image) to embed
 */
function embedLogoInSvg(svg: string, logoDataUri: string, size: number, logoSize: number): string {
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
      href="${escapeXml(logoDataUri)}" 
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
