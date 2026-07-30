# Life Dashboard

Personal life-logging dashboard aggregating external apps (Todoist, Strava, Apple Health, Apple Calendar, Obsidian). Single user (Sienna). External apps stay the source of truth — we pull read-only by default and write back only where the API is good (Todoist: completing tasks). Todoist uses the **unified v1 API** (`api.todoist.com/api/v1`, cursor pagination) — REST v2 returns 410.

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
- **Connector pattern.** Every source: fetch → normalize → upsert on `(source, external_id)` (or `(source, name, date)` for metrics) → record a row in `sync_runs`. Connectors live in `apps/api/src/connectors/`.
- **Every connector records sync_runs** — status `running` → `ok`/`error`. Silent sync failure is the failure mode we guard against.
- **Per-symbol/per-item API failures must degrade, not fail the batch.** A quote/beta/event that can't be fetched becomes `null`/skipped; one bad item must never 500 the whole response (learned via Finnhub 403 on SPAXX).
- **Manual-entry pattern** (exercise, books): rows in `events` with `source: "manual"` and a per-kind `type`; entry fields live in `payload`; `externalId` is a randomUUID. Zod input schemas live in `packages/shared` and are parsed in the route (the global error handler turns ZodError into a 400).
- **All Obsidian vault I/O goes through the `VaultStore` interface** (Phase 4). Never write to the vault path directly from connectors/routes. v1 impl is direct filesystem; it will be swapped for an Obsidian-Git impl when hosting moves off the MacBook.
- **Mac-coupled integrations** (iMessage chat.db, anything AppleScript) live in `bridges/` as standalone scripts that POST to the API — the core app must never assume it runs on macOS.
- **Auth:** every `/api/*` route requires `Authorization: Bearer $API_TOKEN` (hook in `apps/api/src/index.ts`). Webhooks (`/webhooks/*`) use their own shared secrets instead.
- **Thin frontend.** Logic belongs in the API; the web app renders and calls. A future native app should be possible as a second thin client.

## What's built

Sync loop: pull connectors run on API boot, then every 5 min (`runSyncs` in `index.ts`); each configured connector is isolated so one failing doesn't block the others. `POST /api/sync` triggers all of them manually.

### Todos (source `todoist`)
Todoist v1 sync + `POST /api/todos/:externalId/close` write-back. Tasks absent from the active set get `payload.status = "completed"` locally.

### Finance (sources `fidelity` + live quotes)
- **Holdings**: `POST /api/finance/holdings/upload` takes a Fidelity positions CSV as raw text body (`text/csv`). Parsed with papaparse in `connectors/fidelity.ts` — loose header matching (Symbol/Quantity/Cost Basis variants), strips `$`/commas, `SPAXX**` asterisks, skips `Pending Activity` + disclaimer rows. Stored as `events` (`type: "holding"`, `externalId` = symbol); re-upload replaces (symbols missing from the upload are deleted = sold).
- **Live prices**: `GET /api/finance/portfolio` (in `finance.ts`) prices holdings via Finnhub `/quote` (`FINNHUB_API_KEY`, 45s in-memory cache in `connectors/finnhub.ts`). Free tier can't price money-market/mutual funds (SPAXX, FEDDX → 403 → null, shown as "—").
- **Risk**: beta per symbol from `yahoo-finance2` v4 (`connectors/yahoo.ts`, 12h cache, no key needed) → riskTier per position (thresholds in `finance.ts:betaToTier`) + portfolio rating = value-weighted beta bumped a notch if top position >30% or high-risk value >40%. Deterministic arithmetic, no AI.

### Exercise (source `manual`, type `exercise`)
`POST/GET /api/exercises`. Required: `type` (run/gym/yoga/bike/hike/custom) + `date` (YYYY-MM-DD); optional description/totalTime(min)/caloriesBurned. `startTs` = noon UTC of the date (keeps the calendar day TZ-stable). List sorted by workout date desc.

### Reading (source `manual`, type `book`)
`POST/GET /api/books` + `PUT /api/books/:id` (**full-replace** edit — the form resubmits every field; omitted optionals clear). Required: title + status (reading/complete/queued/abandoned); rating is 0.5–5 in half-star steps (Zod `multipleOf(0.5)`); dates optional. List sorted: no-completion-date books first (current read on top), then `dateCompleted` desc. History note: 53 books were imported from `OneDrive/Documents/life-dashboard.xlsx`; synthetic completion dates fall on the **1st of a month** = "real date unknown", non-1st dates are real.

### Calendar (source `calendar`)
- **iCloud CalDAV** read-only in `connectors/icloud.ts` (tsdav + node-ical, Basic auth with `ICLOUD_EMAIL` + `ICLOUD_APP_PASSWORD` app-specific password). Never use public ICS links — Sienna's events contain locations. Syncs a −90d/+365d window: RRULE expansion, EXDATE, per-instance overrides; recurring instances get `externalId` = `uid:occurrenceISO`; events gone from the window are pruned. `GET /api/calendar/events` serves them start-ordered.
- **Calendar page** (`pages/Calendar.tsx`): hand-rolled Monday-start 6×7 grid (no library, on purpose). Fixed 45rem height; week rows are flex items (`basis-0`), expansion works by animating `flex-grow` (expanded week `grow-[25]` = 37.5rem, others compress to 1.5rem). Inside an expanded week, a clicked day widens the same way horizontally (siblings squeeze to `basis-9`). Hover tabs on each row edge toggle week expansion; clicking any day from anywhere expands its week + day. Blue outline marks the current selection (week or day). Chips: violet = iCloud events (`9:30 AM Title`), blue = exercises (`30min gym`); overflow clips — expand the day to see everything.

### Web app structure
`nav.ts` is the single source for sidebar + routes (`implemented: true` = real page, else auto-Placeholder). Implemented: Todos, Calendar, Finance, Exercise, Reading. Placeholders: Home, Career, Wedding. Index redirect stays on `/todos` (Home is intentionally separate). Entry forms on Exercise/Reading are collapsed behind a green "+ Add Entry" button. Layout shell: sidebar fixed, only `<main>` scrolls.

## Gotchas (hard-won, do not rediscover)

- **Non-ASCII in API string literals gets mangled** by tsx/esbuild on this Windows machine (em dash → `â€"` mojibake in responses). Keep runtime strings in `apps/api` ASCII-only; comments are fine (stripped at compile).
- **Tailwind v4 + running vite dev server**: utility classes in a **newly created** file aren't picked up until the dev server restarts (page renders unstyled). Edits to existing files hot-reload fine.
- **Calendar grid flexbox**: every nested flex container needs `min-w-0`/`min-h-0` — the default `min-size: auto` lets chip content blow rows out to 1600px+ wide / uneven heights. If the grid ever looks "randomly oversized", check for a flex child missing its min-size reset.
- **node-ical types**: `VEvent` includes a `Record<string, unknown>` index signature, so `Omit<VEvent, ...>` degrades all fields to `unknown` (cast instead); text fields are `string | { params, val }` — unwrap before use.
- **yahoo-finance2 v4** is class-based: `new YahooFinance({...})`; the static default-export methods are deprecated stubs that return `never` / throw.
- Port 3001 conflicts: a stale API process (hers or a background one) causes `EADDRINUSE` and the *new* process dies while the old one serves stale code — kill the listener on :3001 before debugging "my change isn't taking effect".

## Workflow

- Verify each phase against real data before starting the next.
- Sienna handles git commits herself — don't offer to commit/stage/push.
- Roadmap, Sienna's pending setup tasks, and open decisions live in her Obsidian note `Projects/Life Dashboard.md` (vault path in `.env` → `VAULT_PATH`). Update it when a phase completes.
