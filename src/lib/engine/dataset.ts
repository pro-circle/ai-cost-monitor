import { DATASET_SEED, JOB_COUNT } from "./constants";
import { generateDataset, type GeneratedData } from "./generate";
import type { TelemetryPoint, TrainingJob } from "./types";

/**
 * Deterministic in-memory dataset, generated lazily per worker instance.
 * Never generated at module scope (edge runtime forbids work in global scope).
 */

let cache: GeneratedData | undefined;
let telemetryIndex: Map<string, TelemetryPoint[]> | undefined;
let jobIndex: Map<string, TrainingJob> | undefined;

export function getDataset(): GeneratedData {
  if (!cache) cache = generateDataset(DATASET_SEED, JOB_COUNT);
  return cache;
}

export function getJob(jobId: string): TrainingJob | undefined {
  if (!jobIndex) {
    jobIndex = new Map(getDataset().jobs.map((j) => [j.jobId, j]));
  }
  return jobIndex.get(jobId);
}

export function getTelemetry(jobId: string): TelemetryPoint[] {
  if (!telemetryIndex) {
    telemetryIndex = new Map();
    for (const point of getDataset().telemetry) {
      const arr = telemetryIndex.get(point.jobId);
      if (arr) arr.push(point);
      else telemetryIndex.set(point.jobId, [point]);
    }
  }
  return telemetryIndex.get(jobId) ?? [];
}

export function datasetMeta() {
  const d = getDataset();
  return {
    jobs: d.jobs.length,
    telemetry: d.telemetry.length,
    billing: d.billing.length,
    tokenUsage: d.tokenUsage.length,
    generatedAt: d.generatedAt,
    windowStart: d.windowStart,
    windowEnd: d.windowEnd,
    seed: DATASET_SEED,
  };
}
