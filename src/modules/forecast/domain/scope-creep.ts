import type { DetectorResult, Evidence, Issue, Severity } from "@/shared/domain";

import { formatShortDate, round } from "./dates";
import { issueChangeEvidence, sprintEvidence } from "./evidence";
import {
  DEFAULT_FORECAST_OPTIONS,
  insufficientDataDriver,
  type ForecastOptions,
  type ProjectSnapshot,
} from "./snapshot";
import { unitLabel } from "./sprint-completion";
import type { SprintScope } from "./sprint-scope";

/**
 * Scope creep (decision D-040): work added to the active sprint after it
 * started (issues pulled in, estimates raised) net of work removed (issues
 * moved out, estimates lowered), relative to the scope committed at start.
 */

/** Severity by net growth: > 50% critical, > 30% high, else medium. */
export function scopeCreepSeverity(ratio: number): Severity {
  if (ratio > 0.5) return "critical";
  if (ratio > 0.3) return "high";
  if (ratio > 0.15) return "medium";
  return "low";
}

export interface ScopeCreepSummary {
  committed: number;
  added: number;
  removed: number;
  net: number;
  ratio: number | null;
}

export function summarizeScopeCreep(scope: SprintScope): ScopeCreepSummary {
  const added = scope.changes
    .filter((change) => change.delta > 0)
    .reduce((sum, change) => sum + change.delta, 0);
  const removed = scope.changes
    .filter((change) => change.delta < 0)
    .reduce((sum, change) => sum - change.delta, 0);
  const net = added - removed;
  return {
    committed: scope.committed,
    added,
    removed,
    net,
    ratio: scope.committed > 0 ? net / scope.committed : null,
  };
}

export function detectScopeCreep(
  snapshot: ProjectSnapshot,
  scope: SprintScope | null,
  options: ForecastOptions = DEFAULT_FORECAST_OPTIONS,
): DetectorResult {
  if (!scope) {
    return {
      kind: "scope_creep",
      triggered: false,
      severity: "low",
      confidence: 0.1,
      eta: null,
      drivers: [insufficientDataDriver("No active sprint.")],
      evidence: [],
    };
  }
  const summary = summarizeScopeCreep(scope);
  const eta = scope.days.at(-1) ?? null;
  if (summary.ratio === null) {
    return {
      kind: "scope_creep",
      triggered: false,
      severity: "low",
      confidence: 0.1,
      eta,
      drivers: [insufficientDataDriver("Nothing was committed at sprint start.")],
      evidence: [],
    };
  }

  const label = unitLabel(scope.unit);
  const triggered = summary.ratio > options.scopeCreepThreshold;
  const issuesByKey = new Map<string, Issue>(
    snapshot.issues.map((issue) => [issue.key, issue]),
  );
  const evidence: Evidence[] = [];
  const sprintRef = sprintEvidence(scope.sprint, snapshot.project, scope.members);
  if (sprintRef) evidence.push(sprintRef);
  for (const change of scope.changes) {
    const issue = issuesByKey.get(change.issueKey);
    if (!issue) continue;
    const day = formatShortDate(change.at.slice(0, 10));
    const text =
      change.kind === "reestimated"
        ? `Re-estimated ${change.from ?? 0} -> ${change.to ?? 0} ${label} on ${day}`
        : change.kind === "added"
          ? `Added to the sprint on ${day} (+${round(change.delta)} ${label})`
          : `Removed from the sprint on ${day} (${round(change.delta)} ${label})`;
    evidence.push(issueChangeEvidence(issue, change.event, text));
  }

  const count = (kind: string) => scope.changes.filter((change) => change.kind === kind).length;
  return {
    kind: "scope_creep",
    triggered,
    severity: scopeCreepSeverity(summary.ratio),
    // Direct observation from the changelog; less sure when counting issues.
    confidence: scope.unit === snapshot.project.forecastUnit ? 0.9 : 0.7,
    eta,
    drivers: [
      { key: "committed_scope", label: "Committed at sprint start", value: round(summary.committed), unit: label },
      { key: "scope_added", label: "Added after sprint start", value: round(summary.added), unit: label },
      { key: "scope_removed", label: "Removed after sprint start", value: round(summary.removed), unit: label },
      { key: "scope_growth", label: "Net scope growth vs. commitment", value: Math.round(summary.ratio * 100), unit: "%" },
      { key: "issues_added", label: "Issues pulled into the sprint", value: count("added"), unit: "issues" },
      { key: "reestimates", label: "Estimate changes after sprint start", value: count("reestimated"), unit: "issues" },
    ],
    evidence,
  };
}

export function scopeCreepTitle(scope: SprintScope): string {
  const summary = summarizeScopeCreep(scope);
  const label = unitLabel(scope.unit);
  const percent = Math.round((summary.ratio ?? 0) * 100);
  return `Scope grew ${percent}% since sprint start (+${round(summary.net)} ${label} on ${round(summary.committed)} committed)`;
}
