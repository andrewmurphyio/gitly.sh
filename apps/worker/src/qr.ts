import { Context } from 'hono'
import QRCode from 'qrcode'

type Bindings = {
  LINKS: KVNamespace
}

interface QROptions {
  size: number
  format: 'png' | 'svg'
  logo?: string
  logoSize: number
}

const DEFAULT_OPTIONS: QROptions = {
  size: 256,
  format: 'png',
  logoSize: 0.25,
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
      // PNG output
      const buffer = await QRCode.toBuffer(targetUrl, {
        type: 'png',
        width: options.size,
        errorCorrectionLevel,
        margin: 2,
      })

      // Note: Logo compositing for PNG requires canvas or image processing library
      // For now, return QR without logo for PNG format
      // TODO: Implement PNG logo compositing (see ADR 008)
      
      const headers: Record<string, string> = {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600',
      }
      
      if (options.logo) {
        headers['X-Logo-Status'] = 'not-implemented-for-png'
      }

      return c.body(buffer, 200, headers)
    }
  } catch (error) {
    console.error('QR generation failed:', error)
    return c.json({ error: 'Failed to generate QR code' }, 500)
  }
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
