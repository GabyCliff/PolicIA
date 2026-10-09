"use server";

import { revalidatePath } from "next/cache";

import { getContainer } from "@/composition-root";
import type { AlertStatusState } from "@/modules/cockpit/project/ui/alert-status-state";
import { AlertStatusSchema, canTransitionAlert } from "@/shared/domain";
import { AlertConflictError } from "@/shared/ports";

/**
 * Alert triage from the cockpit.
 *
 * The transition is validated here (the repository and, in live mode, a DB
 * trigger validate it again) and a conflicting reactivation comes back as a
 * message instead of an unhandled rejection. Nothing from the error object is
 * forwarded except the kind of conflict, so internals never reach the client.
 */

export async function setAlertStatusAction(
  _previous: AlertStatusState,
  formData: FormData,
): Promise<AlertStatusState> {
  const projectId = String(formData.get("projectId") ?? "");
  const alertId = String(formData.get("alertId") ?? "");
  const parsedStatus = AlertStatusSchema.safeParse(formData.get("status"));

  if (projectId === "" || alertId === "" || !parsedStatus.success) {
    return { status: "error", message: "That request was not understood." };
  }
  const nextStatus = parsedStatus.data;

  try {
    const { repo } = await getContainer();
    const alerts = await repo.alerts.byProject(projectId);
    const alert = alerts.find((candidate) => candidate.id === alertId);

    if (alert === undefined) {
      return { status: "error", message: "This alert no longer exists." };
    }
    if (!canTransitionAlert(alert.status, nextStatus)) {
      return {
        status: "error",
        message: `An alert that is ${alert.status} cannot be moved to ${nextStatus}.`,
      };
    }

    const updated = await repo.alerts.setStatus(alertId, nextStatus);
    if (updated === null) {
      return { status: "error", message: "This alert no longer exists." };
    }

    revalidatePath(`/projects/${projectId}`);
    revalidatePath("/");
    return { status: "ok", message: null };
  } catch (error) {
    if (error instanceof AlertConflictError) {
      return {
        status: "error",
        message:
          "Another alert of this kind is already active. Resolve it first, then reopen this one.",
      };
    }
    return {
      status: "error",
      message: "The alert could not be updated. Please try again.",
    };
  }
}
