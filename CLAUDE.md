# Life Dashboard

Personal life-logging dashboard aggregating external apps (Todoist, Strava, Apple Health, Apple Calendar, Obsidian). Single user (Sienna). External apps stay the source of truth — we pull read-only by default and write back only where the API is good.

## Commands

```bash
pnpm dev            # api (tsx watch, :3001) + web (vite, :5173) in parallel
pnpm db:up          # start postgres via docker compose
pnpm db:generate    # drizzle-kit generate (after schema changes)
pnpm db:migrate     # apply migrations
pnpm typecheck      # all workspaces
```

Node 24 via nvm (`.nvmrc`). Non-interactive shells may resolve Node 18 — prefix with `source ~/.nvm/nvm.sh` if needed. Env lives in root `.env` (see `.env.example`); the API and drizzle-kit both load it from repo root.

## Architecture rules

- **Generic schema only.** All sources normalize into `events` (things with timestamps) and `metrics` (daily scalars) in `packages/db/src/schema.ts`. Do NOT add per-source tables without strong justification.
- **Connector pattern.** Every source: fetch → normalize → upsert on `(source, external_id)` (or `(source, name, date)` for metrics) → record a row in `sync_runs`. Connectors live in `apps/api/src/connectors/<source>/`.
- **Every connector records sync_runs** — status `running` → `ok`/`error`. Silent sync failure is the failure mode we guard against.
- **All Obsidian vault I/O goes through the `VaultStore` interface** (Phase 4). Never write to the vault path directly from connectors/routes. v1 impl is direct filesystem; it will be swapped for an Obsidian-Git impl when hosting moves off the MacBook.
- **Mac-coupled integrations** (iMessage chat.db, anything AppleScript) live in `bridges/` as standalone scripts that POST to the API — the core app must never assume it runs on macOS.
- **Auth:** every `/api/*` route requires `Authorization: Bearer $API_TOKEN` (hook in `apps/api/src/index.ts`). Webhooks (`/webhooks/*`) use their own shared secrets instead.
- **Thin frontend.** Logic belongs in the API; the web app renders and calls. A future native app should be possible as a second thin client.

## Workflow

- Verify each phase against real data before starting the next.
- Roadmap, Sienna's pending setup tasks, and open decisions live in her Obsidian note `Projects/Life Dashboard.md` (vault path in `.env` → `VAULT_PATH`). Update it when a phase completes.
