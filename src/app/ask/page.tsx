import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getAppConfig, getContainer } from "@/composition-root";
import { AskRadarChat } from "@/modules/chat/ui/ask-radar-chat";

export const metadata: Metadata = {
  title: "Ask Radar",
};

const NO_KEY_REASON =
  "ANTHROPIC_API_KEY is not configured, so Radar cannot call the model. Everything else keeps working: forecasts and alerts are computed deterministically, and alert explanations fall back to templates built from the detectors' own drivers. Set ANTHROPIC_API_KEY and restart to enable the chat.";

/**
 * The project selector needs the container, which reads the clock and syncs
 * the demo scenario, so it renders at request time behind a Suspense boundary
 * while the page shell streams immediately (Cache Components).
 */
async function Chat() {
  await connection();
  const { llmAvailable } = getAppConfig();
  const { repo } = await getContainer();
  const projects = await repo.projects.list();

  return (
    <AskRadarChat
      projects={projects.map((project) => ({
        id: project.id,
        name: project.name,
        jiraKey: project.jiraKey,
      }))}
      llmAvailable={llmAvailable}
      disabledReason={NO_KEY_REASON}
    />
  );
}

export default function AskPage() {
  return (
    <>
      <PageHeader
        title="Ask Radar"
        description="Ask questions across Jira, GitHub, Calendar, and Flocktools. Every answer cites its evidence."
      />
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Chat />
      </Suspense>
    </>
  );
}
