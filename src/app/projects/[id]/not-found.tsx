import Link from "next/link";
import { SearchXIcon } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { Button } from "@/components/ui/button";

export default function ProjectNotFound() {
  return (
    <div className="space-y-4">
      <EmptyState
        icon={SearchXIcon}
        title="Project not found"
        description="This project does not exist, or it is not part of the current workspace."
      />
      <div className="flex justify-center">
        <Button asChild variant="outline">
          <Link href="/">Back to the portfolio</Link>
        </Button>
      </div>
    </div>
  );
}
