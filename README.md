# Radar

Radar is a cockpit for engineering leaders. It **anticipates** delivery risks with a date and a confidence, **remembers** what the team did with verifiable evidence, and **unifies** progress reports, client reports, team metrics, and natural-language questions over Jira, GitHub, Google Calendar, and Flocktools.

Out of the box it runs in **demo mode**: seeded data, no accounts, no API keys.

> **Status: phase 1 (scaffold).** The app shell, env validation, health check, and the authenticated cron endpoint work today. Everything else below is marked with the phase that delivers it.

## Quickstart

Requires Node.js `^22.12.0 || >=24` (see `engines` in `package.json`).

```bash
npm install
cp .env.example .env.local   # DEMO_MODE=true by default
npm run dev                  # http://localhost:3000
```

Check it is up: `curl http://localhost:3000/api/health` returns `{"status":"ok","mode":"demo","model":"claude-opus-5-5"}`.

## What works today

| Capability | Status |
|------------|--------|
| App shell, demo-mode badge, placeholder pages | Available |
| Validated server-only env (`DEMO_MODE`, live-mode requirements) | Available |
| `GET /api/health` | Available |
| `GET /api/cron/sync` (Bearer `CRON_SECRET`, currently a no-op) | Available |
| Demo seed scenario and portfolio cards | Planned (phase 2 and 5) |
| Forecast engine and alerts | Planned (phase 3) |
| AI explanations with deterministic template fallback | Planned (phase 4) |
| Memory, Ask Radar chat, reports | Planned (phases 6 to 8) |
| Live mode: Supabase persistence, magic-link auth, RLS | Planned (phase 2 onward) |
| Real Jira / GitHub / Calendar / Flocktools ingestion | Planned (phase 9) |

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Start the dev server |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` | ESLint, including the hexagonal import rules |
| `npm run typecheck` | Generate Next.js route types, then `tsc --noEmit` |
| `npm test` / `npm run test:watch` | Vitest (single run / watch) |
| `npm run seed:supabase` | Seed a live Supabase project. Planned (phase 2); today it exits with an error |

## Docs

- [Architecture](docs/architecture.md): C4 diagrams, sync and chat sequences, folder structure, layering rules.
- [Decisions](docs/decisions.md): what we chose, why, and the tradeoffs.
- [.env.example](.env.example): every environment variable, grouped and commented.

## Deploy

Demo mode needs nothing but a Vercel project.

1. Push this repository to GitHub.
2. Import it in the [Vercel dashboard](https://vercel.com/new), or run `npx vercel` after `npx vercel login`.
3. Set environment variables in the Vercel project settings:
   - `DEMO_MODE=true` is enough for a working demo.
   - Add `CRON_SECRET` (at least 16 characters, for example `openssl rand -hex 32`) so the cron job in `vercel.json` can authenticate. It runs daily, within the 07:00 UTC hour (Vercel Hobby precision).
4. Deploy.

> **Do not deploy live mode with real data yet.** `DEMO_MODE=false` currently only validates that the Supabase variables are present: there is no login, no RLS, and no Supabase wiring until the planned phases land. Keep deployments on `DEMO_MODE=true`.
