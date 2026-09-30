import type { GpuTypeId, JobStatus, TrainingJob, WorkloadType } from "./types";

export type RangeKey = "24h" | "7d" | "30d" | "60d" | "custom";

export interface Filters {
  range?: RangeKey;
  from?: string | null;
  to?: string | null;
  gpuTypes?: GpuTypeId[];
  workloadTypes?: WorkloadType[];
  models?: string[];
  statuses?: JobStatus[];
  clusters?: string[];
  minCost?: number | null;
  maxCost?: number | null;
  minUtilization?: number | null;
  maxUtilization?: number | null;
  search?: string | null;
}

export const RANGE_HOURS: Record<Exclude<RangeKey, "custom">, number> = {
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
  "60d": 24 * 60,
};

export interface ResolvedWindow {
  fromMs: number;
  toMs: number;
  prevFromMs: number;
  prevToMs: number;
  label: string;
}

export function resolveWindow(filters: Filters, windowEndIso: string): ResolvedWindow {
  const endMs = Date.parse(windowEndIso);
  const range = filters.range ?? "30d";
  if (range === "custom" && filters.from && filters.to) {
    const fromMs = Date.parse(filters.from);
    const toMs = Date.parse(filters.to);
    const span = Math.max(1, toMs - fromMs);
    return { fromMs, toMs, prevFromMs: fromMs - span, prevToMs: fromMs, label: "custom range" };
  }
  const hours = RANGE_HOURS[(range === "custom" ? "30d" : range) as Exclude<RangeKey, "custom">];
  const span = hours * 3600_000;
  return {
    fromMs: endMs - span,
    toMs: endMs,
    prevFromMs: endMs - 2 * span,
    prevToMs: endMs - span,
    label: range === "custom" ? "30d" : range,
  };
}

function inList<T>(list: T[] | undefined, value: T): boolean {
  return !list || list.length === 0 || list.includes(value);
}

export function matchesFilters(job: TrainingJob, filters: Filters): boolean {
  if (!inList(filters.gpuTypes, job.gpuType)) return false;
  if (!inList(filters.workloadTypes, job.workloadType)) return false;
  if (!inList(filters.models, job.modelName)) return false;
  if (!inList(filters.statuses, job.status)) return false;
  if (!inList(filters.clusters, job.cluster)) return false;
  if (filters.minCost != null && job.cost < filters.minCost) return false;
  if (filters.maxCost != null && job.cost > filters.maxCost) return false;
  if (filters.minUtilization != null && job.gpuUtilization * 100 < filters.minUtilization) return false;
  if (filters.maxUtilization != null && job.gpuUtilization * 100 > filters.maxUtilization) return false;
  if (filters.search) {
    const q = filters.search.toLowerCase();
    const haystack = `${job.jobId} ${job.modelName} ${job.owner} ${job.cluster} ${job.gpuType} ${job.workloadType}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

export interface FilteredJobs {
  current: TrainingJob[];
  previous: TrainingJob[];
  window: ResolvedWindow;
}

export function applyFilters(jobs: TrainingJob[], filters: Filters, windowEndIso: string): FilteredJobs {
  const window = resolveWindow(filters, windowEndIso);
  const current: TrainingJob[] = [];
  const previous: TrainingJob[] = [];
  for (const job of jobs) {
    if (!matchesFilters(job, filters)) continue;
    const t = Date.parse(job.startedAt);
    if (t >= window.fromMs && t <= window.toMs) current.push(job);
    else if (t >= window.prevFromMs && t < window.prevToMs) previous.push(job);
  }
  return { current, previous, window };
}
