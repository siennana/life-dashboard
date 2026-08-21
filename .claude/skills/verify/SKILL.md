---
name: verify
description: How to drive the running app to verify web/UI changes end-to-end.
---

# Verifying changes in the running app

The surface is the web app at `http://localhost:5173` (vite) backed by the API on `:3001`. `pnpm dev` is usually **already running** in the user's terminal — check with `Get-NetTCPConnection -LocalPort 3001,5173 -State Listen` and drive the existing servers; never kill them (see the :3001 stale-process gotcha in CLAUDE.md before starting your own).

## Browser driving (headless)

No browser tooling in the repo; Playwright browser builds are already cached in `$LOCALAPPDATA/ms-playwright`. Install the package in the session scratchpad (fast, no browser download):

```bash
cd <scratchpad> && npm init -y && npm i playwright
```

Then a plain `node script.mjs` with `chromium.launch()` works. The API bearer token is baked into the dev bundle, so a fresh headless page authenticates like the real browser — no login step.

## Useful patterns

- SPA routes load directly (`page.goto("http://localhost:5173/settings")`); after client-side navigation give queries ~1s to settle.
- **Theme/style checks without touching saved settings**: Settings dropdown changes preview live (no Save needed), and leaving the page reverts them — or stamp `document.documentElement.dataset.theme = "..."` directly on any page (same mechanism `applyUiSettings` uses). Assert via `getComputedStyle(document.documentElement).getPropertyValue("--color-zinc-950")`.
- Screenshots at 1440×900 capture the full sidebar + a month of calendar.
- Avoid saving settings or toggling DB-mutating controls during verification — the app runs against the shared Neon database with real data.
