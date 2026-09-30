import { createFileRoute } from "@tanstack/react-router";

import { PageHeader, Panel } from "@/components/common/Panel";

export const Route = createFileRoute("/research")({
  head: () => ({
    meta: [
      { title: "Research Mode — AIComputeGuard" },
      { name: "description", content: "Statistical testing and hypothesis workflows." },
      { property: "og:title", content: "Research Mode — AIComputeGuard" },
      { property: "og:description", content: "Statistical testing and hypothesis workflows." },
    ],
  }),
  component: ResearchPage,
});

function ResearchPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Research Mode" description="Statistical testing and hypothesis workflows." />
      <Panel title="Wiring in progress" description="This surface is being connected to the analytics engine.">
        <p className="text-sm text-muted-foreground">
          The research mode views are next in the build queue and will read from the same server-side
          analytics pipeline that powers the dashboard.
        </p>
      </Panel>
    </div>
  );
}
