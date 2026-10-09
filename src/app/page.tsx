import type { Metadata } from "next";
import { FolderKanbanIcon } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { PageHeader } from "@/components/app-shell/page-header";

// The root layout's title template only applies to child segments, not to
// the page that shares its segment, so the full title is set explicitly.
export const metadata: Metadata = {
  title: { absolute: "Portfolio · Radar" },
};

export default function PortfolioPage() {
  return (
    <>
      <PageHeader
        title="Portfolio"
        description="Health, sprint probability, and budget runway for every project."
      />
      <EmptyState
        icon={FolderKanbanIcon}
        title="No projects yet"
        description="Projects will appear here after the data spine lands."
      />
    </>
  );
}
