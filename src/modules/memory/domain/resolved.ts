import {
  DAY_MS,
  toIsoDate,
  withEvidence,
  type Evidence,
  type Issue,
  type MemoryItem,
} from "@/shared/domain";

import { commitEvidence, issueEvidence, pullRequestEvidence } from "./evidence";
import { memoryItemId } from "./ids";
import { mergeCommitOf, mergedPullRequestForIssue } from "./links";
import { DEFAULT_MEMORY_OPTIONS, type MemoryOptions, type MemorySnapshot } from "./snapshot";

/**
 * "What actually got done": issues resolved inside the period, each carrying
 * its evidence CHAIN in order — issue -> merged pull request -> merge commit.
 * The chain is what lets a leader stop re-checking finished work: the order of
 * `evidence` is the order of the trail, so the UI renders it as-is.
 *
 * A deploy record would be the fourth link; Radar has no deploy source yet.
 */

function resolvedAt(issue: Issue): string | null {
  return issue.resolvedAt;
}

export function issuesResolvedBetween(
  snapshot: MemorySnapshot,
  sinceMs: number,
): Issue[] {
  const nowMs = snapshot.now.getTime();
  return snapshot.issues
    .filter((issue) => issue.statusCategory === "done")
    .filter((issue) => {
      const at = resolvedAt(issue);
      if (at === null) return false;
      const ms = Date.parse(at);
      return ms >= sinceMs && ms <= nowMs;
    })
    .sort(
      (a, b) =>
        Date.parse(a.resolvedAt as string) - Date.parse(b.resolvedAt as string) ||
        a.key.localeCompare(b.key),
    );
}

/** Issue -> merged PR -> merge commit, in that order, skipping missing links. */
export function evidenceChainFor(snapshot: MemorySnapshot, issue: Issue): Evidence[] {
  const chain: Evidence[] = [
    issueEvidence(issue, `${issue.status} on ${toIsoDate(new Date(issue.resolvedAt ?? issue.updatedAt))}`),
  ];
  const pr = mergedPullRequestForIssue(snapshot.pullRequests, issue.key);
  if (!pr) return chain;
  chain.push(pullRequestEvidence(pr, `Merged on ${toIsoDate(new Date(pr.mergedAt as string))}`));
  const mergeCommit = mergeCommitOf(snapshot.commits, pr);
  if (mergeCommit) chain.push(commitEvidence(mergeCommit, `Merge commit of PR #${pr.number}`));
  return chain;
}

export function detectResolved(
  snapshot: MemorySnapshot,
  options: MemoryOptions = DEFAULT_MEMORY_OPTIONS,
): MemoryItem[] {
  const sinceMs = snapshot.now.getTime() - options.digestDays * DAY_MS;
  const items = issuesResolvedBetween(snapshot, sinceMs).map((issue) => {
    const chain = evidenceChainFor(snapshot, issue);
    const pr = mergedPullRequestForIssue(snapshot.pullRequests, issue.key);
    const tail = pr ? ` via PR #${pr.number}` : " without a pull request";
    return {
      id: memoryItemId(snapshot.project.id, "done", "issue_resolved", issue.key),
      projectId: snapshot.project.id,
      kind: "done" as const,
      summary: `${issue.key} "${issue.title}" resolved on ${toIsoDate(
        new Date(issue.resolvedAt as string),
      )}${tail}.`,
      evidence: chain,
      occurredAt: issue.resolvedAt as string,
      status: "resolved" as const,
    };
  });
  return withEvidence(items);
}
