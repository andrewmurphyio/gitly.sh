# ADR-006: Data Model

**Status:** Proposed  
**Issue:** #6  
**Date:** 2026-02-15

## Context

Define what we store for each short link across KV and D1.

## Storage Architecture

### Cloudflare KV (Fast Lookups)
Used for redirects — must be fast.

```
Key: "link:{slug}"
Value: { "url": "https://...", "createdAt": 1234567890 }
```

### Cloudflare D1 (Relational)
Used for admin, search, analytics.

## Schema

### `links` table

| Column | Type | Description |
|--------|------|-------------|
| `slug` | TEXT PK | Short URL slug |
| `url` | TEXT NOT NULL | Original URL |
| `created_at` | INTEGER | Unix timestamp |
| `created_by_ip` | TEXT | Creator IP (hashed?) |
| `expires_at` | INTEGER | Optional expiry |
| `clicks` | INTEGER DEFAULT 0 | Denormalized counter |

### `clicks` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `slug` | TEXT | FK to links |
| `clicked_at` | INTEGER | Unix timestamp |
| `referrer` | TEXT | HTTP referrer |
| `country` | TEXT | From CF headers |
| `user_agent` | TEXT | Browser info |

## Design Decisions

| Question | Recommendation |
|----------|----------------|
| Individual clicks vs counters? | Individual (richer analytics) |
| Fetch page title? | Skip for MVP |
| Soft vs hard delete? | Hard delete |
| Hash creator IP? | Yes (privacy) |

## Recommendation

Store individual clicks for rich analytics. Keep it simple — no title fetching, hard deletes, hashed IPs.

## Decision

*Pending — awaiting input from @andrewmurphyio*
