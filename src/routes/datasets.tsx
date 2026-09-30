import { createFileRoute } from "@tanstack/react-router";

import { PageHeader, Panel } from "@/components/common/Panel";

export const Route = createFileRoute("/datasets")({
  head: () => ({
    meta: [
      { title: "Dataset Management — AIComputeGuard" },
      { name: "description", content: "Upload, validate, profile and clean workload datasets." },
      { property: "og:title", content: "Dataset Management — AIComputeGuard" },
      { property: "og:description", content: "Upload, validate, profile and clean workload datasets." },
    ],
  }),
  component: DatasetsPage,
});

function DatasetsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Dataset Management" description="Upload, validate, profile and clean workload datasets." />
      <Panel title="Wiring in progress" description="This surface is being connected to the analytics engine.">
        <p className="text-sm text-muted-foreground">
          The dataset management views are next in the build queue and will read from the same server-side
          analytics pipeline that powers the dashboard.
        </p>
      </Panel>
    </div>
  );
}
