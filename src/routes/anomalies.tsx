import { createFileRoute } from "@tanstack/react-router";

import { PageHeader, Panel } from "@/components/common/Panel";

export const Route = createFileRoute("/anomalies")({
  head: () => ({
    meta: [
      { title: "Anomaly Detection — AIComputeGuard" },
      { name: "description", content: "Isolation Forest and LOF scoring over workload features." },
      { property: "og:title", content: "Anomaly Detection — AIComputeGuard" },
      { property: "og:description", content: "Isolation Forest and LOF scoring over workload features." },
    ],
  }),
  component: AnomaliesPage,
});

function AnomaliesPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Anomaly Detection" description="Isolation Forest and LOF scoring over workload features." />
      <Panel title="Wiring in progress" description="This surface is being connected to the analytics engine.">
        <p className="text-sm text-muted-foreground">
          The anomaly detection views are next in the build queue and will read from the same server-side
          analytics pipeline that powers the dashboard.
        </p>
      </Panel>
    </div>
  );
}
