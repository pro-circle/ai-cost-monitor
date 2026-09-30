import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import type { FiltersInput } from "@/lib/api/acg.functions";

export type AcgFilters = FiltersInput;

const DEFAULT_FILTERS: AcgFilters = { range: "30d" };

interface FiltersContextValue {
  filters: AcgFilters;
  setFilters: (next: AcgFilters) => void;
  patch: (next: Partial<AcgFilters>) => void;
  reset: () => void;
  activeCount: number;
}

const FiltersContext = createContext<FiltersContextValue | null>(null);

export function FiltersProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<AcgFilters>(DEFAULT_FILTERS);

  const patch = useCallback((next: Partial<AcgFilters>) => {
    setFilters((prev) => {
      const merged = { ...prev, ...next } as Record<string, unknown>;
      for (const key of Object.keys(merged)) {
        const value = merged[key];
        if (value === undefined || value === null || (Array.isArray(value) && value.length === 0) || value === "") {
          delete merged[key];
        }
      }
      if (!merged["range"]) merged["range"] = "30d";
      return merged as AcgFilters;
    });
  }, []);

  const reset = useCallback(() => setFilters(DEFAULT_FILTERS), []);

  const value = useMemo<FiltersContextValue>(() => {
    const activeCount = [
      filters.gpuTypes?.length,
      filters.workloadTypes?.length,
      filters.statuses?.length,
      filters.models?.length,
      filters.clusters?.length,
      filters.search ? 1 : 0,
      filters.minCost != null || filters.maxCost != null ? 1 : 0,
      filters.minUtilization != null || filters.maxUtilization != null ? 1 : 0,
    ].reduce<number>((acc, n) => acc + (n ? 1 : 0), 0);
    return { filters, setFilters, patch, reset, activeCount };
  }, [filters, patch, reset]);

  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>;
}

export function useAcgFilters(): FiltersContextValue {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error("useAcgFilters must be used inside <FiltersProvider>");
  return ctx;
}

/** Stable query-key fragment for the current filters. */
export function filtersKey(filters: AcgFilters): string {
  return JSON.stringify(
    Object.keys(filters)
      .sort()
      .map((k) => [k, (filters as Record<string, unknown>)[k]]),
  );
}
