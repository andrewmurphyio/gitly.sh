# ADR-005: Interface Design (GitHub PR-based)

**Status:** Accepted  
**Issue:** #5  
**Date:** 2026-02-15

## Context

Define how users create and manage short links.

## The Pivot: GitHub PRs as Interface

Instead of a traditional API, users interact with git.ly via GitHub Pull Requests. This is a dev-focused URL shortener — the workflow should feel native to developers.

## How It Works

### Creating Links

1. User forks the repo (or edits directly if collaborator)
2. Creates/updates their CSV file at `links/<github-username>/links.csv`
3. Opens PR
4. CI validates:
   - URL is valid and reachable
   - Slug is available (not taken)
   - Slug meets format rules
   - User is only editing their own folder
5. PR merged → GitHub Action syncs to Cloudflare KV/D1
6. Link is live immediately after merge

### Link CSV Format

```csv
slug,url,created_at
my-project,https://github.com/user/repo,2024-02-15
blog,https://myblog.dev,2024-02-15
```

### Directory Structure

```
links/
├── _global/              # Reserved slugs (admin only)
│   └── links.csv
├── andrewmurphyio/       # User's links
│   └── links.csv
├── someuser/
│   └── links.csv
└── anotherdev/
    └── links.csv
```

## Key Decisions

| Question | Decision |
|----------|----------|
| Namespace | Flat — all slugs share global namespace |
| Visibility | Fully open source — all links visible |
| Edit permissions | Users can only edit their own `links/<username>/` folder |
| Analytics export | Periodic job updates CSV with click counts |

## Why This Approach

- **Git-native**: Version history, PRs, code review — all built-in
- **No API keys**: GitHub auth handles identity
- **Transparent**: All links are public, auditable
- **Simple hosting**: Just Cloudflare Workers + KV, no auth layer

## Traditional API

No REST API for link creation in v1. The redirect endpoint (`/:slug`) is the only HTTP interface.

Future consideration: Read-only API for fetching analytics.
