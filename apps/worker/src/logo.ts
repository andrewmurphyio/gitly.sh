import { Context } from 'hono'

/**
 * Logo endpoint handler
 * 
 * Fetches a user's logo.png from their GitHub folder and serves it with caching.
 * Logos are stored at: links/<username>/logo.png in the gitly.sh repo
 * 
 * Returns:
 * - 200 with image/png on success
 * - 204 No Content when logo doesn't exist
 * - 400 for invalid username
 * - 502 for upstream fetch failures
 */

// GitHub raw content URL for the gitly.sh repository
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/andrewmurphyio/gitly.sh/main/links'

// Cache TTL: 1 hour (matches other assets)
const CACHE_TTL_SECONDS = 3600

// Maximum logo size: 2MB
const MAX_LOGO_SIZE = 2 * 1024 * 1024

// Fetch timeout: 10 seconds
const LOGO_FETCH_TIMEOUT = 10000

// Username validation: alphanumeric, hyphens, underscores (GitHub username rules)
const USERNAME_PATTERN = /^[a-zA-Z0-9][-a-zA-Z0-9_]*$/

/**
 * Validate username format to prevent path traversal and injection
 */
function isValidUsername(username: string): boolean {
  if (!username || username.length > 39) return false // GitHub max is 39 chars
  if (username.startsWith('-') || username.endsWith('-')) return false
  return USERNAME_PATTERN.test(username)
}

/**
 * Build cache key for a user's logo
 */
function buildCacheKey(username: string): string {
  return `https://gitly.sh/api/logo/${username}`
}

export async function handleLogo(c: Context) {
  const username = c.req.param('username')
  
  // Validate username format
  if (!isValidUsername(username)) {
    return c.json({ error: 'Invalid username format' }, 400)
  }

  // Check cache first
  const cache = caches.default
  const cacheKey = buildCacheKey(username)
  const cacheRequest = new Request(cacheKey)
  
  const cachedResponse = await cache.match(cacheRequest)
  if (cachedResponse) {
    return cachedResponse
  }

  // Fetch logo from GitHub
  const logoUrl = `${GITHUB_RAW_BASE}/${username}/logo.png`
  
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), LOGO_FETCH_TIMEOUT)
  
  let response: Response
  try {
    response = await fetch(logoUrl, { 
      signal: controller.signal,
      headers: {
        // Include user-agent so GitHub doesn't reject the request
        'User-Agent': 'gitly.sh-worker/1.0'
      }
    })
  } catch (error) {
    clearTimeout(timeout)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    
    if (errorMessage.includes('abort')) {
      return c.json({ error: 'Logo fetch timeout' }, 504)
    }
    
    console.error(`Logo fetch failed for ${username}:`, error)
    return c.json({ error: 'Failed to fetch logo' }, 502)
  } finally {
    clearTimeout(timeout)
  }

  // Handle 404 - logo doesn't exist
  if (response.status === 404) {
    // Return 204 No Content (cacheable)
    const noContentResponse = new Response(null, {
      status: 204,
      headers: {
        'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
      },
    })
    
    // Cache the 204 response to avoid repeated GitHub requests
    c.executionCtx.waitUntil(cache.put(cacheRequest, noContentResponse.clone()))
    
    return noContentResponse
  }

  // Handle other non-success status codes
  if (!response.ok) {
    console.error(`Logo fetch returned ${response.status} for ${username}`)
    return c.json({ error: 'Failed to fetch logo' }, 502)
  }

  // Verify content-type is PNG
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim()
  if (contentType !== 'image/png') {
    console.error(`Invalid logo content-type for ${username}: ${contentType}`)
    return c.json({ error: 'Invalid logo format' }, 502)
  }

  // Check content-length if available
  const contentLength = response.headers.get('content-length')
  if (contentLength) {
    const size = parseInt(contentLength, 10)
    if (!isNaN(size) && size > MAX_LOGO_SIZE) {
      return c.json({ error: 'Logo exceeds maximum size' }, 413)
    }
  }

  // Read the body
  const logoBuffer = await response.arrayBuffer()
  
  // Verify actual size
  if (logoBuffer.byteLength > MAX_LOGO_SIZE) {
    return c.json({ error: 'Logo exceeds maximum size' }, 413)
  }

  // Validate PNG magic bytes
  const bytes = new Uint8Array(logoBuffer)
  const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  const isPng = PNG_MAGIC.every((byte, i) => bytes[i] === byte)
  
  if (!isPng) {
    console.error(`Logo for ${username} failed PNG magic byte validation`)
    return c.json({ error: 'Invalid logo format' }, 502)
  }

  // Build successful response
  const logoResponse = new Response(logoBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
      'Content-Length': String(logoBuffer.byteLength),
    },
  })

  // Cache the response
  c.executionCtx.waitUntil(cache.put(cacheRequest, logoResponse.clone()))

  return logoResponse
}
