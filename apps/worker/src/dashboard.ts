import { Context } from 'hono'

interface LinkWithClicks {
  slug: string
  url: string
  created_at: number
  clicks: number
}

// CSS for the dashboard - minimal, mobile-responsive
const styles = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0a0a0a;
    color: #fafafa;
    min-height: 100vh;
    padding: 2rem 1rem;
  }
  .container {
    max-width: 800px;
    margin: 0 auto;
  }
  header {
    margin-bottom: 2.5rem;
    padding-bottom: 1.5rem;
    border-bottom: 1px solid #333;
  }
  h1 {
    font-size: 1.75rem;
    font-weight: 600;
    color: #fafafa;
    letter-spacing: -0.025em;
  }
  h1 span { color: #888; }
  .stats {
    margin-top: 0.75rem;
    font-size: 0.9rem;
    color: #888;
  }
  .links {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  .link-card {
    background: #141414;
    border: 1px solid #333;
    border-radius: 12px;
    padding: 1.25rem;
    display: flex;
    gap: 1.25rem;
    align-items: flex-start;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }
  .link-card:hover {
    border-color: #555;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }
  .qr-code {
    flex-shrink: 0;
    width: 80px;
    height: 80px;
    background: #fff;
    border-radius: 4px;
    overflow: hidden;
  }
  .qr-code img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .link-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .slug {
    font-weight: 600;
    font-size: 1.125rem;
  }
  .slug a {
    color: #60a5fa;
    text-decoration: none;
    transition: color 0.15s ease;
  }
  .slug a:hover {
    color: #93c5fd;
    text-decoration: underline;
  }
  .target {
    font-size: 0.875rem;
    color: #888;
    word-break: break-all;
    line-height: 1.4;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    font-size: 0.8rem;
    color: #666;
    margin-top: 0.25rem;
  }
  .clicks {
    background: #1e3a5f;
    color: #60a5fa;
    padding: 0.125rem 0.5rem;
    border-radius: 9999px;
    font-weight: 500;
  }
  .empty {
    text-align: center;
    padding: 3rem 1rem;
    color: #666;
  }
  .empty h2 {
    font-size: 1.25rem;
    margin-bottom: 0.5rem;
    color: #888;
  }
  footer {
    margin-top: 3rem;
    padding-top: 1rem;
    border-top: 1px solid #333;
    text-align: center;
    font-size: 0.75rem;
    color: #666;
  }
  footer a {
    color: #60a5fa;
    text-decoration: none;
  }
  @media (max-width: 480px) {
    body {
      padding: 1.5rem 1rem;
    }
    header {
      margin-bottom: 2rem;
    }
    h1 {
      font-size: 1.5rem;
    }
    .links {
      gap: 1.25rem;
    }
    .link-card {
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: 1.25rem 1rem;
    }
    .qr-code {
      width: 100px;
      height: 100px;
    }
    .link-info {
      align-items: center;
    }
    .meta {
      justify-content: center;
    }
  }
`

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function truncateUrl(url: string, maxLength = 60): string {
  if (url.length <= maxLength) return url
  return url.slice(0, maxLength - 3) + '...'
}

export async function handleDashboard(c: Context): Promise<Response> {
  // Support both /@:username route and fallback from /:slug route
  // When called from /:slug, the slug includes the @ prefix which we strip
  let username = c.req.param('username')
  if (!username) {
    const slug = c.req.param('slug')
    if (slug?.startsWith('@')) {
      username = slug.slice(1)
    }
  }
  
  // Validate username exists and matches format (alphanumeric, hyphens, underscores)
  if (!username || !/^[a-zA-Z0-9_-]+$/.test(username)) {
    return c.notFound()
  }

  try {
    // Fetch user's links with click counts
    const result = await c.env.DB.prepare(`
      SELECT slug, url, created_at, clicks
      FROM links
      WHERE created_by = ?1
      ORDER BY created_at DESC
    `).bind(username).all<LinkWithClicks>()

    const links = result.results || []
    const totalClicks = links.reduce((sum, link) => sum + (link.clicks || 0), 0)

    // Generate HTML
    const linksHtml = links.length > 0 
      ? links.map(link => `
        <div class="link-card">
          <div class="qr-code">
            <img src="/${escapeHtml(link.slug)}/qr?size=80" alt="QR code for ${escapeHtml(link.slug)}" loading="lazy">
          </div>
          <div class="link-info">
            <div class="slug">
              <a href="/${escapeHtml(link.slug)}" target="_blank">gitly.sh/${escapeHtml(link.slug)}</a>
            </div>
            <div class="target">${escapeHtml(truncateUrl(link.url))}</div>
            <div class="meta">
              <span class="clicks">${link.clicks || 0} clicks</span>
              <span>Created ${formatDate(link.created_at)}</span>
            </div>
          </div>
        </div>
      `).join('')
      : `
        <div class="empty">
          <h2>No links yet</h2>
          <p>This user hasn't created any links.</p>
        </div>
      `

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>@${escapeHtml(username)}'s Links - gitly.sh</title>
  <meta name="description" content="View all short links created by @${escapeHtml(username)} on gitly.sh">
  <style>${styles}</style>
</head>
<body>
  <div class="container">
    <header>
      <h1>@${escapeHtml(username)}<span>'s links</span></h1>
      <div class="stats">${links.length} link${links.length !== 1 ? 's' : ''} · ${totalClicks} total click${totalClicks !== 1 ? 's' : ''}</div>
    </header>
    <div class="links">
      ${linksHtml}
    </div>
    <footer>
      <a href="https://github.com/andrewmurphyio/gitly.sh">gitly.sh</a> - URL shortener for developers
    </footer>
  </div>
</body>
</html>`

    return c.html(html)
  } catch (error) {
    console.error('Dashboard query failed:', error)
    return c.text('Internal Server Error', 500)
  }
}
