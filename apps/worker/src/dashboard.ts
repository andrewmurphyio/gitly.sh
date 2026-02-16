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
    margin-bottom: 2rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid #333;
  }
  h1 {
    font-size: 1.5rem;
    font-weight: 600;
    color: #fafafa;
  }
  h1 span { color: #888; }
  .stats {
    margin-top: 0.5rem;
    font-size: 0.875rem;
    color: #888;
  }
  .links {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .link-card {
    background: #141414;
    border: 1px solid #333;
    border-radius: 8px;
    padding: 1rem;
    display: flex;
    gap: 1rem;
    align-items: flex-start;
  }
  .link-card:hover {
    border-color: #555;
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
  }
  .slug {
    font-weight: 600;
    font-size: 1rem;
    margin-bottom: 0.25rem;
  }
  .slug a {
    color: #60a5fa;
    text-decoration: none;
  }
  .slug a:hover {
    text-decoration: underline;
  }
  .target {
    font-size: 0.875rem;
    color: #888;
    word-break: break-all;
    margin-bottom: 0.5rem;
  }
  .meta {
    display: flex;
    gap: 1rem;
    font-size: 0.75rem;
    color: #666;
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
    .link-card {
      flex-direction: column;
      align-items: center;
      text-align: center;
    }
    .qr-code {
      width: 120px;
      height: 120px;
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
  const username = c.req.param('username')
  
  // Validate username format (alphanumeric, hyphens, underscores)
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
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
