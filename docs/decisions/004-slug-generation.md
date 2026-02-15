# ADR-004: Slug Generation Strategy

**Status:** Accepted  
**Issue:** #4  
**Date:** 2026-02-15

## Context

When a user creates a short link without specifying a custom slug, we need to generate one automatically.

## Options Considered

### Option A: Random Base62 *(Recommended)*
- Characters: `a-zA-Z0-9` (62 chars)
- 6 chars = 56 billion combinations
- Example: `Kj9xBm`
- Simple, URL-safe, case-sensitive for density

### Option B: Nanoid
- Same concept, well-tested library
- Cryptographically random
- Customizable alphabet

### Option C: Sequential + Encoding
- Auto-increment ID encoded to base62
- Shorter slugs early on
- Cons: Enumerable (security concern)

### Option D: Word-based
- e.g., `happy-tiger-42`
- Memorable but longer

## Parameters

| Parameter | Value |
|-----------|-------|
| Length | 6 characters |
| Alphabet | Base62 (a-zA-Z0-9) |
| Collision handling | Retry up to 3 times |
| Custom slugs | Allowed, 1-50 chars (updated via #119) |
| Custom validation | Alphanumeric + hyphens |

## Decision

**Accepted: Option A/B — 6-char Base62 using nanoid**

- Auto-generated slugs: 6 characters, Base62 alphabet
- Custom slugs allowed: 1-50 characters, alphanumeric + hyphens (single-char must be alphanumeric only)
- Collision handling: Retry generation up to 3 times before failing
