import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { FolderKanbanIcon } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { PageHeader } from "@/components/app-shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getContainer } from "@/composition-root";
import { getPortfolio } from "@/modules/cockpit/portfolio/application/get-portfolio";
import { ProjectCard } from "@/modules/cockpit/portfolio/ui/project-card";

// The root layout's title template only applies to child segments, not to
// the page that shares its segment, so the full title is set explicitly.
export const metadata: Metadata = {
  title: { absolute: "Portfolio · Radar" },
};

const GRID = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3";

function PortfolioSkeleton() {
  return (
    <div className={GRID} aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} className="h-56 w-full rounded-xl" />
      ))}
    </div>
  );
}

/**
 * Portfolio grid. Booting the container reads the clock and, in demo mode,
 * syncs the seeded scenario, so it stays behind a Suspense boundary: the
 * shell renders immediately and the cards stream in (Cache Components).
 */
async function PortfolioGrid() {
  // The demo container reads the clock and syncs the seeded scenario, so this
  // subtree renders at request time instead of being prerendered.
  await connection();
  const { repo, clock } = await getContainer();
  const rows = await getPortfolio(repo);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={FolderKanbanIcon}
        title="No projects yet"
        description="Connect Jira and GitHub, or run a sync, and every project will appear here."
      />
    );
  }

  const now = clock.now().toISOString();

  return (
    <div className={GRID}>
      {rows.map((row) => (
        <ProjectCard key={row.project.id} row={row} now={now} />
      ))}
    </div>
  );
}

export default function PortfolioPage() {
  return (
    <>
      <PageHeader
        title="Portfolio"
        description="Health, sprint probability, and budget runway for every project."
      />
      <Suspense fallback={<PortfolioSkeleton />}>
        <PortfolioGrid />
      </Suspense>
    </>
  );
}
