import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { EmptyState, ErrorBlock, PageHeader, Panel, StatTile } from "@/components/common/Panel";
import { ToneBadge } from "@/components/common/SeverityBadge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { generateReport } from "@/lib/api/acg.functions";
import { downloadText } from "@/lib/download";
import { useAcgFilters } from "@/lib/filters-store";
import { formatCurrency, formatDateTime, formatKpi, formatNumber } from "@/lib/format";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports — AIComputeGuard" },
      { name: "description", content: "Generate an executive AI compute report with spend, GPU efficiency, anomalies and savings." },
      { property: "og:title", content: "Reports — AIComputeGuard" },
      { property: "og:description", content: "Shareable AI infrastructure cost and efficiency reports." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReportsPage,
});

const SECTIONS = [
  ["executive-summary", "Executive summary"],
  ["infrastructure", "Infrastructure"],
  ["cost-analysis", "Cost analysis"],
  ["anomalies", "Anomalies"],
  ["predictions", "Prediction models"],
  ["optimization", "Recommendations"],
  ["savings", "Savings"],
] as const;

type Report = Awaited<ReturnType<typeof generateReport>>;

function toMarkdown(r: Report): string {
  const has = (s: string) => r.sections.includes(s);
  const out: string[] = [`# ${r.title}`, `Generated ${r.generatedAt}`, ""];
  if (has("executive-summary")) {
    out.push("## Executive summary", ...r.executiveSummary.kpis.map((k) => `- **${k.label}:** ${formatKpi(k.value, k.unit)} (${k.changePct >= 0 ? "+" : ""}${k.changePct.toFixed(1)}%)`), "", ...r.executiveSummary.insights.map((i) => `- ${i}`), "");
  }
  if (has("infrastructure")) {
    out.push("## Infrastructure", "| GPU | Jobs | GPU h | Idle h | Util | Cost |", "|---|---|---|---|---|---|", ...r.infrastructure.perGpu.map((g) => `| ${g.gpuType} | ${g.jobs} | ${g.gpuHours} | ${g.idleHours} | ${g.avgUtilization}% | ${formatCurrency(g.cost)} |`), "");
  }
  if (has("cost-analysis")) {
    out.push("## Cost analysis", `Total spend ${formatCurrency(r.costAnalysis.totals.totalSpend)}; forecast next 14 days ${formatCurrency(r.costAnalysis.totals.forecastedSpend)}.`, ...r.costAnalysis.breakdown.map((b) => `- ${b.category}: ${formatCurrency(b.amount)} (${b.share}%)`), "");
  }
  if (has("anomalies")) {
    out.push("## Anomalies", `${r.anomalies.stats.flagged} flagged (${r.anomalies.stats.critical} critical), est. waste ${formatCurrency(r.anomalies.stats.estimatedWaste)}.`, ...r.anomalies.items.map((a) => `- [${a.severity}] ${a.jobId}: ${a.title}`), "");
  }
  if (has("predictions")) out.push("## Prediction models", ...r.predictions.map((m) => `- ${m.target}: ${m.name} v${m.version}, R² ${m.metrics.r2.toFixed(3)}`), "");
  if (has("optimization")) out.push("## Recommendations", ...r.recommendations.map((x) => `- **${x.title}** — ${x.action} (save ~${formatCurrency(x.estimatedSavings)})`), "");
  if (has("savings")) out.push("## Savings", `Recoverable waste ${formatCurrency(r.savings.potential)} (${r.savings.share}% of spend).`, "");
  return out.join("\n");
}

function ReportsPage() {
  const { filters } = useAcgFilters();
  const [title, setTitle] = useState("AI Compute Intelligence Report");
  const [sections, setSections] = useState<string[]>(SECTIONS.map((s) => s[0]));
  const m = useMutation({ mutationFn: () => generateReport({ data: { ...filters, title, sections } }) });
  const r = m.data;
  const has = (s: string) => r?.sections.includes(s) ?? false;

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" description="Build a shareable summary for the current filter selection." />
      <Panel title="Report settings" actions={<Button onClick={() => m.mutate()} disabled={m.isPending || sections.length === 0}>{m.isPending ? "Generating…" : "Generate report"}</Button>}>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="rt" className="text-xs text-muted-foreground">Title</Label>
            <Input id="rt" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2 lg:col-span-2 sm:grid-cols-4">
            {SECTIONS.map(([id, label]) => (
              <label key={id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={sections.includes(id)} onCheckedChange={(c) => setSections((s) => (c ? [...s, id] : s.filter((x) => x !== id)))} />
                {label}
              </label>
            ))}
          </div>
        </div>
      </Panel>
      {m.error ? <ErrorBlock error={m.error} /> : null}
      {!r ? (
        <EmptyState title="No report yet" description="Pick sections and press Generate report." />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-xl font-semibold">{r.title}</h2>
              <p className="text-xs text-muted-foreground">Generated {formatDateTime(r.generatedAt)}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => downloadText("report.md", toMarkdown(r), "text/markdown")}>Download Markdown</Button>
              <Button variant="outline" size="sm" onClick={() => downloadText("report.json", JSON.stringify(r, null, 2), "application/json")}>Download JSON</Button>
              <Button variant="outline" size="sm" onClick={() => window.print()}>Print / PDF</Button>
            </div>
          </div>
          {has("executive-summary") ? (
            <Panel title="Executive summary">
              <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
                {r.executiveSummary.kpis.slice(0, 6).map((k) => <StatTile key={k.label} label={k.label} value={formatKpi(k.value, k.unit)} hint={`${k.changePct >= 0 ? "+" : ""}${k.changePct.toFixed(1)}% vs prior`} />)}
              </div>
              <ul className="mt-3 list-disc space-y-1 pl-4 text-sm text-muted-foreground">{r.executiveSummary.insights.map((i) => <li key={i}>{i}</li>)}</ul>
            </Panel>
          ) : null}
          {has("cost-analysis") ? (
            <Panel title="Cost analysis">
              <div className="grid gap-3 sm:grid-cols-3">
                <StatTile label="Total spend" value={formatCurrency(r.costAnalysis.totals.totalSpend)} />
                <StatTile label="14-day forecast" value={formatCurrency(r.costAnalysis.totals.forecastedSpend)} />
                <StatTile label="Per GPU-hour" value={formatCurrency(r.costAnalysis.totals.costPerGpuHour)} />
              </div>
              <div className="mt-3 space-y-1 text-xs">{r.costAnalysis.breakdown.map((b) => <div key={b.category} className="flex justify-between"><span>{b.category}</span><span className="font-mono">{formatCurrency(b.amount)} · {b.share}%</span></div>)}</div>
            </Panel>
          ) : null}
          {has("infrastructure") ? (
            <Panel title="Infrastructure">
              <div className="space-y-1 text-xs">{r.infrastructure.perGpu.map((g) => <div key={g.gpuType} className="flex justify-between"><span>{g.gpuType} · {g.jobs} jobs</span><span className="font-mono">{formatNumber(g.gpuHours)} GPU h · {g.avgUtilization}% util · {formatCurrency(g.cost)}</span></div>)}</div>
            </Panel>
          ) : null}
          {has("anomalies") ? (
            <Panel title="Anomalies" description={`${r.anomalies.stats.flagged} flagged · ${formatCurrency(r.anomalies.stats.estimatedWaste)} estimated waste`}>
              <div className="space-y-1.5 text-xs">{r.anomalies.items.map((a) => <div key={a.id} className="flex items-center gap-2"><ToneBadge value={a.severity} /><span className="font-mono">{a.jobId}</span><span className="text-muted-foreground">{a.title}</span></div>)}</div>
            </Panel>
          ) : null}
          {has("predictions") ? (
            <Panel title="Prediction models">
              <div className="space-y-1 text-xs">{r.predictions.map((p) => <div key={p.target} className="flex justify-between"><span className="capitalize">{p.target}: {p.name}</span><span className="font-mono">R² {p.metrics.r2.toFixed(3)} · MAPE {p.metrics.mape.toFixed(1)}%</span></div>)}</div>
            </Panel>
          ) : null}
          {has("optimization") ? (
            <Panel title="Recommendations">
              <div className="space-y-2 text-xs">{r.recommendations.map((x) => <div key={x.id}><span className="font-medium">{x.title}</span> <span className="font-mono text-success">{formatCurrency(x.estimatedSavings)}</span><p className="text-muted-foreground">{x.action}</p></div>)}</div>
            </Panel>
          ) : null}
          {has("savings") ? (
            <Panel title="Savings">
              <div className="grid gap-3 sm:grid-cols-3">
                <StatTile label="Recoverable waste" value={formatCurrency(r.savings.potential)} tone="warn" />
                <StatTile label="Share of spend" value={`${r.savings.share}%`} />
                <StatTile label="From recommendations" value={formatCurrency(r.savings.fromRecommendations)} tone="good" />
              </div>
            </Panel>
          ) : null}
        </div>
      )}
    </div>
  );
}
