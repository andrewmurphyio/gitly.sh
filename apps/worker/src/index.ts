import { Hono } from 'hono'
import { handleQR } from './qr'
import { parseUserAgent, hashIP } from './ua-parser'
import { constantTimeCompare } from './crypto'

type Bindings = {
  LINKS: KVNamespace
  DB: D1Database
  ANALYTICS_API_KEY: string // Secret for analytics export
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

const app = new Hono<{ Bindings: Bindings }>()

// Security headers middleware
app.use('*', async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
})

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }))

// QR code endpoint - must be before generic redirect handler
app.get('/:slug/qr', handleQR)

// Analytics API - protected by API key
app.get('/api/analytics', async (c) => {
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

// Redirect handler with click tracking
app.get('/:slug', async (c) => {
  const slug = c.req.param('slug')
  
  // Skip API routes
  if (slug === 'api' || slug === 'health') {
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

  // Record the click asynchronously (don't block redirect)
  c.executionCtx.waitUntil(recordClick(c, slug))
  
  // 302 temporary redirect - safer for user-generated content
  return c.redirect(linkData.url, 302)
})

async function recordClick(c: any, slug: string): Promise<void> {
  try {
    const now = Math.floor(Date.now() / 1000)
    const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD for hash salt
    
    // Extract data from request
    const ua = c.req.header('User-Agent') || null
    const referrer = c.req.header('Referer') || null
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
