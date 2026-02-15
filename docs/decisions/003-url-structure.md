# ADR-003: URL/Domain Structure

**Status:** Proposed  
**Issue:** #3  
**Date:** 2026-02-15

## Context

We need to decide what domain short URLs will use and how routing works.

## Options Considered

### Option A: Acquire git.ly domain
- Clean, memorable
- Cost: ~$50-500/year depending on availability
- Risk: may not be available or expensive

### Option B: Use existing domain *(Recommended)*
- Free
- e.g., `go.andrewmurphy.io` or `l.andrewmurphy.io`
- Less memorable but works for MVP

### Option C: Buy a different short domain
- `.ly`, `.io`, `.sh`, `.link` options
- Could find something available and cheap

## URL Structure

```
{domain}/{slug}        → Redirect
{domain}/api/*         → API endpoints
{domain}/_/*           → Dashboard (future)
```

## Reserved Slugs

- `api`, `_`, `app`, `dashboard`, `admin`
- `health`, `status`, `metrics`
- Any slug starting with underscore

## Recommendation

Start with existing domain (`go.andrewmurphy.io`) for MVP. Acquire short domain later if project succeeds.

## Decision

*Pending — awaiting input from @andrewmurphyio*
