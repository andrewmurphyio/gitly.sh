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

## Development

This project is being built collaboratively between a human and AI agents. See:
- [SPEC.md](./SPEC.md) — Project vision and requirements
- [AGENTS.md](./AGENTS.md) — Development guidelines

## License

MIT
