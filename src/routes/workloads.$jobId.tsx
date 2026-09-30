import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { CHART_COLORS, ChartFrame, Legend, axisProps, gridProps, tooltipStyles } from "@/components/charts/chart-kit";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, Panel, StatTile } from "@/components/common/Panel";
import { ToneBadge } from "@/components/common/SeverityBadge";
import { fetchWorkloadDetail } from "@/lib/api/acg.functions";
import { formatCurrency, formatDateTime, formatHours, formatNumber, formatTokens } from "@/lib/format";

export const Route = createFileRoute("/workloads/$jobId")({
  head: ({ params }) => ({
    meta: [
      { title: `Workload ${params.jobId} — AIComputeGuard` },
      { name: "description", content: `Telemetry, cost breakdown, anomalies and optimization for job ${params.jobId}.` },
      { property: "og:title", content: `Workload ${params.jobId} — AIComputeGuard` },
      { property: "og:description", content: "Per-job telemetry, anomalies and optimization advice." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WorkloadDetailPage,
});

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border/60 py-1.5 text-xs last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}

function WorkloadDetailPage() {
  const { jobId } = Route.useParams();
  const { data, isPending, error } = useQuery({
    queryKey: ["workload", jobId],
    queryFn: () => fetchWorkloadDetail({ data: { jobId } }),
  });

  if (error) return <ErrorBlock error={error} />;
  if (isPending || !data) return <LoadingBlock label="Loading job telemetry…" />;
  if (!data.found) return <EmptyState title="Workload not found" description={`No job with id ${jobId} exists in the dataset.`} />;

  const { job, telemetry, peerStats, anomalies, optimization } = data;
  const rec = optimization.recommended;

  return (
    <div className="space-y-6">
      <Link to="/workloads" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> All workloads
      </Link>
      <PageHeader
        title={job.jobId}
        description={`${job.modelName} · ${job.workloadType} · ${job.gpuCount}× ${job.gpuType} · ${job.cluster} (${job.region}) · owner ${job.owner}`}
        actions={<ToneBadge value={job.status} />}
      />
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Cost" value={formatCurrency(job.cost)} hint={`peer median ${formatCurrency(peerStats.medianCost)}`} tone={job.cost > peerStats.medianCost * 1.5 ? "bad" : "default"} />
        <StatTile label="Duration" value={formatHours(job.durationHours)} hint={`peer median ${formatHours(peerStats.medianDuration)}`} />
        <StatTile label="GPU utilization" value={`${(job.gpuUtilization * 100).toFixed(1)}%`} hint={`peer median ${peerStats.medianUtilization}%`} tone={job.gpuUtilization < 0.45 ? "warn" : "good"} />
        <StatTile label="Memory utilization" value={`${(job.memoryUtilization * 100).toFixed(1)}%`} tone={job.memoryUtilization > 0.92 ? "bad" : "default"} />
        <StatTile label="Tokens" value={formatTokens(job.tokens)} hint={`${formatNumber(job.tokensPerSecond)} tok/s`} />
        <StatTile label="Efficiency score" value={job.efficiencyScore.toFixed(0)} tone={job.efficiencyScore >= 70 ? "good" : job.efficiencyScore >= 50 ? "warn" : "bad"} />
      </div>

      <Panel
        title="Resource telemetry"
        description={`${telemetry.length} samples across the run`}
        actions={<Legend items={[{ label: "GPU", color: CHART_COLORS[0]! }, { label: "Memory", color: CHART_COLORS[1]! }, { label: "CPU", color: CHART_COLORS[2]! }, { label: "RAM", color: CHART_COLORS[3]! }]} />}
      >
        <ChartFrame>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={telemetry}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="t" tickFormatter={(v: number) => formatDateTime(v)} {...axisProps} minTickGap={40} />
              <YAxis unit="%" domain={[0, 100]} {...axisProps} />
              <Tooltip {...tooltipStyles} labelFormatter={(v) => formatDateTime(Number(v))} />
              <Line dataKey="gpuUtil" name="GPU" stroke={CHART_COLORS[0]} dot={false} strokeWidth={1.5} isAnimationActive={false} />
              <Line dataKey="memUtil" name="Memory" stroke={CHART_COLORS[1]} dot={false} strokeWidth={1.5} isAnimationActive={false} />
              <Line dataKey="cpuUtil" name="CPU" stroke={CHART_COLORS[2]} dot={false} strokeWidth={1.5} isAnimationActive={false} />
              <Line dataKey="ramUtil" name="RAM" stroke={CHART_COLORS[3]} dot={false} strokeWidth={1.5} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartFrame>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Configuration">
          <Row label="Parameters" value={`${job.paramsB}B`} />
          <Row label="Framework" value={job.framework} />
          <Row label="Batch size" value={String(job.batchSize)} />
          <Row label="Sequence length" value={formatNumber(job.sequenceLength)} />
          <Row label="Precision" value={job.precision} />
          <Row label="Epochs / steps" value={`${job.epochs} / ${formatNumber(job.trainingSteps)}`} />
          <Row label="CPU cores / RAM" value={`${job.cpuCores} / ${job.ramGb} GB`} />
          <Row label="Started" value={formatDateTime(job.startedAt)} />
          <Row label="Completed" value={job.completedAt ? formatDateTime(job.completedAt) : "—"} />
          <Row label="Retry of" value={job.retryOf ?? "—"} />
        </Panel>
        <Panel title="Cost breakdown">
          <Row label="GPU" value={formatCurrency(job.gpuCost)} />
          <Row label="CPU" value={formatCurrency(job.cpuCost)} />
          <Row label="Storage" value={formatCurrency(job.storageCost)} />
          <Row label="Network" value={formatCurrency(job.networkCost)} />
          <Row label="Per GPU-hour" value={formatCurrency(job.costPerGpuHour)} />
          <Row label="Per 1M tokens" value={formatCurrency(job.costPerMillionTokens, 3)} />
          <Row label="Per training step" value={formatCurrency(job.costPerTrainingStep, 5)} />
          <Row label="Idle hours" value={formatHours(job.idleHours)} />
          <Row label="Energy" value={`${formatNumber(job.energyKwh, 1)} kWh`} />
          <Row label="Avg power / temp" value={`${formatNumber(job.powerWatts)} W / ${job.temperatureC}°C`} />
        </Panel>
        <Panel title="Optimization opportunity" description="Coordinate-descent search over GPU, count, batch and precision">
          {rec ? (
            <div className="space-y-3 text-xs">
              <p className="font-mono text-2xl font-semibold text-success">{formatCurrency(rec.savings)}</p>
              <p className="text-muted-foreground">
                saved ({rec.savingsPct.toFixed(1)}%) by running on {rec.config.gpuCount}× {rec.config.gpuType}, batch {rec.config.batchSize}, {rec.config.precision}. Duration change {rec.durationDeltaPct >= 0 ? "+" : ""}
                {rec.durationDeltaPct.toFixed(1)}%.
              </p>
              <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                {rec.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
              <Row label="Current simulated cost" value={formatCurrency(optimization.currentCost)} />
            </div>
          ) : (
            <EmptyState title="Already near-optimal" description="No cheaper configuration satisfies the constraints." />
          )}
        </Panel>
      </div>

      <Panel title="Detected anomalies" description="Isolation forest + LOF + cohort rules">
        {anomalies.length === 0 ? (
          <EmptyState title="No anomalies for this job" />
        ) : (
          <div className="space-y-3">
            {anomalies.map((a) => (
              <div key={a.id} className="rounded-md border border-border bg-surface p-3 text-xs">
                <div className="flex items-center gap-2">
                  <ToneBadge value={a.severity} />
                  <span className="font-medium text-foreground">{a.metric}</span>
                  <span className="ml-auto font-mono text-muted-foreground">waste {formatCurrency(a.estimatedWaste)}</span>
                </div>
                <p className="mt-2 text-muted-foreground">{a.explanation}</p>
                <p className="mt-1"><span className="text-muted-foreground">Likely cause:</span> {a.likelyCause}</p>
                <p className="mt-1"><span className="text-muted-foreground">Action:</span> {a.recommendation}</p>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
