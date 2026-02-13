# git.ly - URL Shortener for Developers

## Vision
A fast, developer-focused URL shortener. Like bit.ly, but built for the git workflow.

## Core Features (MVP)

### URL Shortening
- Create short URLs from long URLs
- Custom slugs (e.g., `git.ly/my-project`)
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

## Tech Stack (TBD)
- **Options to consider:**
  - Cloudflare Workers (edge performance)
  - Next.js + Vercel
  - Go/Rust for raw speed
  - PostgreSQL or Redis for storage

## Non-Goals (for now)
- Enterprise features
- Complex user management
- Monetization

---

*This spec evolves as we build. PRs welcome to refine scope.*
