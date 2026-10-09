import {
  CalendarDaysIcon,
  FileTextIcon,
  GitCommitHorizontalIcon,
  GitPullRequestIcon,
  MessageSquareIcon,
  SquareCheckBigIcon,
  TimerIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { Driver, Evidence, EvidenceSourceType } from "@/shared/domain";

import { formatNumber, humanizeKey } from "./format";

/**
 * "Evidence or it didn't happen": every claim links back to the record it was
 * built from. Chips open the source system in a new tab and carry the human
 * id (`BCN-123`, `#42`) plus the kind of record, so the label is readable
 * without the icon.
 */

const SOURCE_ICON: Readonly<Record<EvidenceSourceType, LucideIcon>> = {
  jira_issue: SquareCheckBigIcon,
  jira_transition: SquareCheckBigIcon,
  jira_comment: MessageSquareIcon,
  jira_worklog: TimerIcon,
  jira_sprint: CalendarDaysIcon,
  github_pr: GitPullRequestIcon,
  github_review: GitPullRequestIcon,
  github_commit: GitCommitHorizontalIcon,
  calendar_event: CalendarDaysIcon,
  doc: FileTextIcon,
};

const SOURCE_LABEL: Readonly<Record<EvidenceSourceType, string>> = {
  jira_issue: "Jira issue",
  jira_transition: "Jira transition",
  jira_comment: "Jira comment",
  jira_worklog: "Worklog",
  jira_sprint: "Sprint",
  github_pr: "Pull request",
  github_review: "Review",
  github_commit: "Commit",
  calendar_event: "Calendar",
  doc: "Doc",
};

export function EvidenceChip({ evidence }: { evidence: Evidence }) {
  const Icon = SOURCE_ICON[evidence.sourceType];
  const sourceLabel = SOURCE_LABEL[evidence.sourceType];

  return (
    <a
      href={evidence.url}
      target="_blank"
      rel="noopener noreferrer"
      title={evidence.label ?? `${sourceLabel} ${evidence.externalId}`}
      className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-4xl border border-border bg-muted/40 px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      <span className="font-mono text-[0.7rem] text-foreground">
        {evidence.externalId}
      </span>
      <span className="truncate">{sourceLabel}</span>
    </a>
  );
}

export function EvidenceChips({
  evidence,
  className,
}: {
  evidence: readonly Evidence[];
  className?: string;
}) {
  if (evidence.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <span className="text-xs font-medium text-muted-foreground">Evidence</span>
      {evidence.map((entry) => (
        <EvidenceChip
          key={`${entry.sourceType}-${entry.externalId}-${entry.url}`}
          evidence={entry}
        />
      ))}
    </div>
  );
}

/** The numbers a detector fired on, e.g. "Scope added 13 pts". */
export function DriverChips({
  drivers,
  className,
}: {
  drivers: readonly Driver[];
  className?: string;
}) {
  if (drivers.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {drivers.map((driver) => (
        <span
          key={driver.key}
          title={driver.detail ?? driver.label}
          className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs"
        >
          <span className="truncate text-muted-foreground">
            {driver.label || humanizeKey(driver.key)}
          </span>
          <span className="font-mono text-[0.7rem] font-medium tabular-nums">
            {formatNumber(driver.value, Number.isInteger(driver.value) ? 0 : 1)}
            {driver.unit ? ` ${driver.unit}` : ""}
          </span>
        </span>
      ))}
    </div>
  );
}
