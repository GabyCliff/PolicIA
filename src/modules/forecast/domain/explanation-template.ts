import type {
  AlertExplanationInput,
  AlertKind,
  Driver,
  Explanation,
  SuggestedAction,
} from "@/shared/domain";

/**
 * Deterministic fallback explanation.
 *
 * Used whenever the LLM path is unavailable (no API key, an API error, a
 * refusal) or produced ungrounded prose twice. It is built only from the
 * detector's own drivers, so it can never contain a number the engine did not
 * compute — the same guarantee the grounding check enforces on generated text.
 *
 * Pure: no clock, no IO, no randomness. Same input, same sentences.
 */

const KIND_SUBJECT: Readonly<Record<AlertKind, string>> = {
  sprint_goal_risk: "the sprint goal is at risk",
  budget_overrun: "the budget is on track to run out",
  scope_creep: "scope was added after the sprint started",
  wip_over_limit: "too much work is in progress at once",
  stale_review: "pull requests are waiting too long for review",
  stalled_issue: "work in progress has stopped moving",
  reopen_rate: "too much finished work is being reopened",
};

const KIND_ACTIONS: Readonly<Record<AlertKind, readonly SuggestedAction[]>> = {
  sprint_goal_risk: [
    {
      title: "Re-cut the sprint scope with the team",
      rationale: "Drop or defer the lowest-value items so the committed goal stays reachable.",
    },
    {
      title: "Confirm remaining capacity",
      rationale: "Check planned time off and interrupts before promising the current scope.",
    },
  ],
  budget_overrun: [
    {
      title: "Review the burn with the client before the end date",
      rationale: "A budget conversation is cheaper now than after the budget is spent.",
    },
    {
      title: "Re-plan the remaining scope against the money left",
      rationale: "Decide what still fits instead of discovering the gap at delivery.",
    },
  ],
  scope_creep: [
    {
      title: "Move the added work to the next sprint",
      rationale: "Protect the commitment the team made at sprint planning.",
    },
    {
      title: "Agree a scope-change rule with the requester",
      rationale: "Anything added mid-sprint should displace something else.",
    },
  ],
  wip_over_limit: [
    {
      title: "Finish before starting",
      rationale: "Pull nothing new until in-progress work is back under the limit.",
    },
    {
      title: "Pair on the oldest in-progress item",
      rationale: "Clearing the oldest item first shortens cycle time for everything behind it.",
    },
  ],
  stale_review: [
    {
      title: "Assign a reviewer to each waiting pull request",
      rationale: "An unassigned review has no owner and keeps waiting.",
    },
    {
      title: "Add a daily review slot",
      rationale: "A fixed slot keeps review time bounded instead of best-effort.",
    },
  ],
  stalled_issue: [
    {
      title: "Ask the assignee what is blocking the item",
      rationale: "Work in progress with no commits usually hides an unstated blocker.",
    },
    {
      title: "Move blocked work out of progress",
      rationale: "Keeping it in progress hides the real state of the sprint.",
    },
  ],
  reopen_rate: [
    {
      title: "Review the definition of done",
      rationale: "Repeated reopens usually mean work is called done too early.",
    },
    {
      title: "Add a verification step before closing",
      rationale: "Catching the gap before closing is cheaper than reopening.",
    },
  ],
};

/** `13 points` / `48 hours` / `4`, using the driver's own unit. */
function formatDriver(driver: Driver): string {
  const value = Number.isInteger(driver.value)
    ? String(driver.value)
    : String(Number(driver.value.toFixed(2)));
  const unit = driver.unit ? ` ${driver.unit}` : "";
  return `${driver.label}: ${value}${unit}`;
}

/**
 * Builds the two-sentence headline, the why, and 2 actions from the drivers.
 * Every number it prints comes from `input`, so the result is grounded by
 * construction.
 */
export function templateExplanation(input: AlertExplanationInput): Explanation {
  const subject = KIND_SUBJECT[input.kind];
  const when = input.eta === null ? "" : ` The projected date is ${input.eta}.`;
  const headline = `${input.project.name}: ${subject}.${when}`.trim();

  const drivers = input.drivers.map(formatDriver);
  // Evidence is cited by external id, never counted: a count would be a
  // number that is not in the inputs, which is exactly what this template
  // exists to avoid.
  const cited = input.evidence.map((evidence) => evidence.externalId).join(", ");
  const why =
    drivers.length > 0
      ? `Detected from ${drivers.join("; ")}. Backed by ${cited}.`
      : `Detected by the ${input.title} check. Backed by ${cited}.`;

  return {
    headline,
    why,
    suggestedActions: [...KIND_ACTIONS[input.kind]],
  };
}
