import { GPU_CATALOG, GPU_TYPES, PRECISIONS, WORKLOAD_TYPES } from "./constants";
import { simulate } from "./cost-model";
import { getDataset } from "./dataset";
import { round } from "./random";
import { predict as predictWith, trainModelZoo, type AnyModel, type Dataset } from "./ml";
import type { ModelMetrics, TrainedModelReport, WorkloadConfig } from "./types";

/**
 * Supervised pipeline: feature engineering → model zoo → selection → inference.
 * Trained lazily per worker and cached (mirrors joblib persistence server-side).
 */

export const FEATURE_NAMES = [
  "gpu_hourly_rate",
  "gpu_count",
  "params_b",
  "batch_size",
  "log_sequence_length",
  "log_tokens",
  "epochs",
  "log_training_steps",
  "precision_bits_factor",
  "avg_gpu_utilization",
  "memory_utilization",
  "log_expected_duration",
  "workload_intensity",
  "vram_gb",
  "peak_tflops",
];

const PRECISION_FACTOR = { FP32: 2, FP16: 1, BF16: 1.05 } as const;
const WORKLOAD_INTENSITY = { Training: 6, "Fine-tuning": 4.2, Inference: 2, Evaluation: 2.2 } as const;

export function buildFeatureVector(input: {
  gpuType: WorkloadConfig["gpuType"];
  gpuCount: number;
  paramsB: number;
  batchSize: number;
  sequenceLength: number;
  tokens: number;
  epochs: number;
  trainingSteps: number;
  precision: WorkloadConfig["precision"];
  gpuUtilization: number;
  memoryUtilization: number;
  expectedDurationHours: number;
  workloadType: WorkloadConfig["workloadType"];
}): number[] {
  const spec = GPU_CATALOG[input.gpuType];
  return [
    spec.hourlyCost,
    input.gpuCount,
    input.paramsB,
    input.batchSize,
    Math.log2(input.sequenceLength),
    Math.log1p(input.tokens),
    input.epochs,
    Math.log1p(input.trainingSteps),
    PRECISION_FACTOR[input.precision],
    input.gpuUtilization,
    input.memoryUtilization,
    Math.log1p(input.expectedDurationHours),
    WORKLOAD_INTENSITY[input.workloadType],
    spec.vramGb,
    spec.bf16Tflops,
  ];
}

function trainingFrame(target: "cost" | "duration", sampleLimit = 2200): Dataset {
  const jobs = getDataset().jobs.filter((j) => j.status !== "Queued");
  const stride = Math.max(1, Math.floor(jobs.length / sampleLimit));
  const rows = jobs.filter((_, i) => i % stride === 0);
  return {
    features: FEATURE_NAMES,
    X: rows.map((j) =>
      buildFeatureVector({
        gpuType: j.gpuType,
        gpuCount: j.gpuCount,
        paramsB: j.paramsB,
        batchSize: j.batchSize,
        sequenceLength: j.sequenceLength,
        tokens: j.tokens,
        epochs: j.epochs,
        trainingSteps: j.trainingSteps,
        precision: j.precision,
        gpuUtilization: j.gpuUtilization,
        memoryUtilization: j.memoryUtilization,
        expectedDurationHours: j.durationHours,
        workloadType: j.workloadType,
      }),
    ),
    y: rows.map((j) => (target === "cost" ? j.cost : j.durationHours)),
  };
}

export interface ModelBundle {
  target: "cost" | "duration";
  reports: TrainedModelReport[];
  best: { name: string; model: AnyModel; metrics: ModelMetrics };
  residualStd: number;
  trainedAt: string;
  version: string;
  rows: number;
}

const bundles = new Map<string, ModelBundle>();

export function getModelBundle(target: "cost" | "duration"): ModelBundle {
  const cached = bundles.get(target);
  if (cached) return cached;
  const frame = trainingFrame(target);
  const outcome = trainModelZoo(frame);
  const bundle: ModelBundle = {
    target,
    reports: outcome.reports,
    best: outcome.best,
    residualStd: outcome.residualStd,
    trainedAt: new Date().toISOString(),
    version: `v1.${target === "cost" ? 0 : 1}.${frame.X.length}`,
    rows: frame.X.length,
  };
  bundles.set(target, bundle);
  return bundle;
}

export function retrainModels() {
  bundles.delete("cost");
  bundles.delete("duration");
  return { cost: getModelBundle("cost"), duration: getModelBundle("duration") };
}

export function modelRegistry() {
  const cost = getModelBundle("cost");
  const duration = getModelBundle("duration");
  return [cost, duration].map((b) => ({
    target: b.target,
    name: b.best.name,
    version: b.version,
    trainedAt: b.trainedAt,
    rows: b.rows,
    features: FEATURE_NAMES,
    metrics: b.best.metrics,
    reports: b.reports,
  }));
}

export interface PredictionInput {
  gpuType: WorkloadConfig["gpuType"];
  gpuCount: number;
  paramsB: number;
  batchSize: number;
  sequenceLength: number;
  tokens: number;
  epochs: number;
  precision: WorkloadConfig["precision"];
  workloadType: WorkloadConfig["workloadType"];
}

export function predictWorkload(input: PredictionInput) {
  const trainingSteps = Math.max(50, Math.round(input.tokens / Math.max(1, input.batchSize * input.sequenceLength)));
  const config: WorkloadConfig = { ...input, trainingSteps };
  const analytical = simulate(config);

  const features = buildFeatureVector({
    ...input,
    trainingSteps,
    gpuUtilization: analytical.gpuUtilization,
    memoryUtilization: analytical.memoryUtilization,
    expectedDurationHours: analytical.durationHours,
  });

  const costBundle = getModelBundle("cost");
  const durationBundle = getModelBundle("duration");
  const predictedCost = Math.max(0.01, predictWith(costBundle.best.model, features));
  const predictedDuration = Math.max(0.01, predictWith(durationBundle.best.model, features));

  const ci = (value: number, std: number) => ({
    lower: round(Math.max(0, value - 1.96 * std), 3),
    upper: round(value + 1.96 * std, 3),
  });

  return {
    input: { ...input, trainingSteps },
    analytical: {
      durationHours: round(analytical.durationHours, 3),
      gpuHours: round(analytical.gpuHours, 2),
      cost: round(analytical.cost, 2),
      gpuUtilization: round(analytical.gpuUtilization * 100, 1),
      memoryUtilization: round(analytical.memoryUtilization * 100, 1),
      tokensPerSecond: round(analytical.tokensPerSecond, 0),
      costPerMillionTokens: round(analytical.costPerMillionTokens, 3),
      feasible: analytical.feasible,
      infeasibleReason: analytical.infeasibleReason ?? null,
    },
    predicted: {
      cost: round(predictedCost, 2),
      costInterval: ci(predictedCost, costBundle.residualStd),
      durationHours: round(predictedDuration, 3),
      durationInterval: ci(predictedDuration, durationBundle.residualStd),
      gpuHours: round(predictedDuration * input.gpuCount, 2),
      costPerMillionTokens: round(predictedCost / Math.max(0.000001, (input.tokens * input.epochs) / 1e6), 3),
      tokensPerSecond: round((input.tokens * input.epochs) / Math.max(60, predictedDuration * 3600), 0),
      confidence: round(Math.max(0, Math.min(1, costBundle.best.metrics.r2)), 3),
    },
    models: {
      cost: { name: costBundle.best.name, metrics: costBundle.best.metrics, version: costBundle.version },
      duration: { name: durationBundle.best.name, metrics: durationBundle.best.metrics, version: durationBundle.version },
    },
  };
}

export const PREDICTION_OPTIONS = {
  gpuTypes: GPU_TYPES,
  precisions: PRECISIONS,
  workloadTypes: [...WORKLOAD_TYPES],
  gpuCounts: [1, 2, 4, 8, 16, 32],
};
