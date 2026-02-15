# ADR-001: Hosting Platform

**Status:** Accepted ✅  
**Issue:** #1  
**Date:** 2026-02-13  
**Decided:** 2026-02-15

## Context

We need to choose a hosting platform for git.ly. Key requirements:
- Free tier (or very cheap)
- Fast redirects (this is a URL shortener)
- Simple deployment

## Options Considered

### Option A: Cloudflare Workers + KV ✅

| Aspect | Details |
|--------|---------|
| Free tier | 100k requests/day, 1GB KV storage |
| Latency | ~10ms globally (edge) |
| Deployment | `wrangler deploy` |
| Storage | KV built-in, D1 for SQL |

**Pros:**
- Fastest possible redirects (runs at edge)
- KV is perfect for slug→URL lookups
- No cold starts
- Andrew already has Cloudflare set up

**Cons:**
- Workers runtime constraints (no Node.js APIs)
- KV is eventually consistent (fine for shortlinks)

### Option B: Vercel

| Aspect | Details |
|--------|---------|
| Free tier | 100GB bandwidth |
| Latency | ~50-100ms |
| Deployment | Git push |
| Storage | External (Turso, Upstash, etc.) |

**Pros:**
- Great DX with Next.js
- Edge middleware for redirects
- Full React for dashboard

**Cons:**
- More overhead than Workers
- Need external database

### Option C: Deno Deploy

| Aspect | Details |
|--------|---------|
| Free tier | 1M requests/month |
| Latency | ~20ms |
| Deployment | Git or CLI |
| Storage | Deno KV |

**Pros:**
- Native TypeScript
- Good edge distribution
- Built-in KV

**Cons:**
- Smaller ecosystem
- Less familiar

### Option D: Self-hosted (Fly.io, Render, Railway)

**Pros:**
- Maximum control
- Can use any tech

**Cons:**
- More ops overhead
- Cold starts or always-on costs
- Overkill for MVP

## Decision

**Cloudflare Workers** — best performance for a URL shortener, generous free tier, and existing Cloudflare infrastructure.
