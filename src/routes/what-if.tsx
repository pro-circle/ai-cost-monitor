import { createFileRoute } from "@tanstack/react-router";

import { PageHeader, Panel } from "@/components/common/Panel";

export const Route = createFileRoute("/what-if")({
  head: () => ({
    meta: [
      { title: "What-If Simulator — AIComputeGuard" },
      { name: "description", content: "Scenario comparison against a baseline configuration." },
      { property: "og:title", content: "What-If Simulator — AIComputeGuard" },
      { property: "og:description", content: "Scenario comparison against a baseline configuration." },
    ],
  }),
  component: WhatIfPage,
});

function WhatIfPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="What-If Simulator" description="Scenario comparison against a baseline configuration." />
      <Panel title="Wiring in progress" description="This surface is being connected to the analytics engine.">
        <p className="text-sm text-muted-foreground">
          The what-if simulator views are next in the build queue and will read from the same server-side
          analytics pipeline that powers the dashboard.
        </p>
      </Panel>
    </div>
  );
}
