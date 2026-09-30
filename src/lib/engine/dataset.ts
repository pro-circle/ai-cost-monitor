import { getCookie } from "@tanstack/react-start/server";

import { DATASET_SEED, JOB_COUNT } from "./constants";
import { generateDataset, type GeneratedData } from "./generate";
import type { TelemetryPoint, TrainingJob } from "./types";

/**
 * The app starts with NO data. Mock data is only served when the visitor has
 * pressed "Load mock data", which sets the `acg_mock=1` cookie. The mock set is
 * generated lazily per worker instance (never at module scope).
 */

export const MOCK_COOKIE = "acg_mock";

let cache: GeneratedData | undefined;
let empty: GeneratedData | undefined;
let telemetryIndex: Map<string, TelemetryPoint[]> | undefined;
let jobIndex: Map<string, TrainingJob> | undefined;

export function isMockLoaded(): boolean {
  try {
    return getCookie(MOCK_COOKIE) === "1";
  } catch {
    return false;
  }
}

function emptyDataset(): GeneratedData {
  if (!empty) {
    const now = new Date().toISOString();
    empty = { jobs: [], telemetry: [], billing: [], tokenUsage: [], generatedAt: now, windowStart: now, windowEnd: now };
  }
  return empty;
}

export function getDataset(): GeneratedData {
  if (!isMockLoaded()) return emptyDataset();
  if (!cache) cache = generateDataset(DATASET_SEED, JOB_COUNT);
  return cache;
}

export function getJob(jobId: string): TrainingJob | undefined {
  if (!isMockLoaded()) return undefined;
  if (!jobIndex) {
    jobIndex = new Map(getDataset().jobs.map((j) => [j.jobId, j]));
  }
  return jobIndex.get(jobId);
}

export function getTelemetry(jobId: string): TelemetryPoint[] {
  if (!isMockLoaded()) return [];
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
    loaded: d.jobs.length > 0,
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
