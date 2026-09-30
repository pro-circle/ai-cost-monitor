import {
  GPU_CATALOG,
  PRECISION_FACTORS,
  RATES,
  WORKLOAD_FLOPS_PER_PARAM_TOKEN,
} from "./constants";
import { clamp } from "./random";
import type { SimulationResult, WorkloadConfig } from "./types";

/**
 * Analytical performance/cost model for an AI workload.
 * Everything downstream (generation, prediction baselines, what-if, optimization)
 * derives from this single physical model, so numbers stay internally consistent.
 */

/** Multi-GPU scaling efficiency: communication overhead grows with device count. */
export function scalingEfficiency(gpuCount: number, sequenceLength: number): number {
  const commPenalty = 0.055 + Math.min(0.03, sequenceLength / 900000);
  return clamp(1 / (1 + commPenalty * Math.log2(Math.max(1, gpuCount)) * Math.sqrt(gpuCount)), 0.28, 1);
}

/** Estimated VRAM footprint per GPU in GB. */
export function memoryFootprintGb(config: WorkloadConfig): number {
  const spec = GPU_CATALOG[config.gpuType];
  const pf = PRECISION_FACTORS[config.precision];
  const isTrainingLike = config.workloadType === "Training" || config.workloadType === "Fine-tuning";
  // weights + (optimizer states & gradients for training) sharded across devices
  const bytesPerParam = 2 * pf.memory;
  const optimizerMultiplier = config.workloadType === "Training" ? 4 : config.workloadType === "Fine-tuning" ? 1.6 : 1;
  const weightsGb = (config.paramsB * 1e9 * bytesPerParam * optimizerMultiplier) / 1e9 / Math.max(1, config.gpuCount);
  // activations scale with batch * sequence * hidden-size proxy
  const hiddenProxy = Math.cbrt(config.paramsB * 1e9) * 0.9;
  const activationsGb =
    (config.batchSize * config.sequenceLength * hiddenProxy * 2 * pf.memory * (isTrainingLike ? 1.8 : 0.5)) / 1e9;
  return weightsGb + activationsGb + 1.2 * (spec.vramGb / 80);
}

export function simulate(config: WorkloadConfig): SimulationResult {
  const spec = GPU_CATALOG[config.gpuType];
  const pf = PRECISION_FACTORS[config.precision];
  const flopsPerParamToken = WORKLOAD_FLOPS_PER_PARAM_TOKEN[config.workloadType] ?? 6;

  const totalTokens = Math.max(1, config.tokens) * Math.max(1, config.epochs);
  const totalFlops = totalTokens * config.paramsB * 1e9 * flopsPerParamToken;

  const memNeeded = memoryFootprintGb(config);
  const memoryUtilization = clamp(memNeeded / spec.vramGb, 0.05, 1.6);
  const feasible = memoryUtilization <= 0.98;

  // Model FLOP utilization (MFU): peaks with healthy batch and sequence sizes.
  const batchFit = clamp(Math.log2(config.batchSize + 1) / Math.log2(65), 0.22, 1);
  const seqFit = clamp(1 - Math.abs(Math.log2(config.sequenceLength / 4096)) * 0.075, 0.55, 1);
  const memPressurePenalty = memoryUtilization > 0.92 ? 0.72 : memoryUtilization < 0.25 ? 0.82 : 1;
  const scaling = scalingEfficiency(config.gpuCount, config.sequenceLength);
  const mfu = clamp(0.62 * batchFit * seqFit * memPressurePenalty * scaling * pf.throughput, 0.02, 0.78);

  const effectiveFlops = spec.bf16Tflops * 1e12 * config.gpuCount * mfu;
  const durationSeconds = totalFlops / effectiveFlops;
  const durationHours = Math.max(0.02, durationSeconds / 3600);
  const gpuHours = durationHours * config.gpuCount;

  const gpuUtilization = clamp(mfu / 0.78, 0.05, 0.99);
  const cpuCores = Math.max(8, config.gpuCount * 8);
  const ramGb = Math.max(64, config.gpuCount * 96);
  const storageGb = 220 + config.paramsB * 22;

  const gpuCost = gpuHours * spec.hourlyCost;
  const cpuCost = durationHours * cpuCores * RATES.cpuCoreHour + durationHours * ramGb * RATES.ramGbHour;
  const storageCost = durationHours * storageGb * RATES.storageGbHour;
  const networkCost =
    (totalTokens / 1e6) * RATES.networkPerMillionTokens * Math.max(1, Math.log2(config.gpuCount + 1));
  const cost = gpuCost + cpuCost + storageCost + networkCost;

  const powerWatts = spec.tdpWatts * config.gpuCount * (0.35 + 0.65 * gpuUtilization);
  const tokensPerSecond = totalTokens / Math.max(1, durationSeconds);

  return {
    durationHours,
    gpuHours,
    gpuUtilization,
    memoryUtilization,
    powerWatts,
    tokensPerSecond,
    cost,
    gpuCost,
    cpuCost,
    storageCost,
    networkCost,
    costPerHour: cost / durationHours,
    costPerMillionTokens: cost / (totalTokens / 1e6),
    costPerTrainingStep: cost / Math.max(1, config.trainingSteps),
    feasible,
    infeasibleReason: feasible
      ? undefined
      : `Estimated VRAM need ${memNeeded.toFixed(1)} GB exceeds ${spec.vramGb} GB per ${config.gpuType}`,
  };
}
