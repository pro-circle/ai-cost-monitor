import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { ConfigForm, DEFAULT_CONFIG } from "@/components/common/ConfigForm";
import { EmptyState, ErrorBlock, PageHeader, Panel, StatTile } from "@/components/common/Panel";
import { ToneBadge } from "@/components/common/SeverityBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { runOptimization, type ConfigInput } from "@/lib/api/acg.functions";
import { formatCurrency, formatHours } from "@/lib/format";

export const Route = createFileRoute("/optimize")({
  head: () => ({
    meta: [
      { title: "Optimization Engine — AIComputeGuard" },
      { name: "description", content: "Search GPU type, count, batch size and precision for the cheapest setup that meets your limits." },
      { property: "og:title", content: "Optimization Engine — AIComputeGuard" },
      { property: "og:description", content: "Find the cheapest GPU setup that still meets your deadlines." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OptimizePage,
});

function OptimizePage() {
  const [config, setConfig] = useState<ConfigInput>({ ...DEFAULT_CONFIG, gpuType: "H100", gpuCount: 16 });
  const [maxSlow, setMaxSlow] = useState(25);
  const [minUtil, setMinUtil] = useState(40);
  const [allowGpu, setAllowGpu] = useState(true);
  const [allowPrec, setAllowPrec] = useState(true);
  const m = useMutation({
    mutationFn: () =>
      runOptimization({
        data: {
          config,
          constraints: { maxDurationIncreasePct: maxSlow, minGpuUtilization: minUtil / 100, allowGpuTypeChange: allowGpu, allowPrecisionChange: allowPrec },
        },
      }),
  });
  const r = m.data;
  const rec = r?.recommended;

  return (
    <div className="space-y-6">
      <PageHeader title="Optimization Engine" description="Enter a planned job and your limits; we search every nearby setup for the cheapest one that still works." />
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Current plan" className="xl:col-span-2">
          <ConfigForm value={config} onChange={setConfig} idPrefix="opt" />
        </Panel>
        <Panel title="Limits" actions={<Button onClick={() => m.mutate()} disabled={m.isPending}>{m.isPending ? "Searching…" : "Optimize"}</Button>}>
          <div className="space-y-4 text-sm">
            <div className="space-y-1.5">
              <Label htmlFor="slow" className="text-xs text-muted-foreground">Max slowdown allowed (%)</Label>
              <Input id="slow" type="number" min={0} max={300} value={maxSlow} onChange={(e) => setMaxSlow(Math.min(300, Math.max(0, Number(e.target.value) || 0)))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="util" className="text-xs text-muted-foreground">Min GPU utilization (%)</Label>
              <Input id="util" type="number" min={0} max={100} value={minUtil} onChange={(e) => setMinUtil(Math.min(100, Math.max(0, Number(e.target.value) || 0)))} />
            </div>
            <div className="flex items-center justify-between"><Label htmlFor="ag">Allow changing GPU type</Label><Switch id="ag" checked={allowGpu} onCheckedChange={setAllowGpu} /></div>
            <div className="flex items-center justify-between"><Label htmlFor="ap">Allow changing precision</Label><Switch id="ap" checked={allowPrec} onCheckedChange={setAllowPrec} /></div>
          </div>
        </Panel>
      </div>
      {m.error ? <ErrorBlock error={m.error} /> : null}
      {!r ? (
        <EmptyState title="No search run yet" description="Press Optimize to find a cheaper setup." />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatTile label="Current cost" value={formatCurrency(r.current.result.cost)} hint={formatHours(r.current.result.durationHours)} />
            <StatTile label="Best cost" value={rec ? formatCurrency(rec.result.cost) : "—"} hint={rec ? formatHours(rec.result.durationHours) : "no cheaper setup"} tone="good" />
            <StatTile label="Savings" value={rec ? formatCurrency(rec.savings) : "$0"} hint={rec ? `${rec.savingsPct.toFixed(1)}%` : "—"} tone="good" />
            <StatTile label="Duration change" value={rec ? `${rec.durationDeltaPct >= 0 ? "+" : ""}${rec.durationDeltaPct.toFixed(1)}%` : "—"} tone={rec && rec.durationDeltaPct > 0 ? "warn" : "default"} />
            <StatTile label="Setups evaluated" value={String(r.searchSpaceSize)} />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="Recommended setup">
              {rec ? (
                <div className="space-y-2 text-xs">
                  <p className="font-mono text-lg text-foreground">{rec.config.gpuCount}× {rec.config.gpuType} · batch {rec.config.batchSize} · {rec.config.precision} · seq {rec.config.sequenceLength}</p>
                  <ul className="list-disc space-y-1 pl-4 text-muted-foreground">{rec.notes.map((n) => <li key={n}>{n}</li>)}</ul>
                  <p className="text-muted-foreground">Projected GPU utilization {(rec.result.gpuUtilization * 100).toFixed(1)}%, memory {(rec.result.memoryUtilization * 100).toFixed(1)}%.</p>
                </div>
              ) : (
                <EmptyState title="Already near-optimal" description="Loosen the limits to explore more options." />
              )}
            </Panel>
            <Panel title="Limit checks">
              <div className="space-y-2">
                {r.constraintReport.map((c) => (
                  <div key={c.constraint} className="flex items-center justify-between gap-2 text-xs">
                    <span>{c.constraint}<span className="block text-[11px] text-muted-foreground">{c.detail}</span></span>
                    <ToneBadge value={c.status === "met" ? "Completed" : c.status === "violated" ? "Failed" : "Queued"} className="normal-case" />
                  </div>
                ))}
              </div>
            </Panel>
          </div>
          {r.alternatives.length > 0 ? (
            <Panel title="Other good options">
              <Table>
                <TableHeader><TableRow><TableHead>Setup</TableHead><TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Savings</TableHead><TableHead className="text-right">Duration</TableHead><TableHead className="text-right">Util</TableHead></TableRow></TableHeader>
                <TableBody>
                  {r.alternatives.map((a, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">{a.config.gpuCount}× {a.config.gpuType} · b{a.config.batchSize} · {a.config.precision}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(a.result.cost)}</TableCell>
                      <TableCell className="text-right font-mono text-success">{a.savingsPct.toFixed(1)}%</TableCell>
                      <TableCell className="text-right font-mono">{a.durationDeltaPct >= 0 ? "+" : ""}{a.durationDeltaPct.toFixed(1)}%</TableCell>
                      <TableCell className="text-right font-mono">{(a.result.gpuUtilization * 100).toFixed(0)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Panel>
          ) : null}
        </>
      )}
    </div>
  );
}
