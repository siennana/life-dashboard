# Life Dashboard

Personal life-logging dashboard: todos, workouts, calories, calendar, and journal in one place, pulled from the apps I already use.

## Stack

pnpm monorepo — React (Vite) PWA · Fastify API · Postgres (Drizzle) · Docker Compose.

## Quickstart

```bash
nvm use                      # Node 24
pnpm install
cp .env.example .env         # then set API_TOKEN (openssl rand -hex 24)
pnpm db:up                   # postgres in docker
pnpm db:migrate
pnpm dev                     # api :3001, web :5173
```

Open http://localhost:5173 — or the MacBook's Tailscale address from a phone.

## Layout

```
apps/api        Fastify: REST + webhooks + cron sync jobs
apps/web        React dashboard (thin client)
packages/db     Drizzle schema + migrations (events / metrics / sync_runs)
packages/shared zod schemas shared across api + web
bridges/        Mac-only scripts that push Apple-locked data to the API
```
