# ADR-006: Data Model

**Status:** Accepted  
**Issue:** #6  
**Date:** 2026-02-15

## Context

Define what we store for each short link across KV and D1.

## Storage Architecture

### Cloudflare KV (Fast Lookups)
Used for redirects — must be fast.

```
Key: "link:{slug}"
Value: { "url": "https://...", "createdAt": 1234567890, "createdBy": "github-username" }
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
| `created_by` | TEXT | GitHub username |
| `expires_at` | INTEGER | Optional expiry |
| `clicks` | INTEGER DEFAULT 0 | Denormalized counter |

### `clicks` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `slug` | TEXT | FK to links |
| `clicked_at` | INTEGER | Unix timestamp |
| `referrer` | TEXT | HTTP referrer |
| `country` | TEXT | From CF `cf.country` |
| `city` | TEXT | From CF `cf.city` |
| `device_type` | TEXT | Mobile/Desktop/Tablet |
| `browser` | TEXT | Chrome/Safari/Firefox/etc |
| `os` | TEXT | Windows/macOS/iOS/Android |
| `visitor_hash` | TEXT | Hashed IP for unique visitor tracking |
| `user_agent` | TEXT | Raw user-agent string |

## Design Decisions

| Question | Decision |
|----------|----------|
| Individual clicks vs counters? | Individual (richer analytics) |
| Soft vs hard delete? | Hard delete |
| IP handling | Hash for privacy, enables unique visitor tracking |
| Device/browser parsing | Parse UA on click, store breakdown |

## Decision

Store individual clicks with full analytics data (per ADR-007). Parse user-agent for device/browser/OS. Hash IP for unique visitor tracking while preserving privacy.
