-- 0001_core.sql — Radar data spine.
--
-- Mirrors the domain schemas in src/shared/domain. Every table synced from a
-- source has a natural-key unique constraint, so sync upserts are idempotent
-- (`insert ... on conflict (...) do update`). Child rows reference their
-- parent together with `project_id` (composite foreign keys), so a row can
-- never point at a record of another project. Requires Supabase's `auth`
-- schema (auth.users) to exist.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Projects and membership
-- ---------------------------------------------------------------------------

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  jira_key text not null check (jira_key ~ '^[A-Z][A-Z0-9]+$'),
  github_repo text not null check (github_repo ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  client_name text not null,
  budget_amount numeric(14, 2) not null check (budget_amount >= 0),
  budget_currency char(3) not null default 'USD' check (budget_currency ~ '^[A-Z]{3}$'),
  hourly_rate numeric(10, 2) not null check (hourly_rate >= 0),
  start_date date not null,
  end_date date not null,
  forecast_unit text not null default 'points' check (forecast_unit in ('points', 'issues')),
  wip_limit integer not null default 5 check (wip_limit > 0),
  board_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_jira_key_key unique (jira_key),
  constraint projects_dates_ordered check (start_date <= end_date)
);

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'viewer' check (role in ('owner', 'lead', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index project_members_user_id_idx on public.project_members (user_id, project_id);

-- ---------------------------------------------------------------------------
-- Issue tracker (Jira)
-- ---------------------------------------------------------------------------

create table public.sprints (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  external_id text not null,
  name text not null,
  goal text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  state text not null check (state in ('future', 'active', 'closed')),
  -- Points committed when the sprint started (before scope changes).
  committed_points numeric(8, 2) check (committed_points >= 0),
  -- Natural key and upsert target; `id` is never overwritten by a sync.
  constraint sprints_project_external_key unique (project_id, external_id),
  -- Target of composite foreign keys from issues and snapshots.
  constraint sprints_project_id_id_key unique (project_id, id),
  constraint sprints_window_ordered check (start_at < end_at)
);

create index sprints_project_state_idx on public.sprints (project_id, state);

create table public.issues (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  sprint_id uuid,
  key text not null check (key ~ '^[A-Z][A-Z0-9]+-[0-9]+$'),
  title text not null,
  type text not null,
  status text not null,
  status_category text not null check (status_category in ('todo', 'in_progress', 'done')),
  points numeric(8, 2) check (points >= 0),
  assignee text,
  requires_code boolean not null default true,
  -- Source timestamps (Jira), not row bookkeeping.
  created_at timestamptz not null,
  updated_at timestamptz not null,
  resolved_at timestamptz,
  url text not null check (url ~ '^https?://'),
  constraint issues_project_key unique (project_id, key),
  constraint issues_project_id_id_key unique (project_id, id),
  constraint issues_project_sprint_fkey foreign key (project_id, sprint_id)
    references public.sprints (project_id, id) on delete set null (sprint_id)
);

create index issues_sprint_id_idx on public.issues (sprint_id);
create index issues_project_status_idx on public.issues (project_id, status_category);

-- Live-mode cache only: burn-up is derived from issues + issue_events, and
-- daily snapshots just make long histories cheaper to chart.
create table public.issue_snapshots (
  project_id uuid not null references public.projects (id) on delete cascade,
  issue_id uuid not null,
  captured_on date not null,
  status text not null,
  status_category text not null check (status_category in ('todo', 'in_progress', 'done')),
  points numeric(8, 2) check (points >= 0),
  sprint_id uuid,
  primary key (issue_id, captured_on),
  constraint issue_snapshots_project_issue_fkey foreign key (project_id, issue_id)
    references public.issues (project_id, id) on delete cascade,
  constraint issue_snapshots_project_sprint_fkey foreign key (project_id, sprint_id)
    references public.sprints (project_id, id) on delete set null (sprint_id)
);

create index issue_snapshots_project_day_idx on public.issue_snapshots (project_id, captured_on);

-- Changelog entries. `from`/`to` are reserved words, hence *_value.
create table public.issue_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  issue_id uuid not null,
  external_id text not null,
  field text not null check (field in ('status', 'sprint', 'points', 'resolution')),
  from_value text,
  to_value text,
  at timestamptz not null,
  author text,
  constraint issue_events_project_external unique (project_id, external_id),
  constraint issue_events_project_issue_fkey foreign key (project_id, issue_id)
    references public.issues (project_id, id) on delete cascade
);

create index issue_events_issue_id_idx on public.issue_events (issue_id);
create index issue_events_project_at_idx on public.issue_events (project_id, at);

create table public.issue_comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  issue_id uuid not null,
  external_id text not null,
  author text not null,
  body text not null default '',
  created_at timestamptz not null,
  url text not null check (url ~ '^https?://'),
  constraint issue_comments_project_external unique (project_id, external_id),
  constraint issue_comments_project_issue_fkey foreign key (project_id, issue_id)
    references public.issues (project_id, id) on delete cascade
);

create index issue_comments_issue_id_idx on public.issue_comments (issue_id);

create table public.worklogs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  issue_id uuid not null,
  external_id text not null,
  author text not null,
  seconds integer not null check (seconds > 0),
  started_at timestamptz not null,
  constraint worklogs_project_external unique (project_id, external_id),
  constraint worklogs_project_issue_fkey foreign key (project_id, issue_id)
    references public.issues (project_id, id) on delete cascade
);

create index worklogs_project_started_idx on public.worklogs (project_id, started_at);
create index worklogs_issue_id_idx on public.worklogs (issue_id);

-- ---------------------------------------------------------------------------
-- Code host (GitHub). Full 40-character SHAs only.
-- ---------------------------------------------------------------------------

create table public.pull_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  number integer not null check (number > 0),
  title text not null,
  state text not null check (state in ('open', 'closed', 'merged')),
  author text not null,
  created_at timestamptz not null,
  merged_at timestamptz,
  first_review_at timestamptz,
  linked_issue_keys text[] not null default '{}',
  url text not null check (url ~ '^https?://'),
  head_sha text check (head_sha ~ '^[0-9a-f]{40}$'),
  merge_commit_sha text check (merge_commit_sha ~ '^[0-9a-f]{40}$'),
  constraint pull_requests_project_number unique (project_id, number)
);

create index pull_requests_project_state_idx on public.pull_requests (project_id, state);
create index pull_requests_linked_issue_keys_idx on public.pull_requests using gin (linked_issue_keys);

create table public.commits (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  sha text not null check (sha ~ '^[0-9a-f]{40}$'),
  author text not null,
  message text not null default '',
  committed_at timestamptz not null,
  linked_issue_keys text[] not null default '{}',
  url text not null check (url ~ '^https?://'),
  constraint commits_project_sha unique (project_id, sha)
);

create index commits_project_committed_idx on public.commits (project_id, committed_at);
create index commits_linked_issue_keys_idx on public.commits using gin (linked_issue_keys);

-- ---------------------------------------------------------------------------
-- Calendar and docs
-- ---------------------------------------------------------------------------

create table public.capacity (
  project_id uuid not null references public.projects (id) on delete cascade,
  person text not null,
  date date not null,
  available_hours numeric(5, 2) not null check (available_hours >= 0 and available_hours <= 24),
  reason text check (reason in ('weekend', 'holiday', 'pto', 'meetings')),
  primary key (project_id, person, date)
);

create table public.docs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null,
  url text not null check (url ~ '^https?://'),
  updated_at timestamptz not null,
  excerpt text not null default '',
  constraint docs_project_slug unique (project_id, slug)
);

-- ---------------------------------------------------------------------------
-- Forecasts, alerts, memory, reports
-- ---------------------------------------------------------------------------

create table public.forecasts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null,
  computed_at timestamptz not null default now(),
  inputs jsonb not null default '{}',
  result jsonb not null default '{}'
);

create index forecasts_project_kind_computed_idx
  on public.forecasts (project_id, kind, computed_at desc);

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null check (kind in (
    'sprint_goal_risk', 'budget_overrun', 'scope_creep', 'wip_over_limit',
    'stale_review', 'stalled_issue', 'reopen_rate'
  )),
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  confidence numeric(4, 3) not null check (confidence >= 0 and confidence <= 1),
  eta date,
  title text not null,
  explanation text,
  explanation_source text check (explanation_source in ('llm', 'template')),
  drivers jsonb not null default '[]' check (jsonb_typeof(drivers) = 'array'),
  -- Evidence or it didn't happen: at least one pointer.
  evidence jsonb not null check (
    case when jsonb_typeof(evidence) = 'array'
      then jsonb_array_length(evidence) >= 1
      else false
    end
  ),
  suggested_actions jsonb not null default '[]' check (jsonb_typeof(suggested_actions) = 'array'),
  -- open: detected; ack: seen, still active; resolved: handled (terminal).
  status text not null default 'open' check (status in ('open', 'ack', 'resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  -- `project_id:kind` while the alert is active (open or ack), null once
  -- resolved. Its plain unique index allows one active alert per kind and is
  -- the upsert target PostgREST can use: `.upsert(row, { onConflict: 'active_key' })`.
  active_key text generated always as (
    case when status in ('open', 'ack') then project_id::text || ':' || kind end
  ) stored
);

create index alerts_project_kind_status_idx on public.alerts (project_id, kind, status);
create unique index alerts_active_key_idx on public.alerts (active_key);

create trigger alerts_set_updated_at
  before update on public.alerts
  for each row execute function public.set_updated_at();

create table public.memory_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null check (kind in ('done', 'pending', 'decision', 'risk', 'next_step')),
  summary text not null,
  evidence jsonb not null check (
    case when jsonb_typeof(evidence) = 'array'
      then jsonb_array_length(evidence) >= 1
      else false
    end
  ),
  occurred_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index memory_items_project_kind_status_idx on public.memory_items (project_id, kind, status);
create index memory_items_project_occurred_idx on public.memory_items (project_id, occurred_at);

create trigger memory_items_set_updated_at
  before update on public.memory_items
  for each row execute function public.set_updated_at();

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null check (kind in ('progress', 'client', 'weekly')),
  period_start date not null,
  period_end date not null,
  content jsonb not null default '{}' check (octet_length(content::text) <= 1000000),
  markdown text not null default '' check (octet_length(markdown) <= 200000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint reports_period_ordered check (period_start <= period_end)
);

create index reports_project_created_idx on public.reports (project_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Operations
-- ---------------------------------------------------------------------------

-- One row per project and source per sync. `error` is a short sanitized
-- reason (e.g. 'jira: HTTP 401 unauthorized'), never upstream text.
create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  source text not null check (source in ('jira', 'github', 'calendar', 'docs')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'partial', 'failed')),
  stats jsonb not null default '{}',
  error text check (char_length(error) <= 500),
  constraint sync_runs_finished_after_start check (finished_at is null or finished_at >= started_at)
);

create index sync_runs_project_source_started_idx
  on public.sync_runs (project_id, source, started_at desc);

create table public.llm_calls (
  id uuid primary key default gen_random_uuid(),
  purpose text not null,
  model text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cache_read_tokens integer not null default 0 check (cache_read_tokens >= 0),
  latency_ms integer not null check (latency_ms >= 0),
  stop_reason text,
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now()
);

create index llm_calls_created_idx on public.llm_calls (created_at desc);
