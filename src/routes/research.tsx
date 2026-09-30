import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { CHART_COLORS, ChartFrame, axisProps, gridProps, tooltipStyles } from "@/components/charts/chart-kit";
import { ErrorBlock, LoadingBlock, PageHeader, Panel } from "@/components/common/Panel";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchModels, fetchRecommendations, trainCostModels } from "@/lib/api/acg.functions";
import { filtersKey, useAcgFilters } from "@/lib/filters-store";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/format";

export const Route = createFileRoute("/research")({
  head: () => ({
    meta: [
      { title: "Research Mode — AIComputeGuard" },
      { name: "description", content: "Compare prediction algorithms, inspect feature importance and retrain models on the latest data." },
      { property: "og:title", content: "Research Mode — AIComputeGuard" },
      { property: "og:description", content: "Model benchmarking, feature importance and recommendations." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResearchPage,
});

type Report = Awaited<ReturnType<typeof fetchModels>>["costReports"][number];

function Leaderboard({ title, reports }: { title: string; reports: Report[] }) {
  const selected = reports.find((r) => r.selected) ?? reports[0];
  return (
    <Panel title={title} description={selected ? `Selected: ${selected.name}` : undefined}>
      <Table>
        <TableHeader><TableRow><TableHead>Algorithm</TableHead><TableHead className="text-right">R²</TableHead><TableHead className="text-right">MAE</TableHead><TableHead className="text-right">RMSE</TableHead><TableHead className="text-right">MAPE</TableHead><TableHead className="text-right">Train / test</TableHead></TableRow></TableHeader>
        <TableBody>
          {reports.map((r) => (
            <TableRow key={r.name} className={r.selected ? "bg-primary/5" : ""}>
              <TableCell className="text-xs"><span className="font-medium">{r.name}</span> <span className="text-muted-foreground">{r.algorithm}</span></TableCell>
              <TableCell className="text-right font-mono text-xs">{r.metrics.r2.toFixed(3)}</TableCell>
              <TableCell className="text-right font-mono text-xs">{formatNumber(r.metrics.mae, 2)}</TableCell>
              <TableCell className="text-right font-mono text-xs">{formatNumber(r.metrics.rmse, 2)}</TableCell>
              <TableCell className="text-right font-mono text-xs">{r.metrics.mape.toFixed(1)}%</TableCell>
              <TableCell className="text-right font-mono text-xs">{r.trainSize}/{r.testSize}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {selected ? (
        <ChartFrame height={Math.max(160, selected.featureImportance.slice(0, 10).length * 22)}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={selected.featureImportance.slice(0, 10)} layout="vertical" margin={{ left: 30, top: 12 }}>
              <CartesianGrid {...gridProps} horizontal={false} vertical />
              <XAxis type="number" {...axisProps} />
              <YAxis type="category" dataKey="feature" {...axisProps} width={120} />
              <Tooltip {...tooltipStyles} formatter={(v) => Number(v).toFixed(3)} />
              <Bar dataKey="importance" fill={CHART_COLORS[1]} radius={[0, 4, 4, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>
      ) : null}
    </Panel>
  );
}

function ResearchPage() {
  const qc = useQueryClient();
  const { filters } = useAcgFilters();
  const models = useQuery({ queryKey: ["models"], queryFn: () => fetchModels() });
  const recs = useQuery({ queryKey: ["recs", filtersKey(filters)], queryFn: () => fetchRecommendations({ data: filters }) });
  const retrain = useMutation({ mutationFn: () => trainCostModels(), onSuccess: () => void qc.invalidateQueries({ queryKey: ["models"] }) });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Research Mode"
        description="How the prediction models are built, how they compare, and what drives cost."
        actions={<Button onClick={() => retrain.mutate()} disabled={retrain.isPending}>{retrain.isPending ? "Retraining…" : "Retrain models"}</Button>}
      />
      {retrain.data ? <p className="text-xs text-success">Retrained on {formatNumber(retrain.data.cost.rows)} jobs at {formatDateTime(retrain.data.trainedAt)} — cost model v{retrain.data.cost.version}, duration model v{retrain.data.duration.version}.</p> : null}
      {retrain.error ? <ErrorBlock error={retrain.error} /> : null}
      {models.error ? <ErrorBlock error={models.error} /> : null}
      {!models.data ? (
        <LoadingBlock label="Loading model registry…" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {models.data.models.map((m) => (
              <div key={m.target} className="rounded-md border border-border bg-surface p-3 text-xs">
                <p className="font-medium capitalize text-foreground">{m.target} model · {m.name} v{m.version}</p>
                <p className="mt-1 text-muted-foreground">Trained {formatDateTime(m.trainedAt)} on {formatNumber(m.rows)} jobs · {m.features.length} features · R² {m.metrics.r2.toFixed(3)}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Leaderboard title="Cost prediction benchmark" reports={models.data.costReports} />
            <Leaderboard title="Duration prediction benchmark" reports={models.data.durationReports} />
          </div>
        </>
      )}
      <Panel title="Recommendations" description="Ranked by estimated savings for the current filter">
        {recs.isPending ? (
          <LoadingBlock rows={2} />
        ) : recs.error ? (
          <ErrorBlock error={recs.error} />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {recs.data.recommendations.map((r) => (
              <div key={r.id} className="rounded-md border border-border bg-surface p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{r.title}</span>
                  <span className="font-mono text-success">{formatCurrency(r.estimatedSavings)}</span>
                </div>
                <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">{r.category} · {(r.confidence * 100).toFixed(0)}% confidence · {r.jobIds.length} jobs</p>
                <p className="mt-2 text-muted-foreground">{r.reason}</p>
                <p className="mt-1"><span className="text-muted-foreground">Do:</span> {r.action}</p>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
