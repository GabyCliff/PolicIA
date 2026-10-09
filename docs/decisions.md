# Decisions

Lightweight decision log (ADR-lite). Each entry states the decision, why it was made, and what we give up. When a decision changes, add a new entry that supersedes the old one instead of rewriting history.

## Index

| ID | Decision | Area |
|----|----------|------|
| [D-001](#d-001--demo-mode-runs-on-in-memory-repositories) | Demo mode runs on in-memory repositories seeded relative to today | Runtime |
| [D-002](#d-002--npm-is-the-package-manager) | npm is the package manager | Tooling |
| [D-003](#d-003--embeddings-sit-behind-an-embedder-port) | Embeddings sit behind an `Embedder` port | AI |
| [D-004](#d-004--the-llm-is-never-on-the-critical-path) | The LLM is never on the critical path | AI |
| [D-005](#d-005--cloud-provisioning-is-owner-driven) | Cloud provisioning is owner-driven; demo needs none | Ops |
| [D-006](#d-006--auth-is-enforced-only-in-live-mode) | Auth is enforced only in live mode | Security |
| [D-007](#d-007--forecast-throughput-unit-is-configurable) | Forecast throughput unit is configurable per project | Forecast |
| [D-008](#d-008--single-nextjs-app) | Single Next.js app, no monorepo | Architecture |
| [D-009](#d-009--monte-carlo-uses-a-seeded-prng) | Monte Carlo uses a seeded PRNG | Forecast |
| [D-010](#d-010--daily-cron-plus-manual-sync) | Daily cron plus manual "Sync now" | Ops |
| [D-011](#d-011--rest-for-ingestion-tool-runner-for-chat) | REST for ingestion, Tool Runner for chat, remote MCP optional | Integrations |
| [D-012](#d-012--shadcnui-on-radix-with-os-driven-dark-mode) | shadcn/ui on Radix, OS-driven dark mode | UI |
| [D-013](#d-013--keep-nextjs-16-cache-components-enabled) | Keep Next.js 16 Cache Components enabled | Framework |
| [D-014](#d-014--supabase-client-factories-land-with-the-repositories) | Supabase client factories land with the repositories (phase 2) | Data |

---

### D-001 — Demo mode runs on in-memory repositories

- **Decision:** `DEMO_MODE=true` (the default) wires in-memory repositories and fake adapters, seeded deterministically relative to today through the `Clock` port. No Supabase project or auth is needed.
- **Why:** the live demo must never depend on a third-party API being up, and the scenario must look "current" on any day it is shown.
- **Tradeoff:** writes (acknowledging an alert, generated reports) live in the memory of one serverless instance and are ephemeral. Acceptable for a demo; live mode persists to Supabase.

### D-002 — npm is the package manager

- **Decision:** use npm and commit `package-lock.json`.
- **Why:** pnpm is not available in the build environment; npm ships with Node and is supported by Vercel out of the box.
- **Tradeoff:** slower installs and a larger `node_modules` than pnpm.

### D-003 — Embeddings sit behind an `Embedder` port

- **Decision:** Anthropic has no embeddings API, so memory search depends on an `Embedder` port. The Voyage AI adapter is used when `VOYAGE_API_KEY` is set; otherwise a deterministic feature-hashing embedder (1024 dimensions) runs locally. The pgvector column is `vector(1024)`.
- **Why:** keeps semantic search working offline and in demo mode with zero keys, while allowing a real model in live mode.
- **Tradeoff:** feature-hashing captures lexical overlap, not meaning; demo search quality is lower than with Voyage. Both embedders must keep 1024 dimensions.

### D-004 — The LLM is never on the critical path

- **Decision:** every LLM output has a deterministic template fallback, used when the API key is missing, the call fails, the model refuses, or the text contains numbers not present in the inputs (after one regeneration). Explanations are cached by a hash of their inputs.
- **Why:** "math computes, the LLM explains" — alerts and forecasts must be correct and available even when the AI layer is not.
- **Tradeoff:** fallback text is plainer than model output; the grounding check can reject legitimate paraphrases of numbers (e.g. "two weeks" vs "14 days").

### D-005 — Cloud provisioning is owner-driven

- **Decision:** Vercel and Supabase provisioning require the owner's accounts and is done by hand. The app runs fully in demo mode without either. Deploy steps live in the README.
- **Why:** no CLI access or credentials for those platforms in the build environment.
- **Tradeoff:** the first deploy and the live database setup are manual steps.

### D-006 — Auth is enforced only in live mode

- **Decision:** Supabase magic-link auth and RLS apply only when `DEMO_MODE=false`. Demo mode shows a "Demo data" badge and needs no login.
- **Why:** frictionless demo; seeded data contains nothing sensitive.
- **Tradeoff:** demo deployments are public by URL. Never point a demo deployment at real data.
- **Status:** auth is planned for phase 2 onward. Until it lands, live mode has no login at all, so it must not be deployed with real data.

### D-007 — Forecast throughput unit is configurable

- **Decision:** each project chooses its throughput unit (`points` or `issues`). When story points are missing, the engine falls back to issue count.
- **Why:** many teams do not estimate consistently; issue count is a robust default for Monte Carlo forecasting.
- **Tradeoff:** issue count assumes similar issue sizes; mixing units across projects makes portfolio comparisons approximate.

### D-008 — Single Next.js app

- **Decision:** one Next.js app (UI, API routes, cron) with hexagonal modules inside `src/`. No monorepo.
- **Why:** one-day MVP, one deploy target; module boundaries are enforced by ESLint instead of package boundaries.
- **Tradeoff:** boundaries are lint rules, not compiler-enforced packages; extracting a service later needs work.

### D-009 — Monte Carlo uses a seeded PRNG

- **Decision:** simulations use `mulberry32` seeded with `hash(projectId + date)`.
- **Why:** the UI stays stable across refreshes within a day and tests are deterministic.
- **Tradeoff:** results do not reflect sampling variance between refreshes; a bad seed is "stuck" for the whole day.

### D-010 — Daily cron plus manual sync

- **Decision:** Vercel Cron calls `/api/cron/sync` once a day, within the 07:00 UTC hour (`0 7 * * *`; Hobby plans only guarantee hourly precision). A manual "Sync now" button covers intraday refreshes.
- **Why:** the Vercel Hobby plan only allows daily cron jobs.
- **Tradeoff:** data can be up to a day stale unless someone syncs manually; the UI shows freshness per source.

### D-011 — REST for ingestion, Tool Runner for chat

- **Decision:** ingestion uses REST adapters. Ask Radar uses the Anthropic SDK Tool Runner with read-only tools over the same adapters and repositories. A remote (HTTP) MCP connector is optional behind `REMOTE_MCP_ENABLED`.
- **Why:** stdio MCP servers cannot run inside Vercel functions; REST adapters are deterministic, testable, and cacheable.
- **Tradeoff:** we maintain our own tool definitions instead of reusing an MCP server's.

### D-012 — shadcn/ui on Radix, OS-driven dark mode

- **Decision:** shadcn/ui is initialized with the Radix primitives base (`radix-nova` style, neutral palette, Lucide icons). Dark mode follows `prefers-color-scheme` through a CSS media variant; there is no theme toggle.
- **Why:** the shadcn CLI default is now Base UI. Radix keeps the widely documented `asChild` composition model. A media-query variant needs no client JavaScript and cannot flash the wrong theme.
- **Tradeoff:** adding a manual theme toggle later means switching the `dark` variant back to a class strategy (for example with `next-themes`).

### D-013 — Keep Next.js 16 Cache Components enabled

- **Decision:** keep `cacheComponents: true` and `partialPrefetching: true` from the Next.js 16.4 scaffold. Route handlers do not use the `dynamic` segment config (it is not supported with Cache Components). Handlers that must run per request read request data or call `await connection()` from `next/server`.
- **Why:** it is the framework default going forward; static shells prerender and dynamic data streams in.
- **Tradeoff:** server components that read time, randomness, or uncached data must sit behind `connection()`, request APIs, or `<Suspense>`, or the build fails. Env-derived UI (the mode badge) is resolved at build time, so changing `DEMO_MODE` needs a redeploy (already true on Vercel).

### D-014 — Supabase client factories land with the repositories

- **Decision:** `@supabase/supabase-js` and `@supabase/ssr` are installed in phase 1, but the server, browser, and service-role client factories are written in phase 2, inside `src/adapters/supabase`, together with the repositories and migrations that use them.
- **Why:** a client factory with no caller is untested code; building it with its first repository keeps the adapter, its schema, and its tests in one reviewable unit.
- **Tradeoff:** phase 1 cannot talk to Supabase at all, so live mode is configuration-only until phase 2.
