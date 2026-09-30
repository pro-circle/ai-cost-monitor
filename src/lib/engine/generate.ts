import {
  CLUSTERS,
  DEFAULT_EFFICIENCY_WEIGHTS,
  GPU_CATALOG,
  JOB_COUNT,
  MODEL_CATALOG,
  OWNERS,
  PRECISIONS,
  RATES,
  REGIONS,
  WORKLOAD_TYPES,
} from "./constants";
import { simulate } from "./cost-model";
import { clamp, gauss, mulberry32, pick, round, weightedPick, type Rng } from "./random";
import type {
  AnomalyKind,
  BillingRecord,
  EfficiencyWeights,
  GpuTypeId,
  JobStatus,
  Precision,
  TelemetryPoint,
  TokenUsageRecord,
  TrainingJob,
  WorkloadConfig,
  WorkloadType,
} from "./types";

/** Engineered-feature + efficiency-score computation shared with the Python layer. */
export function computeEfficiency(
  job: Omit<TrainingJob, "efficiencyScore" | "gpuEfficiency" | "memoryEfficiency" | "computeEfficiency" | "tokenEfficiency" | "costEfficiency" | "trainingEfficiency" | "idleRatio">,
  medianCostPerMTokens: number,
  medianTokensPerSecond: number,
  weights: EfficiencyWeights = DEFAULT_EFFICIENCY_WEIGHTS,
) {
  const gpuEfficiency = clamp(job.gpuUtilization, 0, 1);
  const memoryEfficiency = clamp(1 - Math.abs(job.memoryUtilization - 0.78) / 0.78, 0, 1);
  const tokenEfficiency = clamp(job.tokensPerSecond / (medianTokensPerSecond || 1) / 2, 0, 1);
  const costEfficiency = clamp(medianCostPerMTokens / (job.costPerMillionTokens || 1) / 2, 0, 1);
  const idleRatio = clamp(job.idleHours / Math.max(0.01, job.durationHours), 0, 1);
  const trainingEfficiency = clamp((1 - idleRatio) * job.gpuUtilization * (job.status === "Failed" ? 0.2 : 1), 0, 1);
  const computeEfficiency = clamp((gpuEfficiency * 0.6 + memoryEfficiency * 0.4) * (1 - idleRatio * 0.5), 0, 1);

  const score =
    100 *
    (weights.gpuUtilization * gpuEfficiency +
      weights.memoryUtilization * memoryEfficiency +
      weights.tokenThroughput * tokenEfficiency +
      weights.costEfficiency * costEfficiency +
      weights.trainingEfficiency * trainingEfficiency +
      weights.idleRatio * (1 - idleRatio));

  return {
    gpuEfficiency,
    memoryEfficiency,
    computeEfficiency,
    tokenEfficiency,
    costEfficiency,
    trainingEfficiency,
    idleRatio,
    efficiencyScore: clamp(score, 0, 100),
  };
}

const HOUR = 3600_000;

function sampleConfig(rng: Rng): { config: WorkloadConfig; modelIdx: number } {
  const modelIdx = Math.floor(rng() * MODEL_CATALOG.length);
  const model = MODEL_CATALOG[modelIdx]!;
  const workloadType = weightedPick<WorkloadType>(rng, [...WORKLOAD_TYPES], [26, 34, 30, 10]);
  const gpuType = weightedPick<GpuTypeId>(rng, ["H100", "A100", "L40S", "T4"], [24, 38, 24, 14]);
  const spec = GPU_CATALOG[gpuType];

  const maxGpus = spec.vramGb >= 80 ? 32 : spec.vramGb >= 48 ? 16 : 8;
  const gpuCount = weightedPick(
    rng,
    [1, 2, 4, 8, 16, 32].filter((g) => g <= maxGpus),
    [18, 16, 24, 22, 12, 8],
  );
  const precision = weightedPick<Precision>(rng, PRECISIONS, [16, 34, 50]);
  const batchSize = weightedPick(rng, [1, 4, 8, 16, 24, 32, 64, 128, 256], [6, 10, 14, 20, 12, 16, 12, 7, 3]);
  const sequenceLength = weightedPick(
    rng,
    [512, 1024, 2048, 4096, 8192, 16384, 32768],
    [10, 16, 24, 24, 14, 8, 4],
  );

  const tokenBase =
    workloadType === "Training" ? 4.2e9 : workloadType === "Fine-tuning" ? 5.5e8 : workloadType === "Inference" ? 1.8e8 : 6e7;
  const tokens = Math.round(tokenBase * Math.exp(gauss(rng, 0, 0.55)));
  const epochs = workloadType === "Training" ? 1 : Math.max(1, Math.round(1 + rng() * 3));
  const trainingSteps = Math.max(50, Math.round(tokens / Math.max(1, batchSize * sequenceLength)));

  return {
    modelIdx,
    config: {
      gpuType,
      gpuCount,
      paramsB: model.paramsB,
      batchSize,
      sequenceLength,
      precision,
      tokens,
      epochs,
      trainingSteps,
      workloadType,
    },
  };
}

export interface GeneratedData {
  jobs: TrainingJob[];
  telemetry: TelemetryPoint[];
  billing: BillingRecord[];
  tokenUsage: TokenUsageRecord[];
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
}

export function generateDataset(seed: number, jobCount = JOB_COUNT, nowMs?: number): GeneratedData {
  const rng = mulberry32(seed);
  const now = nowMs ?? Date.UTC(2026, 7, 12, 6, 0, 0);
  const windowMs = 60 * 24 * HOUR; // 60 days of history
  const jobs: TrainingJob[] = [];
  const telemetry: TelemetryPoint[] = [];
  const billing: BillingRecord[] = [];
  const tokenUsage: TokenUsageRecord[] = [];

  // Pass 1: raw simulated jobs.
  interface Draft {
    job: TrainingJob;
    anomalyKinds: AnomalyKind[];
  }
  const drafts: Draft[] = [];

  for (let i = 0; i < jobCount; i += 1) {
    const { config, modelIdx } = sampleConfig(rng);
    const model = MODEL_CATALOG[modelIdx]!;
    const spec = GPU_CATALOG[config.gpuType];
    const anomalyKinds: AnomalyKind[] = [];

    let sim = simulate(config);
    // resolve infeasible memory configs by shrinking batch, as a scheduler would
    let guard = 0;
    let effective = { ...config };
    while (!sim.feasible && guard < 6 && effective.batchSize > 1) {
      effective = { ...effective, batchSize: Math.max(1, Math.floor(effective.batchSize / 2)) };
      sim = simulate(effective);
      guard += 1;
    }

    let gpuUtilization = clamp(sim.gpuUtilization * (1 + gauss(rng, 0, 0.08)), 0.04, 0.99);
    let memoryUtilization = clamp(sim.memoryUtilization * (1 + gauss(rng, 0, 0.06)), 0.05, 0.99);
    let durationHours = sim.durationHours * (1 + Math.abs(gauss(rng, 0, 0.1)));
    let cost = sim.cost;
    let tokens = effective.tokens;
    let idleHours = durationHours * clamp(Math.abs(gauss(rng, 0.06, 0.05)), 0, 0.45);

    // ---- deliberate anomaly injection (~9% of jobs) ----
    const roll = rng();
    if (roll < 0.032) {
      gpuUtilization = clamp(gpuUtilization * 0.22, 0.03, 0.2);
      durationHours *= 2.1;
      idleHours = durationHours * 0.42;
      anomalyKinds.push("low_gpu_utilization");
    } else if (roll < 0.05) {
      memoryUtilization = clamp(0.965 + rng() * 0.03, 0.9, 0.995);
      durationHours *= 1.35;
      anomalyKinds.push("high_memory_pressure");
    } else if (roll < 0.064) {
      cost *= 2.3 + rng();
      anomalyKinds.push("cost_spike");
    } else if (roll < 0.078) {
      durationHours *= 3.4 + rng();
      anomalyKinds.push("long_duration");
    } else if (roll < 0.09) {
      tokens = Math.round(tokens * (2.4 + rng() * 1.6));
      anomalyKinds.push("abnormal_tokens");
    }
    if (gpuUtilization < 0.35 && effective.gpuCount >= 8) anomalyKinds.push("over_provisioned");

    const status: JobStatus = (() => {
      const r = rng();
      if (anomalyKinds.length > 0 && r < 0.42) return "Anomalous";
      if (r < 0.055) return "Failed";
      if (r < 0.1) return "Running";
      if (r < 0.13) return "Queued";
      return "Completed";
    })();

    if (status === "Failed") {
      durationHours *= 0.35 + rng() * 0.4;
      idleHours = durationHours * 0.5;
      anomalyKinds.push("repeated_failure");
    }

    const startedAtMs = now - windowMs + rng() * windowMs;
    const gpuHours = durationHours * effective.gpuCount;
    const totalTokens = tokens * effective.epochs;

    const gpuCost = gpuHours * spec.hourlyCost * (cost / sim.cost);
    const cpuCores = Math.max(8, effective.gpuCount * 8);
    const ramGb = Math.max(64, effective.gpuCount * 96);
    const cpuCost = durationHours * cpuCores * RATES.cpuCoreHour + durationHours * ramGb * RATES.ramGbHour;
    const storageCost = durationHours * (220 + effective.paramsB * 22) * RATES.storageGbHour;
    const networkCost = (totalTokens / 1e6) * RATES.networkPerMillionTokens;
    const totalCost = gpuCost + cpuCost + storageCost + networkCost + idleHours * RATES.idleOverheadHour;

    const tokensPerSecond = totalTokens / Math.max(60, durationHours * 3600);
    const cpuUtilization = clamp(0.28 + gpuUtilization * 0.35 + gauss(rng, 0, 0.07), 0.05, 0.98);
    const ramUtilization = clamp(0.3 + memoryUtilization * 0.4 + gauss(rng, 0, 0.06), 0.08, 0.98);
    const powerWatts = spec.tdpWatts * effective.gpuCount * (0.32 + 0.68 * gpuUtilization);
    const temperatureC = clamp(38 + gpuUtilization * 42 + gauss(rng, 0, 3), 30, 92);

    const base = {
      jobId: `${effective.workloadType === "Fine-tuning" ? "FT" : effective.workloadType === "Inference" ? "INF" : effective.workloadType === "Evaluation" ? "EVAL" : "TRN"}-${1000 + i}`,
      modelName: model.name,
      modelFamily: model.family,
      framework: model.framework,
      paramsB: model.paramsB,
      workloadType: effective.workloadType,
      gpuType: effective.gpuType,
      gpuCount: effective.gpuCount,
      cpuCores,
      ramGb,
      vramGb: spec.vramGb,
      batchSize: effective.batchSize,
      sequenceLength: effective.sequenceLength,
      precision: effective.precision,
      epochs: effective.epochs,
      trainingSteps: effective.trainingSteps,
      tokens: totalTokens,
      status,
      cluster: pick(rng, CLUSTERS),
      region: pick(rng, REGIONS),
      owner: pick(rng, OWNERS),
      startedAt: new Date(startedAtMs).toISOString(),
      completedAt:
        status === "Running" || status === "Queued" ? null : new Date(startedAtMs + durationHours * HOUR).toISOString(),
      durationHours: round(durationHours, 3),
      gpuHours: round(gpuHours, 3),
      gpuUtilization: round(gpuUtilization, 4),
      peakGpuUtilization: round(clamp(gpuUtilization * (1.08 + rng() * 0.16), 0, 1), 4),
      minGpuUtilization: round(clamp(gpuUtilization * (0.35 + rng() * 0.35), 0, 1), 4),
      memoryUtilization: round(memoryUtilization, 4),
      cpuUtilization: round(cpuUtilization, 4),
      ramUtilization: round(ramUtilization, 4),
      powerWatts: round(powerWatts, 1),
      energyKwh: round((powerWatts * durationHours) / 1000, 3),
      temperatureC: round(temperatureC, 1),
      idleHours: round(idleHours, 3),
      cost: round(totalCost, 2),
      gpuCost: round(gpuCost, 2),
      cpuCost: round(cpuCost, 2),
      storageCost: round(storageCost, 2),
      networkCost: round(networkCost, 2),
      costPerHour: round(totalCost / durationHours, 2),
      costPerGpuHour: round(totalCost / Math.max(0.01, gpuHours), 3),
      costPerMillionTokens: round(totalCost / Math.max(0.000001, totalTokens / 1e6), 3),
      costPerTrainingStep: round(totalCost / Math.max(1, effective.trainingSteps), 5),
      tokensPerSecond: round(tokensPerSecond, 1),
      retryOf: null as string | null,
      anomalyKinds,
    };

    drafts.push({ job: base as unknown as TrainingJob, anomalyKinds });
  }

  // Pass 2: cohort medians → efficiency features (needs the whole population).
  const costPerM = drafts.map((d) => d.job.costPerMillionTokens).sort((a, b) => a - b);
  const tps = drafts.map((d) => d.job.tokensPerSecond).sort((a, b) => a - b);
  const medianCostPerM = costPerM[Math.floor(costPerM.length / 2)] ?? 1;
  const medianTps = tps[Math.floor(tps.length / 2)] ?? 1;

  drafts.forEach((d, i) => {
    const eff = computeEfficiency(d.job, medianCostPerM, medianTps);
    const job: TrainingJob = { ...d.job, ...eff };

    // retries for a slice of failed jobs
    if (job.status === "Failed" && rng() < 0.35) {
      job.retryOf = `${job.jobId.split("-")[0]}-${1000 + Math.max(0, i - 1)}`;
    }
    jobs.push(job);
  });

  // Pass 3: telemetry (sampled per job), billing, token usage.
  const trng = mulberry32(seed + 991);
  for (const job of jobs) {
    const points = job.status === "Queued" ? 0 : 12;
    const startMs = Date.parse(job.startedAt);
    for (let p = 0; p < points; p += 1) {
      const frac = (p + 1) / points;
      // ramp-up profile with a dip for utilization_drop style behaviour
      const rampin = clamp(frac * 3, 0.2, 1);
      const dip = job.anomalyKinds.includes("low_gpu_utilization") && frac > 0.4 && frac < 0.75 ? 0.35 : 1;
      telemetry.push({
        jobId: job.jobId,
        t: startMs + frac * job.durationHours * HOUR,
        gpuUtil: round(clamp(job.gpuUtilization * rampin * dip * (1 + gauss(trng, 0, 0.07)), 0.01, 1), 4),
        memUtil: round(clamp(job.memoryUtilization * (0.8 + 0.25 * frac) * (1 + gauss(trng, 0, 0.04)), 0.02, 1), 4),
        cpuUtil: round(clamp(job.cpuUtilization * (1 + gauss(trng, 0, 0.09)), 0.02, 1), 4),
        ramUtil: round(clamp(job.ramUtilization * (1 + gauss(trng, 0, 0.05)), 0.02, 1), 4),
        powerWatts: round(job.powerWatts * clamp(rampin * dip * (1 + gauss(trng, 0, 0.05)), 0.2, 1.1), 1),
        temperatureC: round(clamp(job.temperatureC * clamp(0.8 + 0.25 * frac * dip, 0.6, 1.1), 28, 95), 1),
      });
    }

    const day = job.startedAt.slice(0, 10);
    billing.push({
      id: `BIL-${job.jobId}-G`,
      jobId: job.jobId,
      date: day,
      category: job.status === "Failed" ? "Failed jobs" : (job.workloadType as BillingRecord["category"]),
      gpuType: job.gpuType,
      amount: round(job.gpuCost, 2),
    });
    if (job.idleHours > 0.05) {
      billing.push({
        id: `BIL-${job.jobId}-I`,
        jobId: job.jobId,
        date: day,
        category: "Idle resources",
        gpuType: job.gpuType,
        amount: round(job.idleHours * GPU_CATALOG[job.gpuType].hourlyCost * job.gpuCount * 0.55, 2),
      });
    }
    billing.push({
      id: `BIL-${job.jobId}-S`,
      jobId: job.jobId,
      date: day,
      category: "Storage",
      gpuType: null,
      amount: round(job.storageCost, 2),
    });

    const promptShare = job.workloadType === "Inference" ? 0.65 : 0.85;
    tokenUsage.push({
      id: `TOK-${job.jobId}`,
      jobId: job.jobId,
      date: day,
      modelName: job.modelName,
      workloadType: job.workloadType,
      promptTokens: Math.round(job.tokens * promptShare),
      completionTokens: Math.round(job.tokens * (1 - promptShare)),
      totalTokens: job.tokens,
      costPerMillionTokens: job.costPerMillionTokens,
    });
  }

  return {
    jobs,
    telemetry,
    billing,
    tokenUsage,
    generatedAt: new Date(now).toISOString(),
    windowStart: new Date(now - windowMs).toISOString(),
    windowEnd: new Date(now).toISOString(),
  };
}
