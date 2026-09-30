import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import { CHART_COLORS, ChartFrame, Legend, axisProps, gridProps, tooltipStyles } from "@/components/charts/chart-kit";
import { KpiCard } from "@/components/common/KpiCard";
import { EmptyState, ErrorBlock, LoadingBlock, Panel, PageHeader, StatTile } from "@/components/common/Panel";
import { Badge } from "@/components/ui/badge";
import { fetchDashboard } from "@/lib/api/acg.functions";
import { filtersKey, useAcgFilters } from "@/lib/filters-store";
import { formatCompact, formatCurrency, formatDate, formatDateTime, formatNumber } from "@/lib/format";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AIComputeGuard — AI Compute Cost & GPU Efficiency Dashboard" },
      {
        name: "description",
        content:
          "Executive dashboard for AI compute spend: GPU utilization, cost per million tokens, waste attribution, forecasts and optimization signals.",
      },
      { property: "og:title", content: "AIComputeGuard — AI Compute Cost Dashboard" },
      {
        property: "og:description",
        content: "Monitor GPU utilization, predict training cost and recover wasted compute spend.",
      },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { filters } = useAcgFilters();
  const { data, isPending, error } = useQuery({
    queryKey: ["dashboard", filtersKey(filters)],
    queryFn: () => fetchDashboard({ data: filters }),
  });

  if (error) return <ErrorBlock error={error} />;
  if (isPending || !data) return <LoadingBlock label="Aggregating workload telemetry…" rows={4} />;

  const utilizationBands = data.utilization;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compute Intelligence Dashboard"
        description={`Fleet posture for ${data.window.label} · ${formatNumber(data.counts.jobs)} workloads analysed`}
        actions={
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline" className="border-info/40 text-info">
              {formatNumber(data.counts.running)} running
            </Badge>
            <Badge variant="outline" className="border-destructive/40 text-destructive">
              {formatNumber(data.counts.failed)} failed
            </Badge>
            <Badge variant="outline" className="border-warning/40 text-warning">
              {formatNumber(data.counts.anomalous)} anomalous
            </Badge>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {data.kpis.map((kpi) => (
          <KpiCard key={kpi.key} kpi={kpi} />
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          title="GPU utilization over time"
          description="Bucketed mean, peak and floor utilization across the selected window"
          actions={
            <Legend
              items={[
                { label: "Peak", color: CHART_COLORS[1]! },
                { label: "Mean", color: CHART_COLORS[0]! },
                { label: "Min", color: CHART_COLORS[3]! },
              ]}
            />
          }
        >
          <ChartFrame>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={utilizationBands}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="t" tickFormatter={(v: number) => formatDateTime(v)} {...axisProps} minTickGap={32} />
                <YAxis unit="%" domain={[0, 100]} {...axisProps} />
                <Tooltip
                  {...tooltipStyles}
                  labelFormatter={(v) => formatDateTime(Number(v))}
                  formatter={(value: number, name) => [`${value}%`, String(name)]}
                />
                <Area
                  type="monotone"
                  dataKey="peak"
                  stroke={CHART_COLORS[1]}
                  fill={CHART_COLORS[1]}
                  fillOpacity={0.12}
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="avg"
                  stroke={CHART_COLORS[0]}
                  fill={CHART_COLORS[0]}
                  fillOpacity={0.22}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="min"
                  stroke={CHART_COLORS[3]}
                  fill="transparent"
                  strokeWidth={1}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartFrame>
        </Panel>

        <Panel
          title="Daily spend and OLS trend"
          description={`Least-squares trend R² ${data.costTrend.trendR2} · slope ${formatCurrency(data.costTrend.trendSlopePerDay)}/day`}
        >
          <ChartFrame>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data.costTrend.daily}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="date" tickFormatter={(v: string) => formatDate(v)} {...axisProps} minTickGap={28} />
                <YAxis {...axisProps} tickFormatter={(v: number) => `$${formatCompact(v)}`} />
                <Tooltip {...tooltipStyles} formatter={(value: number, name) => [formatCurrency(value), String(name)]} />
                <Bar dataKey="cost" name="Spend" fill={CHART_COLORS[0]} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                <Line
                  type="monotone"
                  dataKey="trend"
                  name="Trend"
                  stroke={CHART_COLORS[4]}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartFrame>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <StatTile label="Weekly run-rate" value={formatCurrency(data.costTrend.weekly)} />
            <StatTile label="30-day projection" value={formatCurrency(data.costTrend.monthlyProjection)} tone="info" />
            <StatTile label="Days observed" value={formatNumber(data.costTrend.daily.length)} />
          </div>
        </Panel>

        <Panel title="Cost by GPU type" description="Spend, GPU-hours and unit economics per accelerator class">
          <ChartFrame height={260}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.costByGpuType}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="gpuType" {...axisProps} />
                <YAxis {...axisProps} tickFormatter={(v: number) => `$${formatCompact(v)}`} />
                <Tooltip {...tooltipStyles} formatter={(value: number) => formatCurrency(value)} />
                <Bar dataKey="cost" name="Spend" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                  {data.costByGpuType.map((row, i) => (
                    <Cell key={row.gpuType} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {data.costByGpuType.map((row) => (
              <StatTile
                key={row.gpuType}
                label={`${row.gpuType} · ${formatNumber(row.jobs)} jobs`}
                value={`$${row.costPerMillionTokens}/1M tok`}
                hint={`${row.avgUtilization}% util · ${formatNumber(row.gpuHours)} GPU-h`}
              />
            ))}
          </div>
        </Panel>

        <Panel title="Cost vs tokens processed" description="Per-workload unit economics; colour encodes accelerator">
          <ChartFrame height={260}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart>
                <CartesianGrid {...gridProps} />
                <XAxis
                  dataKey="tokensM"
                  name="Tokens (M)"
                  type="number"
                  {...axisProps}
                  tickFormatter={(v: number) => formatCompact(v)}
                />
                <YAxis
                  dataKey="cost"
                  name="Cost"
                  type="number"
                  {...axisProps}
                  tickFormatter={(v: number) => `$${formatCompact(v)}`}
                />
                <ZAxis dataKey="utilization" range={[20, 120]} />
                <Tooltip
                  {...tooltipStyles}
                  formatter={(value: number, name) =>
                    name === "Cost" ? formatCurrency(value) : `${formatCompact(value)}`
                  }
                />
                {["H100", "A100", "L40S", "T4"].map((gpu, i) => (
                  <Scatter
                    key={gpu}
                    name={gpu}
                    data={data.costVsTokens.filter((p) => p.gpuType === gpu)}
                    fill={CHART_COLORS[i % CHART_COLORS.length]}
                    fillOpacity={0.65}
                    isAnimationActive={false}
                  />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </ChartFrame>
          <Legend
            items={["H100", "A100", "L40S", "T4"].map((gpu, i) => ({
              label: gpu,
              color: CHART_COLORS[i % CHART_COLORS.length]!,
            }))}
          />
        </Panel>

        <Panel title="Utilization distribution" description="Histogram of mean GPU utilization per workload">
          <ChartFrame height={240}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.utilizationHistogram}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="bin" {...axisProps} interval={1} />
                <YAxis {...axisProps} />
                <Tooltip {...tooltipStyles} formatter={(value: number) => [formatNumber(value), "Workloads"]} />
                <Bar dataKey="count" radius={[2, 2, 0, 0]} isAnimationActive={false}>
                  {data.utilizationHistogram.map((bin) => (
                    <Cell
                      key={bin.bin}
                      fill={bin.from < 40 ? "var(--color-destructive)" : bin.from < 70 ? "var(--color-warning)" : "var(--color-success)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        </Panel>

        <Panel
          title="Scaling behaviour: duration vs GPU count"
          description="Median wall-clock duration and average cost by device count (training and fine-tuning)"
        >
          <ChartFrame height={240}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data.trainingTimeVsGpuCount}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="gpuCount" {...axisProps} />
                <YAxis yAxisId="left" {...axisProps} unit="h" />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  {...axisProps}
                  tickFormatter={(v: number) => `$${formatCompact(v)}`}
                />
                <Tooltip {...tooltipStyles} />
                <Bar
                  yAxisId="left"
                  dataKey="medianDuration"
                  name="Median duration (h)"
                  fill={CHART_COLORS[2]}
                  radius={[2, 2, 0, 0]}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="avgCost"
                  name="Avg cost"
                  stroke={CHART_COLORS[4]}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartFrame>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
        <Panel title="Cost composition" description="Billing categories attributed to workloads in range">
          {data.costBreakdown.length === 0 ? (
            <EmptyState title="No billing records in this window" />
          ) : (
            <div className="grid gap-4 md:grid-cols-[220px_1fr] md:items-center">
              <ChartFrame height={220}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.costBreakdown}
                      dataKey="amount"
                      nameKey="category"
                      innerRadius={52}
                      outerRadius={84}
                      paddingAngle={2}
                      isAnimationActive={false}
                    >
                      {data.costBreakdown.map((row, i) => (
                        <Cell key={row.category} fill={CHART_COLORS[i % CHART_COLORS.length]} stroke="var(--color-card)" />
                      ))}
                    </Pie>
                    <Tooltip {...tooltipStyles} formatter={(value: number) => formatCurrency(value)} />
                  </PieChart>
                </ResponsiveContainer>
              </ChartFrame>
              <ul className="space-y-1.5">
                {data.costBreakdown.map((row, i) => (
                  <li key={row.category} className="flex items-center gap-2 text-sm">
                    <span
                      className="size-2.5 rounded-sm"
                      style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                      aria-hidden
                    />
                    <span className="flex-1 truncate text-muted-foreground">{row.category}</span>
                    <span className="font-mono tabular-nums text-foreground">{formatCurrency(row.amount)}</span>
                    <span className="w-12 text-right font-mono text-xs text-muted-foreground">{row.share}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        <Panel title="Diagnostic insights" description="Generated from the current filtered population">
          <ul className="space-y-2">
            {data.insights.map((insight) => (
              <li key={insight.id} className="rounded-md border border-border bg-surface px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                    {insight.category}
                  </Badge>
                  <span className="font-mono text-xs text-muted-foreground">impact {insight.magnitude}</span>
                </div>
                <p className="mt-1.5 text-sm text-foreground">{insight.text}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
