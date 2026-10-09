import type { Metadata } from "next";
import { MessageSquareTextIcon } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { PageHeader } from "@/components/app-shell/page-header";

export const metadata: Metadata = {
  title: "Ask Radar",
};

export default function AskPage() {
  return (
    <>
      <PageHeader
        title="Ask Radar"
        description="Ask questions across Jira, GitHub, Calendar, and Flocktools. Every answer cites its evidence."
      />
      <EmptyState
        icon={MessageSquareTextIcon}
        title="Chat is not available yet"
        description="Ask Radar will appear here once the chat module lands."
      />
    </>
  );
}
