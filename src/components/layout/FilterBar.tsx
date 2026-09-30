import { useQuery } from "@tanstack/react-query";
import { Filter, RotateCcw, Search } from "lucide-react";

import { fetchFacets } from "@/lib/api/acg.functions";
import { useAcgFilters } from "@/lib/filters-store";
import { INR_PER_USD } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const RANGES = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "60d", label: "Last 60 days" },
] as const;

export const facetsQueryOptions = {
  queryKey: ["facets"],
  queryFn: () => fetchFacets(),
  staleTime: Infinity,
};

function MultiSelect<T extends string>({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: T[];
  selected: T[] | undefined;
  onChange: (next: T[]) => void;
}) {
  const active = selected ?? [];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 justify-between gap-2 font-normal">
          {label}
          {active.length > 0 ? (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
              {active.length}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2">
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {options.map((option) => {
            const checked = active.includes(option);
            return (
              <label
                key={option}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={() =>
                    onChange(checked ? active.filter((v) => v !== option) : [...active, option])
                  }
                />
                <span className="truncate">{option}</span>
              </label>
            );
          })}
        </div>
        {active.length > 0 ? (
          <Button variant="ghost" size="sm" className="mt-1 w-full" onClick={() => onChange([])}>
            Clear
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export function FilterBar() {
  const { filters, patch, reset, activeCount } = useAcgFilters();
  const { data: facets } = useQuery(facetsQueryOptions);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filters.search ?? ""}
          onChange={(event) => patch({ search: event.target.value })}
          placeholder="Search job, model, owner…"
          className="h-9 w-56 pl-8"
          aria-label="Search workloads"
        />
      </div>

      <Select value={filters.range ?? "30d"} onValueChange={(value) => patch({ range: value as "30d" })}>
        <SelectTrigger className="h-9 w-[150px]" aria-label="Time range">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RANGES.map((range) => (
            <SelectItem key={range.value} value={range.value}>
              {range.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <MultiSelect
        label="GPU"
        options={(facets?.gpuTypes ?? []) as ("A100" | "H100" | "L40S" | "T4")[]}
        selected={filters.gpuTypes}
        onChange={(next) => patch({ gpuTypes: next })}
      />
      <MultiSelect
        label="Workload"
        options={(facets?.workloadTypes ?? []) as ("Training" | "Fine-tuning" | "Inference" | "Evaluation")[]}
        selected={filters.workloadTypes}
        onChange={(next) => patch({ workloadTypes: next })}
      />
      <MultiSelect
        label="Status"
        options={(facets?.statuses ?? []) as ("Running" | "Completed" | "Failed" | "Queued" | "Anomalous")[]}
        selected={filters.statuses}
        onChange={(next) => patch({ statuses: next })}
      />
      <MultiSelect
        label="Model"
        options={facets?.models ?? []}
        selected={filters.models}
        onChange={(next) => patch({ models: next })}
      />
      <MultiSelect
        label="Cluster"
        options={facets?.clusters ?? []}
        selected={filters.clusters}
        onChange={(next) => patch({ clusters: next })}
      />

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-9 gap-2 font-normal">
            <Filter className="size-3.5" />
            Thresholds
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 space-y-3 p-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[11px]">Min cost (₹)</Label>
              <Input
                type="number"
                value={filters.minCost == null ? "" : Number((filters.minCost * INR_PER_USD).toFixed(2))}
                onChange={(e) => patch({ minCost: e.target.value === "" ? null : Number(e.target.value) / INR_PER_USD })}
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Max cost (₹)</Label>
              <Input
                type="number"
                value={filters.maxCost == null ? "" : Number((filters.maxCost * INR_PER_USD).toFixed(2))}
                onChange={(e) => patch({ maxCost: e.target.value === "" ? null : Number(e.target.value) / INR_PER_USD })}
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Min utilization (%)</Label>
              <Input
                type="number"
                value={filters.minUtilization != null ? filters.minUtilization * 100 : ""}
                onChange={(e) =>
                  patch({ minUtilization: e.target.value === "" ? null : Number(e.target.value) / 100 })
                }
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Max utilization (%)</Label>
              <Input
                type="number"
                value={filters.maxUtilization != null ? filters.maxUtilization * 100 : ""}
                onChange={(e) =>
                  patch({ maxUtilization: e.target.value === "" ? null : Number(e.target.value) / 100 })
                }
                className="h-8"
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {activeCount > 0 ? (
        <Button variant="ghost" size="sm" className="h-9 gap-1.5" onClick={reset}>
          <RotateCcw className="size-3.5" />
          Reset
        </Button>
      ) : null}
    </div>
  );
}
