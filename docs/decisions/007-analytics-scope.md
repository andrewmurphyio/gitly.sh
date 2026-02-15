# ADR-007: MVP Analytics Scope

**Status:** Accepted  
**Issue:** #7  
**Date:** 2026-02-15

## Context

What analytics do we track and display in v1?

## Decision: Option B+ (Enhanced Basic Analytics)

Everything in the "Basic Analytics" option, plus device/browser breakdown and unique visitor tracking.

### What We Capture

| Data Point | Source | Storage |
|------------|--------|---------|
| Click timestamp | Server | `clicked_at` |
| Referrer | `Referer` header | `referrer` |
| Country | `cf.country` | `country` |
| City | `cf.city` | `city` |
| Device type | User-Agent parsing | `device_type` |
| Browser | User-Agent parsing | `browser` |
| OS | User-Agent parsing | `os` |
| Visitor hash | Hashed IP | `visitor_hash` |
| Raw UA | `User-Agent` header | `user_agent` |

### Analytics Available

- Total click count
- Clicks over time (daily/hourly aggregation)
- Top referrers
- Country/city breakdown
- Device type breakdown (Mobile/Desktop/Tablet)
- Browser breakdown
- OS breakdown
- Unique vs repeat visitors (via hashed IP)

### What We Don't Build (Yet)

- Real-time dashboard
- Historical comparison
- Funnel analysis
- Custom date ranges via UI

Data is captured and queryable — dashboard comes later.

## Storage Impact

| Metric | Value |
|--------|-------|
| Bytes per click | ~150 (with extra fields) |
| 1M clicks | ~150MB |
| D1 free tier | 5GB storage |
| Headroom | Plenty |

## Decision

Capture rich analytics from day one. Easy to store, impossible to backfill. Export analytics periodically to CSV in user folders.
