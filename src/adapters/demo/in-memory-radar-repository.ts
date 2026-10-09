import type { z } from "zod";

import { stableUuid } from "@/adapters/shared/stable-ids";
import {
  AlertSchema,
  CapacityEntrySchema,
  CommitSchema,
  DocRefSchema,
  EMBEDDING_DIMENSIONS,
  ForecastSchema,
  IssueCommentSchema,
  IssueEventSchema,
  IssueSchema,
  LlmCallSchema,
  MemoryItemSchema,
  ProjectSchema,
  PullRequestSchema,
  ReportSchema,
  SYNC_SOURCES,
  SprintSchema,
  SyncRunSchema,
  WorklogSchema,
  isActiveAlert,
  type Alert,
  type Forecast,
  type LlmCall,
  type MemoryItem,
  type Report,
  type SyncRun,
} from "@/shared/domain";
import {
  AlertConflictError,
  MAX_MEMORY_SEARCH_RESULTS,
  RepositoryConstraintError,
  type RadarRepository,
} from "@/shared/ports";

/**
 * In-memory implementation of `RadarRepository` used in demo mode and tests.
 *
 * - Postgres parity: every write is validated with the domain schemas, and
 *   the same constraints the migrations declare are enforced (natural keys
 *   unique within a batch, parents must exist, sprint ids are never
 *   overwritten, one active alert per kind, unique Jira keys).
 * - Values are deep-copied on write and on read: callers can never alias or
 *   mutate stored state.
 * - State lives in closures, not on the instance, so serializing the
 *   repository (e.g. a container dump) never leaks data.
 * - Ids the repository assigns are random by default. With
 *   `ids: "deterministic"` they are derived from the row's stable inputs, so
 *   every demo instance booted on the same day agrees on alert ids (deep
 *   links keep working across serverless instances).
 */

export interface InMemoryRadarRepositoryOptions {
  /** How repository-assigned ids are generated. Defaults to `random`. */
  ids?: "random" | "deterministic";
  /** Explicit id generator (tests); overrides `ids`. */
  newId?: () => string;
  /** Source of "now" for status changes. Defaults to the system time. */
  now?: () => Date;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function byString<T>(select: (item: T) => string) {
  return (a: T, b: T) => {
    const left = select(a);
    const right = select(b);
    return left < right ? -1 : left > right ? 1 : 0;
  };
}

function thenBy<T>(...comparators: Array<(a: T, b: T) => number>) {
  return (a: T, b: T) => {
    for (const compare of comparators) {
      const result = compare(a, b);
      if (result !== 0) return result;
    }
    return 0;
  };
}

function issueNumber(key: string): number {
  return Number(key.slice(key.lastIndexOf("-") + 1));
}

function violation(constraint: string, message: string): RepositoryConstraintError {
  return new RepositoryConstraintError(constraint, message);
}

interface CollectionConfig<T> {
  table: string;
  schema: z.ZodType<T>;
  /** Natural key; also the storage key. */
  keyOf: (item: T) => string;
  compare: (a: T, b: T) => number;
  /** Foreign-key and uniqueness checks against stored rows and the batch. */
  check?: (item: T, batch: readonly T[]) => void;
}

/** Keyed, validated, copy-on-read/write collection. */
class Collection<T> {
  readonly #items = new Map<string, T>();

  constructor(private readonly config: CollectionConfig<T>) {}

  /**
   * Validates the whole batch first (schema, duplicate natural keys,
   * constraints), so a bad record leaves the store untouched.
   */
  upsertMany(items: readonly T[]): void {
    const { table, schema, keyOf, check } = this.config;
    const parsed = items.map((item) => schema.parse(clone(item)));
    const seen = new Set<string>();
    for (const item of parsed) {
      const key = keyOf(item);
      if (seen.has(key)) {
        throw violation(
          `${table}_natural_key`,
          `${table}: the batch contains the natural key "${key}" more than once.`,
        );
      }
      seen.add(key);
      check?.(item, parsed);
    }
    for (const item of parsed) this.#items.set(keyOf(item), item);
  }

  get(key: string): T | null {
    const item = this.#items.get(key);
    return item === undefined ? null : clone(item);
  }

  has(key: string): boolean {
    return this.#items.has(key);
  }

  /** Stored values without copying; internal checks only. */
  values(): IterableIterator<T> {
    return this.#items.values();
  }

  where(predicate: (item: T) => boolean): T[] {
    return [...this.#items.values()]
      .filter(predicate)
      .sort(this.config.compare)
      .map(clone);
  }
}

function norm(vector: readonly number[]): number {
  let sum = 0;
  for (const value of vector) sum += value * value;
  return Math.sqrt(sum);
}

function cosineSimilarity(
  a: readonly number[],
  b: readonly number[],
  normA: number,
  normB: number,
): number {
  let dot = 0;
  for (let index = 0; index < a.length; index += 1) dot += a[index] * b[index];
  return dot / (normA * normB);
}

function assertEmbedding(embedding: readonly number[]): void {
  if (
    embedding.length !== EMBEDDING_DIMENSIONS ||
    !embedding.every((value) => Number.isFinite(value))
  ) {
    throw new Error(
      `Embeddings must have ${EMBEDDING_DIMENSIONS} finite dimensions (got ${embedding.length}).`,
    );
  }
}

export class InMemoryRadarRepository implements RadarRepository {
  readonly projects: RadarRepository["projects"];
  readonly sprints: RadarRepository["sprints"];
  readonly issues: RadarRepository["issues"];
  readonly issueEvents: RadarRepository["issueEvents"];
  readonly issueComments: RadarRepository["issueComments"];
  readonly worklogs: RadarRepository["worklogs"];
  readonly pullRequests: RadarRepository["pullRequests"];
  readonly commits: RadarRepository["commits"];
  readonly capacity: RadarRepository["capacity"];
  readonly docs: RadarRepository["docs"];
  readonly forecasts: RadarRepository["forecasts"];
  readonly alerts: RadarRepository["alerts"];
  readonly memory: RadarRepository["memory"];
  readonly reports: RadarRepository["reports"];
  readonly syncRuns: RadarRepository["syncRuns"];
  readonly llmCalls: RadarRepository["llmCalls"];

  constructor(options: InMemoryRadarRepositoryOptions = {}) {
    const now = options.now ?? (() => new Date());
    const deterministic = options.ids === "deterministic";
    /** Assigns an id; deterministic ids hash the row's stable inputs. */
    const assignId = (...parts: string[]): string =>
      options.newId?.() ??
      (deterministic ? stableUuid("demo-repo", ...parts) : globalThis.crypto.randomUUID());
    let sequence = 0;
    const nextSequence = () => (sequence += 1);

    // --- Parents and references ------------------------------------------

    const projects = new Collection({
      table: "projects",
      schema: ProjectSchema,
      keyOf: (project) => project.id,
      compare: thenBy(
        byString((project) => project.name),
        byString((project) => project.id),
      ),
      check: (project) => {
        for (const other of projects.values()) {
          if (other.id !== project.id && other.jiraKey === project.jiraKey) {
            throw violation(
              "projects_jira_key_key",
              `projects: Jira key ${project.jiraKey} already belongs to project ${other.id}.`,
            );
          }
        }
      },
    });

    const requireProject = (table: string, projectId: string) => {
      if (!projects.has(projectId)) {
        throw violation(
          `${table}_project_id_fkey`,
          `${table}: project ${projectId} does not exist.`,
        );
      }
    };

    const sprints = new Collection({
      table: "sprints",
      schema: SprintSchema,
      keyOf: (sprint) => `${sprint.projectId}:${sprint.externalId}`,
      compare: thenBy(
        (a, b) => Date.parse(a.startAt) - Date.parse(b.startAt),
        byString((sprint) => sprint.id),
      ),
      check: (sprint, batch) => {
        requireProject("sprints", sprint.projectId);
        if (batch.filter((other) => other.id === sprint.id).length > 1) {
          throw violation(
            "sprints_pkey",
            `sprints: the batch uses id ${sprint.id} for more than one sprint.`,
          );
        }
        const existing = sprints.get(`${sprint.projectId}:${sprint.externalId}`);
        if (existing && existing.id !== sprint.id) {
          throw violation(
            "sprints_project_external_key",
            `sprints: sprint ${sprint.externalId} already exists with id ${existing.id}; ids are never overwritten.`,
          );
        }
        for (const other of sprints.values()) {
          if (other.id === sprint.id && other.externalId !== sprint.externalId) {
            throw violation(
              "sprints_pkey",
              `sprints: id ${sprint.id} already belongs to sprint ${other.externalId}.`,
            );
          }
        }
      },
    });

    const sprintById = (id: string) => {
      for (const sprint of sprints.values()) if (sprint.id === id) return sprint;
      return undefined;
    };

    const issues = new Collection({
      table: "issues",
      schema: IssueSchema,
      keyOf: (issue) => `${issue.projectId}:${issue.key}`,
      compare: thenBy(
        byString((issue) => issue.projectId),
        (a, b) => issueNumber(a.key) - issueNumber(b.key),
        byString((issue) => issue.key),
      ),
      check: (issue) => {
        requireProject("issues", issue.projectId);
        if (issue.sprintId !== null) {
          const sprint = sprintById(issue.sprintId);
          if (!sprint || sprint.projectId !== issue.projectId) {
            throw violation(
              "issues_project_sprint_fkey",
              `issues: ${issue.key} references sprint ${issue.sprintId}, which does not exist in its project.`,
            );
          }
        }
      },
    });

    const requireIssue = (table: string, projectId: string, issueKey: string) => {
      requireProject(table, projectId);
      if (!issues.has(`${projectId}:${issueKey}`)) {
        throw violation(
          `${table}_project_issue_fkey`,
          `${table}: issue ${issueKey} does not exist in its project.`,
        );
      }
    };

    // --- Synced children ---------------------------------------------------

    const issueEvents = new Collection({
      table: "issue_events",
      schema: IssueEventSchema,
      keyOf: (event) => `${event.projectId}:${event.externalId}`,
      compare: thenBy(
        (a, b) => Date.parse(a.at) - Date.parse(b.at),
        byString((event) => event.externalId),
      ),
      check: (event) => requireIssue("issue_events", event.projectId, event.issueKey),
    });
    const issueComments = new Collection({
      table: "issue_comments",
      schema: IssueCommentSchema,
      keyOf: (comment) => `${comment.projectId}:${comment.id}`,
      compare: thenBy(
        (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
        byString((comment) => comment.id),
      ),
      check: (comment) =>
        requireIssue("issue_comments", comment.projectId, comment.issueKey),
    });
    const worklogs = new Collection({
      table: "worklogs",
      schema: WorklogSchema,
      keyOf: (worklog) => `${worklog.projectId}:${worklog.id}`,
      compare: thenBy(
        (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt),
        byString((worklog) => worklog.id),
      ),
      check: (worklog) => requireIssue("worklogs", worklog.projectId, worklog.issueKey),
    });
    const pullRequests = new Collection({
      table: "pull_requests",
      schema: PullRequestSchema,
      keyOf: (pr) => `${pr.projectId}:${pr.number}`,
      compare: (a, b) => a.number - b.number,
      check: (pr) => requireProject("pull_requests", pr.projectId),
    });
    const commits = new Collection({
      table: "commits",
      schema: CommitSchema,
      keyOf: (commit) => `${commit.projectId}:${commit.sha}`,
      compare: thenBy(
        (a, b) => Date.parse(a.committedAt) - Date.parse(b.committedAt),
        byString((commit) => commit.sha),
      ),
      check: (commit) => requireProject("commits", commit.projectId),
    });
    const capacity = new Collection({
      table: "capacity",
      schema: CapacityEntrySchema,
      keyOf: (entry) => `${entry.projectId}:${entry.person}:${entry.date}`,
      compare: thenBy(
        byString((entry) => entry.date),
        byString((entry) => entry.person),
      ),
      check: (entry) => requireProject("capacity", entry.projectId),
    });
    const docs = new Collection({
      table: "docs",
      schema: DocRefSchema,
      keyOf: (doc) => `${doc.projectId}:${doc.slug}`,
      compare: byString((doc) => doc.slug),
      check: (doc) => requireProject("docs", doc.projectId),
    });

    // --- Append-only and stateful rows -------------------------------------

    const forecastRows: Array<{ seq: number; forecast: Forecast }> = [];
    const alertRows = new Map<string, Alert>();
    const memoryRows = new Map<
      string,
      { item: MemoryItem; embedding: number[] | null }
    >();
    const reportRows = new Map<string, Report>();
    const syncRunRows = new Map<string, { seq: number; run: SyncRun }>();
    const llmCallRows: LlmCall[] = [];

    this.projects = {
      list: async () => projects.where(() => true),
      get: async (id) => projects.get(id),
      upsert: async (project) => {
        projects.upsertMany([project]);
        const stored = projects.get(project.id);
        if (!stored) throw new Error(`Project ${project.id} was not stored.`);
        return stored;
      },
    };

    this.sprints = {
      byProject: async (projectId) =>
        sprints.where((sprint) => sprint.projectId === projectId),
      active: async (projectId, at) => {
        const time = at.getTime();
        const all = sprints.where((sprint) => sprint.projectId === projectId);
        const contains = (sprint: (typeof all)[number]) =>
          Date.parse(sprint.startAt) <= time && time <= Date.parse(sprint.endAt);
        return (
          all.find((sprint) => sprint.state === "active" && contains(sprint)) ??
          all.find((sprint) => sprint.state === "active") ??
          all.find(contains) ??
          null
        );
      },
      upsertMany: async (items) => sprints.upsertMany(items),
    };

    this.issues = {
      byProject: async (projectId) =>
        issues.where((issue) => issue.projectId === projectId),
      bySprint: async (sprintId) =>
        issues.where((issue) => issue.sprintId === sprintId),
      upsertMany: async (items) => issues.upsertMany(items),
    };

    this.issueEvents = {
      byProject: async (projectId) =>
        issueEvents.where((event) => event.projectId === projectId),
      upsertMany: async (items) => issueEvents.upsertMany(items),
    };

    this.issueComments = {
      byProject: async (projectId) =>
        issueComments.where((comment) => comment.projectId === projectId),
      upsertMany: async (items) => issueComments.upsertMany(items),
    };

    this.worklogs = {
      byProject: async (projectId) =>
        worklogs.where((worklog) => worklog.projectId === projectId),
      upsertMany: async (items) => worklogs.upsertMany(items),
    };

    this.pullRequests = {
      byProject: async (projectId) =>
        pullRequests.where((pr) => pr.projectId === projectId),
      upsertMany: async (items) => pullRequests.upsertMany(items),
    };

    this.commits = {
      byProject: async (projectId) =>
        commits.where((commit) => commit.projectId === projectId),
      upsertMany: async (items) => commits.upsertMany(items),
    };

    this.capacity = {
      byProject: async (projectId, range) =>
        capacity.where(
          (entry) =>
            entry.projectId === projectId &&
            (!range || (entry.date >= range.start && entry.date <= range.end)),
        ),
      upsertMany: async (items) => capacity.upsertMany(items),
    };

    this.docs = {
      byProject: async (projectId) =>
        docs.where((doc) => doc.projectId === projectId),
      upsertMany: async (items) => docs.upsertMany(items),
    };

    this.forecasts = {
      latest: async (projectId, kind) => {
        let latest: { seq: number; forecast: Forecast } | undefined;
        for (const row of forecastRows) {
          if (row.forecast.projectId !== projectId) continue;
          if (row.forecast.kind !== kind) continue;
          const time = Date.parse(row.forecast.computedAt);
          if (
            !latest ||
            time > Date.parse(latest.forecast.computedAt) ||
            (time === Date.parse(latest.forecast.computedAt) && row.seq > latest.seq)
          ) {
            latest = row;
          }
        }
        return latest ? clone(latest.forecast) : null;
      },
      insert: async (input) => {
        requireProject("forecasts", input.projectId);
        const nth = forecastRows.filter(
          (row) =>
            row.forecast.projectId === input.projectId &&
            row.forecast.kind === input.kind &&
            row.forecast.computedAt === input.computedAt,
        ).length;
        const forecast = ForecastSchema.parse(
          clone({
            ...input,
            id: assignId("forecast", input.projectId, input.kind, input.computedAt, String(nth)),
          }),
        );
        forecastRows.push({ seq: nextSequence(), forecast });
        return clone(forecast);
      },
    };

    const findActiveAlert = (projectId: string, kind: Alert["kind"]) =>
      [...alertRows.values()].find(
        (alert) =>
          alert.projectId === projectId && alert.kind === kind && isActiveAlert(alert),
      );

    this.alerts = {
      byProject: async (projectId, status) =>
        [...alertRows.values()]
          .filter(
            (alert) =>
              alert.projectId === projectId &&
              (status === undefined || alert.status === status),
          )
          .sort(
            thenBy(
              (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
              byString((alert) => alert.id),
            ),
          )
          .map(clone),
      upsertForKind: async (projectId, kind, draft) => {
        requireProject("alerts", projectId);
        const { detectedAt, ...fields } = draft;
        const existing = findActiveAlert(projectId, kind);
        const nth = [...alertRows.values()].filter(
          (alert) => alert.projectId === projectId && alert.kind === kind,
        ).length;
        const alert = AlertSchema.parse(
          clone({
            ...fields,
            id:
              existing?.id ??
              // Stable per (project, kind, first detection day, occurrence).
              assignId("alert", projectId, kind, detectedAt.slice(0, 10), String(nth)),
            projectId,
            kind,
            status: existing?.status ?? "open",
            createdAt: existing?.createdAt ?? detectedAt,
            updatedAt: detectedAt,
            lastDetectedAt: detectedAt,
          }),
        );
        alertRows.set(alert.id, alert);
        return clone(alert);
      },
      setStatus: async (id, status) => {
        const alert = alertRows.get(id);
        if (!alert) return null;
        const updated = AlertSchema.parse({
          ...clone(alert),
          status,
          updatedAt: now().toISOString(),
        });
        if (isActiveAlert(updated)) {
          const active = findActiveAlert(updated.projectId, updated.kind);
          if (active && active.id !== id) {
            throw new AlertConflictError(updated.projectId, updated.kind, active.id);
          }
        }
        alertRows.set(id, updated);
        return clone(updated);
      },
    };

    this.memory = {
      byProject: async (projectId, filter = {}) =>
        [...memoryRows.values()]
          .map((row) => row.item)
          .filter(
            (item) =>
              item.projectId === projectId &&
              (filter.kind === undefined || item.kind === filter.kind) &&
              (filter.status === undefined || item.status === filter.status),
          )
          .sort(
            thenBy(
              (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt),
              byString((item) => item.id),
            ),
          )
          .map(clone),
      upsertMany: async (items) => {
        const seen = new Set<string>();
        const parsed = items.map(({ embedding, ...item }) => {
          if (embedding) assertEmbedding(embedding);
          const parsedItem = MemoryItemSchema.parse(clone(item));
          if (seen.has(parsedItem.id)) {
            throw violation(
              "memory_items_natural_key",
              `memory_items: the batch contains id ${parsedItem.id} more than once.`,
            );
          }
          seen.add(parsedItem.id);
          requireProject("memory_items", parsedItem.projectId);
          return { item: parsedItem, embedding: embedding ? [...embedding] : undefined };
        });
        for (const { item, embedding } of parsed) {
          const previous = memoryRows.get(item.id);
          // A new summary invalidates the old vector unless a new one is given.
          const keptEmbedding =
            previous && previous.item.summary === item.summary ? previous.embedding : null;
          memoryRows.set(item.id, { item, embedding: embedding ?? keptEmbedding });
        }
      },
      search: async (projectId, queryEmbedding, k) => {
        assertEmbedding(queryEmbedding);
        const limit = Math.min(Math.floor(k), MAX_MEMORY_SEARCH_RESULTS);
        const queryNorm = norm(queryEmbedding);
        if (limit <= 0 || queryNorm === 0) return [];
        return [...memoryRows.values()]
          .flatMap((row) => {
            if (row.item.projectId !== projectId || row.embedding === null) return [];
            const rowNorm = norm(row.embedding);
            if (rowNorm === 0) return [];
            return [
              {
                item: row.item,
                similarity: cosineSimilarity(row.embedding, queryEmbedding, rowNorm, queryNorm),
              },
            ];
          })
          .sort(
            thenBy(
              (a, b) => b.similarity - a.similarity,
              byString((hit) => hit.item.id),
            ),
          )
          .slice(0, limit)
          .map(clone);
      },
    };

    this.reports = {
      byProject: async (projectId) =>
        [...reportRows.values()]
          .filter((report) => report.projectId === projectId)
          .sort(
            thenBy(
              (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
              byString((report) => report.id),
            ),
          )
          .map(clone),
      get: async (id) => {
        const report = reportRows.get(id);
        return report ? clone(report) : null;
      },
      insert: async (input) => {
        requireProject("reports", input.projectId);
        const nth = [...reportRows.values()].filter(
          (report) => report.projectId === input.projectId && report.createdAt === input.createdAt,
        ).length;
        const report = ReportSchema.parse(
          clone({
            ...input,
            id: assignId(
              "report",
              input.projectId,
              input.kind,
              input.periodStart,
              input.periodEnd,
              input.createdAt,
              String(nth),
            ),
          }),
        );
        reportRows.set(report.id, report);
        return clone(report);
      },
    };

    this.syncRuns = {
      start: async ({ projectId, source, startedAt }) => {
        requireProject("sync_runs", projectId);
        const nth = [...syncRunRows.values()].filter(
          (row) =>
            row.run.projectId === projectId &&
            row.run.source === source &&
            row.run.startedAt === startedAt,
        ).length;
        const run = SyncRunSchema.parse({
          id: assignId("sync-run", projectId, source, startedAt, String(nth)),
          projectId,
          source,
          startedAt,
          finishedAt: null,
          status: "running",
          stats: {},
          error: null,
        });
        syncRunRows.set(run.id, { seq: nextSequence(), run });
        return clone(run);
      },
      finish: async (id, outcome) => {
        const row = syncRunRows.get(id);
        if (!row) throw new Error(`Unknown sync run ${id}.`);
        const run = SyncRunSchema.parse(clone({ ...row.run, ...outcome }));
        syncRunRows.set(id, { seq: row.seq, run });
        return clone(run);
      },
      latestBySource: async (projectId) => {
        const latest = new Map<string, { seq: number; run: SyncRun }>();
        for (const row of syncRunRows.values()) {
          if (row.run.projectId !== projectId) continue;
          const current = latest.get(row.run.source);
          const time = Date.parse(row.run.startedAt);
          if (
            !current ||
            time > Date.parse(current.run.startedAt) ||
            (time === Date.parse(current.run.startedAt) && row.seq > current.seq)
          ) {
            latest.set(row.run.source, row);
          }
        }
        return SYNC_SOURCES.flatMap((source) => {
          const row = latest.get(source);
          return row ? [clone(row.run)] : [];
        });
      },
    };

    this.llmCalls = {
      insert: async (input) => {
        const nth = llmCallRows.filter(
          (call) => call.purpose === input.purpose && call.createdAt === input.createdAt,
        ).length;
        const call = LlmCallSchema.parse(
          clone({
            ...input,
            id: assignId("llm-call", input.purpose, input.createdAt, String(nth)),
          }),
        );
        llmCallRows.push(call);
        return clone(call);
      },
      totals: async () => {
        const totals = llmCallRows.reduce(
          (sum, call) => ({
            calls: sum.calls + 1,
            inputTokens: sum.inputTokens + call.inputTokens,
            outputTokens: sum.outputTokens + call.outputTokens,
            cacheReadTokens: sum.cacheReadTokens + call.cacheReadTokens,
            costUsd: sum.costUsd + call.costUsd,
          }),
          { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 },
        );
        return { ...totals, costUsd: Math.round(totals.costUsd * 1e6) / 1e6 };
      },
    };
  }
}
