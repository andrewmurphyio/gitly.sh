import { Hono } from 'hono'

type Bindings = {
  LINKS: KVNamespace
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

// Redirect handler
app.get('/:slug', async (c) => {
  const slug = c.req.param('slug')
  
  // Look up the URL in KV
  const url = await c.env.LINKS.get(slug)
  
  if (!url) {
    return c.notFound()
  }
  
  // 302 temporary redirect - safer for user-generated content
  // (301s are cached by browsers indefinitely, making malicious link removal ineffective)
  return c.redirect(url, 302)
})

// Root - could be a landing page later
app.get('/', (c) => {
  return c.json({
    name: 'gitly.sh',
    description: 'URL shortener for developers',
    docs: 'https://github.com/andrewmurphyio/gitly.sh'
  })
})

export default app
