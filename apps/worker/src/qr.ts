import { Context } from 'hono'
import * as QRCode from 'qrcode'
import qrGenerator from 'qrcode-generator'
import { PhotonImage, SamplingFilter, resize, watermark } from '@cf-wasm/photon/workerd'
import { validateUrlForFetch, safeFetch } from './url-validator'

// Maximum logo file size (2MB) - prevents DoS via oversized image URLs
const MAX_LOGO_SIZE = 2 * 1024 * 1024

// Timeout for logo fetch requests (5 seconds) - prevents slow servers from tying up Worker execution
const LOGO_FETCH_TIMEOUT = 5000

// Allowed image Content-Type values for logo uploads
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/vnd.microsoft.icon', 'image/x-icon'] as const

// Magic bytes signatures for image format validation (defense-in-depth)
const IMAGE_MAGIC_BYTES: Record<string, { bytes: number[]; offset?: number }> = {
  'image/png': { bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }, // PNG signature
  'image/jpeg': { bytes: [0xff, 0xd8, 0xff] }, // JPEG SOI marker
  'image/gif': { bytes: [0x47, 0x49, 0x46, 0x38] }, // "GIF8" (GIF87a or GIF89a)
  'image/webp': { bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 }, // "WEBP" at offset 8 (after RIFF header)
  'image/vnd.microsoft.icon': { bytes: [0x00, 0x00, 0x01, 0x00] }, // ICO format
  'image/x-icon': { bytes: [0x00, 0x00, 0x01, 0x00] }, // ICO format (alternative MIME)
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
 * Fetch a logo with size limit, timeout, and content-type validation.
 * Checks Content-Length and Content-Type headers before downloading,
 * then validates magic bytes after download for defense-in-depth.
 * @throws Error if logo exceeds MAX_LOGO_SIZE, times out, or has invalid content type
 */
async function fetchLogoWithSizeLimit(logoUrl: string): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), LOGO_FETCH_TIMEOUT)

  let response: Response
  try {
    response = await safeFetch(logoUrl, { signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }

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

interface LinkData {
  url: string
  createdAt: number
  createdBy: string
}

interface QROptions {
  size: number
  format: 'png' | 'svg'
  logo?: string
  logoSize: number
  autoLogo: boolean // Whether to try fetching user's logo.png from GitHub
}

// GitHub raw content URL for user logos
const GITHUB_LOGO_BASE = 'https://raw.githubusercontent.com/andrewmurphyio/gitly.sh/main/links'

function parseOptions(c: Context): QROptions {
  const size = Math.min(1024, Math.max(64, parseInt(c.req.query('size') || '256', 10)))
  const format = c.req.query('format') === 'svg' ? 'svg' : 'png'
  const logo = c.req.query('logo')
  const logoSize = Math.min(0.35, Math.max(0.15, parseFloat(c.req.query('logo_size') || '0.25')))
  // autoLogo is true when no explicit logo param is provided
  const autoLogo = logo === undefined

  return { size, format, logo, logoSize, autoLogo }
}

/**
 * Try to fetch a user's logo.png from their GitHub folder
 * Returns the logo URL if it exists, undefined otherwise
 */
async function tryGetUserLogo(username: string): Promise<string | undefined> {
  if (!username || username === 'unknown') return undefined
  
  const logoUrl = `${GITHUB_LOGO_BASE}/${username}/logo.png`
  
  try {
    // HEAD request to check if logo exists (faster than GET)
    const response = await fetch(logoUrl, {
      method: 'HEAD',
      headers: { 'User-Agent': 'gitly.sh-worker/1.0' }
    })
    
    if (response.ok) {
      return logoUrl
    }
  } catch {
    // Silently fail - logo just won't be used
  }
  
  return undefined
}

/**
 * Build a normalized cache key URL that includes all query params affecting QR output.
 * This ensures different parameter combinations are cached separately.
 */
function buildCacheKey(c: Context, slug: string, options: QROptions, resolvedLogo?: string): string {
  // Normalize the URL to ensure consistent cache keys
  // Include only params that affect output (size, format, logo, logo_size)
  const cacheUrl = new URL(`https://gitly.sh/${slug}/qr`)
  cacheUrl.searchParams.set('size', String(options.size))
  cacheUrl.searchParams.set('format', options.format)
  // Use resolved logo (could be from query param or auto-detected)
  if (resolvedLogo) {
    cacheUrl.searchParams.set('logo', resolvedLogo)
    cacheUrl.searchParams.set('logo_size', String(options.logoSize))
  } else if (options.autoLogo) {
    // Mark that we checked for auto-logo but none was found
    cacheUrl.searchParams.set('autologo', 'none')
  }
  return cacheUrl.toString()
}

export async function handleQR(c: Context<{ Bindings: Bindings }>) {
  const slug = c.req.param('slug')
  const requestId = crypto.randomUUID().slice(0, 8) // Short ID for log correlation
  
  console.log(`[QR:${requestId}] Starting QR generation for slug: ${slug}`)
  
  // Verify the link exists and get link data
  const linkDataRaw = await c.env.LINKS.get(slug)
  if (!linkDataRaw) {
    console.log(`[QR:${requestId}] Link not found: ${slug}`)
    return c.notFound()
  }

  // Parse link data to get username for auto-logo
  let linkData: LinkData
  try {
    linkData = JSON.parse(linkDataRaw)
    console.log(`[QR:${requestId}] Link data parsed: createdBy=${linkData.createdBy}`)
  } catch (parseError) {
    // Legacy format: raw URL string
    console.log(`[QR:${requestId}] Legacy link format detected, using raw URL`)
    linkData = { url: linkDataRaw, createdAt: 0, createdBy: 'unknown' }
  }

  const options = parseOptions(c)
  console.log(`[QR:${requestId}] Options: size=${options.size}, format=${options.format}, autoLogo=${options.autoLogo}, logo=${options.logo || 'none'}`)
  
  // Resolve logo: use explicit query param, or try auto-fetch from user's folder
  let resolvedLogo = options.logo
  if (options.autoLogo && linkData.createdBy && linkData.createdBy !== 'unknown') {
    console.log(`[QR:${requestId}] Attempting auto-logo fetch for user: ${linkData.createdBy}`)
    resolvedLogo = await tryGetUserLogo(linkData.createdBy)
    console.log(`[QR:${requestId}] Auto-logo result: ${resolvedLogo || 'none found'}`)
  }
  
  // Use Cache API with explicit cache key including all query params
  // This ensures different size/format/logo combinations are cached separately
  const cache = caches.default
  const cacheKey = buildCacheKey(c, slug, options, resolvedLogo)
  const cacheRequest = new Request(cacheKey)
  
  // Check cache first
  const cachedResponse = await cache.match(cacheRequest)
  if (cachedResponse) {
    console.log(`[QR:${requestId}] Returning cached response`)
    return cachedResponse
  }

  const targetUrl = `https://gitly.sh/${slug}`
  console.log(`[QR:${requestId}] Generating QR for URL: ${targetUrl}`)

  // Use higher error correction when logo is present
  const errorCorrectionLevel = resolvedLogo ? 'H' : 'M'

  try {
    let response: Response

    if (options.format === 'svg') {
      console.log(`[QR:${requestId}] Generating SVG QR code`)
      let svg: string
      try {
        svg = await QRCode.toString(targetUrl, {
          type: 'svg',
          width: options.size,
          errorCorrectionLevel,
          margin: 2,
        })
        console.log(`[QR:${requestId}] SVG generated successfully, length=${svg.length}`)
      } catch (svgError) {
        const errorMessage = svgError instanceof Error ? svgError.message : String(svgError)
        console.error(`[QR:${requestId}] SVG generation failed: ${errorMessage}`, svgError)
        return c.json({ 
          error: 'Failed to generate QR code', 
          details: `SVG generation error: ${errorMessage}`,
          requestId 
        }, 500)
      }

      // If logo available (from query param or auto-detected), fetch and embed as data URI
      // This prevents viewer IP leakage from client-side logo fetches
      let finalSvg = svg
      if (resolvedLogo) {
        try {
          console.log(`[QR:${requestId}] Fetching logo for SVG embed: ${resolvedLogo}`)
          const logoDataUri = await fetchLogoAsDataUri(resolvedLogo)
          finalSvg = embedLogoInSvg(svg, logoDataUri, options.size, options.logoSize)
          console.log(`[QR:${requestId}] Logo embedded successfully`)
        } catch (logoError) {
          const errorMessage = logoError instanceof Error ? logoError.message : String(logoError)
          console.warn(`[QR:${requestId}] Logo fetch failed for SVG, using QR without logo: ${errorMessage}`, logoError)
          // DEBUG: Add error as XML comment in SVG
          finalSvg = svg.replace('</svg>', `<!-- LOGO_ERROR: ${errorMessage.replace(/--/g, '__')} --></svg>`)
        }
      }

      response = new Response(finalSvg, {
        status: 200,
        headers: {
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'public, max-age=3600',
        },
      })
    } else {
      // PNG output with optional logo compositing via photon
      console.log(`[QR:${requestId}] Generating PNG QR code`)
      let qrBytes: Uint8Array
      let qrModuleCount: number = 33 // Default estimate
      let qrCellSize: number = 8
      let qrMargin: number = 2
      try {
        // Use qrcode-generator to get QR matrix, then render with photon for proper PNG
        const typeNumber = 0 // Auto-detect
        const ecLevel: 'L' | 'M' | 'Q' | 'H' = errorCorrectionLevel as 'L' | 'M' | 'Q' | 'H'
        const qr = qrGenerator(typeNumber, ecLevel)
        qr.addData(targetUrl)
        qr.make()
        
        const moduleCount = qr.getModuleCount()
        const margin = 2
        const cellSize = Math.floor((options.size - margin * 2) / moduleCount)
        // Store for logo compositing grid alignment
        qrModuleCount = moduleCount
        qrCellSize = cellSize
        qrMargin = margin
        const actualSize = cellSize * moduleCount + margin * 2
        
        // Create white image and draw QR modules using photon
        const pixels = new Uint8Array(actualSize * actualSize * 4)
        // Fill with white
        for (let i = 0; i < pixels.length; i += 4) {
          pixels[i] = 255     // R
          pixels[i + 1] = 255 // G  
          pixels[i + 2] = 255 // B
          pixels[i + 3] = 255 // A
        }
        
        // Draw black modules
        for (let row = 0; row < moduleCount; row++) {
          for (let col = 0; col < moduleCount; col++) {
            if (qr.isDark(row, col)) {
              const x0 = margin + col * cellSize
              const y0 = margin + row * cellSize
              for (let dy = 0; dy < cellSize; dy++) {
                for (let dx = 0; dx < cellSize; dx++) {
                  const px = x0 + dx
                  const py = y0 + dy
                  const idx = (py * actualSize + px) * 4
                  pixels[idx] = 0     // R
                  pixels[idx + 1] = 0 // G
                  pixels[idx + 2] = 0 // B
                  pixels[idx + 3] = 255 // A
                }
              }
            }
          }
        }
        
        // Convert to PNG using photon
        const qrImage = new PhotonImage(pixels, actualSize, actualSize)
        qrBytes = qrImage.get_bytes()
        qrImage.free()
        console.log(`[QR:${requestId}] PNG generated via photon, size=${qrBytes.length} bytes`)
      } catch (pngError) {
        const errorMessage = pngError instanceof Error ? pngError.message : String(pngError)
        console.error(`[QR:${requestId}] PNG generation failed: ${errorMessage}`, pngError)
        return c.json({ 
          error: 'Failed to generate QR code', 
          details: `PNG generation error: ${errorMessage}`,
          requestId 
        }, 500)
      }

      let outputBytes: Uint8Array

      if (resolvedLogo) {
        try {
          console.log(`[QR:${requestId}] Compositing logo onto PNG: ${resolvedLogo}`)
          outputBytes = await compositeLogoOnQR(qrBytes, resolvedLogo, options.size, options.logoSize, qrModuleCount, qrCellSize, qrMargin)
          console.log(`[QR:${requestId}] Logo composited successfully, output size=${outputBytes.length} bytes`)
        } catch (logoError) {
          const errorMessage = logoError instanceof Error ? logoError.message : String(logoError)
          console.error(`[QR:${requestId}] Logo compositing failed: ${errorMessage}`, logoError)
          // Fall back to QR without logo
          outputBytes = qrBytes
        }
      } else {
        outputBytes = qrBytes
      }

      response = new Response(outputBytes, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=3600',
        },
      })
    }

    // Store in cache with the explicit key (clone since response body is consumed)
    console.log(`[QR:${requestId}] Caching response`)
    c.executionCtx.waitUntil(cache.put(cacheRequest, response.clone()))

    console.log(`[QR:${requestId}] QR generation complete`)
    return response
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined
    console.error(`[QR:${requestId}] QR generation failed unexpectedly: ${errorMessage}`, { error, stack: errorStack })
    return c.json({ 
      error: 'Failed to generate QR code', 
      details: errorMessage,
      requestId 
    }, 500)
  }
}

/**
 * Composite a logo onto a QR code PNG using photon WASM
 */
async function compositeLogoOnQR(
  qrBuffer: Uint8Array,
  logoUrl: string,
  size: number,
  logoSizeRatio: number,
  moduleCount?: number,
  cellSize?: number,
  margin?: number
): Promise<Uint8Array> {
  console.log(`[compositeLogoOnQR] Starting. logoUrl=${logoUrl}, size=${size}, logoSizeRatio=${logoSizeRatio}`)
  
  // Validate and fetch the logo image with SSRF protection, size limit, and content-type validation
  console.log(`[compositeLogoOnQR] Fetching logo with size limit`)
  const logoResponse = await fetchLogoWithSizeLimit(logoUrl)
  
  console.log(`[compositeLogoOnQR] Logo fetch response: status=${logoResponse.status}`)
  const logoBuffer = await logoResponse.arrayBuffer()
  console.log(`[compositeLogoOnQR] Logo buffer size: ${logoBuffer.byteLength} bytes`)
  
  // Verify actual size after download (Content-Length can be spoofed or missing)
  if (logoBuffer.byteLength > MAX_LOGO_SIZE) {
    throw new Error(`Logo exceeds maximum size: ${logoBuffer.byteLength} bytes (max ${MAX_LOGO_SIZE})`)
  }
  
  const logoBytes = new Uint8Array(logoBuffer)
  
  // Defense-in-depth: Validate magic bytes match the declared content-type
  const contentType = logoResponse.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
  console.log(`[compositeLogoOnQR] Logo content-type: ${contentType}`)
  if (!validateImageMagicBytes(logoBytes, contentType)) {
    throw new Error(`Logo file signature does not match content-type: ${contentType}`)
  }
  
  // Load QR code as PhotonImage
  console.log(`[compositeLogoOnQR] Loading QR image into Photon`)
  let qrImage: PhotonImage
  try {
    qrImage = PhotonImage.new_from_byteslice(qrBuffer)
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    throw new Error(`Failed to load QR image into Photon: ${errorMessage}`)
  }
  
  // Load logo as PhotonImage
  console.log(`[compositeLogoOnQR] Loading logo image into Photon`)
  let logoImage: PhotonImage
  try {
    logoImage = PhotonImage.new_from_byteslice(logoBytes)
  } catch (e) {
    qrImage.free()
    const errorMessage = e instanceof Error ? e.message : String(e)
    throw new Error(`Failed to decode logo image: ${errorMessage}`)
  }
  
  // Calculate QR module grid info first (needed for grid-aligned logo sizing)
  const qrWidth = qrImage.get_width()
  const actualMargin = margin ?? 2
  const actualModuleCount = moduleCount ?? 33
  const actualCellSize = cellSize ?? Math.floor((qrWidth - actualMargin * 2) / actualModuleCount)

  // Calculate logo area snapped to QR module grid so edges don't cut through modules
  const qrContentSize = actualModuleCount * actualCellSize
  const desiredLogoPx = Math.round(qrContentSize * logoSizeRatio)
  // Convert to modules: logo + 1 module padding on each side
  let logoModules = Math.ceil(desiredLogoPx / actualCellSize)
  let bgModules = logoModules + 2 // 1 module white padding per side
  // Ensure odd count so it centers perfectly in the odd-sized module grid
  if (bgModules % 2 === 0) bgModules += 1
  logoModules = bgModules - 2

  const bgSize = bgModules * actualCellSize
  const logoPixels = logoModules * actualCellSize
  const paddingPx = actualCellSize // exactly 1 module of white padding
  console.log(`[compositeLogoOnQR] Grid-aligned: bgModules=${bgModules}, bgSize=${bgSize}, logoPixels=${logoPixels}, cellSize=${actualCellSize}`)

  // Resize logo to grid-aligned size
  console.log(`[compositeLogoOnQR] Resizing logo`)
  let resizedLogo: PhotonImage
  try {
    resizedLogo = resize(logoImage, logoPixels, logoPixels, SamplingFilter.Lanczos3)
  } catch (e) {
    logoImage.free()
    qrImage.free()
    const errorMessage = e instanceof Error ? e.message : String(e)
    throw new Error(`Failed to resize logo: ${errorMessage}`)
  }
  logoImage.free()

  // Create white background at grid-aligned size (covers exact whole modules)
  console.log(`[compositeLogoOnQR] Creating white background, size=${bgSize}`)
  let whiteBackground: PhotonImage
  try {
    whiteBackground = createWhiteImage(bgSize, bgSize)
  } catch (e) {
    resizedLogo.free()
    qrImage.free()
    const errorMessage = e instanceof Error ? e.message : String(e)
    throw new Error(`Failed to create white background: ${errorMessage}`)
  }

  // Composite logo onto white background (centered with 1-module padding)
  console.log(`[compositeLogoOnQR] Compositing logo onto white background`)
  try {
    watermark(whiteBackground, resizedLogo, BigInt(paddingPx), BigInt(paddingPx))
  } catch (e) {
    resizedLogo.free()
    whiteBackground.free()
    qrImage.free()
    const errorMessage = e instanceof Error ? e.message : String(e)
    throw new Error(`Failed to watermark logo onto background: ${errorMessage}`)
  }
  resizedLogo.free()

  // Center position snapped to module grid
  const logoStartModule = Math.floor((actualModuleCount - bgModules) / 2)
  const centerX = actualMargin + logoStartModule * actualCellSize
  const centerY = centerX
  console.log(`[compositeLogoOnQR] Centering on QR: centerX=${centerX}, centerY=${centerY}, bgModules=${bgModules}`)
  
  // Composite the logo-with-background onto the QR code
  console.log(`[compositeLogoOnQR] Compositing logo+background onto QR code`)
  try {
    watermark(qrImage, whiteBackground, BigInt(centerX), BigInt(centerY))
  } catch (e) {
    whiteBackground.free()
    qrImage.free()
    const errorMessage = e instanceof Error ? e.message : String(e)
    throw new Error(`Failed to watermark logo onto QR code: ${errorMessage}`)
  }
  whiteBackground.free()
  
  // Get output bytes as PNG
  console.log(`[compositeLogoOnQR] Extracting output bytes`)
  let outputBytes: Uint8Array
  try {
    outputBytes = qrImage.get_bytes()
  } catch (e) {
    qrImage.free()
    const errorMessage = e instanceof Error ? e.message : String(e)
    throw new Error(`Failed to get output bytes from QR image: ${errorMessage}`)
  }
  qrImage.free()
  
  console.log(`[compositeLogoOnQR] Complete. Output size=${outputBytes.length} bytes`)
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
  
  // Convert all image formats to PNG for consistent SVG embedding
  // (ICO and other formats may not render in SVG <image> tags)
  let pngBytes: Uint8Array
  try {
    const logoImage = PhotonImage.new_from_byteslice(bytes)
    pngBytes = logoImage.get_bytes() // get_bytes() returns PNG format
    logoImage.free()
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    throw new Error(`Failed to convert logo to PNG: ${errorMessage}`)
  }

  // Copy to own ArrayBuffer — pngBytes.buffer may be WASM linear memory
  const base64 = arrayBufferToBase64(pngBytes.slice().buffer as ArrayBuffer)

  return `data:image/png;base64,${base64}`
}

/**
 * Embed a logo into an SVG QR code using xlink:href for broad compatibility.
 * Parses the viewBox to correctly position the logo in SVG coordinate space.
 */
function embedLogoInSvg(svg: string, logoDataUri: string, size: number, logoSize: number): string {
  // Parse viewBox to get actual SVG coordinate system
  const viewBoxMatch = svg.match(/viewBox=["']([^"']+)["']/)
  let svgSize = size // Default to pixel size
  if (viewBoxMatch) {
    const parts = viewBoxMatch[1].split(/\s+/)
    if (parts.length >= 4) {
      svgSize = parseFloat(parts[2]) // width from viewBox
    }
  }
  
  // In qrcode library SVG, each module is 1 unit, margin is 2 units per side
  const svgMargin = 2
  const moduleCount = svgSize - svgMargin * 2

  // Calculate logo area snapped to module grid
  let logoModules = Math.ceil(moduleCount * logoSize)
  let bgModules = logoModules + 2 // 1 module white padding per side
  if (bgModules % 2 === 0) bgModules += 1
  logoModules = bgModules - 2

  const logoStartModule = Math.floor((moduleCount - bgModules) / 2)
  const bgX = svgMargin + logoStartModule
  const bgY = bgX
  const logoX = bgX + 1 // 1 module padding
  const logoY = logoX

  // Ensure SVG has xlink namespace for broad browser compatibility
  let updatedSvg = svg
  if (!svg.includes('xmlns:xlink')) {
    updatedSvg = svg.replace('<svg', '<svg xmlns:xlink="http://www.w3.org/1999/xlink"')
  }

  // Create a white background rect and image element for the logo
  // All dimensions snapped to module grid boundaries
  const logoElements = `
    <rect
      x="${bgX}"
      y="${bgY}"
      width="${bgModules}"
      height="${bgModules}"
      fill="white"
    />
    <image
      xlink:href="${logoDataUri}"
      href="${logoDataUri}"
      x="${logoX}"
      y="${logoY}"
      width="${logoModules}"
      height="${logoModules}"
      preserveAspectRatio="xMidYMid meet"
    />
  `
  
  // Insert before closing </svg> tag
  return updatedSvg.replace('</svg>', `${logoElements}</svg>`)
}
