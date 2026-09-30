import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { CHART_COLORS, ChartFrame, Legend, axisProps, gridProps, tooltipStyles } from "@/components/charts/chart-kit";
import { ErrorBlock, LoadingBlock, PageHeader, Panel, StatTile } from "@/components/common/Panel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchGpuAnalytics } from "@/lib/api/acg.functions";
import { filtersKey, useAcgFilters } from "@/lib/filters-store";
import { formatCurrency, formatNumber } from "@/lib/format";

export const Route = createFileRoute("/gpu-analytics")({
  head: () => ({
    meta: [
      { title: "GPU Analytics — AIComputeGuard" },
      { name: "description", content: "Utilization, memory, power, idle time and efficiency per GPU type, model and cluster." },
      { property: "og:title", content: "GPU Analytics — AIComputeGuard" },
      { property: "og:description", content: "Fleet-wide GPU utilization, idle time and efficiency analytics." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GpuAnalyticsPage,
});

function heatTone(v: number) {
  const a = Math.max(0.06, Math.min(1, v / 100));
  return { background: `color-mix(in oklch, var(--color-primary) ${Math.round(a * 100)}%, transparent)` };
}

function GpuAnalyticsPage() {
  const { filters } = useAcgFilters();
  const { data, isPending, error } = useQuery({
    queryKey: ["gpu", filtersKey(filters)],
    queryFn: () => fetchGpuAnalytics({ data: filters }),
  });
  if (error) return <ErrorBlock error={error} />;
  if (isPending || !data) return <LoadingBlock label="Aggregating GPU telemetry…" />;

  const { fleet, perGpu, byModel, byCluster, byWorkload, heatmap } = data;
  const gpuTypes = [...new Set(heatmap.map((h) => h.gpuType))];
  const hours = [...new Set(heatmap.map((h) => h.hour))].sort((a, b) => a - b);

  return (
    <div className="space-y-6">
      <PageHeader title="GPU Analytics" description="How hard the fleet is actually working — and where GPU-hours are being paid for but not used." />
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Avg GPU utilization" value={`${fleet.avgUtilization}%`} tone={fleet.avgUtilization < 55 ? "warn" : "good"} />
        <StatTile label="Avg memory utilization" value={`${fleet.memoryUtilization}%`} />
        <StatTile label="GPU hours" value={formatNumber(fleet.gpuHours)} />
        <StatTile label="Idle GPU hours" value={formatNumber(fleet.idleHours)} tone="warn" />
        <StatTile label="Energy" value={`${formatNumber(fleet.energyKwh)} kWh`} />
        <StatTile label="Efficiency score" value={String(fleet.efficiencyScore)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Active vs idle GPU hours" description="By GPU type" actions={<Legend items={[{ label: "Active", color: CHART_COLORS[0]! }, { label: "Idle", color: CHART_COLORS[3]! }]} />}>
          <ChartFrame>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={perGpu}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="gpuType" {...axisProps} />
                <YAxis {...axisProps} />
                <Tooltip {...tooltipStyles} />
                <Bar dataKey="activeHours" name="Active" stackId="a" fill={CHART_COLORS[0]} isAnimationActive={false} />
                <Bar dataKey="idleHours" name="Idle" stackId="a" fill={CHART_COLORS[3]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        </Panel>
        <Panel title="Utilization by model" description="Mean GPU utilization, %">
          <ChartFrame>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byModel} layout="vertical" margin={{ left: 40 }}>
                <CartesianGrid {...gridProps} horizontal={false} vertical />
                <XAxis type="number" domain={[0, 100]} {...axisProps} />
                <YAxis type="category" dataKey="modelName" width={110} {...axisProps} />
                <Tooltip {...tooltipStyles} />
                <Bar dataKey="avgUtilization" name="Utilization %" fill={CHART_COLORS[1]} radius={[0, 4, 4, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        </Panel>
      </div>

      <Panel title="Utilization heatmap" description="Mean GPU utilization by GPU type and hour of day (job start, UTC)">
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0.5 text-[10px]">
            <thead>
              <tr>
                <th className="w-12" />
                {hours.map((h) => (
                  <th key={h} className="font-normal text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gpuTypes.map((g) => (
                <tr key={g}>
                  <td className="pr-2 text-right font-mono text-muted-foreground">{g}</td>
                  {hours.map((h) => {
                    const cell = heatmap.find((c) => c.gpuType === g && c.hour === h);
                    const v = cell?.utilization ?? 0;
                    return (
                      <td key={h} title={`${g} @ ${h}:00 — ${v}% across ${cell?.jobs ?? 0} jobs`} className="h-7 rounded-sm text-center font-mono text-foreground" style={heatTone(v)}>
                        {v ? v.toFixed(0) : ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="GPU type scorecard" bodyClassName="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              {["GPU", "VRAM", "$/h", "Jobs", "Avg util", "Peak util", "Mem util", "Avg power", "Temp", "GPU h", "Cost", "Efficiency"].map((h) => (
                <TableHead key={h}>{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {perGpu.map((g) => (
              <TableRow key={g.gpuType} className="font-mono text-xs">
                <TableCell>{g.spec.name}</TableCell>
                <TableCell>{g.spec.vramGb} GB</TableCell>
                <TableCell>{formatCurrency(g.spec.hourlyCost)}</TableCell>
                <TableCell>{formatNumber(g.jobs)}</TableCell>
                <TableCell>{g.avgUtilization}%</TableCell>
                <TableCell>{g.peakUtilization}%</TableCell>
                <TableCell>{g.memoryUtilization}%</TableCell>
                <TableCell>{g.avgPowerWatts} W</TableCell>
                <TableCell>{g.avgTemperatureC}°C</TableCell>
                <TableCell>{formatNumber(g.gpuHours)}</TableCell>
                <TableCell>{formatCurrency(g.cost)}</TableCell>
                <TableCell>{g.efficiencyScore}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Clusters" bodyClassName="p-0">
          <Table>
            <TableHeader>
              <TableRow>{["Cluster", "Jobs", "Util", "Idle", "GPU h", "Cost"].map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow>
            </TableHeader>
            <TableBody>
              {byCluster.map((c) => (
                <TableRow key={c.cluster} className="font-mono text-xs">
                  <TableCell>{c.cluster}</TableCell>
                  <TableCell>{formatNumber(c.jobs)}</TableCell>
                  <TableCell>{c.avgUtilization}%</TableCell>
                  <TableCell>{c.idleRatio}%</TableCell>
                  <TableCell>{formatNumber(c.gpuHours)}</TableCell>
                  <TableCell>{formatCurrency(c.cost)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
        <Panel title="Workload types" bodyClassName="p-0">
          <Table>
            <TableHeader>
              <TableRow>{["Type", "Jobs", "Util", "GPU h", "Cost", "Efficiency"].map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow>
            </TableHeader>
            <TableBody>
              {byWorkload.map((w) => (
                <TableRow key={w.workloadType} className="font-mono text-xs">
                  <TableCell>{w.workloadType}</TableCell>
                  <TableCell>{formatNumber(w.jobs)}</TableCell>
                  <TableCell>{w.avgUtilization}%</TableCell>
                  <TableCell>{formatNumber(w.gpuHours)}</TableCell>
                  <TableCell>{formatCurrency(w.cost)}</TableCell>
                  <TableCell>{w.efficiencyScore}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      </div>
    </div>
  );
}
