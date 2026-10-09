import {
  HOUR_MS,
  addWorkingDays,
  startOfUtcDay,
  toIsoDate,
  type Commit,
  type DetectorResult,
  type Evidence,
  type Issue,
  type IssueEvent,
  type Severity,
} from "@/shared/domain";

import { fullWorkingDaysBetween, round } from "./dates";
import {
  commitEvidence,
  issueChangeEvidence,
  issueEvidence,
  pullRequestEvidence,
} from "./evidence";
import {
  DEFAULT_FORECAST_OPTIONS,
  insufficientDataDriver,
  type ForecastOptions,
  type ProjectSnapshot,
} from "./snapshot";

/**
 * Flow signals (decision D-041). Each describes a problem that exists today,
 * so `eta` is today's date. Confidence is 0.9: they are direct observations,
 * not projections; only data gaps (missing links, renamed statuses) can make
 * them wrong.
 */

const FLOW_CONFIDENCE = 0.9;

function today(snapshot: ProjectSnapshot): string {
  return toIsoDate(startOfUtcDay(snapshot.now));
}

// ---------------------------------------------------------------------------
// WIP over limit
// ---------------------------------------------------------------------------

/** count >= 2x limit critical, >= 1.5x high, otherwise medium. */
export function wipSeverity(count: number, limit: number): Severity {
  if (count >= 2 * limit) return "critical";
  if (count >= 1.5 * limit) return "high";
  if (count > limit) return "medium";
  return "low";
}

export function inProgressIssues(snapshot: ProjectSnapshot): Issue[] {
  const sprint = snapshot.activeSprint;
  if (!sprint) return [];
  return snapshot.issues.filter(
    (issue) => issue.sprintId === sprint.id && issue.statusCategory === "in_progress",
  );
}

export function detectWipOverLimit(snapshot: ProjectSnapshot): DetectorResult {
  const sprint = snapshot.activeSprint;
  if (!sprint || sprint.state !== "active") {
    return {
      kind: "wip_over_limit",
      triggered: false,
      severity: "low",
      confidence: 0.1,
      eta: null,
      drivers: [insufficientDataDriver("No active sprint.")],
      evidence: [],
    };
  }
  const limit = snapshot.project.wipLimit;
  const wip = inProgressIssues(snapshot);
  const triggered = wip.length > limit;
  return {
    kind: "wip_over_limit",
    triggered,
    severity: wipSeverity(wip.length, limit),
    confidence: FLOW_CONFIDENCE,
    eta: today(snapshot),
    drivers: [
      { key: "wip", label: "Issues in progress in the active sprint", value: wip.length, unit: "issues" },
      { key: "wip_limit", label: "WIP limit", value: limit, unit: "issues" },
      { key: "wip_over", label: "Issues over the limit", value: Math.max(0, wip.length - limit), unit: "issues" },
    ],
    evidence: wip.map((issue) =>
      issueEvidence(issue, `${issue.status}${issue.assignee ? `, ${issue.assignee}` : ""}`),
    ),
  };
}

export function wipTitle(count: number, limit: number): string {
  return `WIP over limit: ${count} issues in progress (limit ${limit})`;
}

// ---------------------------------------------------------------------------
// PRs waiting for a first review
// ---------------------------------------------------------------------------

/** Three or more stale PRs, or one waiting >= 2x the threshold: high; else medium. */
export function staleReviewSeverity(count: number, maxHours: number, thresholdHours: number): Severity {
  if (count >= 3 || maxHours >= 2 * thresholdHours) return "high";
  if (count > 0) return "medium";
  return "low";
}

export interface StaleReview {
  number: number;
  hours: number;
}

export function detectStaleReviews(
  snapshot: ProjectSnapshot,
  options: ForecastOptions = DEFAULT_FORECAST_OPTIONS,
): DetectorResult & { stale: StaleReview[] } {
  const nowMs = snapshot.now.getTime();
  const waiting = snapshot.pullRequests
    .filter((pr) => pr.state === "open" && pr.firstReviewAt === null)
    .map((pr) => ({ pr, hours: (nowMs - Date.parse(pr.createdAt)) / HOUR_MS }))
    .filter((item) => item.hours > options.staleReviewHours)
    .sort((a, b) => b.hours - a.hours || a.pr.number - b.pr.number);
  const issuesByKey = new Map(snapshot.issues.map((issue) => [issue.key, issue]));
  const evidence: Evidence[] = [];
  for (const { pr, hours } of waiting) {
    evidence.push(pullRequestEvidence(pr, `Open ${Math.floor(hours)} h without a review`));
    for (const key of pr.linkedIssueKeys) {
      const issue = issuesByKey.get(key);
      if (issue) evidence.push(issueEvidence(issue, issue.status));
    }
  }
  const maxHours = waiting[0]?.hours ?? 0;
  return {
    kind: "stale_review",
    triggered: waiting.length > 0,
    severity: staleReviewSeverity(waiting.length, maxHours, options.staleReviewHours),
    confidence: FLOW_CONFIDENCE,
    eta: today(snapshot),
    drivers: [
      { key: "stale_prs", label: `PRs waiting more than ${options.staleReviewHours} h for a first review`, value: waiting.length, unit: "PRs" },
      { key: "longest_wait_hours", label: "Longest wait for a first review", value: Math.floor(maxHours), unit: "hours" },
      { key: "review_threshold_hours", label: "Review wait threshold", value: options.staleReviewHours, unit: "hours" },
    ],
    evidence,
    stale: waiting.map(({ pr, hours }) => ({ number: pr.number, hours: Math.floor(hours) })),
  };
}

export function staleReviewTitle(stale: readonly StaleReview[], thresholdHours: number): string {
  if (stale.length === 1) {
    return `PR #${stale[0].number} has waited ${stale[0].hours} h for a first review`;
  }
  return `${stale.length} PRs have waited more than ${thresholdHours} h for a first review`;
}

// ---------------------------------------------------------------------------
// Stalled issues: in progress, no linked commit for N full working days
// ---------------------------------------------------------------------------

export interface StalledIssue {
  key: string;
  idleWorkingDays: number;
  /** The last linked commit, or `null` when the issue never had one. */
  lastCommit: Commit | null;
  /** When idleness is measured from (last commit, or work start). */
  since: string;
}

/** Idle >= 2x the threshold: high; else medium. */
export function stalledSeverity(maxIdle: number, threshold: number): Severity {
  if (maxIdle >= 2 * threshold) return "high";
  if (maxIdle >= threshold) return "medium";
  return "low";
}

function workStartedAt(issue: Issue, events: readonly IssueEvent[]): string {
  const firstStatusChange = events.find(
    (event) => event.issueKey === issue.key && event.field === "status",
  );
  return firstStatusChange?.at ?? issue.createdAt;
}

export function findStalledIssues(
  snapshot: ProjectSnapshot,
  options: ForecastOptions = DEFAULT_FORECAST_OPTIONS,
): StalledIssue[] {
  const lastCommitByKey = new Map<string, Commit>();
  for (const commit of snapshot.commits) {
    for (const key of commit.linkedIssueKeys) {
      const current = lastCommitByKey.get(key);
      if (!current || Date.parse(commit.committedAt) > Date.parse(current.committedAt)) {
        lastCommitByKey.set(key, commit);
      }
    }
  }
  const events = [...snapshot.issueEvents].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return snapshot.issues
    .filter((issue) => issue.statusCategory === "in_progress" && issue.requiresCode)
    .map((issue) => {
      const lastCommit = lastCommitByKey.get(issue.key) ?? null;
      const since = lastCommit?.committedAt ?? workStartedAt(issue, events);
      return {
        key: issue.key,
        idleWorkingDays: fullWorkingDaysBetween(since, snapshot.now),
        lastCommit,
        since,
      };
    })
    .filter((item) => item.idleWorkingDays >= options.stalledWorkingDays)
    .sort((a, b) => b.idleWorkingDays - a.idleWorkingDays || a.key.localeCompare(b.key));
}

export function detectStalledIssues(
  snapshot: ProjectSnapshot,
  options: ForecastOptions = DEFAULT_FORECAST_OPTIONS,
): DetectorResult & { stalled: StalledIssue[] } {
  const stalled = findStalledIssues(snapshot, options);
  const issuesByKey = new Map(snapshot.issues.map((issue) => [issue.key, issue]));
  const evidence: Evidence[] = [];
  for (const item of stalled) {
    const issue = issuesByKey.get(item.key);
    if (!issue) continue;
    evidence.push(issueEvidence(issue, `${issue.status}, no commits for ${item.idleWorkingDays} working days`));
    if (item.lastCommit) evidence.push(commitEvidence(item.lastCommit, `Last commit on ${item.key}`));
  }
  const maxIdle = stalled[0]?.idleWorkingDays ?? 0;
  return {
    kind: "stalled_issue",
    triggered: stalled.length > 0,
    severity: stalledSeverity(maxIdle, options.stalledWorkingDays),
    confidence: FLOW_CONFIDENCE,
    eta: today(snapshot),
    drivers: [
      { key: "stalled_issues", label: "In-progress issues without recent commits", value: stalled.length, unit: "issues" },
      { key: "max_idle_working_days", label: "Longest time without a linked commit", value: maxIdle, unit: "working days" },
      { key: "stalled_threshold_working_days", label: "Stalled threshold", value: options.stalledWorkingDays, unit: "working days" },
    ],
    evidence,
    stalled,
  };
}

export function stalledTitle(stalled: readonly StalledIssue[], threshold: number): string {
  if (stalled.length === 1) {
    return `${stalled[0].key} stalled: no commits in ${stalled[0].idleWorkingDays} working days`;
  }
  return `${stalled.length} issues in progress without commits for ${threshold}+ working days`;
}

// ---------------------------------------------------------------------------
// Reopen rate
// ---------------------------------------------------------------------------

/** Rate >= 2x the threshold: high; else medium. */
export function reopenSeverity(rate: number, threshold: number): Severity {
  if (rate >= 2 * threshold) return "high";
  if (rate > threshold) return "medium";
  return "low";
}

export function detectReopenRate(
  snapshot: ProjectSnapshot,
  options: ForecastOptions = DEFAULT_FORECAST_OPTIONS,
): DetectorResult & { rate: number | null } {
  const todayDate = startOfUtcDay(snapshot.now);
  const windowStartMs = addWorkingDays(todayDate, -options.reopenWindowWorkingDays).getTime();
  const nowMs = snapshot.now.getTime();
  const inWindow = snapshot.issueEvents.filter((event) => {
    const at = Date.parse(event.at);
    return event.field === "resolution" && at >= windowStartMs && at <= nowMs;
  });
  const resolutions = inWindow.filter((event) => event.to !== null);
  const reopens = inWindow.filter((event) => event.from !== null && event.to === null);
  const eta = toIsoDate(todayDate);

  if (resolutions.length < options.reopenMinResolutions) {
    return {
      kind: "reopen_rate",
      triggered: false,
      severity: "low",
      confidence: 0.1,
      eta,
      drivers: [
        insufficientDataDriver(
          `${resolutions.length} resolution(s) in the last ${options.reopenWindowWorkingDays} working days; at least ${options.reopenMinResolutions} are needed.`,
        ),
      ],
      evidence: [],
      rate: null,
    };
  }

  const rate = reopens.length / resolutions.length;
  const issuesByKey = new Map(snapshot.issues.map((issue) => [issue.key, issue]));
  const evidence = reopens.flatMap((event) => {
    const issue = issuesByKey.get(event.issueKey);
    return issue ? [issueChangeEvidence(issue, event, `Reopened (was ${event.from})`)] : [];
  });
  return {
    kind: "reopen_rate",
    // Evidence gaps are handled by the engine (D-042): a triggered signal
    // with nothing to cite must not read as "condition cleared".
    triggered: rate > options.reopenRateThreshold,
    severity: reopenSeverity(rate, options.reopenRateThreshold),
    confidence: FLOW_CONFIDENCE,
    eta,
    drivers: [
      { key: "reopen_rate", label: `Reopened vs. resolved in the last ${options.reopenWindowWorkingDays} working days`, value: Math.round(rate * 100), unit: "%" },
      { key: "reopens", label: "Issues reopened", value: reopens.length, unit: "issues" },
      { key: "resolutions", label: "Issues resolved", value: resolutions.length, unit: "issues" },
      { key: "reopen_threshold", label: "Reopen rate threshold", value: round(options.reopenRateThreshold * 100), unit: "%" },
    ],
    evidence,
    rate,
  };
}

export function reopenTitle(rate: number, windowDays: number): string {
  return `Reopen rate at ${Math.round(rate * 100)}% over the last ${windowDays} working days`;
}
