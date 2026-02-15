import { Context, MiddlewareHandler } from 'hono'

/**
 * Cloudflare Workers Rate Limiting API binding
 * @see https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
 */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

interface RateLimitOptions {
  /** Function to extract the rate limit key from the request */
  keyFunc: (c: Context) => string | Promise<string>
  /** Optional custom error response */
  errorResponse?: (c: Context) => Response
}

/**
 * Creates a rate limiting middleware using Cloudflare's native Rate Limiting API.
 * 
 * @param binding - The rate limiter binding from env (e.g., env.QR_RATE_LIMITER)
 * @param options - Configuration options including key extraction function
 * @returns Hono middleware handler
 * 
 * @example
 * ```ts
 * app.use('/api/*', rateLimitMiddleware(
 *   (c) => c.env.API_RATE_LIMITER,
 *   { keyFunc: (c) => c.req.header('Authorization') || getClientIP(c) }
 * ))
 * ```
 */
export function createRateLimiter(
  getBinding: (c: Context) => RateLimitBinding,
  options: RateLimitOptions
): MiddlewareHandler {
  return async (c, next) => {
    const binding = getBinding(c)
    
    // If binding is not available (local dev without rate limiting), skip
    if (!binding?.limit) {
      return next()
    }

    const key = await options.keyFunc(c)
    
    // Empty key bypasses rate limiting (useful for trusted sources)
    if (!key) {
      return next()
    }

    const { success } = await binding.limit({ key })

    if (!success) {
      if (options.errorResponse) {
        return options.errorResponse(c)
      }
      
      return c.json(
        { 
          error: 'Too Many Requests',
          message: 'Rate limit exceeded. Please slow down.',
          retryAfter: 10 // Hint for clients
        },
        429,
        {
          'Retry-After': '10',
          'X-RateLimit-Limit': 'See rate limit documentation'
        }
      )
    }

    return next()
  }
}

/**
 * Extract client IP from Cloudflare headers.
 * Falls back to X-Forwarded-For for non-Cloudflare requests (local dev).
 */
export function getClientIP(c: Context): string {
  return (
    c.req.header('CF-Connecting-IP') ||
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown'
  )
}

/**
 * Generate a composite key for per-resource rate limiting.
 * Combines client IP with a resource identifier (e.g., slug).
 */
export function compositeKey(ip: string, resource: string): string {
  return `${ip}:${resource}`
}
