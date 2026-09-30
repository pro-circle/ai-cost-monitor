import { createFileRoute } from "@tanstack/react-router";

import { PageHeader, Panel } from "@/components/common/Panel";

export const Route = createFileRoute("/cost")({
  head: () => ({
    meta: [
      { title: "Cost Intelligence — AIComputeGuard" },
      { name: "description", content: "Spend attribution, forecasting and waste recovery." },
      { property: "og:title", content: "Cost Intelligence — AIComputeGuard" },
      { property: "og:description", content: "Spend attribution, forecasting and waste recovery." },
    ],
  }),
  component: CostPage,
});

function CostPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Cost Intelligence" description="Spend attribution, forecasting and waste recovery." />
      <Panel title="Wiring in progress" description="This surface is being connected to the analytics engine.">
        <p className="text-sm text-muted-foreground">
          The cost intelligence views are next in the build queue and will read from the same server-side
          analytics pipeline that powers the dashboard.
        </p>
      </Panel>
    </div>
  );
}
