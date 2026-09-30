import type { EfficiencyWeights, GpuSpec, GpuTypeId, ModelSpec, Precision } from "./types";

export const GPU_CATALOG: Record<GpuTypeId, GpuSpec> = {
  H100: {
    id: "H100",
    name: "NVIDIA H100 SXM",
    vendor: "NVIDIA",
    vramGb: 80,
    bf16Tflops: 989,
    hourlyCost: 3.2,
    tdpWatts: 700,
    memBandwidthGbs: 3350,
  },
  A100: {
    id: "A100",
    name: "NVIDIA A100 SXM",
    vendor: "NVIDIA",
    vramGb: 80,
    bf16Tflops: 312,
    hourlyCost: 1.9,
    tdpWatts: 400,
    memBandwidthGbs: 2039,
  },
  L40S: {
    id: "L40S",
    name: "NVIDIA L40S",
    vendor: "NVIDIA",
    vramGb: 48,
    bf16Tflops: 366,
    hourlyCost: 1.1,
    tdpWatts: 350,
    memBandwidthGbs: 864,
  },
  T4: {
    id: "T4",
    name: "NVIDIA T4",
    vendor: "NVIDIA",
    vramGb: 16,
    bf16Tflops: 65,
    hourlyCost: 0.35,
    tdpWatts: 70,
    memBandwidthGbs: 320,
  },
};

export const GPU_TYPES: GpuTypeId[] = ["H100", "A100", "L40S", "T4"];

export const MODEL_CATALOG: ModelSpec[] = [
  { name: "Llama-3-8B", family: "Llama", paramsB: 8, framework: "PyTorch" },
  { name: "Llama-3-70B", family: "Llama", paramsB: 70, framework: "PyTorch" },
  { name: "Llama-3.2-3B", family: "Llama", paramsB: 3, framework: "PyTorch" },
  { name: "Mistral-7B", family: "Mistral", paramsB: 7, framework: "PyTorch" },
  { name: "Mixtral-8x7B", family: "Mistral", paramsB: 46, framework: "PyTorch" },
  { name: "Qwen2.5-14B", family: "Qwen", paramsB: 14, framework: "PyTorch" },
  { name: "Qwen2.5-32B", family: "Qwen", paramsB: 32, framework: "PyTorch" },
  { name: "Qwen2.5-1.5B", family: "Qwen", paramsB: 1.5, framework: "JAX" },
  { name: "Guard-Retriever-1B", family: "Custom", paramsB: 1, framework: "PyTorch" },
  { name: "Guard-Ranker-4B", family: "Custom", paramsB: 4, framework: "DeepSpeed" },
];

export const WORKLOAD_TYPES = ["Training", "Fine-tuning", "Inference", "Evaluation"] as const;
export const PRECISIONS: Precision[] = ["FP32", "FP16", "BF16"];
export const JOB_STATUSES = ["Running", "Completed", "Failed", "Queued", "Anomalous"] as const;

export const CLUSTERS = ["cluster-alpha", "cluster-beta", "cluster-gamma", "cluster-delta"];
export const REGIONS = ["us-east-1", "us-west-2", "eu-west-1", "ap-south-1"];
export const OWNERS = ["research", "platform", "product-ml", "safety", "infra"];

/** Throughput / memory multipliers per precision (relative to BF16). */
export const PRECISION_FACTORS: Record<Precision, { throughput: number; memory: number }> = {
  FP32: { throughput: 0.42, memory: 2.0 },
  FP16: { throughput: 1.0, memory: 1.0 },
  BF16: { throughput: 1.0, memory: 1.0 },
};

/** Relative compute intensity of each workload type (FLOPs per parameter per token). */
export const WORKLOAD_FLOPS_PER_PARAM_TOKEN: Record<string, number> = {
  Training: 6,
  "Fine-tuning": 4.2,
  Inference: 2,
  Evaluation: 2.2,
};

/** Configurable weights for the 0-100 resource efficiency score. */
export const DEFAULT_EFFICIENCY_WEIGHTS: EfficiencyWeights = {
  gpuUtilization: 0.3,
  memoryUtilization: 0.15,
  tokenThroughput: 0.15,
  costEfficiency: 0.2,
  trainingEfficiency: 0.1,
  idleRatio: 0.1,
};

export const EFFICIENCY_BANDS = [
  { min: 90, label: "Excellent", tone: "success" as const },
  { min: 75, label: "Good", tone: "info" as const },
  { min: 50, label: "Moderate", tone: "warning" as const },
  { min: 25, label: "Poor", tone: "warning" as const },
  { min: 0, label: "Critical", tone: "destructive" as const },
];

export function efficiencyBand(score: number) {
  return EFFICIENCY_BANDS.find((b) => score >= b.min) ?? EFFICIENCY_BANDS[EFFICIENCY_BANDS.length - 1]!;
}

/** Non-GPU cost rates. */
export const RATES = {
  cpuCoreHour: 0.011,
  ramGbHour: 0.0042,
  storageGbHour: 0.00012,
  networkPerMillionTokens: 0.004,
  idleOverheadHour: 0.02,
};

export const DATASET_SEED = 20260812;
export const JOB_COUNT = 10000;
export const TELEMETRY_PER_JOB = 12;
