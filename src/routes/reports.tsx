import { createFileRoute } from "@tanstack/react-router";

import { PageHeader, Panel } from "@/components/common/Panel";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Report Generation — AIComputeGuard" },
      { name: "description", content: "Executive briefs assembled from live analytics." },
      { property: "og:title", content: "Report Generation — AIComputeGuard" },
      { property: "og:description", content: "Executive briefs assembled from live analytics." },
    ],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Report Generation" description="Executive briefs assembled from live analytics." />
      <Panel title="Wiring in progress" description="This surface is being connected to the analytics engine.">
        <p className="text-sm text-muted-foreground">
          The report generation views are next in the build queue and will read from the same server-side
          analytics pipeline that powers the dashboard.
        </p>
      </Panel>
    </div>
  );
}
