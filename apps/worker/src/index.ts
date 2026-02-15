import { Hono } from 'hono'
import { handleQR } from './qr'
import { parseUserAgent, hashIP } from './ua-parser'
import { constantTimeCompare } from './crypto'
import { createRateLimiter, getClientIP, compositeKey, RateLimitBinding } from './rate-limit'

type Bindings = {
  LINKS: KVNamespace
  DB: D1Database
  ANALYTICS_API_KEY: string // Secret for analytics export
  // Rate limiting bindings (Cloudflare Workers Rate Limiting API)
  QR_RATE_LIMITER: RateLimitBinding
  ANALYTICS_RATE_LIMITER: RateLimitBinding
  REDIRECT_RATE_LIMITER: RateLimitBinding
}

interface LinkData {
  url: string
  createdAt: number
  createdBy: string
}

interface ClickRow {
  slug: string
  clicked_at: number
  referrer: string | null
  country: string | null
  city: string | null
  device_type: string
  browser: string
  os: string
  visitor_hash: string
  created_by: string // Joined from links table
}

// Security: Limit stored User-Agent length to prevent storage abuse
const MAX_UA_LENGTH = 512
const MAX_REFERRER_LENGTH = 2048

// Reserved slugs that would conflict with API routes (must match scripts/sync-links.ts)
const RESERVED_SLUGS = new Set(['health', 'api', 'admin', '_'])

// Security: Validate redirect URLs to prevent open redirect attacks
function isValidRedirectUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "https:"
  } catch {
    return false
  }
}

const app = new Hono<{ Bindings: Bindings }>()

// Security headers middleware
app.use('*', async (c, next) => {
  await next()
  // Existing security headers
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  // Additional security headers (GitHub issue #102)
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  c.header('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'")
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.header('Permissions-Policy', 'geolocation=(), camera=(), microphone=()')
})

// Health check (no rate limiting - used for monitoring)
app.get('/health', (c) => c.json({ status: 'ok' }))

// QR code endpoint - strict rate limiting (CPU-expensive with logo processing)
// Limit: 10 requests per 10 seconds per IP+slug combo
app.get('/:slug/qr', 
  createRateLimiter(
    (c) => c.env.QR_RATE_LIMITER,
    {
      keyFunc: (c) => {
        const ip = getClientIP(c)
        const slug = c.req.param('slug')
        return compositeKey(ip, slug)
      },
      errorResponse: (c) => c.json(
        { 
          error: 'Too Many Requests',
          message: 'QR code generation rate limit exceeded. Please wait before retrying.',
          retryAfter: 10
        },
        429,
        { 'Retry-After': '10' }
      )
    }
  ),
  handleQR
)

// Analytics API - protected by API key with rate limiting
// Limit: 30 requests per 60 seconds per API key
app.get('/api/analytics',
  createRateLimiter(
    (c) => c.env.ANALYTICS_RATE_LIMITER,
    {
      keyFunc: (c) => {
        // Rate limit by API key (or IP if no auth header)
        const authHeader = c.req.header('Authorization') || ''
        return authHeader || getClientIP(c)
      },
      errorResponse: (c) => c.json(
        { 
          error: 'Too Many Requests',
          message: 'Analytics API rate limit exceeded. Limit: 30 requests per minute.',
          retryAfter: 60
        },
        429,
        { 'Retry-After': '60' }
      )
    }
  ),
  async (c) => {
  // Verify API key using constant-time comparison to prevent timing attacks
  const authHeader = c.req.header('Authorization') || ''
  const expected = `Bearer ${c.env.ANALYTICS_API_KEY}`
  const isValid = await constantTimeCompare(authHeader, expected)
  
  if (!isValid) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  // Parse time range (Unix timestamps)
  const since = parseInt(c.req.query('since') || '0')
  const until = parseInt(c.req.query('until') || String(Math.floor(Date.now() / 1000)))

  if (isNaN(since) || isNaN(until)) {
    return c.json({ error: 'Invalid time range' }, 400)
  }

  try {
    // Fetch clicks with username from links table
    const result = await c.env.DB.prepare(`
      SELECT 
        c.slug,
        c.clicked_at,
        c.referrer,
        c.country,
        c.city,
        c.device_type,
        c.browser,
        c.os,
        c.visitor_hash,
        l.created_by
      FROM clicks c
      JOIN links l ON c.slug = l.slug
      WHERE c.clicked_at >= ?1 AND c.clicked_at < ?2
      ORDER BY c.clicked_at ASC
    `).bind(since, until).all<ClickRow>()

    return c.json({
      clicks: result.results,
      meta: {
        since,
        until,
        count: result.results?.length || 0,
      }
    })
  } catch (error) {
    console.error('Analytics query failed:', error)
    return c.json({ error: 'Database error' }, 500)
  }
})

// Redirect handler with click tracking and rate limiting
// Limit: 60 requests per 10 seconds per IP+slug combo (prevents click inflation)
app.get('/:slug',
  createRateLimiter(
    (c) => c.env.REDIRECT_RATE_LIMITER,
    {
      keyFunc: (c) => {
        const ip = getClientIP(c)
        const slug = c.req.param('slug')
        return compositeKey(ip, slug)
      },
      errorResponse: (c) => {
        // Return a simple HTML page for redirect rate limits (user-facing)
        return new Response(
          `<!DOCTYPE html>
<html>
<head><title>Rate Limited</title></head>
<body>
<h1>Too Many Requests</h1>
<p>You're clicking too fast! Please wait a moment and try again.</p>
</body>
</html>`,
          {
            status: 429,
            headers: {
              'Content-Type': 'text/html',
              'Retry-After': '10'
            }
          }
        )
      }
    }
  ),
  async (c) => {
  const slug = c.req.param('slug')
  
  // Skip reserved slugs (case-insensitive, matches scripts/sync-links.ts validation)
  if (RESERVED_SLUGS.has(slug.toLowerCase())) {
    return c.notFound()
  }
  
  // Look up the URL in KV
  const linkDataRaw = await c.env.LINKS.get(slug)
  
  if (!linkDataRaw) {
    return c.notFound()
  }

  // Parse link data
  let linkData: LinkData
  try {
    linkData = JSON.parse(linkDataRaw)
  } catch {
    // Legacy format: raw URL string
    linkData = { url: linkDataRaw, createdAt: 0, createdBy: 'unknown' }
  }

  // Security: Validate URL before redirecting (prevents javascript:, data:, etc.)
  if (!isValidRedirectUrl(linkData.url)) {
    console.error(`Invalid redirect URL for slug ${slug}: ${linkData.url}`)
    return c.notFound()
  }

  // Record the click asynchronously (don't block redirect)
  c.executionCtx.waitUntil(recordClick(c, slug))
  
  // 302 temporary redirect - safer for user-generated content
  return c.redirect(linkData.url, 302)
})

async function recordClick(c: any, slug: string): Promise<void> {
  try {
    const now = Math.floor(Date.now() / 1000)
    const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD for hash salt
    
    // Extract data from request (truncate UA to prevent storage abuse)
    const rawUa = c.req.header('User-Agent')
    const ua = rawUa ? rawUa.slice(0, MAX_UA_LENGTH) : null
    const rawReferrer = c.req.header('Referer')
    const referrer = rawReferrer ? rawReferrer.slice(0, MAX_REFERRER_LENGTH) : null
    const cf = (c.req.raw as any).cf || {}
    
    // Parse user agent
    const parsed = parseUserAgent(ua)
    
    // Hash IP for unique visitor tracking (with daily salt)
    const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'
    const visitorHash = await hashIP(ip, today)

    // Insert click record
    await c.env.DB.prepare(`
      INSERT INTO clicks (slug, clicked_at, referrer, country, city, device_type, browser, os, visitor_hash, user_agent)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
    `).bind(
      slug,
      now,
      referrer,
      cf.country || null,
      cf.city || null,
      parsed.deviceType,
      parsed.browser,
      parsed.os,
      visitorHash,
      ua
    ).run()

    // Increment denormalized counter (best effort)
    await c.env.DB.prepare(`
      UPDATE links SET clicks = clicks + 1 WHERE slug = ?1
    `).bind(slug).run()

  } catch (error) {
    // Log but don't fail the redirect
    console.error('Failed to record click:', error)
  }
}

// Root - could be a landing page later
app.get('/', (c) => {
  return c.json({
    name: 'gitly.sh',
    description: 'URL shortener for developers',
    docs: 'https://github.com/andrewmurphyio/gitly.sh'
  })
})

export default app
