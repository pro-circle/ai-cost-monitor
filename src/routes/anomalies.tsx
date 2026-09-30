import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { CHART_COLORS, ChartFrame, axisProps, gridProps, tooltipStyles } from "@/components/charts/chart-kit";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, Panel, StatTile } from "@/components/common/Panel";
import { ToneBadge } from "@/components/common/SeverityBadge";
import { Button } from "@/components/ui/button";
import { fetchAnomalies } from "@/lib/api/acg.functions";
import { filtersKey, useAcgFilters } from "@/lib/filters-store";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/format";

export const Route = createFileRoute("/anomalies")({
  head: () => ({
    meta: [
      { title: "Anomaly Detection — AIComputeGuard" },
      { name: "description", content: "Isolation forest, LOF and cohort rules flag wasteful or failing AI workloads." },
      { property: "og:title", content: "Anomaly Detection — AIComputeGuard" },
      { property: "og:description", content: "Automatically flagged GPU workloads with causes and fixes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AnomaliesPage,
});

const SEVERITIES = ["all", "critical", "warning", "info"] as const;
const label = (k: string) => k.replace(/_/g, " ");

function AnomaliesPage() {
  const { filters } = useAcgFilters();
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>("all");
  const [kind, setKind] = useState<string | null>(null);
  const { data, isPending, error } = useQuery({
    queryKey: ["anomalies", filtersKey(filters)],
    queryFn: () => fetchAnomalies({ data: { ...filters, limit: 300 } }),
  });
  if (error) return <ErrorBlock error={error} />;
  if (isPending || !data) return <LoadingBlock label="Scoring workloads…" />;

  const { stats, byKind, anomalies } = data;
  const shown = anomalies.filter((a) => (severity === "all" || a.severity === severity) && (!kind || a.kind === kind));

  return (
    <div className="space-y-6">
      <PageHeader title="Anomaly Detection" description="Jobs that behave unlike their peers — with the likely cause and what to do about it." />
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Jobs scanned" value={formatNumber(stats.scanned)} />
        <StatTile label="Flagged" value={formatNumber(stats.flagged)} hint={`${(stats.contamination * 100).toFixed(1)}% of jobs`} />
        <StatTile label="Critical" value={formatNumber(stats.critical)} tone="bad" />
        <StatTile label="Warning" value={formatNumber(stats.warning)} tone="warn" />
        <StatTile label="Info" value={formatNumber(stats.info)} tone="info" />
        <StatTile label="Estimated waste" value={formatCurrency(stats.estimatedWaste)} tone="warn" />
      </div>

      <Panel title="Anomalies by type" description="Click a bar to filter the list">
        <ChartFrame height={220}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byKind.map((b) => ({ ...b, name: label(b.kind) }))}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="name" {...axisProps} interval={0} tick={{ ...axisProps.tick, fontSize: 10 }} />
              <YAxis {...axisProps} allowDecimals={false} />
              <Tooltip {...tooltipStyles} />
              <Bar
                dataKey="count"
                name="Jobs"
                fill={CHART_COLORS[3]}
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
                cursor="pointer"
                onClick={(d: { kind?: string }) => setKind((k) => (k === d.kind ? null : (d.kind ?? null)))}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>
      </Panel>

      <Panel
        title={`Flagged workloads (${shown.length})`}
        description={kind ? `Showing ${label(kind)} only` : "Sorted by anomaly score"}
        actions={
          <div className="flex flex-wrap gap-1">
            {SEVERITIES.map((s) => (
              <Button key={s} size="sm" variant={severity === s ? "default" : "outline"} onClick={() => setSeverity(s)} className="h-7 capitalize">
                {s}
              </Button>
            ))}
            {kind ? <Button size="sm" variant="ghost" className="h-7" onClick={() => setKind(null)}>Clear type</Button> : null}
          </div>
        }
      >
        {shown.length === 0 ? (
          <EmptyState title="Nothing matches" description="Try another severity or clear the type filter." />
        ) : (
          <div className="space-y-3">
            {shown.slice(0, 80).map((a) => (
              <div key={a.id} className="rounded-md border border-border bg-surface p-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <ToneBadge value={a.severity} />
                  <span className="font-medium text-foreground">{a.title}</span>
                  <Link to="/workloads/$jobId" params={{ jobId: a.jobId }} className="font-mono text-primary hover:underline">{a.jobId}</Link>
                  <span className="text-muted-foreground">{formatDateTime(a.timestamp)}</span>
                  <span className="ml-auto font-mono text-muted-foreground">score {a.score.toFixed(2)} · waste {formatCurrency(a.estimatedWaste)}</span>
                </div>
                <p className="mt-2 text-muted-foreground">
                  {a.metric}: <span className="font-mono text-foreground">{a.observed}{a.unit}</span> (expected {a.expectedMin}–{a.expectedMax}{a.unit}). {a.explanation}
                </p>
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
