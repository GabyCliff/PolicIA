import type { Metadata } from "next";
import { SettingsIcon } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { PageHeader } from "@/components/app-shell/page-header";

export const metadata: Metadata = {
  title: "Admin",
};

export default function AdminPage() {
  return (
    <>
      <PageHeader
        title="Admin"
        description="Sync runs, data freshness per source, and LLM usage and cost."
      />
      <EmptyState
        icon={SettingsIcon}
        title="Nothing to administer yet"
        description="Sync history and LLM cost will appear here once ingestion and the AI layer land."
      />
    </>
  );
}
