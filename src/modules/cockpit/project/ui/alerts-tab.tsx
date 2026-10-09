import { BellIcon } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ALERT_STATUS_TRANSITIONS, type Alert, type AlertStatus } from "@/shared/domain";

import { DriverChips, EvidenceChips } from "../../shared/ui/evidence-chips";
import {
  daysUntil,
  formatDay,
  formatDayDistance,
  formatPercent,
  humanizeKey,
} from "../../shared/ui/format";
import { SeverityBadge } from "../../shared/ui/severity";
import { AlertTriage } from "./alert-triage";

const STATUS_LABEL: Readonly<Record<AlertStatus, string>> = {
  open: "Open",
  ack: "Acknowledged",
  resolved: "Resolved",
};

const STATUS_GROUPS: readonly AlertStatus[] = ["open", "ack", "resolved"];

function AlertRow({
  alert,
  projectId,
  now,
}: {
  alert: Alert;
  projectId: string;
  now: string;
}) {
  const etaDays = alert.eta === null ? null : daysUntil(now, alert.eta);

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={alert.severity} />
              <Badge variant="outline">{humanizeKey(alert.kind)}</Badge>
              <span className="text-xs text-muted-foreground">
                Confidence {formatPercent(alert.confidence)}
              </span>
              <span className="text-xs text-muted-foreground">
                {alert.eta === null
                  ? "No ETA"
                  : `ETA ${formatDay(alert.eta)}${
                      etaDays === null ? "" : ` · ${formatDayDistance(etaDays)}`
                    }`}
              </span>
            </div>
            <h3 className="text-sm font-medium">{alert.title}</h3>
          </div>
          <AlertTriage
            alertId={alert.id}
            projectId={projectId}
            transitions={ALERT_STATUS_TRANSITIONS[alert.status]}
          />
        </div>

        {alert.explanation === null ? (
          <p className="text-xs text-muted-foreground italic">AI explanation pending</p>
        ) : (
          <p className="text-sm text-muted-foreground">{alert.explanation}</p>
        )}

        {alert.suggestedActions.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {alert.suggestedActions.map((action) => (
              <li key={action.title} className="text-muted-foreground">
                <span className="font-medium text-foreground">{action.title}</span> —{" "}
                {action.rationale}
              </li>
            ))}
          </ul>
        ) : null}

        <DriverChips drivers={alert.drivers} />
        <Separator />
        <EvidenceChips evidence={alert.evidence} />
      </CardContent>
    </Card>
  );
}

export function AlertsTab({
  alerts,
  projectId,
  now,
}: {
  alerts: readonly Alert[];
  projectId: string;
  now: string;
}) {
  if (alerts.length === 0) {
    return (
      <EmptyState
        icon={BellIcon}
        title="No alerts for this project"
        description="Detectors run on every sync. Anything they find will show up here with its evidence."
      />
    );
  }

  return (
    <div className="space-y-6">
      {STATUS_GROUPS.map((status) => {
        const group = alerts.filter((alert) => alert.status === status);
        if (group.length === 0) return null;
        return (
          <section key={status} className="space-y-3">
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {STATUS_LABEL[status]} · {group.length}
            </h2>
            <div className="space-y-3">
              {group.map((alert) => (
                <AlertRow
                  key={alert.id}
                  alert={alert}
                  projectId={projectId}
                  now={now}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
