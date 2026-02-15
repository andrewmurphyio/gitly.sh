# ADR-002: Technology Stack

**Status:** Proposed  
**Issue:** #2  
**Date:** 2026-02-13

## Context

We need to decide what technology to build git.ly with. This depends partly on the hosting decision (ADR-001).

## Options Considered

### Option A: Cloudflare Workers + Hono

**Stack:**
- Hono (lightweight web framework for Workers)
- Cloudflare KV for slug storage
- D1 (SQLite) or external DB for analytics
- Cloudflare Pages for dashboard (optional)

**Pros:**
- Fastest redirects possible
- Simple deployment
- TypeScript native
- Minimal dependencies

**Cons:**
- Workers runtime limitations
- Dashboard needs separate setup

### Option B: Next.js

**Stack:**
- Next.js App Router
- Edge middleware for redirects
- API routes for shortening
- Turso/Supabase/Upstash for storage
- React for dashboard

**Pros:**
- Familiar stack
- Full React for rich UI
- Great DX

**Cons:**
- Heavier than needed for simple redirects
- External DB required

### Option C: Go or Rust

**Stack:**
- Go (Chi/Fiber) or Rust (Axum)
- SQLite or Redis
- Deploy to Fly.io or VPS

**Pros:**
- Maximum performance
- Full control
- Fun to build

**Cons:**
- More ops work
- Separate frontend needed
- Overkill for MVP

### Option D: Other frameworks (Remix, SvelteKit, etc.)

Similar to Next.js with framework-specific tradeoffs.

## Key Question

How important is the dashboard/analytics UI vs the core shortening API?

- **API-first:** Workers + Hono is simpler
- **UI-heavy:** Next.js gives more flexibility

## Recommendation

If hosting is Cloudflare (ADR-001), then **Workers + Hono** is the natural fit:
- Matches the platform
- Minimal complexity
- Dashboard can be added later via Pages

## Decision

*Pending — awaiting input from @andrewmurphyio*
