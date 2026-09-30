import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";

import { CHART_COLORS, ChartFrame, axisProps, gridProps, tooltipStyles } from "@/components/charts/chart-kit";
import { NativeSelect } from "@/components/common/ConfigForm";
import { ErrorBlock, LoadingBlock, PageHeader, Panel } from "@/components/common/Panel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchEda } from "@/lib/api/acg.functions";
import type { EDA_NUMERIC_FIELDS } from "@/lib/engine/analytics";
import { filtersKey, useAcgFilters } from "@/lib/filters-store";
import { formatNumber } from "@/lib/format";

export const Route = createFileRoute("/eda")({
  head: () => ({
    meta: [
      { title: "Exploratory Analysis — AIComputeGuard" },
      { name: "description", content: "Distributions, correlations and relationships across every workload metric." },
      { property: "og:title", content: "Exploratory Analysis — AIComputeGuard" },
      { property: "og:description", content: "Correlations, scatter plots and distributions of AI workload data." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EdaPage,
});

type Field = (typeof EDA_NUMERIC_FIELDS)[number];
const GPU_COLOR: Record<string, string> = { H100: CHART_COLORS[0]!, A100: CHART_COLORS[1]!, L40S: CHART_COLORS[2]!, T4: CHART_COLORS[3]! };

function corrStyle(v: number) {
  const pct = Math.round(Math.abs(v) * 90);
  const c = v >= 0 ? "var(--color-primary)" : "var(--color-destructive)";
  return { background: `color-mix(in oklch, ${c} ${pct}%, transparent)` };
}

function EdaPage() {
  const { filters } = useAcgFilters();
  const [x, setX] = useState<Field>("gpuCount");
  const [y, setY] = useState<Field>("cost");
  const { data, isPending, error } = useQuery({
    queryKey: ["eda", filtersKey(filters), x, y],
    queryFn: () => fetchEda({ data: { ...filters, x, y } }),
    placeholderData: keepPreviousData,
  });
  if (error) return <ErrorBlock error={error} />;
  if (isPending || !data) return <LoadingBlock label="Profiling workloads…" />;

  const gpus = [...new Set(data.scatter.points.map((p) => p.gpuType))];

  return (
    <div className="space-y-6">
      <PageHeader title="Exploratory Analysis" description={`${formatNumber(data.rowCount)} workloads in the current filter.`} />

      <Panel
        title="Relationship explorer"
        description={`Linear fit: y = ${data.scatter.fit.slope} x + ${data.scatter.fit.intercept} · R² ${data.scatter.fit.r2}`}
        actions={
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">X</span>
            <NativeSelect value={x} options={data.fields} onChange={(v) => setX(v as Field)} className="h-8 w-40" />
            <span className="text-muted-foreground">Y</span>
            <NativeSelect value={y} options={data.fields} onChange={(v) => setY(v as Field)} className="h-8 w-40" />
          </div>
        }
      >
        <ChartFrame height={320}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart>
              <CartesianGrid {...gridProps} />
              <XAxis type="number" dataKey="x" name={x} {...axisProps} />
              <YAxis type="number" dataKey="y" name={y} {...axisProps} />
              <Tooltip {...tooltipStyles} cursor={{ strokeDasharray: "3 3" }} />
              {gpus.map((g) => (
                <Scatter key={g} name={g} data={data.scatter.points.filter((p) => p.gpuType === g)} fill={GPU_COLOR[g] ?? CHART_COLORS[4]} fillOpacity={0.6} isAnimationActive={false} />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </ChartFrame>
      </Panel>

      <Panel title="Correlation matrix" description="Pearson correlation; blue = move together, red = move opposite">
        <div className="overflow-auto">
          <table className="text-[10px]">
            <thead>
              <tr>
                <th />
                {data.correlation.map((c) => <th key={c.key} className="h-24 w-10 align-bottom font-normal text-muted-foreground"><div className="w-10 origin-bottom-left -rotate-45 translate-x-3 whitespace-nowrap">{c.key}</div></th>)}
              </tr>
            </thead>
            <tbody>
              {data.correlation.map((row) => (
                <tr key={row.key}>
                  <td className="pr-2 text-right text-muted-foreground">{row.key}</td>
                  {row.values.map((v) => (
                    <td key={v.key} className="size-10 border border-background text-center font-mono text-foreground" style={corrStyle(v.value)} title={`${row.key} × ${v.key}: ${v.value.toFixed(2)}`}>
                      {v.value.toFixed(1)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Cost distribution">
          <ChartFrame height={240}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.histograms.cost}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="bin" {...axisProps} minTickGap={20} />
                <YAxis {...axisProps} />
                <Tooltip {...tooltipStyles} />
                <Bar dataKey="count" fill={CHART_COLORS[0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        </Panel>
        <Panel title="Daily trend" description="Spend and average GPU utilization">
          <ChartFrame height={240}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.timeSeries}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="date" {...axisProps} minTickGap={30} />
                <YAxis yAxisId="c" {...axisProps} />
                <YAxis yAxisId="u" orientation="right" unit="%" {...axisProps} />
                <Tooltip {...tooltipStyles} />
                <Line yAxisId="c" dataKey="cost" name="Spend" stroke={CHART_COLORS[0]} dot={false} isAnimationActive={false} />
                <Line yAxisId="u" dataKey="utilization" name="Util %" stroke={CHART_COLORS[2]} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartFrame>
        </Panel>
      </div>

      <Panel title="Summary statistics">
        <div className="overflow-auto">
          <Table>
            <TableHeader><TableRow>{["Field", "Count", "Mean", "Std", "Min", "P25", "Median", "P75", "P95", "Max"].map((h) => <TableHead key={h} className={h === "Field" ? "" : "text-right"}>{h}</TableHead>)}</TableRow></TableHeader>
            <TableBody>
              {data.summaries.map((s) => (
                <TableRow key={s.field}>
                  <TableCell className="font-mono text-xs">{s.field}</TableCell>
                  {[s.count, s.mean, s.std, s.min, s.p25, s.median, s.p75, s.p95, s.max].map((v, i) => (
                    <TableCell key={i} className="text-right font-mono text-xs">{formatNumber(v, Math.abs(v) < 10 ? 3 : 1)}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Panel>

      <Panel title="Spread and outliers">
        <Table>
          <TableHeader><TableRow>{["Metric", "Min", "Q1", "Median", "Q3", "Max", "Outliers"].map((h) => <TableHead key={h} className={h === "Metric" ? "" : "text-right"}>{h}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {data.boxes.map((b) => (
              <TableRow key={b.key}>
                <TableCell className="font-mono text-xs">{b.key}</TableCell>
                {[b.min, b.q1, b.median, b.q3, b.max].map((v, i) => <TableCell key={i} className="text-right font-mono text-xs">{formatNumber(v, 3)}</TableCell>)}
                <TableCell className="text-right font-mono text-xs">{b.outliers}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
    </div>
  );
}
