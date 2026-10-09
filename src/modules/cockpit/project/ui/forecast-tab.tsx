import { LineChartIcon } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import type {
  BudgetRunwayView,
  SprintCompletionView,
} from "../../shared/domain/stored-forecast";
import {
  daysUntil,
  formatDayWithYear,
  formatMoney,
  formatNumber,
  formatPercent,
} from "../../shared/ui/format";
import { StatTile } from "../../shared/ui/stat-tile";
import { BudgetChart } from "./budget-chart";
import { BurnUpChart } from "./burn-up-chart";

/**
 * Forecast tab: the sprint burn-up with its P50/P85 cone, then the budget
 * burn against plan. Every series is optional in the persisted document, so
 * each chart falls back to a one-line note rather than rendering empty axes.
 */

function probabilityTone(probability: number | null) {
  if (probability === null) return "default" as const;
  if (probability < 0.5) return "danger" as const;
  if (probability < 0.75) return "warning" as const;
  return "positive" as const;
}

function SprintSection({ sprint }: { sprint: SprintCompletionView }) {
  const unit = sprint.unit === "issues" ? "issues" : "pts";
  const hasBurnUp = sprint.burnUp.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sprint burn-up</CardTitle>
        <CardDescription>
          {sprint.sprint?.name
            ? `${sprint.sprint.name} · ${formatNumber(sprint.done, 1)} of ${formatNumber(
                sprint.scope,
                1,
              )} ${unit} done`
            : "No active sprint"}
          {sprint.unitFallback
            ? " · counting issues because some estimates are missing"
            : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="P(hit sprint goal)"
            value={
              sprint.probability === null ? "—" : formatPercent(sprint.probability)
            }
            caption={`${formatNumber(sprint.remaining, 1)} ${unit} remaining`}
            tone={probabilityTone(sprint.probability)}
          />
          <StatTile
            label="P50 completion"
            value={sprint.p50Date === null ? "—" : formatDayWithYear(sprint.p50Date)}
            caption="Half of the simulated runs finish by this day"
          />
          <StatTile
            label="P85 completion"
            value={sprint.p85Date === null ? "—" : formatDayWithYear(sprint.p85Date)}
            caption="A confident finish date"
          />
          <StatTile
            label="Working days left"
            value={formatNumber(sprint.remainingWorkingDays)}
            caption={
              sprint.sprint?.endDate
                ? `Sprint ends ${formatDayWithYear(sprint.sprint.endDate)}`
                : "No sprint window"
            }
          />
        </div>

        {hasBurnUp ? (
          <BurnUpChart points={sprint.burnUp} unit={unit} />
        ) : (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No burn-up series in the latest forecast.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function BudgetSection({ budget }: { budget: BudgetRunwayView }) {
  const hasSeries = budget.series.length > 0;
  const daysLeft =
    budget.exhaustionDate === null ? null : daysUntil(budget.asOf, budget.exhaustionDate);
  const exhausted = budget.alreadyExhausted || (daysLeft !== null && daysLeft <= 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Budget burn</CardTitle>
        <CardDescription>
          {formatMoney(budget.spent, budget.currency)} of{" "}
          {formatMoney(budget.budget, budget.currency)} spent ·{" "}
          {formatNumber(budget.spentHours)} hours logged
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Runway"
            value={
              budget.exhaustionDate === null
                ? "Within budget"
                : exhausted
                  ? "Exhausted"
                  : `${daysLeft} days`
            }
            caption={
              budget.exhaustionDate === null
                ? "No exhaustion projected before the end date"
                : `Projected ${formatDayWithYear(budget.exhaustionDate)}`
            }
            tone={exhausted ? "danger" : daysLeft !== null && daysLeft <= 14 ? "warning" : "default"}
          />
          <StatTile
            label="Remaining"
            value={formatMoney(budget.remaining, budget.currency)}
            caption={`Burning ${formatMoney(budget.dailyBurn, budget.currency)} / working day`}
            tone={budget.remaining <= 0 ? "danger" : "default"}
          />
          <StatTile
            label="Projected at end date"
            value={formatMoney(budget.projectedSpendAtEnd, budget.currency)}
            caption={
              budget.percentOverAtEnd === null
                ? `Ends ${budget.endDate ? formatDayWithYear(budget.endDate) : "—"}`
                : `${budget.percentOverAtEnd > 0 ? "+" : ""}${formatNumber(
                    budget.percentOverAtEnd,
                    1,
                  )}% vs budget`
            }
            tone={
              budget.percentOverAtEnd !== null && budget.percentOverAtEnd > 0
                ? "danger"
                : "default"
            }
          />
          <StatTile
            label="Vs end date"
            value={
              budget.daysBeforeEnd === null
                ? "—"
                : formatNumber(Math.abs(budget.daysBeforeEnd))
            }
            caption={
              budget.daysBeforeEnd === null
                ? "No exhaustion projected"
                : budget.daysBeforeEnd > 0
                  ? "Days the budget runs out early"
                  : "Days the budget outlasts the end date"
            }
            tone={
              budget.daysBeforeEnd !== null && budget.daysBeforeEnd > 0 ? "danger" : "default"
            }
          />
        </div>

        {hasSeries ? (
          <BudgetChart
            series={budget.series}
            currency={budget.currency}
            budget={budget.budget}
            exhaustionDate={budget.exhaustionDate}
          />
        ) : (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No budget series in the latest forecast.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function ForecastTab({
  sprint,
  budget,
}: {
  sprint: SprintCompletionView | null;
  budget: BudgetRunwayView | null;
}) {
  if (sprint === null && budget === null) {
    return (
      <EmptyState
        icon={LineChartIcon}
        title="No forecast yet"
        description="Forecasts are computed on every sync. Run a sync to populate this tab."
      />
    );
  }

  return (
    <div className="space-y-4">
      {sprint === null ? null : <SprintSection sprint={sprint} />}
      {budget === null ? null : <BudgetSection budget={budget} />}
    </div>
  );
}
