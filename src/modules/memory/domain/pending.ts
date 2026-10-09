import {
  DAY_MS,
  HOUR_MS,
  toIsoDate,
  withEvidence,
  type Evidence,
  type MemoryItem,
} from "@/shared/domain";

import {
  commentEvidence,
  commitEvidence,
  issueEvidence,
  pullRequestEvidence,
} from "./evidence";
import { memoryItemId } from "./ids";
import {
  fullWorkingDaysBetween,
  isMerged,
  issuesByKey,
  lastCommitForIssue,
  mergeCommitOf,
  mergedPullRequestForIssue,
  pullRequestsForIssue,
} from "./links";
import { DEFAULT_MEMORY_OPTIONS, type MemoryOptions, type MemorySnapshot } from "./snapshot";

/**
 * Pending detection — rule-based, deterministic, no LLM.
 *
 * Every rule is a separate pure function of the snapshot. A rule only emits an
 * item it can back with records it was handed; items without evidence are
 * dropped by `withEvidence` before they leave this module.
 *
 * Summaries are templates: `"<rule label> — <detail citing the real key>"`.
 * The rule label is the grouping key the UI reads back from a stored item
 * (`MemoryItem` has no rule column), so the separator must stay stable.
 */

export const RULE_SEPARATOR = " — ";

export const PENDING_RULES = {
  doneWithoutPr: {
    id: "done_without_pr",
    label: "Done without a merged PR",
    why: "The issue is closed and its type ships code, but no merged pull request references it.",
  },
  prWithoutClosedIssue: {
    id: "pr_without_closed_issue",
    label: "Merged PR without a closed issue",
    why: "Code reached the default branch but the tracker never recorded the work as done.",
  },
  prStuck: {
    id: "pr_stuck",
    label: "Pull request stuck",
    why: "The pull request is still open past the review or age threshold.",
  },
  stalledIssue: {
    id: "stalled_issue",
    label: "In progress without commits",
    why: "The issue is in progress but no linked commit has landed for days.",
  },
  unansweredQuestion: {
    id: "unanswered_question",
    label: "Unanswered question",
    why: "Someone asked a question in Jira and nobody else replied.",
  },
} as const;

export type PendingRuleId = (typeof PENDING_RULES)[keyof typeof PENDING_RULES]["id"];

/** Rule label -> rule, for regrouping stored items in the UI. */
export const PENDING_RULE_BY_LABEL = new Map(
  Object.values(PENDING_RULES).map((rule) => [rule.label as string, rule]),
);

function pendingItem(options: {
  projectId: string;
  rule: { id: string; label: string };
  recordKey: string;
  detail: string;
  occurredAt: string;
  evidence: readonly Evidence[];
}): MemoryItem {
  return {
    id: memoryItemId(options.projectId, "pending", options.rule.id, options.recordKey),
    projectId: options.projectId,
    kind: "pending",
    summary: `${options.rule.label}${RULE_SEPARATOR}${options.detail}`,
    evidence: [...options.evidence],
    occurredAt: options.occurredAt,
    status: "open",
  };
}

// ---------------------------------------------------------------------------
// Rule 1 — issue Done, requires code, no linked merged PR
// ---------------------------------------------------------------------------

export function detectDoneWithoutMergedPr(snapshot: MemorySnapshot): MemoryItem[] {
  const items = snapshot.issues
    .filter((issue) => issue.statusCategory === "done" && issue.requiresCode)
    .filter((issue) => mergedPullRequestForIssue(snapshot.pullRequests, issue.key) === null)
    .map((issue) => {
      const commit = lastCommitForIssue(snapshot.commits, issue.key);
      const openPr = pullRequestsForIssue(snapshot.pullRequests, issue.key).find(
        (pr) => pr.state === "open",
      );
      const evidence = [
        issueEvidence(issue, `${issue.status} since ${toIsoDate(new Date(issue.resolvedAt ?? issue.updatedAt))}`),
        ...(commit ? [commitEvidence(commit, `Commit linked to ${issue.key}`)] : []),
        ...(openPr ? [pullRequestEvidence(openPr, "Still open")] : []),
      ];
      const detail = commit
        ? `${issue.key} "${issue.title}" is ${issue.status} with a direct commit and no merged pull request.`
        : `${issue.key} "${issue.title}" is ${issue.status} with no pull request and no commit.`;
      return pendingItem({
        projectId: snapshot.project.id,
        rule: PENDING_RULES.doneWithoutPr,
        recordKey: issue.key,
        detail,
        occurredAt: issue.resolvedAt ?? issue.updatedAt,
        evidence,
      });
    });
  return withEvidence(items);
}

// ---------------------------------------------------------------------------
// Rule 2 — merged PR with no linked issue, or whose issue never reached done
// ---------------------------------------------------------------------------

export function detectMergedPrWithoutClosedIssue(snapshot: MemorySnapshot): MemoryItem[] {
  const byKey = issuesByKey(snapshot.issues);
  const items = snapshot.pullRequests.filter(isMerged).flatMap((pr) => {
    const mergedAt = pr.mergedAt as string;
    const mergeCommit = mergeCommitOf(snapshot.commits, pr);
    const prEvidence = pullRequestEvidence(pr, `Merged on ${toIsoDate(new Date(mergedAt))}`);
    const commitEvidenceList = mergeCommit
      ? [commitEvidence(mergeCommit, `Merge commit of PR #${pr.number}`)]
      : [];

    if (pr.linkedIssueKeys.length === 0) {
      return [
        pendingItem({
          projectId: snapshot.project.id,
          rule: PENDING_RULES.prWithoutClosedIssue,
          recordKey: `#${pr.number}`,
          detail: `PR #${pr.number} "${pr.title}" was merged without referencing any issue.`,
          occurredAt: mergedAt,
          evidence: [prEvidence, ...commitEvidenceList],
        }),
      ];
    }

    // Only issues we actually hold can be judged: an unknown key is a data
    // gap, not proof that the work was never closed.
    const unfinished = pr.linkedIssueKeys
      .map((key) => byKey.get(key))
      .filter((issue) => issue !== undefined)
      .filter((issue) => issue.statusCategory !== "done");
    if (unfinished.length === 0) return [];
    return [
      pendingItem({
        projectId: snapshot.project.id,
        rule: PENDING_RULES.prWithoutClosedIssue,
        recordKey: `#${pr.number}`,
        detail: `PR #${pr.number} "${pr.title}" is merged but ${unfinished
          .map((issue) => `${issue.key} is still ${issue.status}`)
          .join(", ")}.`,
        occurredAt: mergedAt,
        evidence: [
          prEvidence,
          ...unfinished.map((issue) => issueEvidence(issue, issue.status)),
          ...commitEvidenceList,
        ],
      }),
    ];
  });
  return withEvidence(items);
}

// ---------------------------------------------------------------------------
// Rule 3 — PR open too long, or waiting too long for a first review
// ---------------------------------------------------------------------------

export function detectStuckPullRequests(
  snapshot: MemorySnapshot,
  options: MemoryOptions = DEFAULT_MEMORY_OPTIONS,
): MemoryItem[] {
  const nowMs = snapshot.now.getTime();
  const byKey = issuesByKey(snapshot.issues);
  const items = snapshot.pullRequests
    .filter((pr) => pr.state === "open")
    .flatMap((pr) => {
      const openedMs = Date.parse(pr.createdAt);
      const openDays = Math.floor((nowMs - openedMs) / DAY_MS);
      const waitingHours =
        pr.firstReviewAt === null ? Math.floor((nowMs - openedMs) / HOUR_MS) : null;
      const tooOld = openDays > options.openPullRequestDays;
      const unreviewed = waitingHours !== null && waitingHours > options.staleReviewHours;
      if (!tooOld && !unreviewed) return [];

      const reason = unreviewed
        ? `has waited ${waitingHours} h for a first review (threshold ${options.staleReviewHours} h)`
        : `has been open ${openDays} days (threshold ${options.openPullRequestDays} days)`;
      const linked = pr.linkedIssueKeys
        .map((key) => byKey.get(key))
        .filter((issue) => issue !== undefined);
      return [
        pendingItem({
          projectId: snapshot.project.id,
          rule: PENDING_RULES.prStuck,
          recordKey: `#${pr.number}`,
          detail: `PR #${pr.number} "${pr.title}" ${reason}.`,
          occurredAt: pr.createdAt,
          evidence: [
            pullRequestEvidence(pr, reason),
            ...linked.map((issue) => issueEvidence(issue, issue.status)),
          ],
        }),
      ];
    });
  return withEvidence(items);
}

// ---------------------------------------------------------------------------
// Rule 4 — in-progress issue without a linked commit for N working days
// ---------------------------------------------------------------------------

export function detectStalledIssues(
  snapshot: MemorySnapshot,
  options: MemoryOptions = DEFAULT_MEMORY_OPTIONS,
): MemoryItem[] {
  const events = [...snapshot.issueEvents].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const items = snapshot.issues
    .filter((issue) => issue.statusCategory === "in_progress" && issue.requiresCode)
    .flatMap((issue) => {
      const lastCommit = lastCommitForIssue(snapshot.commits, issue.key);
      const workStartedAt =
        events.find((event) => event.issueKey === issue.key && event.field === "status")?.at ??
        issue.createdAt;
      const since = lastCommit?.committedAt ?? workStartedAt;
      const idleWorkingDays = fullWorkingDaysBetween(since, snapshot.now);
      if (idleWorkingDays < options.stalledWorkingDays) return [];
      const detail = lastCommit
        ? `${issue.key} "${issue.title}" is ${issue.status} with no linked commit for ${idleWorkingDays} working days.`
        : `${issue.key} "${issue.title}" is ${issue.status} and has never had a linked commit (${idleWorkingDays} working days).`;
      return [
        pendingItem({
          projectId: snapshot.project.id,
          rule: PENDING_RULES.stalledIssue,
          recordKey: issue.key,
          detail,
          occurredAt: since,
          evidence: [
            issueEvidence(issue, `${issue.status}, idle ${idleWorkingDays} working days`),
            ...(lastCommit ? [commitEvidence(lastCommit, `Last commit on ${issue.key}`)] : []),
          ],
        }),
      ];
    });
  return withEvidence(items);
}

// ---------------------------------------------------------------------------
// Rule 5 — unanswered question in Jira comments
// ---------------------------------------------------------------------------

/**
 * A question is a comment that contains a sentence ending in `?`.
 *
 * "The comment ends with `?`" was the first cut and it misses the common
 * real shape — a question followed by context ("...clears them? I need this
 * before finalizing the schema.") — so the rule looks for the question mark
 * anywhere instead. A false positive here costs a visible pending line with
 * its evidence; a false negative loses the question entirely.
 */
export function isQuestion(body: string): boolean {
  return /\?/.test(body);
}

export function detectUnansweredQuestions(
  snapshot: MemorySnapshot,
  options: MemoryOptions = DEFAULT_MEMORY_OPTIONS,
): MemoryItem[] {
  const nowMs = snapshot.now.getTime();
  const byKey = issuesByKey(snapshot.issues);
  const comments = [...snapshot.issueComments].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id),
  );
  const items = comments.flatMap((comment) => {
    if (!isQuestion(comment.body)) return [];
    const askedMs = Date.parse(comment.createdAt);
    const hours = Math.floor((nowMs - askedMs) / HOUR_MS);
    if (hours <= options.unansweredQuestionHours) return [];
    const answered = comments.some(
      (other) =>
        other.issueKey === comment.issueKey &&
        other.author !== comment.author &&
        Date.parse(other.createdAt) > askedMs,
    );
    if (answered) return [];
    const issue = byKey.get(comment.issueKey);
    return [
      pendingItem({
        projectId: snapshot.project.id,
        rule: PENDING_RULES.unansweredQuestion,
        recordKey: `${comment.issueKey}:${comment.id}`,
        detail: `${comment.author} asked a question on ${comment.issueKey} ${hours} h ago and nobody answered.`,
        occurredAt: comment.createdAt,
        evidence: [
          commentEvidence(comment, `Unanswered for ${hours} h`),
          ...(issue ? [issueEvidence(issue, issue.status)] : []),
        ],
      }),
    ];
  });
  return withEvidence(items);
}

export type PendingDetector = (
  snapshot: MemorySnapshot,
  options: MemoryOptions,
) => MemoryItem[];

/** Every pending rule, in reporting order. */
export const PENDING_DETECTORS: readonly PendingDetector[] = [
  detectDoneWithoutMergedPr,
  detectMergedPrWithoutClosedIssue,
  detectStuckPullRequests,
  detectStalledIssues,
  detectUnansweredQuestions,
] as const;

export function detectPending(
  snapshot: MemorySnapshot,
  options: MemoryOptions = DEFAULT_MEMORY_OPTIONS,
): MemoryItem[] {
  return PENDING_DETECTORS.flatMap((detect) => detect(snapshot, options));
}
