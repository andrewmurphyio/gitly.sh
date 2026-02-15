# ADR-007: MVP Analytics Scope

**Status:** Proposed  
**Issue:** #7  
**Date:** 2026-02-15

## Context

What analytics do we track and display in v1?

## Options

### Option A: Minimal (Counter Only)
- Just click count per link
- No breakdown
- Simplest implementation

### Option B: Basic Analytics *(Recommended)*
- Click count
- Clicks over time (daily)
- Top referrers
- Country breakdown
- Store data, query via API (no dashboard yet)

### Option C: Full Analytics
- Everything in B plus:
- Device/browser breakdown
- Unique vs repeat visitors
- Real-time dashboard
- Complex, defer to later

## Data Available from Cloudflare

Workers automatically have access to:
- `request.cf.country` — Country code
- `request.cf.city` — City name  
- `request.cf.timezone` — Timezone
- `request.headers.get('referer')` — Referrer
- `request.headers.get('user-agent')` — User agent

## Storage Impact

| Metric | Value |
|--------|-------|
| Bytes per click | ~100 |
| 1M clicks | ~100MB |
| D1 free tier | 5GB storage |
| Headroom | Plenty |

## Recommendation

**Option B** — Store rich click data from day one. Easy to store, hard to backfill. Dashboard can come later.

## Decision

*Pending — awaiting input from @andrewmurphyio*
