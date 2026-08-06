# Life Dashboard

Personal life-logging dashboard aggregating external apps (Todoist, Strava, Apple Health, Apple Calendar, Obsidian). Single user (Sienna). External apps stay the source of truth — we pull read-only by default and write back only where the API is good (Todoist: completing tasks). Todoist uses the **unified v1 API** (`api.todoist.com/api/v1`, cursor pagination) — REST v2 returns 410.

## Commands

```bash
pnpm dev            # api (tsx watch, :3001) + web (vite, :5173) in parallel
pnpm db:up          # local docker postgres — offline fallback; also required by db:copy-to-neon (it runs psql/pg_dump inside the container)
pnpm db:generate    # drizzle-kit generate (after schema changes)
pnpm db:migrate     # apply migrations (against whatever DATABASE_URL points at — normally Neon)
pnpm db:copy-to-neon # local -> Neon data migration; --manual-only for just books/exercises (see below)
pnpm typecheck      # all workspaces
```

Node 24 via nvm (`.nvmrc`). Non-interactive shells may resolve Node 18 — prefix with `source ~/.nvm/nvm.sh` if needed. Env lives in root `.env` (see `.env.example`); the API and drizzle-kit both load it from repo root.

## Two machines (PC + laptop) — shared Neon Postgres

Both machines run the same app against **one shared Neon Postgres** (free tier) — there is no DB syncing, they just point at the same `DATABASE_URL`. The local docker-compose Postgres stays in the repo as an offline fallback (commented-out URL in `.env`).

Neon specifics: database is Neon's default **`neondb`** (not `life`), us-east-2, Postgres **18** (local container is 17 — fine, nothing version-specific in play). Free tier scale-to-zero means the first query after idle takes a few seconds to wake the endpoint — a slow first page load after opening the dashboard is normal, not a bug.

**Migration complete (as of 2026-08-05):** both machines point at Neon. The PC's manual data (53 imported books + real exercises) was copied over with `--manual-only`; Neon now holds the union of both machines' data (books, exercises, period days, todos, calendar, holdings, Plaid transactions).

- **Use Neon's direct (non-pooled) connection string**, not the `-pooler` one. drizzle-kit migrate needs a real session; PgBouncer in transaction mode breaks it.
- **SSL needs no code change** — postgres-js parses `sslmode` off the URL itself (`index.js:443`) and `require`/`allow`/`prefer` set `rejectUnauthorized:false` (`connection.js:283`). `.env.example` uses `verify-full`; drop to `require` if a handshake ever fails.
- **`.env` canonical copy lives in a Bitwarden secure note** — the repo is public, so it is never committed or cloud-synced in plaintext. After changing a var: update the note, then paste it onto the other machine. `.env.example` stays the shared contract; keep it current when adding a var. Known drift: the laptop lacks `FINNHUB_API_KEY` + `ICLOUD_EMAIL`/`ICLOUD_APP_PASSWORD` (present on the PC), so Finance quotes and calendar sync only run from the PC. A connector with missing creds is silently skipped — check which machine synced last (`sync_runs`) before debugging "calendar isn't updating".
- **Migrating data**: `scripts/db-copy-to-neon.mjs` copies local → Neon. Run migrations against Neon first (`DATABASE_URL="$NEON_DATABASE_URL" pnpm db:migrate`), then run it with `DATABASE_URL` still pointing local and `NEON_DATABASE_URL` set. Neither machine has `pg_dump`/`psql` installed — the script runs both **inside the docker `db` container**, so `pnpm db:up` must be running.
  - Default mode copies all four tables via `pg_dump --data-only`, and **requires an empty target** (it replays rows verbatim, so anything already synced collides on `events_source_external_id`).
  - `--manual-only` copies just the `source: "manual"` events — the only data no connector can rebuild. It excludes `id` (target sequence assigns fresh ones) and inserts `on conflict do nothing`, so it is **idempotent and safe against a non-empty Neon**. This is the mode to use once anything has synced.
- **Only `source: "manual"` data is irreplaceable** (books, exercises). Todoist/calendar/holdings all re-sync from their connectors, so when in doubt the machine with the most manual entries is canonical.
- Both machines running `pnpm dev` at once is safe — connector upserts are keyed on `(source, external_id)` so they converge — but it does double up `sync_runs` rows.

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

### Finance — Stocks (sources `fidelity` + live quotes)
- **Holdings**: `POST /api/finance/holdings/upload` takes a Fidelity positions CSV as raw text body (`text/csv`). Parsed with papaparse in `connectors/fidelity.ts` — loose header matching (Symbol/Quantity/Cost Basis variants), strips `$`/commas, `SPAXX**` asterisks, skips `Pending Activity` + disclaimer rows. Stored as `events` (`type: "holding"`, `externalId` = symbol); re-upload replaces (symbols missing from the upload are deleted = sold).
- **Live prices**: `GET /api/finance/portfolio` (in `finance.ts`) prices holdings via Finnhub `/quote` (`FINNHUB_API_KEY`, 45s in-memory cache in `connectors/finnhub.ts`). Free tier can't price money-market/mutual funds (SPAXX, FEDDX → 403 → null, shown as "—").
- **Risk**: beta per symbol from `yahoo-finance2` v4 (`connectors/yahoo.ts`, 12h cache, no key needed) → riskTier per position (thresholds in `finance.ts:betaToTier`) + portfolio rating = value-weighted beta bumped a notch if top position >30% or high-risk value >40%. Deterministic arithmetic, no AI.

### Finance — Bank (source `plaid`)
- **Sync** (`connectors/plaid.ts`): read-only via Plaid's incremental `/transactions/sync`; cursor persisted in `sync_runs.cursor`. Transactions → `events` (`type: "transaction"`, `externalId` = `transaction_id`); `removed` entries hard-deleted. Each run also refreshes account metadata + live balances via `/accounts/get` → `events` (`type: "account"`, `externalId` = `account_id`). Link tokens request `days_requested: 730` (24-month history) — **only applies at link time**, so more history on an existing item = re-link via `/plaid-link`. A fresh/invalid cursor (first sync or post-re-link INVALID_CURSOR) **wipes all plaid transaction rows and re-pulls** — required because a re-linked item re-issues the full history under new transaction_ids (rows would otherwise duplicate).
- **Linking**: browser handshake on `/plaid-link` (`PlaidLink.tsx`) → paste the printed access token into `PLAID_ACCESS_TOKEN` in `.env`.
- **Dashboard** (`spending.ts` → `GET /api/finance/spending?month=YYYY-MM`, default latest): per-month summary (spend/income/refunds/projected pace), 12-month trend, daily cumulative series, category + per-account + top-merchant breakdowns, and DIY recurring-charge detection (≥3 charges, steady amount ±25%, cadence windows weekly/biweekly/monthly/yearly; `active` = not overdue by >2 cycles). "Spend" excludes internal transfers/card payments (`NON_SPEND_DETAILED`, keyed on Plaid detailed categories — LOAN_PAYMENTS_OTHER_PAYMENT is US Bank's card-payment label) and is net of refunds. `normalizeMerchant` collapses statement descriptors ("Chidoordash.comca") into brands (DoorDash etc.) for merchant/recurring grouping. `amount > 0` = money out (Plaid convention).
- **Bank page** (`Bank.tsx`): month switcher (also click a trend bar to jump), stat tiles (Spent + vs-prev delta, Income, Net, DoorDash), monthly-trend columns (selected = blue `#3987e5`, rest zinc — emphasis form, single measure = single hue), daily cumulative line with crosshair tooltip, category bars, accounts/merchants/recurring lists, full month transaction list. Charts are hand-rolled SVG, no library.

### Period tracking (source `manual`, type `period`)
`period.ts`: menstrual cycle tracking, one `events` row per marked day (no ranges — a day is either marked or not), toggled via `POST /api/period/toggle`. No dedicated page; surfaces as a toggle inside the Calendar/Exercise day view (`lib/period.tsx` → `usePeriodDays`) for red-circle rendering on the calendar grid.

### Exercise (source `manual`, type `exercise`)
`POST/GET /api/exercises`. Required: `type` (run/gym/yoga/bike/hike/custom) + `date` (YYYY-MM-DD); optional description/totalTime(min)/caloriesBurned. `startTs` = noon UTC of the date (keeps the calendar day TZ-stable). List sorted by workout date desc.

### Reading (source `manual`, type `book`)
`POST/GET /api/books` + `PUT /api/books/:id` (**full-replace** edit — the form resubmits every field; omitted optionals clear). Required: title + status (reading/complete/queued/abandoned); rating is 0.5–5 in half-star steps (Zod `multipleOf(0.5)`); dates optional. List sorted: no-completion-date books first (current read on top), then `dateCompleted` desc. History note: 53 books were imported from `OneDrive/Documents/life-dashboard.xlsx`; synthetic completion dates fall on the **1st of a month** = "real date unknown", non-1st dates are real.

### Calendar (source `calendar`)
- **iCloud CalDAV** read-only in `connectors/icloud.ts` (tsdav + node-ical, Basic auth with `ICLOUD_EMAIL` + `ICLOUD_APP_PASSWORD` app-specific password). Never use public ICS links — Sienna's events contain locations. Syncs a −90d/+365d window: RRULE expansion, EXDATE, per-instance overrides; recurring instances get `externalId` = `uid:occurrenceISO`; events gone from the window are pruned. `GET /api/calendar/events` serves them start-ordered.
- **Calendar page** (`pages/Calendar.tsx`): hand-rolled Monday-start 6×7 grid (no library, on purpose). Fixed 45rem height; week rows are flex items (`basis-0`), expansion works by animating `flex-grow` (expanded week `grow-[25]` = 37.5rem, others compress to 1.5rem). Inside an expanded week, a clicked day widens the same way horizontally (siblings squeeze to `basis-9`). Hover tabs on each row edge toggle week expansion; clicking any day from anywhere expands its week + day. Blue outline marks the current selection (week or day). Chips: violet = iCloud events (`9:30 AM Title`), blue = exercises (`30min gym`); overflow clips — expand the day to see everything.

### Home page
`pages/Home.tsx`: stacked widgets — `WeatherWidget`, `WeekCalendar`, then `FinanceWidget`/`TodosWidget` side by side, then `SyncStatus` (per-connector `sync_runs` status + a live Neon `select 1` check, source keys relabeled for display — e.g. `calendar` → `CalDAV` — in `SyncStatus.tsx`'s `SOURCE_LABELS`).

### Web app structure
`nav.ts` is the single source for sidebar + routes (`implemented: true` = real page, else auto-Placeholder). Implemented: Home, Todos, Calendar, Finance (with Stocks + Bank children), Exercise, Reading. Placeholders: Projects, Wedding. Index redirect (`/`) goes to `/home` — the default landing page. Entry forms on Exercise/Reading are collapsed behind a green "+ Add Entry" button. Layout shell: sidebar fixed, only `<main>` scrolls.

## Gotchas (hard-won, do not rediscover)

- **Non-ASCII in API string literals gets mangled** by tsx/esbuild on this Windows machine (em dash → `â€"` mojibake in responses). Keep runtime strings in `apps/api` ASCII-only; comments are fine (stripped at compile).
- **Tailwind v4 + running vite dev server**: utility classes in a **newly created** file aren't picked up until the dev server restarts (page renders unstyled). Edits to existing files hot-reload fine.
- **Calendar grid flexbox**: every nested flex container needs `min-w-0`/`min-h-0` — the default `min-size: auto` lets chip content blow rows out to 1600px+ wide / uneven heights. If the grid ever looks "randomly oversized", check for a flex child missing its min-size reset.
- **node-ical types**: `VEvent` includes a `Record<string, unknown>` index signature, so `Omit<VEvent, ...>` degrades all fields to `unknown` (cast instead); text fields are `string | { params, val }` — unwrap before use.
- **yahoo-finance2 v4** is class-based: `new YahooFinance({...})`; the static default-export methods are deprecated stubs that return `never` / throw.
- Port 3001 conflicts: a stale API process (hers or a background one) causes `EADDRINUSE` and the *new* process dies while the old one serves stale code — kill the listener on :3001 before debugging "my change isn't taking effect".
- **`.env` edits need a full `pnpm dev` restart, and the two halves drift differently**: Vite auto-restarts on `.env` changes (web gets new values immediately) but `tsx watch` only restarts on *source* changes (API keeps old values). So editing `API_TOKEN` while dev is running = instant 401 on every page, because the web is sending the new token to an API still holding the old one. Same mechanism: changing `DATABASE_URL` leaves the API writing to the old database until restarted — and it cuts the other way too: if `.env` on disk drifts back to the local docker URL (e.g. from pasting an older snapshot while merging in machine-specific keys) while a Neon-connected `tsx watch` is still running, everything *looks* fine until the next source save silently reconnects it to the near-empty local DB. Diff `.env` against `.env.example`/Bitwarden after any manual paste, not just after intentional edits.
- **`tsx -e` compiles to CJS** — no top-level await in one-liners; wrap in an async IIFE. And `import 'dotenv/config'` resolves `.env` from *cwd*, so under `pnpm --filter @life/api exec` it finds nothing (silently falls back to OS-user Postgres auth) — pass env vars explicitly for ad-hoc scripts.

## Workflow

- Verify each phase against real data before starting the next.
- **The repo is public and forkable — no personal data in tracked files.** Code, comments, `.env.example`, README, todo.md must not contain real names, emails, usernames in paths (`/Users/sienn/...`), tokens, connection strings, or identifiable personal details. Generic placeholders only. CLAUDE.md is the one deliberate exception (it names Sienna and her setup); don't add secrets there either.
- Sienna handles git commits herself — don't offer to commit/stage/push.
- Roadmap, Sienna's pending setup tasks, and open decisions live in her Obsidian note `Projects/Life Dashboard.md` (vault path in `.env` → `VAULT_PATH`). Update it when a phase completes.
