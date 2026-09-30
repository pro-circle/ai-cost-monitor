import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { ConfigForm, DEFAULT_CONFIG } from "@/components/common/ConfigForm";
import { EmptyState, ErrorBlock, PageHeader, Panel, StatTile } from "@/components/common/Panel";
import { Button } from "@/components/ui/button";
import { predictCost, type ConfigInput } from "@/lib/api/acg.functions";
import { formatCurrency, formatHours, formatNumber } from "@/lib/format";

export const Route = createFileRoute("/predict")({
  head: () => ({
    meta: [
      { title: "Cost & Duration Prediction — AIComputeGuard" },
      { name: "description", content: "Predict the cost and runtime of an AI training job before you launch it." },
      { property: "og:title", content: "Cost & Duration Prediction — AIComputeGuard" },
      { property: "og:description", content: "ML-backed cost and runtime estimates with confidence intervals." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PredictPage,
});

function Row({ label, a, b }: { label: string; a: string; b: string }) {
  return (
    <div className="grid grid-cols-3 gap-2 border-b border-border/60 py-1.5 text-xs last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-mono">{a}</span>
      <span className="text-right font-mono">{b}</span>
    </div>
  );
}

function PredictPage() {
  const [config, setConfig] = useState<ConfigInput>(DEFAULT_CONFIG);
  const m = useMutation({
    mutationFn: (c: ConfigInput) => {
      const { trainingSteps: _s, ...input } = c;
      return predictCost({ data: input });
    },
  });
  const r = m.data;

  return (
    <div className="space-y-6">
      <PageHeader title="Cost & Duration Prediction" description="Describe a job and get an estimate before any GPU is reserved." />
      <Panel title="Job settings" actions={<Button onClick={() => m.mutate(config)} disabled={m.isPending}>{m.isPending ? "Predicting…" : "Predict"}</Button>}>
        <ConfigForm value={config} onChange={setConfig} idPrefix="pred" />
      </Panel>
      {m.error ? <ErrorBlock error={m.error} /> : null}
      {!r ? (
        <EmptyState title="No prediction yet" description="Adjust the settings and press Predict." />
      ) : (
        <>
          {!r.analytical.feasible ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              This setup likely won't fit: {r.analytical.infeasibleReason}
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatTile label="Predicted cost" value={formatCurrency(r.predicted.cost)} hint={`95%: ${formatCurrency(r.predicted.costInterval.lower)} – ${formatCurrency(r.predicted.costInterval.upper)}`} tone="info" />
            <StatTile label="Predicted duration" value={formatHours(r.predicted.durationHours)} hint={`95%: ${formatHours(r.predicted.durationInterval.lower)} – ${formatHours(r.predicted.durationInterval.upper)}`} />
            <StatTile label="GPU hours" value={formatNumber(r.predicted.gpuHours, 1)} />
            <StatTile label="Per 1M tokens" value={formatCurrency(r.predicted.costPerMillionTokens, 3)} />
            <StatTile label="Model confidence" value={`${(r.predicted.confidence * 100).toFixed(0)}%`} tone={r.predicted.confidence > 0.8 ? "good" : "warn"} />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="Learned model vs physics estimate" description="The learned model is trained on past jobs; the physics estimate uses GPU throughput specs">
              <div className="grid grid-cols-3 gap-2 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                <span /> <span className="text-right">Learned</span><span className="text-right">Physics</span>
              </div>
              <Row label="Cost" a={formatCurrency(r.predicted.cost)} b={formatCurrency(r.analytical.cost)} />
              <Row label="Duration" a={formatHours(r.predicted.durationHours)} b={formatHours(r.analytical.durationHours)} />
              <Row label="GPU hours" a={formatNumber(r.predicted.gpuHours, 1)} b={formatNumber(r.analytical.gpuHours, 1)} />
              <Row label="Tokens / sec" a={formatNumber(r.predicted.tokensPerSecond)} b={formatNumber(r.analytical.tokensPerSecond)} />
              <Row label="Per 1M tokens" a={formatCurrency(r.predicted.costPerMillionTokens, 3)} b={formatCurrency(r.analytical.costPerMillionTokens, 3)} />
              <Row label="GPU utilization" a="—" b={`${r.analytical.gpuUtilization}%`} />
              <Row label="Memory utilization" a="—" b={`${r.analytical.memoryUtilization}%`} />
            </Panel>
            <Panel title="Models used">
              {(["cost", "duration"] as const).map((k) => {
                const mod = r.models[k];
                return (
                  <div key={k} className="mb-3 rounded-md border border-border bg-surface p-3 text-xs last:mb-0">
                    <p className="font-medium capitalize text-foreground">{k}: {mod.name} <span className="text-muted-foreground">v{mod.version}</span></p>
                    <p className="mt-1 font-mono text-muted-foreground">
                      R² {mod.metrics.r2.toFixed(3)} · MAE {formatNumber(mod.metrics.mae, 2)} · RMSE {formatNumber(mod.metrics.rmse, 2)} · MAPE {mod.metrics.mape.toFixed(1)}%
                    </p>
                  </div>
                );
              })}
              <p className="text-[11px] text-muted-foreground">Training steps are derived automatically: {formatNumber(r.input.trainingSteps)}.</p>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
