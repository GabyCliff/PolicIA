import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { BarChart3Icon, FileTextIcon } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { getContainer } from "@/composition-root";
import { getProjectDetail } from "@/modules/cockpit/project/application/get-project-detail";
import { AlertsTab } from "@/modules/cockpit/project/ui/alerts-tab";
import { ForecastTab } from "@/modules/cockpit/project/ui/forecast-tab";
import { ProjectHeader } from "@/modules/cockpit/project/ui/project-header";
import {
  ProjectTabs,
  parseProjectTab,
} from "@/modules/cockpit/project/ui/project-tabs";
import { MemoryPanel } from "@/modules/memory/ui/memory-panel";

import { ProjectPageSkeleton } from "./skeleton";

/**
 * Project cockpit. `params` and `searchParams` are awaited inside the
 * suspended subtree so the page shell can be prerendered while the data
 * streams in (Cache Components).
 *
 * Only the active tab is rendered server-side, so an unvisited tab never
 * costs a repository read.
 */

export async function generateMetadata({
  params,
}: PageProps<"/projects/[id]">): Promise<Metadata> {
  const { id } = await params;
  try {
    await connection();
    const { repo } = await getContainer();
    const project = await repo.projects.get(id);
    return { title: project?.name ?? "Project" };
  } catch {
    return { title: "Project" };
  }
}

function PlaceholderTab({ tab }: { tab: "metrics" | "reports" }) {
  if (tab === "metrics") {
    return (
      <EmptyState
        icon={BarChart3Icon}
        title="Team metrics"
        description="Throughput, cycle time, WIP, and review time. Coming in a later slice."
      />
    );
  }
  return (
    <EmptyState
      icon={FileTextIcon}
      title="Reports"
      description="Progress and client reports with evidence footnotes. Coming in a later slice."
    />
  );
}

async function ProjectView({
  params,
  searchParams,
}: Pick<PageProps<"/projects/[id]">, "params" | "searchParams">) {
  // Booting the container reads the clock, so this subtree is request-time
  // rendered instead of prerendered (Cache Components).
  await connection();
  const [{ id }, query, { repo, clock }] = await Promise.all([
    params,
    searchParams,
    getContainer(),
  ]);

  const detail = await getProjectDetail(repo, id);
  if (detail === null) notFound();

  const tab = parseProjectTab(query.tab);
  const now = clock.now().toISOString();
  // Active = open + ack: acknowledging an alert does not clear the risk.
  const activeSeverities = detail.alerts
    .filter((alert) => alert.status !== "resolved")
    .map((alert) => alert.severity);

  return (
    <>
      <ProjectHeader
        project={detail.project}
        activeAlertSeverities={activeSeverities}
        syncRuns={detail.syncRuns}
        now={now}
      />
      <ProjectTabs
        projectId={detail.project.id}
        activeTab={tab}
        openAlertCount={detail.openAlertCount}
      >
        {tab === "forecast" ? (
          <ForecastTab sprint={detail.sprint} budget={detail.budget} />
        ) : tab === "alerts" ? (
          <AlertsTab
            alerts={detail.alerts}
            projectId={detail.project.id}
            now={now}
          />
        ) : tab === "memory" ? (
          <MemoryPanel projectId={detail.project.id} />
        ) : (
          <PlaceholderTab tab={tab} />
        )}
      </ProjectTabs>
    </>
  );
}

export default function ProjectPage({
  params,
  searchParams,
}: PageProps<"/projects/[id]">) {
  return (
    <Suspense fallback={<ProjectPageSkeleton />}>
      <ProjectView params={params} searchParams={searchParams} />
    </Suspense>
  );
}
