import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EMBEDDING_DIMENSIONS } from "@/shared/domain";

/**
 * Applies supabase/migrations/*.sql, in order, to an in-process Postgres
 * (PGlite, WASM) and checks the schema, grants, RLS, and pgvector search.
 *
 * Supabase provides the `auth` and `extensions` schemas and the
 * anon/authenticated/service_role roles; PGlite does not, so `SUPABASE_STUB`
 * recreates what the migrations depend on: `auth.users`, `auth.uid()` and
 * `auth.jwt()` (reading the request JWT claims setting, like Supabase), the
 * three roles, the `extensions` schema, and Supabase's default privileges on
 * the public schema (everything granted to all three roles).
 */

const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../supabase/migrations/", import.meta.url),
);

const SUPABASE_STUB = `
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $$;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
  $$;

  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;

  create schema extensions;
  grant usage on schema public, auth, extensions to anon, authenticated, service_role;
  alter default privileges in schema public
    grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public
    grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public
    grant all on sequences to anon, authenticated, service_role;
`;

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const USERS = {
  leadA: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  viewerA: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  leadB: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
  outsider: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
  admin: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5",
};

/** Per-project fixture ids: one row per project-scoped table. */
const FIXTURE = {
  [A]: {
    key: "BCN",
    sprint: "33333333-3333-4333-8333-3333333333a1",
    issue: "44444444-4444-4444-8444-4444444444a1",
    alert: "55555555-5555-4555-8555-5555555555a1",
  },
  [B]: {
    key: "ATL",
    sprint: "33333333-3333-4333-8333-3333333333b1",
    issue: "44444444-4444-4444-8444-4444444444b1",
    alert: "55555555-5555-4555-8555-5555555555b1",
  },
} as const;

const MEMORY = {
  near: "66666666-6666-4666-8666-666666666661",
  far: "66666666-6666-4666-8666-666666666662",
  zero: "66666666-6666-4666-8666-666666666663",
};

/** Every table with a project column, and that column's name. */
const PROJECT_SCOPED_TABLES: Record<string, string> = {
  projects: "id",
  project_members: "project_id",
  sprints: "project_id",
  issues: "project_id",
  issue_snapshots: "project_id",
  issue_events: "project_id",
  issue_comments: "project_id",
  worklogs: "project_id",
  pull_requests: "project_id",
  commits: "project_id",
  capacity: "project_id",
  docs: "project_id",
  forecasts: "project_id",
  alerts: "project_id",
  memory_items: "project_id",
  reports: "project_id",
  sync_runs: "project_id",
};
const GLOBAL_TABLES = ["llm_calls"];

const EVIDENCE = JSON.stringify([
  {
    sourceType: "jira_issue",
    externalId: "BCN-1",
    url: "https://demo.atlassian.net/browse/BCN-1",
    occurredAt: "2026-10-01T10:00:00.000Z",
  },
]);

function vectorLiteral(hot: number, value = 1): string {
  const values = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) =>
    index === hot ? value : 0,
  );
  return `[${values.join(",")}]`;
}

function sha(seed: string): string {
  return seed.repeat(40).slice(0, 40);
}

let db: PGlite;

type Claims = { sub?: string; app_metadata?: Record<string, unknown> } | null;
type Role = "anon" | "authenticated" | "service_role";

/** Runs `fn` as a Supabase role with the given JWT claims, then restores the superuser. */
async function as<T>(role: Role, claims: Claims, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    claims ? JSON.stringify(claims) : "",
  ]);
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims', '', false)");
  }
}

const user = (sub: string): Claims => ({ sub });
const ADMIN_CLAIMS: Claims = { sub: USERS.admin, app_metadata: { role: "admin" } };

async function rows<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function seedProject(projectId: string): Promise<void> {
  const { key, sprint, issue, alert } = FIXTURE[projectId as keyof typeof FIXTURE];
  const params = [projectId, sprint, issue, key];
  await db.query(
    `insert into public.sprints (id, project_id, external_id, name, start_at, end_at, state)
     values ($2, $1, 'S1', 'Sprint 1', '2026-10-05T09:00:00Z', '2026-10-16T18:00:00Z', 'active')`,
    params.slice(0, 2),
  );
  await db.query(
    `insert into public.issues (id, project_id, sprint_id, key, title, type, status, status_category, created_at, updated_at, url)
     values ($3, $1, $2, $4 || '-1', 'Fixture', 'Story', 'To Do', 'todo', now(), now(), 'https://demo.atlassian.net/browse/' || $4 || '-1')`,
    params,
  );
  await db.query(
    `insert into public.issue_snapshots (project_id, issue_id, captured_on, status, status_category, sprint_id)
     values ($1, $3, '2026-10-06', 'To Do', 'todo', $2)`,
    params.slice(0, 3),
  );
  await db.query(
    `insert into public.issue_events (project_id, issue_id, external_id, field, from_value, to_value, at)
     values ($1, $2, 'e1', 'status', 'To Do', 'In Progress', now())`,
    [projectId, issue],
  );
  await db.query(
    `insert into public.issue_comments (project_id, issue_id, external_id, author, body, created_at, url)
     values ($1, $2, 'c1', 'Ana', 'Hi', now(), 'https://demo.atlassian.net/browse/X-1')`,
    [projectId, issue],
  );
  await db.query(
    `insert into public.worklogs (project_id, issue_id, external_id, author, seconds, started_at)
     values ($1, $2, 'w1', 'Ana', 3600, now())`,
    [projectId, issue],
  );
  await db.query(
    `insert into public.pull_requests (project_id, number, title, state, author, created_at, url)
     values ($1, 1, 'Fixture PR', 'open', 'ana', now(), 'https://github.com/demo-org/repo/pull/1')`,
    [projectId],
  );
  await db.query(
    `insert into public.commits (project_id, sha, author, message, committed_at, url)
     values ($1, $2, 'ana', 'Fixture', now(), 'https://github.com/demo-org/repo/commit/x')`,
    [projectId, sha("a")],
  );
  await db.query(
    `insert into public.capacity (project_id, person, date, available_hours) values ($1, 'Ana', '2026-10-06', 8)`,
    [projectId],
  );
  await db.query(
    `insert into public.docs (project_id, slug, title, url, updated_at)
     values ($1, 'runbook', 'Runbook', 'https://flocktools.demo/docs/runbook', now())`,
    [projectId],
  );
  await db.query(
    `insert into public.forecasts (project_id, kind) values ($1, 'sprint_completion')`,
    [projectId],
  );
  await db.query(
    `insert into public.alerts (id, project_id, kind, severity, confidence, title, evidence)
     values ($2, $1, 'scope_creep', 'high', 0.8, 'Scope creep', $3::jsonb)`,
    [projectId, alert, EVIDENCE],
  );
  await db.query(
    `insert into public.reports (project_id, kind, period_start, period_end, markdown)
     values ($1, 'progress', '2026-10-01', '2026-10-07', '# Fixture')`,
    [projectId],
  );
  await db.query(
    `insert into public.sync_runs (project_id, source, status, error)
     values ($1, 'jira', 'failed', 'jira: HTTP 401 unauthorized')`,
    [projectId],
  );
}

beforeAll(async () => {
  db = await PGlite.create({ extensions: { vector } });
  await db.exec(SUPABASE_STUB);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort();
  expect(files).toEqual(["0001_core.sql", "0002_rls.sql", "0003_memory_vector.sql"]);
  for (const file of files) {
    await db.exec(readFileSync(`${MIGRATIONS_DIR}${file}`, "utf8"));
  }

  // Fixtures, written as the superuser (like the service role would).
  await db.query(
    `insert into auth.users (id) select unnest($1::uuid[])`,
    [Object.values(USERS)],
  );
  await db.query(
    `insert into public.projects
       (id, name, jira_key, github_repo, client_name, budget_amount, hourly_rate, start_date, end_date)
     values
       ($1, 'Beacon', 'BCN', 'demo-org/beacon-api', 'Globex', 200000, 50, '2026-07-01', '2027-01-06'),
       ($2, 'Atlas', 'ATL', 'demo-org/atlas-web', 'Northwind', 250000, 55, '2026-07-01', '2027-02-05')`,
    [A, B],
  );
  await db.query(
    `insert into public.project_members (project_id, user_id, role)
     values ($1, $3, 'lead'), ($1, $4, 'viewer'), ($2, $5, 'lead')`,
    [A, B, USERS.leadA, USERS.viewerA, USERS.leadB],
  );
  await seedProject(A);
  await seedProject(B);
  await db.query(
    `insert into public.memory_items (id, project_id, kind, summary, evidence, occurred_at, status, embedding)
     values
       ($1, $4, 'done', 'Shipped webhook retries', $5::jsonb, '2026-10-02T10:00:00Z', 'resolved', $6::extensions.vector),
       ($2, $4, 'decision', 'Rate limit per API key', $5::jsonb, '2026-10-03T10:00:00Z', 'open', $7::extensions.vector),
       ($3, $4, 'risk', 'Zero vector', $5::jsonb, '2026-10-03T11:00:00Z', 'open', $8::extensions.vector)`,
    [
      MEMORY.near,
      MEMORY.far,
      MEMORY.zero,
      A,
      EVIDENCE,
      vectorLiteral(0),
      vectorLiteral(1),
      vectorLiteral(0, 0),
    ],
  );
  // 55 embedded items in project B, to check the 50-row cap.
  await db.query(
    `insert into public.memory_items (project_id, kind, summary, evidence, occurred_at, embedding)
     select $1, 'done', 'Bulk ' || g, $2::jsonb, now(), $3::extensions.vector
     from generate_series(1, 55) g`,
    [B, EVIDENCE, vectorLiteral(2)],
  );
  await db.query(
    `insert into public.llm_calls (purpose, model, latency_ms, cost_usd) values ('chat', 'claude-opus-5-5', 900, 0.01)`,
  );
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("schema", () => {
  it("creates every table of the data model", async () => {
    const tables = await rows<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
       order by table_name`,
    );
    expect(tables.map((row) => row.table_name)).toEqual(
      [...Object.keys(PROJECT_SCOPED_TABLES), ...GLOBAL_TABLES].sort(),
    );
  });

  it("upserts idempotently on every natural key", async () => {
    const issueA = FIXTURE[A].issue;
    const cases: Array<{ table: string; sql: string; params: unknown[]; where: string }> = [
      {
        table: "projects",
        sql: `insert into public.projects (name, jira_key, github_repo, client_name, budget_amount, hourly_rate, start_date, end_date)
              values ($1, 'IDEM', 'o/r', 'C', 1, 1, '2026-01-01', '2026-12-31')
              on conflict (jira_key) do update set name = excluded.name`,
        params: [],
        where: "jira_key = 'IDEM'",
      },
      {
        table: "sprints",
        sql: `insert into public.sprints (project_id, external_id, name, start_at, end_at, state)
              values ('${A}', 'IDEM', $1, '2026-10-05T09:00:00Z', '2026-10-16T18:00:00Z', 'future')
              on conflict (project_id, external_id) do update set name = excluded.name`,
        params: [],
        where: `project_id = '${A}' and external_id = 'IDEM'`,
      },
      {
        table: "issues",
        sql: `insert into public.issues (project_id, key, title, type, status, status_category, created_at, updated_at, url)
              values ('${A}', 'BCN-900', $1, 'Story', 'To Do', 'todo', now(), now(), 'https://x.test/BCN-900')
              on conflict (project_id, key) do update set title = excluded.title`,
        params: [],
        where: `project_id = '${A}' and key = 'BCN-900'`,
      },
      {
        table: "issue_snapshots",
        sql: `insert into public.issue_snapshots (project_id, issue_id, captured_on, status, status_category)
              values ('${A}', '${issueA}', '2026-10-07', $1, 'todo')
              on conflict (issue_id, captured_on) do update set status = excluded.status`,
        params: [],
        where: `issue_id = '${issueA}' and captured_on = '2026-10-07'`,
      },
      {
        table: "issue_events",
        sql: `insert into public.issue_events (project_id, issue_id, external_id, field, to_value, at)
              values ('${A}', '${issueA}', 'IDEM', 'status', $1, now())
              on conflict (project_id, external_id) do update set to_value = excluded.to_value`,
        params: [],
        where: `project_id = '${A}' and external_id = 'IDEM'`,
      },
      {
        table: "issue_comments",
        sql: `insert into public.issue_comments (project_id, issue_id, external_id, author, body, created_at, url)
              values ('${A}', '${issueA}', 'IDEM', 'Ana', $1, now(), 'https://x.test/c')
              on conflict (project_id, external_id) do update set body = excluded.body`,
        params: [],
        where: `project_id = '${A}' and external_id = 'IDEM'`,
      },
      {
        table: "worklogs",
        sql: `insert into public.worklogs (project_id, issue_id, external_id, author, seconds, started_at)
              values ('${A}', '${issueA}', 'IDEM', $1, 60, now())
              on conflict (project_id, external_id) do update set author = excluded.author`,
        params: [],
        where: `project_id = '${A}' and external_id = 'IDEM'`,
      },
      {
        table: "pull_requests",
        sql: `insert into public.pull_requests (project_id, number, title, state, author, created_at, url)
              values ('${A}', 900, $1, 'open', 'ana', now(), 'https://x.test/pr')
              on conflict (project_id, number) do update set title = excluded.title`,
        params: [],
        where: `project_id = '${A}' and number = 900`,
      },
      {
        table: "commits",
        sql: `insert into public.commits (project_id, sha, author, message, committed_at, url)
              values ('${A}', '${sha("b")}', 'ana', $1, now(), 'https://x.test/c')
              on conflict (project_id, sha) do update set message = excluded.message`,
        params: [],
        where: `project_id = '${A}' and sha = '${sha("b")}'`,
      },
      {
        table: "capacity",
        sql: `insert into public.capacity (project_id, person, date, available_hours, reason)
              values ('${A}', 'Idem', '2026-10-07', length($1::text), 'meetings')
              on conflict (project_id, person, date) do update set available_hours = excluded.available_hours`,
        params: [],
        where: `project_id = '${A}' and person = 'Idem'`,
      },
      {
        table: "docs",
        sql: `insert into public.docs (project_id, slug, title, url, updated_at)
              values ('${A}', 'idem', $1, 'https://x.test/d', now())
              on conflict (project_id, slug) do update set title = excluded.title`,
        params: [],
        where: `project_id = '${A}' and slug = 'idem'`,
      },
      {
        table: "alerts",
        sql: `insert into public.alerts (project_id, kind, severity, confidence, title, evidence)
              values ('${A}', 'reopen_rate', 'low', 0.5, $1, '${EVIDENCE}'::jsonb)
              on conflict (active_key) do update set title = excluded.title`,
        params: [],
        where: `project_id = '${A}' and kind = 'reopen_rate'`,
      },
      {
        table: "memory_items",
        sql: `insert into public.memory_items (id, project_id, kind, summary, evidence, occurred_at)
              values ('77777777-7777-4777-8777-777777777777', '${A}', 'done', $1, '${EVIDENCE}'::jsonb, now())
              on conflict (id) do update set summary = excluded.summary`,
        params: [],
        where: `id = '77777777-7777-4777-8777-777777777777'`,
      },
    ];

    for (const testCase of cases) {
      await db.query(testCase.sql, ["first"]);
      await db.query(testCase.sql, ["second"]);
      const [{ count }] = await rows<{ count: number }>(
        `select count(*)::int as count from public.${testCase.table} where ${testCase.where}`,
      );
      expect(count, testCase.table).toBe(1);
    }
    const [issue] = await rows<{ title: string }>(
      `select title from public.issues where project_id = $1 and key = 'BCN-900'`,
      [A],
    );
    expect(issue.title).toBe("second");
  });

  it("rejects links across projects (composite foreign keys)", async () => {
    await expect(
      db.query(
        `insert into public.worklogs (project_id, issue_id, external_id, author, seconds, started_at)
         values ($1, $2, 'cross', 'Ana', 60, now())`,
        [A, FIXTURE[B].issue],
      ),
    ).rejects.toThrow(/worklogs_project_issue_fkey/);
    await expect(
      db.query(
        `insert into public.issues (project_id, sprint_id, key, title, type, status, status_category, created_at, updated_at, url)
         values ($1, $2, 'BCN-901', 'Cross', 'Story', 'To Do', 'todo', now(), now(), 'https://x.test/1')`,
        [A, FIXTURE[B].sprint],
      ),
    ).rejects.toThrow(/issues_project_sprint_fkey/);
    await expect(
      db.query(
        `insert into public.issue_events (project_id, issue_id, external_id, field, at)
         values ($1, $2, 'cross', 'status', now())`,
        [B, FIXTURE[A].issue],
      ),
    ).rejects.toThrow(/issue_events_project_issue_fkey/);
  });

  it("clears only the sprint link when a sprint is deleted", async () => {
    const sprint = "33333333-3333-4333-8333-3333333333c1";
    await db.query(
      `insert into public.sprints (id, project_id, external_id, name, start_at, end_at, state)
       values ($1, $2, 'TMP', 'Temp', '2026-11-02T09:00:00Z', '2026-11-13T18:00:00Z', 'future')`,
      [sprint, A],
    );
    await db.query(
      `insert into public.issues (project_id, sprint_id, key, title, type, status, status_category, created_at, updated_at, url)
       values ($1, $2, 'BCN-902', 'Planned', 'Story', 'To Do', 'todo', now(), now(), 'https://x.test/2')`,
      [A, sprint],
    );
    await db.query(`delete from public.sprints where id = $1`, [sprint]);

    expect(
      await rows(`select project_id, sprint_id from public.issues where key = 'BCN-902'`),
    ).toEqual([{ project_id: A, sprint_id: null }]);
  });

  it("keeps one active alert per kind through a PostgREST-compatible upsert key", async () => {
    // Exactly what `.upsert(row, { onConflict: 'active_key' })` sends.
    const upsert = `
      insert into public.alerts (project_id, kind, severity, confidence, title, evidence, last_detected_at)
      values ($1, 'budget_overrun', $2, 0.7, 'Budget overrun', $3::jsonb, $4)
      on conflict (active_key) do update set
        severity = excluded.severity,
        confidence = excluded.confidence,
        title = excluded.title,
        evidence = excluded.evidence,
        last_detected_at = excluded.last_detected_at`;
    await db.query(upsert, [A, "medium", EVIDENCE, "2026-10-08T07:00:00Z"]);
    await db.query(upsert, [A, "high", EVIDENCE, "2026-10-09T07:00:00Z"]);

    const active = await rows<{ severity: string; active_key: string; last_detected_at: Date }>(
      `select severity, active_key, last_detected_at from public.alerts
       where project_id = $1 and kind = 'budget_overrun'`,
      [A],
    );
    expect(active).toHaveLength(1);
    expect(active[0].severity).toBe("high");
    expect(active[0].active_key).toBe(`${A}:budget_overrun`);
    expect(new Date(active[0].last_detected_at).toISOString()).toBe("2026-10-09T07:00:00.000Z");

    // Resolved alerts leave the key and never block a new open one.
    await db.query(
      `update public.alerts set status = 'resolved' where project_id = $1 and kind = 'budget_overrun'`,
      [A],
    );
    await db.query(upsert, [A, "critical", EVIDENCE, "2026-10-10T07:00:00Z"]);
    const statuses = await rows<{ status: string; active_key: string | null }>(
      `select status, active_key from public.alerts
       where project_id = $1 and kind = 'budget_overrun' order by status`,
      [A],
    );
    expect(statuses).toEqual([
      { status: "open", active_key: `${A}:budget_overrun` },
      { status: "resolved", active_key: null },
    ]);

    // A second active alert of the same kind is impossible.
    await expect(
      db.query(
        `insert into public.alerts (project_id, kind, severity, confidence, title, evidence, status)
         values ($1, 'budget_overrun', 'low', 0.5, 'Duplicate', $2::jsonb, 'ack')`,
        [A, EVIDENCE],
      ),
    ).rejects.toThrow(/alerts_active_key_idx/);
    await expect(
      db.query(
        `insert into public.alerts (project_id, kind, severity, confidence, title, evidence)
         values ($1, 'wip_over_limit', 'low', 0.5, 'No evidence', '[]'::jsonb)`,
        [A],
      ),
    ).rejects.toThrow(/check constraint/);
  });
});

describe("row level security", () => {
  it.each(Object.entries(PROJECT_SCOPED_TABLES))(
    "%s: members see only their projects, outsiders nothing, anon is denied",
    async (table, column) => {
      const visible = (claims: Claims) =>
        as("authenticated", claims, () =>
          rows<{ project_id: string }>(
            `select distinct ${column} as project_id from public.${table} order by 1`,
          ),
        );

      expect(await visible(user(USERS.leadA))).toEqual([{ project_id: A }]);
      expect(await visible(user(USERS.viewerA))).toEqual([{ project_id: A }]);
      expect(await visible(user(USERS.leadB))).toEqual([{ project_id: B }]);
      expect(await visible(user(USERS.outsider))).toEqual([]);
      expect(await visible(ADMIN_CLAIMS)).toEqual([]);
      await expect(
        as("anon", null, () => rows(`select 1 from public.${table}`)),
      ).rejects.toThrow(/permission denied/);
    },
  );

  it("shows sync run errors only to the project's members", async () => {
    const runs = (claims: Claims) =>
      as("authenticated", claims, () =>
        rows<{ project_id: string; error: string }>(
          `select project_id, error from public.sync_runs order by project_id`,
        ),
      );
    expect(await runs(user(USERS.viewerA))).toEqual([
      { project_id: A, error: "jira: HTTP 401 unauthorized" },
    ]);
    expect((await runs(user(USERS.leadB))).map((run) => run.project_id)).toEqual([B]);
    expect(await runs(user(USERS.outsider))).toEqual([]);
  });

  it("shows LLM usage to admins only", async () => {
    const calls = (claims: Claims) =>
      as("authenticated", claims, () => rows(`select purpose from public.llm_calls`));

    expect(await calls(ADMIN_CLAIMS)).toEqual([{ purpose: "chat" }]);
    expect(await calls(user(USERS.leadA))).toEqual([]);
    expect(await calls(user(USERS.viewerA))).toEqual([]);
    // user_metadata is user-editable, so it must not grant admin.
    expect(
      await calls({ sub: USERS.leadA, app_metadata: { role: "lead" } }),
    ).toEqual([]);
    await expect(
      as("anon", null, () => rows(`select 1 from public.llm_calls`)),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("user writes", () => {
  const setStatus = (claims: Claims, alertId: string, status: string) =>
    as("authenticated", claims, () =>
      rows(`update public.alerts set status = $2 where id = $1 returning status`, [
        alertId,
        status,
      ]),
    );

  it("lets only owners and leads change alert status, and nothing else", async () => {
    const alertA = FIXTURE[A].alert;

    expect(await setStatus(user(USERS.viewerA), alertA, "ack")).toEqual([]);
    expect(await setStatus(user(USERS.leadB), alertA, "ack")).toEqual([]);
    expect(await setStatus(user(USERS.leadA), alertA, "ack")).toEqual([{ status: "ack" }]);

    await expect(
      as("authenticated", user(USERS.leadA), () =>
        rows(`update public.alerts set title = 'tampered' where id = $1`, [alertA]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("enforces alert status transitions for users, not for the service role", async () => {
    const alertB = FIXTURE[B].alert;
    const lead = user(USERS.leadB);

    expect(await setStatus(lead, alertB, "ack")).toEqual([{ status: "ack" }]);
    expect(await setStatus(lead, alertB, "open")).toEqual([{ status: "open" }]);
    expect(await setStatus(lead, alertB, "resolved")).toEqual([{ status: "resolved" }]);
    await expect(setStatus(lead, alertB, "open")).rejects.toThrow(
      /cannot change from resolved to open/,
    );
    await expect(setStatus(lead, alertB, "ack")).rejects.toThrow(
      /cannot change from resolved to ack/,
    );

    const reopened = await as("service_role", null, () =>
      rows(`update public.alerts set status = 'open' where id = $1 returning status`, [alertB]),
    );
    expect(reopened).toEqual([{ status: "open" }]);
  });

  it("lets owners and leads create reports only as themselves, within limits", async () => {
    const insert = (claims: Claims, createdBy: string, extra = "", extraValue = "") =>
      as("authenticated", claims, () =>
        rows(
          `insert into public.reports (project_id, kind, period_start, period_end, markdown, created_by${extra})
           values ($1, 'client', '2026-10-01', '2026-10-07', '# Update', $2${extraValue})
           returning created_by`,
          [A, createdBy],
        ),
      );

    expect(await insert(user(USERS.leadA), USERS.leadA)).toEqual([{ created_by: USERS.leadA }]);
    await expect(insert(user(USERS.leadA), USERS.viewerA)).rejects.toThrow(/row-level security/);
    await expect(insert(user(USERS.viewerA), USERS.viewerA)).rejects.toThrow(/row-level security/);
    await expect(insert(user(USERS.outsider), USERS.outsider)).rejects.toThrow(/row-level security/);
    await expect(
      insert(user(USERS.leadA), USERS.leadA, ", created_at", ", '2000-01-01'"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      insert(user(USERS.leadA), USERS.leadA, ", id", ", '99999999-9999-4999-8999-999999999999'"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as("authenticated", user(USERS.leadA), () =>
        rows(
          `insert into public.reports (project_id, kind, period_start, period_end, markdown, created_by)
           values ($1, 'client', '2026-10-01', '2026-10-07', repeat('x', 200001), $2)`,
          [A, USERS.leadA],
        ),
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it.each([
    ["truncate", `truncate public.alerts`],
    ["delete", `delete from public.alerts`],
    ["insert synced data", `insert into public.docs (project_id, slug, title, url, updated_at) values ('${A}', 'x', 'x', 'https://x.test', now())`],
    ["grant themselves membership", `insert into public.project_members (project_id, user_id, role) values ('${B}', '${USERS.leadA}', 'owner')`],
    ["edit a project", `update public.projects set name = 'x'`],
    ["edit LLM usage", `update public.llm_calls set cost_usd = 0`],
  ])("denies authenticated users to %s", async (_label, sql) => {
    await expect(as("authenticated", user(USERS.leadA), () => rows(sql))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("denies anon every write", async () => {
    await expect(as("anon", null, () => rows(`delete from public.alerts`))).rejects.toThrow(
      /permission denied/,
    );
    await expect(as("anon", null, () => rows(`truncate public.issues`))).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("memory search", () => {
  const match = (projectId: string, query: string, count: number) =>
    rows<{ id: string; similarity: number }>(
      `select id, similarity from public.match_memory_items($1, $2::extensions.vector, $3)`,
      [projectId, query, count],
    );

  it("ranks by cosine similarity and skips zero vectors", async () => {
    expect(await match(A, vectorLiteral(0), 5)).toEqual([
      { id: MEMORY.near, similarity: 1 },
      { id: MEMORY.far, similarity: 0 },
    ]);
    expect(await match(A, vectorLiteral(0, 0), 5)).toEqual([]);

    const indexes = await rows(
      `select indexname from pg_indexes
       where tablename = 'memory_items' and indexdef ilike '%hnsw%vector_cosine_ops%'`,
    );
    expect(indexes).toHaveLength(1);
  });

  it("clamps the result count like the in-memory repository", async () => {
    expect(await match(B, vectorLiteral(2), 0)).toEqual([]);
    expect(await match(B, vectorLiteral(2), -3)).toEqual([]);
    expect(await match(B, vectorLiteral(2), 500)).toHaveLength(50);
  });

  it("applies RLS inside match_memory_items", async () => {
    const asUser = (sub: string) =>
      as("authenticated", user(sub), () => match(A, vectorLiteral(0), 5));

    expect((await asUser(USERS.viewerA)).map((row) => row.id)).toEqual([MEMORY.near, MEMORY.far]);
    expect(await asUser(USERS.outsider)).toEqual([]);
    await expect(
      as("anon", null, () => match(A, vectorLiteral(0), 5)),
    ).rejects.toThrow(/permission denied/);
  });

  it("installs pgvector in the extensions schema", async () => {
    expect(
      await rows(
        `select n.nspname as schema from pg_extension e
         join pg_namespace n on n.oid = e.extnamespace where e.extname = 'vector'`,
      ),
    ).toEqual([{ schema: "extensions" }]);
  });
});

describe("catalog hardening", () => {
  it("pins search_path and hides every security definer function from PUBLIC and anon", async () => {
    const functions = await rows<{
      name: string;
      config: string[] | null;
      public_execute: boolean;
      anon_execute: boolean;
    }>(
      `select p.proname as name,
              p.proconfig as config,
              exists (
                select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
                where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
              ) as public_execute,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef
       order by p.proname`,
    );

    expect(functions.map((fn) => fn.name)).toEqual([
      "has_project_role",
      "is_admin",
      "is_project_member",
    ]);
    for (const fn of functions) {
      expect(fn.config?.some((entry) => entry.startsWith("search_path=")), fn.name).toBe(true);
      expect(fn.public_execute, fn.name).toBe(false);
      expect(fn.anon_execute, fn.name).toBe(false);
    }
  });

  it("enables RLS on every table and allows no unsafe views", async () => {
    const unprotected = await rows(
      `select c.relname, c.relkind from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and (
           (c.relkind in ('r', 'p') and not c.relrowsecurity)
           or c.relkind = 'm'
           or (c.relkind = 'v' and not coalesce(c.reloptions::text[] @> array['security_invoker=true'], false))
         )`,
    );
    expect(unprotected).toEqual([]);
  });

  it("has no always-true policies and none for PUBLIC or anon", async () => {
    const unsafe = await rows(
      `select tablename, policyname from pg_policies
       where schemaname = 'public'
         and (
           qual = 'true' or with_check = 'true'
           or roles::text[] && array['public', 'anon']
         )`,
    );
    expect(unsafe).toEqual([]);

    const withoutReadPolicy = await rows(
      `select t.table_name from information_schema.tables t
       where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
         and not exists (
           select 1 from pg_policies p
           where p.schemaname = 'public' and p.tablename = t.table_name and p.cmd = 'SELECT'
         )`,
    );
    expect(withoutReadPolicy).toEqual([]);
  });

  it("grants anon nothing and authenticated only SELECT at table level", async () => {
    const grants = await rows<{ grantee: string; privilege_type: string }>(
      `select distinct grantee, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and grantee in ('anon', 'authenticated')
       order by grantee, privilege_type`,
    );
    expect(grants).toEqual([{ grantee: "authenticated", privilege_type: "SELECT" }]);

    const columnGrants = await rows<{ table_name: string; privilege_type: string }>(
      `select distinct table_name, privilege_type from information_schema.column_privileges
       where table_schema = 'public' and grantee = 'authenticated' and privilege_type <> 'SELECT'
       order by table_name, privilege_type`,
    );
    expect(columnGrants).toEqual([
      { table_name: "alerts", privilege_type: "UPDATE" },
      { table_name: "reports", privilege_type: "INSERT" },
    ]);
  });
});
