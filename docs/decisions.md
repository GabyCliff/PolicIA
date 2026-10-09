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
| [D-014](#d-014--supabase-client-factories-land-with-the-repositories) | Supabase client factories land with the repositories (superseded by D-020) | Data |
| [D-015](#d-015--one-repository-port-with-namespaced-groups) | One `RadarRepository` port with namespaced groups | Data |
| [D-016](#d-016--sync-lives-in-an-ingestion-module) | Sync lives in an `ingestion` module | Architecture |
| [D-017](#d-017--migrations-are-validated-on-pglite) | Migrations are validated on PGlite in Vitest | Data |
| [D-018](#d-018--burn-up-is-derived-from-issues-and-events) | Burn-up is derived from issues and events; snapshots are a cache | Forecast |
| [D-019](#d-019--demo-boots-through-the-real-sync-pipeline) | Demo boots through the real sync pipeline; async container (caching superseded by D-033) | Runtime |
| [D-020](#d-020--supabase-repository-and-seed-script-move-to-phase-9) | Supabase repository and seed script move to phase 9 | Data |
| [D-021](#d-021--demo-numbers-are-calibrated-to-a-reference-model) | Demo numbers are calibrated to a reference model | Demo |
| [D-022](#d-022--one-active-alert-per-project-and-kind) | One active (open or ack) alert per project and kind (mechanism superseded by D-029) | Alerts |
| [D-023](#d-023--sprints-store-instants-not-days) | Sprints store instants, not days | Data |
| [D-024](#d-024--operational-tables-are-readable-by-role) | Operational tables are readable by role (superseded by D-025, D-026, D-028) | Security |
| [D-025](#d-025--sync-runs-are-per-project-with-sanitized-errors) | Sync runs are per project and source, with sanitized errors | Ops |
| [D-026](#d-026--llm-usage-is-admin-only) | LLM usage is admin-only (`app_metadata.role`) | Security |
| [D-027](#d-027--composite-foreign-keys-keep-rows-inside-their-project) | Composite foreign keys keep rows inside their project | Data |
| [D-028](#d-028--owners-and-leads-write-viewers-read) | Owners and leads write, viewers read; least-privilege grants | Security |
| [D-029](#d-029--alerts-upsert-on-a-generated-active-key) | Alerts upsert on a generated `active_key` | Alerts |
| [D-030](#d-030--live-reads-use-a-request-scoped-rls-repository) | Live reads use a request-scoped RLS repository | Security |
| [D-031](#d-031--pgvector-lives-in-extensions-with-aligned-search-rules) | pgvector lives in `extensions`, search rules aligned | Data |
| [D-032](#d-032--repositories-are-strict-sync-is-forgiving) | Repositories are strict, sync is forgiving | Data |
| [D-033](#d-033--the-demo-container-is-rebuilt-per-utc-day) | The demo container is rebuilt per UTC day, cached on `globalThis` | Runtime |
| [D-034](#d-034--stalled-means-five-working-days-without-commits) | Stalled means 5 working days without commits | Forecast |
| [D-035](#d-035--refined-schemas-export-a-plain-fields-variant) | Refined schemas export a plain Fields variant (Zod 4) | Domain |
| [D-036](#d-036--sources-are-normalized-at-the-adapter-boundary) | Sources are normalized at the adapter boundary | Integrations |

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
- **Status:** superseded by [D-020](#d-020--supabase-repository-and-seed-script-move-to-phase-9).

### D-015 — One repository port with namespaced groups

- **Decision:** persistence is a single `RadarRepository` port (`src/shared/ports/radar-repository.ts`) with one group per aggregate (`projects`, `sprints`, `issues`, ..., `alerts`, `memory`, `syncRuns`, `llmCalls`). The in-memory adapter (demo, tests) and the Supabase adapter (phase 9) implement the same interface. Shared contract: `upsertMany` is idempotent on each entity's natural key, reads return copies, list order is deterministic, invalid writes are rejected. The repository assigns ids for append-only rows (forecasts, reports, sync runs, LLM calls).
- **Why:** the composition root swaps persistence as one unit, use cases receive one dependency, and both adapters can be checked against the same behavior.
- **Tradeoff:** one wide interface instead of small per-use-case ports; a use case can technically reach groups it does not need. Methods stay minimal and grow with the phases that need them.

### D-016 — Sync lives in an ingestion module

- **Decision:** the sync use case is `src/modules/ingestion/application/sync-projects.ts`, a new screaming module next to forecast, memory, and cockpit.
- **Why:** pulling sources into the spine is its own capability (it feeds all three modules), and living under `src/modules/**/application` puts it under the ESLint layering rule for use cases automatically. `src/shared/application` would have needed a new lint block; `cockpit` would have hidden it inside one consumer.
- **Tradeoff:** use-case tests may not import adapters, so the end-to-end sync tests (demo sources, in-memory repository, idempotency, outages) live in `src/adapters/demo/demo-pipeline.test.ts`.

### D-017 — Migrations are validated on PGlite

- **Decision:** `src/adapters/supabase/migrations.test.ts` applies `supabase/migrations/*.sql` in order to PGlite (Postgres 18 compiled to WASM, `@electric-sql/pglite`) with pgvector (`@electric-sql/pglite-pgvector`, a separate package since PGlite 0.5). A small stub recreates what Supabase provides: `auth.users`, `auth.uid()` reading the `request.jwt.claim.sub` setting, the `anon` / `authenticated` / `service_role` roles, and Supabase's default privileges on `public`. The test checks tables, RLS on every table, idempotent upserts, the one-active-alert index, member-only reads, alert status updates, report inserts, and `match_memory_items`, switching roles with `set role`.
- **Why:** no Docker or Supabase CLI in the build environment, yet migrations and RLS must be proven before live mode exists.
- **Tradeoff:** the stub is not Supabase. PGlite supported everything the migrations need (roles, `set role`, RLS, HNSW), so nothing was skipped, but Supabase-specific behavior (JWT parsing, PostgREST, `extensions` schema placement) is only exercised against a real project.

### D-018 — Burn-up is derived from issues and events

- **Decision:** sprint scope and burn-up history are reconstructed from current issue state plus `issue_events` (status, sprint, points, resolution changes). `issue_snapshots` exists in the schema only as a live-mode cache for long histories; demo mode never writes it.
- **Why:** the Jira changelog already records every change with a timestamp, so daily snapshots add no information, and the demo would otherwise need fabricated snapshots that could drift from its events.
- **Tradeoff:** reconstruction costs more per request than reading snapshots; the cache can be filled later without changing the model.

### D-019 — Demo boots through the real sync pipeline

- **Decision:** in demo mode the composition root builds the scenario for today (`buildDemoDataset(clock.now())`), stores its projects, and runs `syncProjects` over demo source adapters into an `InMemoryRadarRepository`. `getContainer()` is now async and memoized as a promise (a failed boot is not cached). `getAppConfig()` returns mode, model, and URL synchronously for code that only needs configuration, such as the header in the static shell.
- **Why:** the demo exercises the same ingestion code as live mode, so demo data can never diverge from what sync produces. Keeping the header on `getAppConfig()` avoids reading the clock during prerendering (Cache Components, D-013).
- **Tradeoff:** the first request on a cold instance pays for building and syncing the scenario (about 100 ms measured locally). The data stays anchored to the day the instance booted; a long-running server crossing midnight keeps yesterday's anchor until restart.
- **Status:** caching superseded by [D-033](#d-033--the-demo-container-is-rebuilt-per-utc-day); the boot-through-sync rule stands.

### D-020 — Supabase repository and seed script move to phase 9

- **Decision:** phase 2 delivers the schema, RLS, and their validation (D-017), but the Supabase client factories, the Supabase `RadarRepository`, and `scripts/seed-supabase.ts` land in phase 9 with the live adapters. Until then live mode wires placeholder ports (`src/adapters/unavailable`) whose every call rejects with a "lands in phase 9" error.
- **Why:** nothing reads from Supabase before the live adapters exist, and demo mode needs no database (D-001). Building the repository with its first real caller keeps it tested.
- **Tradeoff:** `DEMO_MODE=false` boots but serves no data until phase 9; `npm run seed:supabase` still exits with an error.

### D-021 — Demo numbers are calibrated to a reference model

- **Decision:** the demo scenario (`src/adapters/demo/scenario`) is deterministic (seeded PRNG, name-based UUIDs and SHAs) and anchored to the UTC day: today is always working day 6 of a 10-working-day sprint. Its intended signals are exported as `DEMO_SCENARIO_EXPECTATIONS` and asserted by tests on every weekday. Beacon's numbers differ from the original brief: history is 35 to 39 points per sprint (not 26 to 30), 27 points were committed at start and 13 were added after it (40 in scope), so a straightforward Monte Carlo (documented in `expectations.ts`) lands at P ≈ 0.38. Cobalt's budget runs out about 14 days before its end date under an EWMA of hours per working day.
- **Why:** with a 26-30 velocity, any scope of 40 points has a near-zero completion probability under any sane model, so the brief's 38% target was unreachable. The new story is coherent: the team planned below its velocity for known PTO, then scope creep consumed the slack.
- **Tradeoff:** the 38% depends on the reference model; phase 3 may need to retune if its model differs materially (the expectations object records the knobs).

### D-022 — One active alert per project and kind

- **Decision:** at most one alert per (project, kind) may be active, where active means `open` or `ack`. Postgres enforces it with a partial unique index (`where status in ('open', 'ack')`), which is also the upsert target; the in-memory repository enforces the same rule.
- **Why:** an acknowledged alert is still a live problem. Allowing a new `open` alert next to an `ack` one would show the same risk twice and lose the acknowledgement.
- **Tradeoff:** a re-detected problem after an acknowledgement updates the acknowledged alert silently; the UI must surface "updated since you acknowledged" if that matters.
- **Status:** the rule stands; the partial index is replaced by a generated `active_key` ([D-029](#d-029--alerts-upsert-on-a-generated-active-key)).

### D-023 — Sprints store instants, not days

- **Decision:** sprints have `start_at` / `end_at` (`timestamptz`) instead of the `start_date` / `end_date` in the original data model.
- **Why:** scope creep is "added after the sprint started"; with day precision, items added during planning on day 1 would be miscounted.
- **Tradeoff:** charts that think in days must truncate to the UTC day.

### D-024 — Operational tables are readable by role

- **Decision:** project-scoped tables are readable by project members only. `sync_runs` (freshness per source, no project) is readable by anyone with a project membership, `llm_calls` (usage and cost) by owners and leads. Users write only alert `status` (column privilege plus policy) and reports as themselves; every other write goes through the service role, which bypasses RLS.
- **Why:** least privilege without an admin role in the MVP; ingestion and AI writes are server-side jobs.
- **Tradeoff:** an owner of one project sees LLM cost across all projects. A dedicated admin role can replace the rule later.
- **Status:** superseded by [D-025](#d-025--sync-runs-are-per-project-with-sanitized-errors) (sync runs), [D-026](#d-026--llm-usage-is-admin-only) (LLM usage), and [D-028](#d-028--owners-and-leads-write-viewers-read) (writes).

### D-025 — Sync runs are per project, with sanitized errors

- **Decision:** `sync_runs` has a required `project_id`; every sync records one run per project and source, readable only by that project's members. `error` holds a short sanitized reason built by `describeSyncFailure`: a `SourceUnavailableError`'s status and safe reason (`jira: HTTP 401 unauthorized`, URLs replaced by `[url]`), a repository constraint name, or just the error class (`docs: unexpected TypeError`). Raw upstream messages are never stored. A calendar run fails with an explicit reason when there is no roster because the issue tracker failed.
- **Why:** a global run per source leaked other projects' keys and upstream text (URLs, bodies) to every member, and freshness is a per-project question anyway.
- **Tradeoff:** four rows per project per sync, and less detail for debugging; full errors belong in server logs, not in the database.

### D-026 — LLM usage is admin-only

- **Decision:** `llm_calls` is readable only when `public.is_admin()` is true: the JWT's `app_metadata.role` equals `admin`. `app_metadata` is writable only with the service role (never `user_metadata`, which users can edit).
- **Why:** cost and usage are operational data, not project data; "owner of any project" was too broad.
- **Tradeoff:** an admin has to be flagged through the Supabase admin API or dashboard; there is no in-app admin management.

### D-027 — Composite foreign keys keep rows inside their project

- **Decision:** `issues` and `sprints` have `unique (project_id, id)`. Children reference the pair: issue events, comments, worklogs, and snapshots use `(project_id, issue_id) -> issues (project_id, id) on delete cascade`, and issues and snapshots use `(project_id, sprint_id) -> sprints (project_id, id) on delete set null (sprint_id)`.
- **Why:** RLS filters on each row's own `project_id`; a worklog of project A pointing at an issue of project B would be shown to A's members with B's data behind it. The schema now makes that state impossible.
- **Tradeoff:** an extra unique index per parent; `on delete set null (column)` needs Postgres 15+.

### D-028 — Owners and leads write, viewers read

- **Decision:** writes are role-aware through `public.has_project_role(project_id, roles)`. Only owners and leads may change an alert's `status` and insert reports (as themselves); viewers are read-only. Grants are least-privilege: anon has nothing; authenticated has `SELECT` plus `UPDATE (status)` on alerts and `INSERT (project_id, kind, period_start, period_end, content, markdown, created_by)` on reports, so ids and timestamps cannot be spoofed. Reports are capped (`markdown` 200 KB, `content` 1 MB). A `BEFORE UPDATE OF status` trigger allows users only open -> ack | resolved and ack -> open | resolved; resolved is terminal for users, while service jobs are exempt.
- **Why:** reviewers found any member (viewer included) could reopen resolved alerts, spoof report ids and dates, insert multi-megabyte reports, and that authenticated still had TRUNCATE.
- **Tradeoff:** every new user write needs an explicit column grant plus a policy; that friction is intended.

### D-029 — Alerts upsert on a generated active key

- **Decision:** `alerts.active_key` is a stored generated column (`project_id:kind` while `open` or `ack`, null once `resolved`) with a plain unique index, replacing the partial index. Alerts also carry `updated_at` and `last_detected_at` (set from the detection time on every upsert). Semantics: `ack` = seen and still active (re-detections update it, duplicates are blocked); `resolved` = handled, and if the detector fires again on the next sync a new `open` alert is created. `setStatus` throws `AlertConflictError` instead of creating a second active alert.
- **Why:** supabase-js `.upsert(row, { onConflict })` sends `ON CONFLICT (columns)` and cannot add the `WHERE` predicate a partial index needs, so the partial index could not be the upsert target in live mode.
- **Tradeoff:** one more column whose meaning lives in an expression; the partial-index version was easier to read.

### D-030 — Live reads use a request-scoped RLS repository

- **Decision (implemented in phase 9):** user-facing reads in live mode go through a request-scoped `RadarRepository` built from the Supabase SSR cookie client, so every query runs as the signed-in user and RLS applies. The process-wide container's service-role repository is reserved for cron, sync, and admin jobs and is never handed to code that serves a user request.
- **Why:** the service role bypasses RLS; serving pages from it would make the whole policy set decorative.
- **Tradeoff:** two repository instances to wire, and per-request client construction.

### D-031 — pgvector lives in extensions, with aligned search rules

- **Decision:** `create extension vector with schema extensions` (Supabase's convention); `match_memory_items` sets `search_path = public, extensions` so `<=>` and `vector_norm` resolve. Postgres and the in-memory repository share the rules: `k <= 0` returns nothing, at most 50 results (`MAX_MEMORY_SEARCH_RESULTS`), and zero vectors (stored or query) never match instead of producing NaN.
- **Why:** extension objects stay out of the exposed `public` API schema, and the two adapters must answer the same query the same way.
- **Tradeoff:** the PGlite harness has to create the `extensions` schema to mirror Supabase.

### D-032 — Repositories are strict, sync is forgiving

- **Decision:** both repositories reject what Postgres rejects: a natural key twice in one batch, rows whose project, issue, or sprint does not exist (or belongs to another project), a new id for a known sprint natural key, and duplicate Jira keys, all as `RepositoryConstraintError`. `syncProjects` dedupes every batch by natural key (last occurrence wins), drops children of issues the source did not return, clears links to unknown sprints, and records `duplicatesDropped`, `orphansDropped`, and `issuesWithUnknownSprint` in the run's stats.
- **Why:** the in-memory adapter silently accepted states Postgres would refuse, so demo and tests could pass while live mode failed. Real sources do return duplicates across pages and references to other boards' sprints; one bad record should not fail the whole project.
- **Tradeoff:** dropped records are only visible as counters on the run.

### D-033 — The demo container is rebuilt per UTC day

- **Decision:** the container promise is cached on `globalThis` (one instance per process, shared by RSC and route-handler module copies) under a key of mode, model, URL, and, in demo mode, the UTC day. A new day rebuilds the demo; a failed build is not cached. The demo repository uses deterministic ids (`ids: "deterministic"`), derived from stable inputs (alerts: project, kind, first detection day, occurrence), so instances booted on the same day agree on alert ids and deep links survive instance changes.
- **Why:** a long-running server must not show yesterday's "today", and separate module instances must not boot separate demos.
- **Tradeoff:** demo writes (acknowledged alerts, generated reports) reset at UTC midnight, on top of D-001's per-instance ephemerality. Sync-run ids still differ between instances because each boots at a different time.

### D-034 — Stalled means five working days without commits

- **Decision:** the detector contract for phase 3 is "In Progress with no linked commit in at least 5 working days" (weekends do not count). The demo's stalled issue (BCN-306) last committed 7 working days before today, i.e. 6 full idle working days on any weekday; `stalledMinWorkingDaysWithoutCommits` records the threshold.
- **Why:** with calendar days, Monday demos would flag work that simply paused over the weekend, and the scripted issue would drift in and out of the threshold by weekday.
- **Tradeoff:** holidays still count as working days until capacity feeds the detector.

### D-035 — Refined schemas export a plain Fields variant

- **Decision:** entities with cross-field rules export `ProjectFieldsSchema`, `SprintFieldsSchema`, `CalendarEventFieldsSchema`, `ReportFieldsSchema`, and `DateRangeFieldsSchema` (plain objects) next to the refined `*Schema`. Derive with `.omit`, `.pick`, or `.partial` from the Fields variant; validate with the refined one.
- **Why:** Zod 4 throws when `.omit()` or `.pick()` is called on an object schema that has refinements.
- **Tradeoff:** two names per entity; derived schemas must re-add the refinement when they need it.

### D-036 — Sources are normalized at the adapter boundary

- **Decision:** adapters emit timestamps as UTC ISO strings (`toISOString()`; Jira's `+0000` offsets included), all-day calendar events on UTC-midnight bounds, full 40-character commit SHAs (DB check constraint), and issue keys only in uppercase (`extractIssueKeys` ignores `bcn-123` and `api-2`). Failures are `SourceUnavailableError` with a safe reason. "New Feature" and "Feature" count as code-requiring issue types.
- **Why:** downstream code compares timestamps as strings, computes capacity per UTC day, and links PRs to issues by key; lowercase matching produced false links from ordinary words.
- **Tradeoff:** lowercase branch names (`bcn-123-fix`) no longer link a PR on their own; titles must carry the key.
