# ADR-008: Analytics Export via GitHub Actions

**Status:** Accepted  
**Issue:** #15  
**Date:** 2026-02-15

## Context

Per ADR-006 and ADR-007, the Worker collects click analytics in D1. Users need access to their analytics data within their repo folders, following the GitHub-native philosophy.

## Decision

### Sync Mechanism

GitHub Actions workflow runs hourly, queries the analytics API for new clicks, and commits daily CSV files to each user's folder.

### File Structure

```
links/<username>/analytics/2026/02/15.csv
```

Nested `{year}/{month}/{day}.csv` structure with all times in UTC.

### CSV Format

```csv
clicked_at,slug,referrer,country,city,device_type,browser,os
2026-02-15T03:22:41Z,abc123,https://twitter.com,US,San Francisco,mobile,Safari,iOS
```

Columns sourced from ADR-007 click data.

### Authentication

Fine-grained GitHub PAT with:
- `contents: write` on the repo
- Stored as Actions secret (`GH_PAT` or similar)

### Timing

- Workflow runs at `:00` each hour
- Fetches clicks from the last hour (with overlap buffer to avoid gaps)
- Appends to today's CSV (creates file if missing)

### Scope

Raw click data only. No aggregation or summary files for MVP.

## Consequences

### Positive

- Users see analytics in their folder — zero dashboard needed
- Data is portable, diffable, version-controlled
- Can build downstream tooling (charts, alerts) on plain CSVs
- Fits GitHub-native philosophy

### Negative

- Hourly commits add noise to git history
- Large-scale usage = large CSVs (acceptable tradeoff)
- PAT rotation is manual

### Deferred

- `summary.csv` with daily/weekly aggregates
- Webhook-based real-time sync
- User-configurable export frequency
- Compression of old months (`.csv.gz`)
