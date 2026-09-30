import type { Filters } from "@/lib/engine/filters";
import type { WorkloadQuery } from "@/lib/engine/analytics";

/** Drops undefined keys so objects satisfy exactOptionalPropertyTypes. */
function compact<T extends object>(input: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}

export function toFilters(input: Record<string, unknown>): Filters {
  const {
    range,
    from,
    to,
    gpuTypes,
    workloadTypes,
    models,
    statuses,
    clusters,
    minCost,
    maxCost,
    minUtilization,
    maxUtilization,
    search,
  } = input;
  return compact({
    range,
    from,
    to,
    gpuTypes,
    workloadTypes,
    models,
    statuses,
    clusters,
    minCost,
    maxCost,
    minUtilization,
    maxUtilization,
    search,
  } as Filters);
}

export function toWorkloadQuery(input: Record<string, unknown>): WorkloadQuery {
  return compact({
    ...toFilters(input),
    page: input["page"],
    pageSize: input["pageSize"],
    sortBy: input["sortBy"],
    sortDir: input["sortDir"],
  } as WorkloadQuery);
}
