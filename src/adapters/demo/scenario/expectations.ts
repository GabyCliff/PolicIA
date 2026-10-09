/**
 * The signals the demo scenario is scripted to produce. Phase 3 calibrates
 * the forecast engine against these numbers and later phases use the keys
 * to assert their detectors; `dataset.test.ts` keeps the dataset honest.
 *
 * Reference model used to tune the numbers (phase 3 may refine it):
 * - Sprint: bootstrap 10,000 runs over the daily throughput (forecast unit
 *   resolved per working day) of the last 6 closed sprints; each remaining
 *   day is scaled by the team's available hours that day divided by the mean
 *   available hours of the elapsed sprint days; P = share of runs reaching
 *   the remaining scope.
 * - Budget: EWMA (alpha 0.3) of hours logged per working day, projected from
 *   the last working day; exhaustion = budget / hourly rate reached.
 *
 * Calendar model: today is working day 6 of a 10-working-day active sprint,
 * on any weekday the demo runs (weekend anchors shift dates, not the story).
 */
export const DEMO_SCENARIO_EXPECTATIONS = {
  sprint: {
    workingDays: 10,
    todayIsWorkingDay: 6,
    elapsedWorkingDays: 5,
    remainingWorkingDays: 5,
  },
  atlas: {
    jiraKey: "ATL",
    intendedHealth: "green",
    closedSprints: 6,
    velocityPoints: { min: 32, max: 36 },
    committedPoints: 34,
    scopeAddedPoints: 0,
    donePoints: 23,
    remainingPoints: 11,
    wipLimit: 5,
    inProgress: 3,
    /** Under the reference model (0.76 at calibration time). */
    minSprintProbability: 0.7,
    budgetExhaustedBeforeEnd: false,
    /** Pending: a Jira question with no reply for more than 48 hours. */
    unansweredQuestionIssueKey: "ATL-308",
    unansweredQuestionMinHours: 48,
  },
  beacon: {
    jiraKey: "BCN",
    intendedHealth: "red",
    closedSprints: 6,
    velocityPoints: { min: 35, max: 39 },
    /** Under the reference model (0.37-0.38 across weekdays at calibration time). */
    targetSprintProbability: 0.38,
    committedPointsAtStart: 27,
    scopeAddedPoints: 13,
    /** Issues pulled into the sprint after it started. */
    scopeAddedIssues: { "BCN-313": 5, "BCN-314": 3 },
    /** Estimates raised after the sprint started (delta points). */
    scopeReestimates: { "BCN-305": 2, "BCN-310": 3 },
    currentScopePoints: 40,
    donePoints: 23,
    remainingPoints: 17,
    ptoPeople: 2,
    ptoPeopleNames: ["Camila Ortega", "Nicolás Vega"],
    /** Remaining-sprint working days each PTO person is out. */
    ptoDaysPerPerson: 2,
    wipLimit: 5,
    inProgress: 8,
    staleReviewIssueKey: "BCN-307",
    staleReviewMinHours: 52,
    /**
     * Detector contract (phase 3): an issue is stalled when it is In Progress
     * and has no linked commit in >= 5 WORKING days (weekends do not count).
     * BCN-306's last commit is 7 working days before today, i.e. 6 full
     * working days without commits on any weekday.
     */
    stalledIssueKey: "BCN-306",
    stalledMinWorkingDaysWithoutCommits: 5,
    /** Pending: merged PR that references no issue. */
    orphanMergedPrTitle: "Hotfix: raise upstream timeout for carrier calls",
    budgetExhaustedBeforeEnd: false,
  },
  cobalt: {
    jiraKey: "CBL",
    intendedHealth: "red",
    forecastUnit: "issues",
    budgetAmount: 120_000,
    budgetCurrency: "USD",
    hourlyRate: 60,
    endOffsetDays: 42,
    /** Under the reference model, on weekday anchors (12-13 on weekends). */
    exhaustionDaysBeforeEnd: 14,
    burnWindowWorkingDays: 15,
    exhaustionWorkingDaysAhead: 20,
    /** Daily burn in the window vs. before it (about 1.8x at calibration). */
    minBurnAcceleration: 1.5,
    lateJoiners: ["Agustina Silva", "Joaquín Navarro"],
    /** Pending: Done, requires code, no linked merged PR (committed to main). */
    doneWithoutMergedPrIssueKey: "CBL-302",
    decisionDocs: 2,
    /** Not the focus; healthy enough not to compete with the budget story (0.69). */
    minSprintProbability: 0.6,
  },
} as const;

export type DemoScenarioExpectations = typeof DEMO_SCENARIO_EXPECTATIONS;
