import { createFileRoute } from "@tanstack/react-router";

import { PageHeader, Panel } from "@/components/common/Panel";

export const Route = createFileRoute("/predict")({
  head: () => ({
    meta: [
      { title: "Prediction Studio — AIComputeGuard" },
      { name: "description", content: "Cost and duration models with confidence intervals." },
      { property: "og:title", content: "Prediction Studio — AIComputeGuard" },
      { property: "og:description", content: "Cost and duration models with confidence intervals." },
    ],
  }),
  component: PredictPage,
});

function PredictPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Prediction Studio" description="Cost and duration models with confidence intervals." />
      <Panel title="Wiring in progress" description="This surface is being connected to the analytics engine.">
        <p className="text-sm text-muted-foreground">
          The prediction studio views are next in the build queue and will read from the same server-side
          analytics pipeline that powers the dashboard.
        </p>
      </Panel>
    </div>
  );
}
