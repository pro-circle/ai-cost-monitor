import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { CHART_COLORS, ChartFrame, Legend, axisProps, gridProps, tooltipStyles } from "@/components/charts/chart-kit";
import { ConfigForm, DEFAULT_CONFIG } from "@/components/common/ConfigForm";
import { ErrorBlock, LoadingBlock, PageHeader, Panel, StatTile } from "@/components/common/Panel";
import { Button } from "@/components/ui/button";
import { runWhatIf, type ConfigInput } from "@/lib/api/acg.functions";
import { formatCurrency, formatHours } from "@/lib/format";

export const Route = createFileRoute("/what-if")({
  head: () => ({
    meta: [
      { title: "What-If Simulator — AIComputeGuard" },
      { name: "description", content: "Compare two GPU setups side by side and see the cost, time and utilization difference instantly." },
      { property: "og:title", content: "What-If Simulator — AIComputeGuard" },
      { property: "og:description", content: "Side-by-side simulation of two training setups." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WhatIfPage,
});

const signed = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}`;

function WhatIfPage() {
  const [baseline, setBaseline] = useState<ConfigInput>(DEFAULT_CONFIG);
  const [scenario, setScenario] = useState<ConfigInput>({ ...DEFAULT_CONFIG, gpuType: "H100", gpuCount: 4 });
  const { data, error, isPending } = useQuery({
    queryKey: ["what-if", baseline, scenario],
    queryFn: () => runWhatIf({ data: { baseline, scenario } }),
    placeholderData: keepPreviousData,
  });

  const chart = data
    ? [
        { metric: "Cost (₹)", A: data.baseline.result.cost, B: data.scenario.result.cost },
        { metric: "Duration (h)", A: data.baseline.result.durationHours, B: data.scenario.result.durationHours },
        { metric: "GPU hours", A: data.baseline.result.gpuHours, B: data.scenario.result.gpuHours },
      ]
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="What-If Simulator"
        description="Change anything on the right and watch the difference update live."
        actions={<Button variant="outline" onClick={() => setScenario(baseline)}>Copy baseline to scenario</Button>}
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Baseline (A)"><ConfigForm value={baseline} onChange={setBaseline} idPrefix="wa" compact /></Panel>
        <Panel title="Scenario (B)"><ConfigForm value={scenario} onChange={setScenario} idPrefix="wb" compact /></Panel>
      </div>
      {error ? <ErrorBlock error={error} /> : null}
      {isPending || !data ? (
        <LoadingBlock label="Simulating…" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <StatTile label="Cost change" value={`${signed(data.delta.costPct)}%`} hint={formatCurrency(data.delta.cost)} tone={data.delta.cost < 0 ? "good" : "bad"} />
            <StatTile label="Duration change" value={`${signed(data.delta.durationPct)}%`} hint={formatHours(Math.abs(data.delta.durationHours))} tone={data.delta.durationHours <= 0 ? "good" : "warn"} />
            <StatTile label="GPU-hour change" value={signed(data.delta.gpuHours)} />
            <StatTile label="Utilization change" value={`${signed(data.delta.utilizationPts)} pts`} tone={data.delta.utilizationPts >= 0 ? "good" : "warn"} />
            <StatTile label="Per 1M tokens change" value={formatCurrency(data.delta.costPerMillionTokens, 3)} />
          </div>
          {!data.scenario.result.feasible ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">Scenario B likely won't fit: {data.scenario.result.infeasibleReason}</div>
          ) : null}
          <Panel title="A vs B" actions={<Legend items={[{ label: "Baseline A", color: CHART_COLORS[1]! }, { label: "Scenario B", color: CHART_COLORS[0]! }]} />}>
            <ChartFrame>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="metric" {...axisProps} />
                  <YAxis {...axisProps} />
                   <Tooltip {...tooltipStyles} formatter={(v, name, item) => item.payload.metric === "Cost (₹)" ? formatCurrency(Number(v)) : Number(v).toFixed(2)} />
                  <Bar dataKey="A" name="Baseline A" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  <Bar dataKey="B" name="Scenario B" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </ChartFrame>
          </Panel>
        </>
      )}
    </div>
  );
}
