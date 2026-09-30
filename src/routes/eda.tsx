import { createFileRoute } from "@tanstack/react-router";

import { PageHeader, Panel } from "@/components/common/Panel";

export const Route = createFileRoute("/eda")({
  head: () => ({
    meta: [
      { title: "Exploratory Data Analysis — AIComputeGuard" },
      { name: "description", content: "Distributions, correlations and bivariate structure." },
      { property: "og:title", content: "Exploratory Data Analysis — AIComputeGuard" },
      { property: "og:description", content: "Distributions, correlations and bivariate structure." },
    ],
  }),
  component: EdaPage,
});

function EdaPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Exploratory Data Analysis" description="Distributions, correlations and bivariate structure." />
      <Panel title="Wiring in progress" description="This surface is being connected to the analytics engine.">
        <p className="text-sm text-muted-foreground">
          The exploratory data analysis views are next in the build queue and will read from the same server-side
          analytics pipeline that powers the dashboard.
        </p>
      </Panel>
    </div>
  );
}
