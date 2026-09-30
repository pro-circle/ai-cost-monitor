export type GpuTypeId = "A100" | "H100" | "L40S" | "T4";
export type WorkloadType = "Training" | "Fine-tuning" | "Inference" | "Evaluation";
export type Precision = "FP32" | "FP16" | "BF16";
export type JobStatus = "Running" | "Completed" | "Failed" | "Queued" | "Anomalous";
export type Severity = "info" | "warning" | "critical";

export interface GpuSpec {
  id: GpuTypeId;
  name: string;
  vendor: string;
  vramGb: number;
  bf16Tflops: number;
  hourlyCost: number;
  tdpWatts: number;
  memBandwidthGbs: number;
}

export interface ModelSpec {
  name: string;
  family: string;
  paramsB: number;
  framework: string;
}

export interface WorkloadConfig {
  gpuType: GpuTypeId;
  gpuCount: number;
  paramsB: number;
  batchSize: number;
  sequenceLength: number;
  precision: Precision;
  tokens: number;
  epochs: number;
  trainingSteps: number;
  workloadType: WorkloadType;
}

export interface SimulationResult {
  durationHours: number;
  gpuHours: number;
  gpuUtilization: number;
  memoryUtilization: number;
  powerWatts: number;
  tokensPerSecond: number;
  cost: number;
  gpuCost: number;
  cpuCost: number;
  storageCost: number;
  networkCost: number;
  costPerHour: number;
  costPerMillionTokens: number;
  costPerTrainingStep: number;
  feasible: boolean;
  infeasibleReason?: string | undefined;
}

export interface TrainingJob {
  jobId: string;
  modelName: string;
  modelFamily: string;
  framework: string;
  paramsB: number;
  workloadType: WorkloadType;
  gpuType: GpuTypeId;
  gpuCount: number;
  cpuCores: number;
  ramGb: number;
  vramGb: number;
  batchSize: number;
  sequenceLength: number;
  precision: Precision;
  epochs: number;
  trainingSteps: number;
  tokens: number;
  status: JobStatus;
  cluster: string;
  region: string;
  owner: string;
  startedAt: string;
  completedAt: string | null;
  durationHours: number;
  gpuHours: number;
  gpuUtilization: number;
  peakGpuUtilization: number;
  minGpuUtilization: number;
  memoryUtilization: number;
  cpuUtilization: number;
  ramUtilization: number;
  powerWatts: number;
  energyKwh: number;
  temperatureC: number;
  idleHours: number;
  cost: number;
  gpuCost: number;
  cpuCost: number;
  storageCost: number;
  networkCost: number;
  costPerHour: number;
  costPerGpuHour: number;
  costPerMillionTokens: number;
  costPerTrainingStep: number;
  tokensPerSecond: number;
  gpuEfficiency: number;
  memoryEfficiency: number;
  computeEfficiency: number;
  tokenEfficiency: number;
  costEfficiency: number;
  trainingEfficiency: number;
  idleRatio: number;
  efficiencyScore: number;
  retryOf: string | null;
  anomalyKinds: AnomalyKind[];
}

export type AnomalyKind =
  | "low_gpu_utilization"
  | "high_memory_pressure"
  | "cost_spike"
  | "long_duration"
  | "abnormal_tokens"
  | "utilization_drop"
  | "repeated_failure"
  | "over_provisioned";

export interface TelemetryPoint {
  jobId: string;
  t: number;
  gpuUtil: number;
  memUtil: number;
  cpuUtil: number;
  ramUtil: number;
  powerWatts: number;
  temperatureC: number;
}

export interface BillingRecord {
  id: string;
  jobId: string | null;
  date: string;
  category:
    | "Training"
    | "Fine-tuning"
    | "Inference"
    | "Evaluation"
    | "Idle resources"
    | "Failed jobs"
    | "Storage"
    | "Network"
    | "Other";
  gpuType: GpuTypeId | null;
  amount: number;
}

export interface TokenUsageRecord {
  id: string;
  jobId: string;
  date: string;
  modelName: string;
  workloadType: WorkloadType;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costPerMillionTokens: number;
}

export interface Anomaly {
  id: string;
  jobId: string;
  kind: AnomalyKind;
  severity: Severity;
  timestamp: string;
  metric: string;
  observed: number;
  expectedMin: number;
  expectedMax: number;
  unit: string;
  score: number;
  title: string;
  explanation: string;
  likelyCause: string;
  recommendation: string;
  estimatedWaste: number;
}

export interface Recommendation {
  id: string;
  category: "Cost" | "Performance" | "GPU utilization" | "Memory" | "Training" | "Configuration";
  title: string;
  reason: string;
  expectedImpact: string;
  estimatedSavings: number;
  confidence: number;
  action: string;
  jobIds: string[];
}

export interface ModelMetrics {
  mae: number;
  mse: number;
  rmse: number;
  r2: number;
  mape: number;
}

export interface TrainedModelReport {
  name: string;
  algorithm: string;
  metrics: ModelMetrics;
  trainSize: number;
  testSize: number;
  featureImportance: { feature: string; importance: number }[];
  selected: boolean;
}

export interface EfficiencyWeights {
  gpuUtilization: number;
  memoryUtilization: number;
  tokenThroughput: number;
  costEfficiency: number;
  trainingEfficiency: number;
  idleRatio: number;
}
