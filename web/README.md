# dsh-why

DeepSeek Harness (dsh) failure diagnostics — paste the red-screen error and get what's missing, when official dsh changed it, and the fix, entirely in your browser. The CLI (`npx dsh-why`) reads your actual install; this page can't, so it never pretends to.

## Data this page consumes

All fetched from dsh-insights.com (CORS-open), with the module tables and known-fix case base also bundled in this repo as an offline fallback:

- `https://dsh-insights.com/data/shell-seeds.json` — per-shell module tables
- `https://dsh-insights.com/data/shell-rows.json` — per-shell client graph rows
- `https://dsh-insights.com/data/fixes.json` — known-fix case base
- `https://dsh-insights.com/data/compat-observed.json` — observed-compat matrix

## Local preview

No build step. Serve the repo root and open `/`:

```bash
python3 -m http.server 8080
# → http://localhost:8080/          (landing + paste box)
```

Shareable prefill: `/?e=<url-encoded error>&v=0.1.2-rc.1&lang=zh`.

## Keeping the web version in sync

The page reports the tool version in its report footer (`web/app.mjs`'s `toolVersion`); bump it alongside `package.json` on each release.

## Deployment

GitHub Actions builds a clean artifact (`.github/workflows/pages.yml`) — `index.html`, `web/`, `lib/`, `llms.txt`, `robots.txt`, `sitemap.xml` — and deploys it to Pages. Set **Settings → Pages → Source: GitHub Actions**, and **Custom domain: dsh-why.com** (then Enforce HTTPS). Before the domain resolves, the site previews at `https://ice5kysl.github.io/dsh-why/`.

## Why it is honest by construction

The page reads no local install, so a require it cannot attribute is reported as *unclassified* (never a false "crash"), and a built-in graph-row require is *conditional* — the same three-tier model the CLI uses. If the published row roster is unreachable, the diagnosis degrades further to unclassified warnings rather than inventing crashes.
