import { GPU_CATALOG, PRECISIONS } from "./constants";
import { memoryFootprintGb, simulate } from "./cost-model";
import type { GpuTypeId, Precision, SimulationResult, WorkloadConfig } from "./types";

export interface OptimizationConstraints {
  maxDurationHours?: number | undefined;
  minGpuUtilization?: number | undefined;
  maxMemoryUtilization?: number | undefined;
  allowGpuTypeChange?: boolean | undefined;
  allowPrecisionChange?: boolean | undefined;
  maxDurationIncreasePct?: number | undefined;
}

export interface Candidate {
  config: WorkloadConfig;
  result: SimulationResult;
  savings: number;
  savingsPct: number;
  durationDeltaPct: number;
  utilizationDeltaPct: number;
  notes: string[];
}

export interface OptimizationOutcome {
  current: { config: WorkloadConfig; result: SimulationResult };
  recommended: Candidate | null;
  alternatives: Candidate[];
  constraintReport: { constraint: string; status: "met" | "violated" | "n/a"; detail: string }[];
  searchSpaceSize: number;
}

const GPU_CHOICES: GpuTypeId[] = ["H100", "A100", "L40S", "T4"];
const BATCH_STEPS = [1, 2, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512];

function neighbourValues(value: number, steps: number[]): number[] {
  const idx = steps.reduce((best, v, i) => (Math.abs(v - value) < Math.abs(steps[best]! - value) ? i : best), 0);
  return [steps[Math.max(0, idx - 2)]!, steps[Math.max(0, idx - 1)]!, steps[idx]!, steps[Math.min(steps.length - 1, idx + 1)]!];
}

function gpuCountOptions(current: number): number[] {
  const opts = new Set<number>([1, 2, 4, 8, 16, 32]);
  opts.add(current);
  return [...opts].filter((v) => v <= Math.max(32, current)).sort((a, b) => a - b);
}

/**
 * Coordinate-descent search over the discrete configuration space, minimising
 * cost subject to memory / duration / utilization constraints.
 */
export function optimizeConfiguration(
  current: WorkloadConfig,
  constraints: OptimizationConstraints = {},
): OptimizationOutcome {
  const baseline = simulate(current);
  const maxDurationIncrease = constraints.maxDurationIncreasePct ?? 25;
  const minUtil = constraints.minGpuUtilization ?? 0.4;
  const maxMem = constraints.maxMemoryUtilization ?? 0.92;
  const allowGpu = constraints.allowGpuTypeChange ?? true;
  const allowPrecision = constraints.allowPrecisionChange ?? true;

  const gpuTypes = allowGpu ? GPU_CHOICES : [current.gpuType];
  const precisions: Precision[] = allowPrecision ? PRECISIONS : [current.precision];
  const counts = gpuCountOptions(current.gpuCount);
  const batches = neighbourValues(current.batchSize, BATCH_STEPS);
  const seqOptions = [...new Set([current.sequenceLength, Math.max(512, current.sequenceLength / 2)])];

  const candidates: Candidate[] = [];
  let searchSpaceSize = 0;

  for (const gpuType of gpuTypes) {
    for (const gpuCount of counts) {
      for (const precision of precisions) {
        for (const batchSize of batches) {
          for (const sequenceLength of seqOptions) {
            searchSpaceSize += 1;
            const config: WorkloadConfig = { ...current, gpuType, gpuCount, precision, batchSize, sequenceLength };
            const result = simulate(config);
            if (!result.feasible) continue;
            if (result.memoryUtilization > maxMem) continue;
            if (result.gpuUtilization < minUtil) continue;
            const durationDeltaPct = ((result.durationHours - baseline.durationHours) / baseline.durationHours) * 100;
            if (durationDeltaPct > maxDurationIncrease) continue;
            if (constraints.maxDurationHours && result.durationHours > constraints.maxDurationHours) continue;

            const notes: string[] = [];
            if (gpuType !== current.gpuType) notes.push(`Switch ${current.gpuType} → ${gpuType}`);
            if (gpuCount !== current.gpuCount) notes.push(`GPU count ${current.gpuCount} → ${gpuCount}`);
            if (precision !== current.precision) notes.push(`Precision ${current.precision} → ${precision}`);
            if (batchSize !== current.batchSize) notes.push(`Batch ${current.batchSize} → ${batchSize}`);
            if (sequenceLength !== current.sequenceLength)
              notes.push(`Sequence length ${current.sequenceLength} → ${sequenceLength}`);

            candidates.push({
              config,
              result,
              savings: baseline.cost - result.cost,
              savingsPct: ((baseline.cost - result.cost) / baseline.cost) * 100,
              durationDeltaPct,
              utilizationDeltaPct: (result.gpuUtilization - baseline.gpuUtilization) * 100,
              notes,
            });
          }
        }
      }
    }
  }

  candidates.sort((a, b) => b.savings - a.savings);
  const improved = candidates.filter((c) => c.savings > baseline.cost * 0.01 && c.notes.length > 0);
  const recommended = improved[0] ?? null;

  const memNeed = memoryFootprintGb(recommended?.config ?? current);
  const constraintReport: OptimizationOutcome["constraintReport"] = [
    {
      constraint: "GPU memory fits",
      status: memNeed <= GPU_CATALOG[(recommended?.config ?? current).gpuType].vramGb ? "met" : "violated",
      detail: `${memNeed.toFixed(1)} GB needed / ${GPU_CATALOG[(recommended?.config ?? current).gpuType].vramGb} GB available`,
    },
    {
      constraint: `Training time increase ≤ ${maxDurationIncrease}%`,
      status: !recommended ? "n/a" : recommended.durationDeltaPct <= maxDurationIncrease ? "met" : "violated",
      detail: recommended ? `${recommended.durationDeltaPct.toFixed(1)}% change` : "no alternative found",
    },
    {
      constraint: `Minimum GPU utilization ≥ ${(minUtil * 100).toFixed(0)}%`,
      status: !recommended ? "n/a" : recommended.result.gpuUtilization >= minUtil ? "met" : "violated",
      detail: recommended ? `${(recommended.result.gpuUtilization * 100).toFixed(1)}% projected` : "no alternative found",
    },
    {
      constraint: "Token volume preserved",
      status: "met",
      detail: `${(current.tokens / 1e9).toFixed(2)}B tokens unchanged`,
    },
  ];

  return {
    current: { config: current, result: baseline },
    recommended,
    alternatives: improved.slice(1, 6),
    constraintReport,
    searchSpaceSize,
  };
}

/** What-if: simulate a config and compare it against a baseline config. */
export function whatIf(baseline: WorkloadConfig, scenario: WorkloadConfig) {
  const a = simulate(baseline);
  const b = simulate(scenario);
  return {
    baseline: { config: baseline, result: a },
    scenario: { config: scenario, result: b },
    delta: {
      cost: b.cost - a.cost,
      costPct: ((b.cost - a.cost) / a.cost) * 100,
      durationHours: b.durationHours - a.durationHours,
      durationPct: ((b.durationHours - a.durationHours) / a.durationHours) * 100,
      gpuHours: b.gpuHours - a.gpuHours,
      utilizationPts: (b.gpuUtilization - a.gpuUtilization) * 100,
      costPerMillionTokens: b.costPerMillionTokens - a.costPerMillionTokens,
      savings: a.cost - b.cost,
      savingsPct: ((a.cost - b.cost) / a.cost) * 100,
    },
  };
}
