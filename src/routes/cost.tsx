import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { CHART_COLORS, ChartFrame, Legend, axisProps, gridProps, tooltipStyles } from "@/components/charts/chart-kit";
import { ErrorBlock, LoadingBlock, PageHeader, Panel, StatTile } from "@/components/common/Panel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchCostIntelligence } from "@/lib/api/acg.functions";
import { filtersKey, useAcgFilters } from "@/lib/filters-store";
import { formatCompactCurrency, formatCurrency, formatNumber } from "@/lib/format";

export const Route = createFileRoute("/cost")({
  head: () => ({
    meta: [
      { title: "Cost Intelligence — AIComputeGuard" },
      { name: "description", content: "Spend attribution, 14-day forecasting and wasted-compute recovery for AI workloads." },
      { property: "og:title", content: "Cost Intelligence — AIComputeGuard" },
      { property: "og:description", content: "Spend attribution, forecasting and waste recovery." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CostPage,
});

function CostPage() {
  const { filters } = useAcgFilters();
  const { data, isPending, error } = useQuery({
    queryKey: ["cost", filtersKey(filters)],
    queryFn: () => fetchCostIntelligence({ data: filters }),
  });
  if (error) return <ErrorBlock error={error} />;
  if (isPending || !data) return <LoadingBlock label="Attributing spend…" />;

  const { totals, dailySeries, forecast, breakdown, byGpuType, topExpensive, waste } = data;
  const change = totals.previousSpend ? ((totals.totalSpend - totals.previousSpend) / totals.previousSpend) * 100 : 0;
  const series = [
    ...dailySeries.map((d) => ({ date: d.date, cost: d.cost })),
    ...forecast.map((f) => ({ date: f.date, forecast: f.forecast, band: [f.lower, f.upper] as [number, number] })),
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Cost Intelligence" description="Where the money goes, where it's heading, and how much of it buys nothing." />
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Total spend" value={formatCurrency(totals.totalSpend)} hint={`${change >= 0 ? "+" : ""}${change.toFixed(1)}% vs prior`} tone={change > 10 ? "bad" : "default"} />
        <StatTile label="Daily run-rate" value={formatCurrency(totals.dailySpend)} hint={`${formatCurrency(totals.monthlySpend)} / month`} />
        <StatTile label="14-day forecast" value={formatCurrency(totals.forecastedSpend)} hint={`trend R² ${totals.trendR2}`} tone="info" />
        <StatTile label="Per GPU-hour" value={formatCurrency(totals.costPerGpuHour)} />
        <StatTile label="Per 1M tokens" value={formatCurrency(totals.costPerMillionTokens, 3)} />
        <StatTile label="Recoverable waste" value={formatCurrency(waste.totalWaste)} hint={`${waste.totalCost ? ((waste.totalWaste / waste.totalCost) * 100).toFixed(1) : 0}% of spend`} tone="warn" />
      </div>

      <Panel
        title="Daily spend and forecast"
        description="Linear trend with an 86–114% confidence band"
        actions={<Legend items={[{ label: "Actual", color: CHART_COLORS[0]! }, { label: "Forecast", color: CHART_COLORS[2]! }]} />}
      >
        <ChartFrame height={300}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={series}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" {...axisProps} minTickGap={30} />
               <YAxis {...axisProps} tickFormatter={formatCompactCurrency} />
              <Tooltip {...tooltipStyles} formatter={(v) => (Array.isArray(v) ? v.map((x) => formatCurrency(Number(x))).join(" – ") : formatCurrency(Number(v)))} />
              <Area dataKey="band" name="Range" fill={CHART_COLORS[2]} fillOpacity={0.15} stroke="none" isAnimationActive={false} />
              <Line dataKey="cost" name="Actual" stroke={CHART_COLORS[0]} dot={false} strokeWidth={1.5} isAnimationActive={false} />
              <Line dataKey="forecast" name="Forecast" stroke={CHART_COLORS[2]} strokeDasharray="4 3" dot={false} strokeWidth={1.5} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartFrame>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Spend by category" description="From billing records">
          <ChartFrame>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={breakdown} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid {...gridProps} horizontal={false} vertical />
                 <XAxis type="number" {...axisProps} tickFormatter={formatCompactCurrency} />
                <YAxis type="category" dataKey="category" {...axisProps} width={100} />
                <Tooltip {...tooltipStyles} formatter={(v) => formatCurrency(Number(v))} />
                <Bar dataKey="amount" name="Spend" fill={CHART_COLORS[0]} radius={[0, 4, 4, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        </Panel>
        <Panel title="Wasted compute" description="Estimated recoverable spend by cause">
          <div className="space-y-2">
            {waste.buckets.map((b) => {
              const pct = waste.totalWaste ? (b.waste / waste.totalWaste) * 100 : 0;
              return (
                <div key={b.key} className="text-xs">
                  <div className="flex justify-between gap-2">
                    <span className="text-foreground">{b.label} <span className="text-muted-foreground">· {b.jobs} jobs</span></span>
                    <span className="font-mono">{formatCurrency(b.waste)}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-surface">
                    <div className="h-full rounded-full bg-warning" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{b.detail}</p>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      <Panel title="Cost by GPU type">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>GPU</TableHead><TableHead className="text-right">Jobs</TableHead><TableHead className="text-right">GPU hours</TableHead>
              <TableHead className="text-right">Avg util</TableHead><TableHead className="text-right">List rate</TableHead>
              <TableHead className="text-right">Per 1M tokens</TableHead><TableHead className="text-right">Spend</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {byGpuType.map((g) => (
              <TableRow key={g.gpuType}>
                <TableCell className="font-medium">{g.gpuType}</TableCell>
                <TableCell className="text-right font-mono">{formatNumber(g.jobs)}</TableCell>
                <TableCell className="text-right font-mono">{formatNumber(g.gpuHours)}</TableCell>
                <TableCell className="text-right font-mono">{g.avgUtilization}%</TableCell>
                <TableCell className="text-right font-mono">{formatCurrency(g.hourlyRate)}/h</TableCell>
                <TableCell className="text-right font-mono">{formatCurrency(g.costPerMillionTokens, 3)}</TableCell>
                <TableCell className="text-right font-mono">{formatCurrency(g.cost)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>

      <Panel title="Most expensive workloads" description="Click a job for its full breakdown">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job</TableHead><TableHead>Model</TableHead><TableHead>Setup</TableHead>
              <TableHead className="text-right">Util</TableHead><TableHead className="text-right">Efficiency</TableHead>
              <TableHead className="text-right">Share</TableHead><TableHead className="text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {topExpensive.map((j) => (
              <TableRow key={j.jobId}>
                <TableCell><Link to="/workloads/$jobId" params={{ jobId: j.jobId }} className="font-mono text-primary hover:underline">{j.jobId}</Link></TableCell>
                <TableCell>{j.modelName}</TableCell>
                <TableCell className="text-muted-foreground">{j.workloadType} · {j.gpuCount}× {j.gpuType}</TableCell>
                <TableCell className="text-right font-mono">{j.gpuUtilization}%</TableCell>
                <TableCell className="text-right font-mono">{j.efficiencyScore}</TableCell>
                <TableCell className="text-right font-mono">{j.share}%</TableCell>
                <TableCell className="text-right font-mono">{formatCurrency(j.cost)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
    </div>
  );
}
