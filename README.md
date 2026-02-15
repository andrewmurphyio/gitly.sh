# gitly.sh

A URL shortener for developers.

## Status

🚧 **Under Construction** — We're just getting started.

## What is this?

A fast, API-first URL shortener built for the development workflow. Think bit.ly, but for git people.

## Adding Your Links

Want to add short links? It's as simple as opening a PR.

### Quick Start

1. **Fork this repository**

2. **Create your links file** at `links/<your-github-username>/links.csv`:
   ```csv
   slug,url
   gh,https://github.com/yourusername
   blog,https://yourblog.com
   ```

3. **Open a pull request** to the `main` branch

4. **Automated validation** will check your links and ensure you're only modifying your own folder

5. **Once merged**, your links will be live at `gitly.sh/<slug>`

### CSV Format

Your `links.csv` file should have two columns:
- **slug** — The short path (e.g., `gh` becomes `gitly.sh/gh`)
- **url** — The destination URL

Example:
```csv
slug,url
gh,https://github.com/octocat
twitter,https://twitter.com/octocat
portfolio,https://octocat.io
```

### Rules

- You can only edit files in `links/<your-github-username>/`
- Slugs must be unique across your links
- URLs must be valid and accessible

### Need a different username?

If you want to claim a folder that doesn't match your GitHub username, [open an issue](https://github.com/andrewmurphyio/gitly.sh/issues/new) to request it.

## Analytics

Every click on your short links is tracked automatically. Analytics data is exported to your folder as CSV files — no dashboard login required.

### What We Track

| Data Point | Description |
|------------|-------------|
| Click timestamp | When the link was clicked (UTC) |
| Referrer | Where the click came from |
| Country & City | Geographic location (via Cloudflare) |
| Device type | Mobile, Desktop, or Tablet |
| Browser | Chrome, Safari, Firefox, etc. |
| OS | iOS, Android, Windows, macOS, etc. |
| Unique visitors | Hashed daily (privacy-preserving) |

### How It Works

1. **Click happens** → Analytics recorded instantly at the edge
2. **Hourly export** → GitHub Actions syncs new clicks to your folder
3. **CSV files** → Raw data appears in `links/<username>/analytics/YYYY/MM/DD.csv`

### File Structure

```
links/<your-username>/
├── links.csv
└── analytics/
    └── 2026/
        └── 02/
            ├── 14.csv
            └── 15.csv
```

### CSV Format

```csv
clicked_at,slug,referrer,country,city,device_type,browser,os
2026-02-15T03:22:41Z,gh,https://twitter.com,US,San Francisco,mobile,Safari,iOS
2026-02-15T10:15:33Z,blog,https://google.com,GB,London,desktop,Chrome,Windows
```

### Privacy

- **No cookies** — We don't use tracking cookies
- **No fingerprinting** — Just basic request headers
- **IP hashing** — IPs are hashed daily for unique visitor counts, then discarded
- **Your data** — Analytics live in your folder, version-controlled and portable

### Why GitHub-Native?

Your analytics are just files in your folder:
- **Diffable** — See changes over time in git history
- **Portable** — Download, analyze, or migrate anytime
- **Programmable** — Build your own charts, alerts, or dashboards on top

## Development

This project is being built collaboratively between a human and AI agents. See:
- [SPEC.md](./SPEC.md) — Project vision and requirements
- [AGENTS.md](./AGENTS.md) — Development guidelines

## License

MIT
