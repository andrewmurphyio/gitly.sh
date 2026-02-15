# ADR-003: URL/Domain Structure

**Status:** Accepted ✅
**Issue:** #3
**Date:** 2026-02-15
**Decided:** 2026-02-15

## Context

We need to decide what domain short URLs will use and how routing works.

## Decision

**Domain:** `gitly.sh`

- Registered on 2026-02-15
- ~$31/yr first year, ~$47/yr renewal via Porkbun

## URL Structure

```
gitly.sh/{slug}        → Redirect
gitly.sh/api/*         → API endpoints
gitly.sh/_/*           → Dashboard (future)
```

## Reserved Slugs

- `api`, `_`, `app`, `dashboard`, `admin`
- `health`, `status`, `metrics`
- Any slug starting with underscore

## Notes

All short .sh puns (sla.sh, pu.sh, fla.sh, etc.) were taken. `gitly.sh` was the best available option that's:
- Short enough
- Dev-themed
- Memorable
- Available
