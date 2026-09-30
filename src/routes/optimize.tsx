import { createFileRoute } from "@tanstack/react-router";

import { PageHeader, Panel } from "@/components/common/Panel";

export const Route = createFileRoute("/optimize")({
  head: () => ({
    meta: [
      { title: "Optimization Engine — AIComputeGuard" },
      { name: "description", content: "Constraint-aware configuration search." },
      { property: "og:title", content: "Optimization Engine — AIComputeGuard" },
      { property: "og:description", content: "Constraint-aware configuration search." },
    ],
  }),
  component: OptimizePage,
});

function OptimizePage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Optimization Engine" description="Constraint-aware configuration search." />
      <Panel title="Wiring in progress" description="This surface is being connected to the analytics engine.">
        <p className="text-sm text-muted-foreground">
          The optimization engine views are next in the build queue and will read from the same server-side
          analytics pipeline that powers the dashboard.
        </p>
      </Panel>
    </div>
  );
}
