# ADR-005: API Design

**Status:** Proposed  
**Issue:** #5  
**Date:** 2026-02-15

## Context

Define the API for creating and managing short links.

## Proposed Endpoints (MVP)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/links` | Create short link |
| `GET` | `/api/links/:slug` | Get link details |
| `DELETE` | `/api/links/:slug` | Delete link |
| `GET` | `/:slug` | Redirect |

## Future Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/links` | List all links |
| `PATCH` | `/api/links/:slug` | Update link |
| `GET` | `/api/links/:slug/stats` | Analytics |

## Authentication Options

### Option A: API Key
- Header: `Authorization: Bearer <key>`
- Secure, standard
- Requires key management

### Option B: No Auth (MVP) *(Recommended)*
- Public creation, rate limited
- Simpler for MVP
- Add auth later

### Option C: Simple Token
- Single admin token for delete/manage
- Middle ground

## Rate Limiting

| Action | Limit |
|--------|-------|
| Create link | 10/hour per IP |
| Redirects | Unlimited |
| API reads | 100/hour per IP |

## Request/Response Format

```json
// POST /api/links
{ "url": "https://...", "slug": "optional" }

// Response
{
  "slug": "abc123",
  "shortUrl": "https://go.example.com/abc123",
  "originalUrl": "https://...",
  "createdAt": "2024-01-01T00:00:00Z"
}
```

## Recommendation

No auth for MVP, rate limit by IP. Add API keys later for power users.

## Decision

*Pending — awaiting input from @andrewmurphyio*
