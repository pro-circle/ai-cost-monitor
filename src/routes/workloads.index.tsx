import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Download } from "lucide-react";
import { useState } from "react";

import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, Panel, StatTile } from "@/components/common/Panel";
import { ToneBadge } from "@/components/common/SeverityBadge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchWorkloads } from "@/lib/api/acg.functions";
import { filtersKey, useAcgFilters } from "@/lib/filters-store";
import { formatCurrency, formatDateTime, formatHours, formatNumber, formatTokens } from "@/lib/format";

export const Route = createFileRoute("/workloads/")({
  head: () => ({
    meta: [
      { title: "Workload Management — AIComputeGuard" },
      { name: "description", content: "Searchable inventory of every training, fine-tuning and inference job with cost and efficiency." },
      { property: "og:title", content: "Workload Management — AIComputeGuard" },
      { property: "og:description", content: "Searchable inventory of every AI compute job with cost and efficiency." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WorkloadsPage,
});

const COLUMNS: { key: string; label: string; align?: "right" }[] = [
  { key: "jobId", label: "Job" },
  { key: "modelName", label: "Model" },
  { key: "workloadType", label: "Type" },
  { key: "gpuType", label: "GPU" },
  { key: "gpuCount", label: "GPUs", align: "right" },
  { key: "status", label: "Status" },
  { key: "startedAt", label: "Started" },
  { key: "durationHours", label: "Duration", align: "right" },
  { key: "tokens", label: "Tokens", align: "right" },
  { key: "gpuUtilization", label: "GPU util", align: "right" },
  { key: "efficiencyScore", label: "Eff.", align: "right" },
  { key: "cost", label: "Cost", align: "right" },
];

function WorkloadsPage() {
  const { filters } = useAcgFilters();
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState("cost");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const pageSize = 25;

  const { data, isPending, error, isFetching } = useQuery({
    queryKey: ["workloads", filtersKey(filters), page, sortBy, sortDir],
    queryFn: () => fetchWorkloads({ data: { ...filters, page, pageSize, sortBy, sortDir } }),
    placeholderData: keepPreviousData,
  });

  const toggleSort = (key: string) => {
    if (key === sortBy) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortBy(key);
      setSortDir("desc");
    }
    setPage(1);
  };

  const exportCsv = () => {
    if (!data) return;
    const header = COLUMNS.map((c) => c.key).join(",");
    const lines = data.rows.map((r) => COLUMNS.map((c) => JSON.stringify((r as unknown as Record<string, unknown>)[c.key] ?? "")).join(","));
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `workloads_page_${page}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (error) return <ErrorBlock error={error} />;
  if (isPending || !data) return <LoadingBlock label="Loading workload inventory…" />;

  const pages = Math.max(1, Math.ceil(data.total / pageSize));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workload Management"
        description="Every job in the selected window. Use the filter bar to narrow down, click a column to sort, and open a job for its full diagnosis."
        actions={
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="size-4" /> Export page
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Matching workloads" value={formatNumber(data.total)} />
        <StatTile label="Total cost" value={formatCurrency(data.totals.cost)} />
        <StatTile label="GPU hours / avg efficiency" value={`${formatNumber(data.totals.gpuHours)} h · ${data.totals.avgEfficiency}`} />
      </div>
      <Panel bodyClassName="p-0" title="Job inventory" description={isFetching ? "Refreshing…" : `Page ${page} of ${pages}`}>
        {data.rows.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No workloads match these filters" description="Widen the date range or clear some filters." />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {COLUMNS.map((c) => (
                  <TableHead key={c.key} className={c.align === "right" ? "text-right" : undefined}>
                    <button type="button" onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 hover:text-foreground">
                      {c.label}
                      {sortBy === c.key ? sortDir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : null}
                    </button>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((j) => (
                <TableRow key={j.jobId}>
                  <TableCell className="font-mono text-xs">
                    <Link to="/workloads/$jobId" params={{ jobId: j.jobId }} className="text-primary hover:underline">
                      {j.jobId}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs">{j.modelName}</TableCell>
                  <TableCell className="text-xs">{j.workloadType}</TableCell>
                  <TableCell className="text-xs">{j.gpuType}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{j.gpuCount}</TableCell>
                  <TableCell><ToneBadge value={j.status} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDateTime(j.startedAt)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{formatHours(j.durationHours)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{formatTokens(j.tokens)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{(j.gpuUtilization * 100).toFixed(1)}%</TableCell>
                  <TableCell className="text-right font-mono text-xs">{j.efficiencyScore.toFixed(0)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{formatCurrency(j.cost)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
          <span>
            Showing {formatNumber((page - 1) * pageSize + 1)}–{formatNumber(Math.min(page * pageSize, data.total))} of {formatNumber(data.total)}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      </Panel>
    </div>
  );
}
