# Architecture

Radar is one Next.js app on Vercel, organized as a hexagon: pure domain modules in the middle, ports around them, and adapters (Jira, GitHub, Calendar, Flocktools, Anthropic, Supabase, demo fakes) on the outside. Deterministic math produces every number; the LLM only explains numbers it is given.

## Quick path

| If you want to... | Read |
|-------------------|------|
| See who uses Radar and what it talks to | [System context](#system-context) |
| Find where code runs | [Containers](#containers) |
| Follow a nightly sync end to end | [Sync, forecast, and alert](#sync-forecast-and-alert) |
| Follow a chat question end to end | [Ask Radar](#ask-radar) |
| Know where new code goes | [Folder structure](#folder-structure) and [Layering rules](#layering-rules) |

## System context

```mermaid
C4Context
  title Radar — System Context
  Person(lead, "Engineering leader", "EM / tech lead / delivery manager")
  Person(client, "Client stakeholder", "Receives client reports")
  System(radar, "Radar", "Forecasts deviations, remembers evidence-backed work, unifies reports and Q&A")
  System_Ext(jira, "Jira Cloud", "Issues, sprints, changelog, worklogs")
  System_Ext(github, "GitHub", "PRs, reviews, commits")
  System_Ext(gcal, "Google Calendar", "PTO and meetings → capacity")
  System_Ext(flock, "Flocktools", "Docs and tech reads")
  System_Ext(claude, "Anthropic API", "claude-opus-5-5: explain, extract, report, chat")
  System_Ext(voyage, "Voyage AI", "Embeddings (optional)")
  SystemDb_Ext(supa, "Supabase", "Postgres + pgvector, Auth, RLS")
  Rel(lead, radar, "Reviews alerts, asks, generates reports", "HTTPS")
  Rel(radar, client, "Client report", "PDF / Markdown")
  Rel(radar, jira, "Reads", "REST")
  Rel(radar, github, "Reads", "REST")
  Rel(radar, gcal, "Reads", "REST")
  Rel(radar, flock, "Reads", "REST")
  Rel(radar, claude, "Explains computed numbers", "Messages API")
  Rel(radar, voyage, "Embeds memory items", "REST")
  Rel(radar, supa, "Persists, authenticates", "SQL / Auth")
```

## Containers

```mermaid
C4Container
  title Radar — Containers
  Person(lead, "Engineering leader")
  System_Ext(cron, "Vercel Cron", "Daily, within the 07:00 UTC hour")

  System_Boundary(vercel, "Next.js app on Vercel") {
    Container(ui, "UI routes", "React Server Components, shadcn/ui, Recharts", "Portfolio, project pages, Ask Radar, Admin")
    Container(api, "API routes", "Route Handlers", "/api/health, /api/chat, report generation, Sync now")
    Container(cronRoute, "Cron route", "Route Handler", "/api/cron/sync, Bearer CRON_SECRET")
    Container(root, "Composition root", "TypeScript", "Chooses demo or live adapters from DEMO_MODE")
    Container(domain, "Domain modules", "Pure TypeScript", "Forecast, Memory, Cockpit use cases behind ports")
    Container(adapters, "Adapters", "TypeScript", "Jira, GitHub, Calendar, Flocktools, LLM, Supabase, demo fakes")
  }

  SystemDb_Ext(supa, "Supabase", "Postgres + pgvector, Auth, RLS")
  System_Ext(sources, "Jira / GitHub / Calendar / Flocktools", "Source systems")
  System_Ext(claude, "Anthropic API", "claude-opus-5-5")
  System_Ext(voyage, "Voyage AI", "Embeddings")

  Rel(lead, ui, "Uses", "HTTPS")
  Rel(cron, cronRoute, "Triggers", "HTTPS GET")
  Rel(ui, root, "Resolves use cases")
  Rel(api, root, "Resolves use cases")
  Rel(cronRoute, root, "Resolves sync use case")
  Rel(root, domain, "Injects ports into")
  Rel(root, adapters, "Instantiates")
  Rel(adapters, supa, "SQL / Auth")
  Rel(adapters, sources, "REST")
  Rel(adapters, claude, "Messages API")
  Rel(adapters, voyage, "REST")
```

In demo mode the adapters box resolves to in-memory fakes, so no arrow leaves the app.

## Sync, forecast, and alert

The nightly path. Every number is computed before the LLM is involved, and the LLM output is checked against those numbers.

```mermaid
sequenceDiagram
  autonumber
  participant Cron as Vercel Cron
  participant Route as /api/cron/sync
  participant Src as Source adapters (Jira, GitHub, Calendar, Flocktools)
  participant Repo as Repositories
  participant Engine as Forecast engine (pure)
  participant Det as Detectors (pure)
  participant LLM as LLM adapter (Anthropic)
  participant Guard as Number-grounding check

  Cron->>Route: GET with Authorization: Bearer CRON_SECRET
  Route->>Route: Constant-time secret check (401 on mismatch)
  Route->>Src: Fetch issues, changelog, worklogs, PRs, commits, calendar
  Src-->>Route: Normalized domain records
  Route->>Repo: Upsert records and record sync_runs
  Route->>Engine: Run Monte Carlo, budget burn, scope creep
  Engine-->>Route: Forecast results (seeded, deterministic)
  Route->>Det: Evaluate forecasts and flow signals
  Det-->>Route: Triggered alerts with drivers and evidence
  Route->>Repo: Persist alerts
  loop Each triggered alert
    Route->>LLM: Explain drivers (structured output)
    LLM-->>Route: Headline, why, suggested actions
    Route->>Guard: Every number in text must appear in inputs
    alt Grounded
      Guard-->>Route: Accept
    else Ungrounded
      Route->>LLM: Regenerate once
      LLM-->>Route: Second attempt
      Route->>Guard: Check again
      Guard-->>Route: Accept, or use template fallback
    end
    Route->>Repo: Store explanation on the alert
  end
  Route-->>Cron: 202 with sync stats
```

## Ask Radar

A question becomes read-only tool calls over the same repositories the cockpit uses, and the answer streams back with citations.

```mermaid
sequenceDiagram
  autonumber
  actor Lead as Engineering leader
  participant UI as Ask Radar UI
  participant Chat as /api/chat
  participant Runner as Tool Runner (Anthropic SDK)
  participant Tools as Read-only tools
  participant Repo as Repositories

  Lead->>UI: "Will we hit the sprint goal?"
  UI->>Chat: POST question and history
  Chat->>Runner: Cached system prompt and tool definitions
  loop Until the model stops calling tools
    Runner->>Tools: search_issues / get_forecast / search_memory / get_team_metrics / ...
    Tools->>Repo: Query
    Repo-->>Tools: Records with evidence (keys, PR numbers, SHAs, URLs)
    Tools-->>Runner: Tool results as delimited, untrusted data
  end
  Runner-->>Chat: Streamed answer referencing evidence ids
  Chat-->>UI: Stream text and citation metadata
  UI-->>Lead: Answer with clickable citation chips
```

## Folder structure

Screaming structure: top-level folders name business capabilities, not technical layers. Every module, including each cockpit submodule, has the same three layers.

```
src/
  app/                       Next.js routes (thin: resolve use cases, render)
    api/health/              Liveness probe
    api/cron/sync/           Vercel Cron entry point
  composition-root.ts        The only place that picks demo or live adapters
  modules/
    forecast/{domain,application,ui}/
    memory/{domain,application,ui}/
    cockpit/
      reports/{domain,application,ui}/
      metrics/{domain,application,ui}/
      chat/{domain,application,ui}/
  shared/
    domain/                  Evidence, Alert, Project, Sprint, Issue, ...
    ports/                   Clock, IssueTracker, CodeHost, LLM, repositories, ...
    config/                  Validated, server-only env
  adapters/
    jira/ github/ calendar/ flocktools/ llm/ supabase/ demo/
  components/                App shell and shadcn/ui primitives
  lib/                       Framework-level helpers (http auth, cn)
supabase/migrations/         SQL migrations
scripts/                     Operational scripts (seed)
test/                        Test helpers and stubs (not shipped)
```

## Layering rules

| Layer | Lives in | Must not import |
|-------|----------|-----------------|
| Domain | `src/modules/**/domain`, `src/shared/domain` | Adapters, composition root, `next`, `react`, `react-dom`, `@anthropic-ai/*`, `@supabase/*` |
| Application (use cases) | `src/modules/**/application` | Adapters, composition root, `next`, `@anthropic-ai/*`, `@supabase/*` |
| Ports | `src/shared/ports` | Adapters, composition root, `next`, `@anthropic-ai/*`, `@supabase/*` |
| Adapters | `src/adapters/**` | Routes (`src/app`), components, any `ui` layer, composition root |
| Composition root | `src/composition-root.ts` | No restrictions |
| Everything else | `src/app`, `src/modules/**/ui`, `src/components`, `src/lib`, `src/shared/config`, other `src/*` files | Adapters |

- **Only the composition root picks adapters.** `DEMO_MODE` decides demo or live wiring there and nowhere else.
- **The container carries no secrets.** It exposes the mode, model id, public app URL, and ports. API keys are consumed inside the composition root when adapters are built; the cron secret is read through `verifyCronSecret()`.
- **ESLint enforces the table.** `no-restricted-imports` blocks in `eslint.config.mjs` fail the lint step on a violation. "Adapters" covers `@/adapters`, `./adapters`, and `../adapters` paths; third-party paths that happen to contain `adapters` are allowed.
- **Time is a port.** Code that needs "now" takes a `Clock`, so the demo seed and forecasts are reproducible.

## Math computes, the LLM explains

- Forecasts (sprint completion probability, budget exhaustion date, scope creep) are pure functions with seeded randomness and unit tests.
- The LLM receives computed numbers and drivers and writes the headline, the why, and suggested actions. It never predicts.
- Any number in LLM text that is not in the inputs triggers one regeneration, then a deterministic template.
- Every claim carries `evidence[]`; claims without evidence are dropped server-side.

See [decisions.md](./decisions.md) for the reasoning behind these rules.
