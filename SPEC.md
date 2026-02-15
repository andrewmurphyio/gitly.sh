# gitly.sh - URL Shortener for Developers

## Vision
A fast, developer-focused URL shortener. Like bit.ly, but built for the git workflow.

## Tech Stack

| Component | Technology |
|-----------|------------|
| **Hosting** | Cloudflare Workers (edge) |
| **Framework** | Hono (TypeScript) |
| **URL Storage** | Cloudflare KV |
| **Analytics** | Cloudflare D1 (SQLite) |
| **Monorepo** | pnpm workspaces + Turborepo |
| **Dashboard** | Cloudflare Pages (future) |

See [ADR-001](./docs/decisions/001-hosting.md) and [ADR-002](./docs/decisions/002-technology.md) for decision rationale.

## Core Features (MVP)

### URL Shortening
- Create short URLs from long URLs
- Custom slugs (e.g., `gitly.sh/my-project`)
- Auto-generated slugs when not specified
- QR code generation

### Analytics
- Click tracking
- Referrer data
- Geographic distribution
- Time-based charts

### Developer Experience
- API-first design
- CLI tool
- GitHub Action for automatic link creation
- Browser extension

## Future Ideas
- GitHub/GitLab integration (auto-shorten repo URLs)
- Link groups/collections
- Team workspaces
- Expiring links
- Password-protected links
- Custom domains

## Non-Goals (for now)
- Enterprise features
- Complex user management
- Monetization

---

*This spec evolves as we build. PRs welcome to refine scope.*
