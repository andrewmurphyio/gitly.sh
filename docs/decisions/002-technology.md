# ADR-002: Technology Stack

**Status:** Accepted ✅  
**Issue:** #2  
**Date:** 2026-02-13  
**Decided:** 2026-02-15

## Context

We need to decide what technology to build git.ly with. Per ADR-001, we're using Cloudflare Workers for hosting.

## Options Considered

### Option A: Cloudflare Workers + Hono ✅

**Stack:**
- Hono (lightweight web framework for Workers)
- Cloudflare KV for slug storage
- D1 (SQLite) for analytics
- Cloudflare Pages for dashboard (future)

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

## Decision

**Cloudflare Workers + TypeScript monorepo:**

| Component | Technology |
|-----------|------------|
| Framework | Hono (or similar lightweight router) |
| URL Storage | Cloudflare KV |
| Analytics | Cloudflare D1 (SQLite) |
| Monorepo | pnpm workspaces + Turborepo |
| Dashboard | Cloudflare Pages (future) |

### Repository Structure

```
git.ly/
├── apps/
│   ├── worker/          # URL redirector (Cloudflare Worker)
│   │   ├── src/
│   │   └── wrangler.toml
│   └── dashboard/       # Admin UI (future, Cloudflare Pages)
│       └── src/
├── packages/
│   └── shared/          # Shared types, utils
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

### Key Constraints

- Keep architecture dashboard-friendly (don't make decisions that block adding UI later)
- Worker handles redirects at edge
- Dashboard will be added later as a separate Cloudflare Pages app
