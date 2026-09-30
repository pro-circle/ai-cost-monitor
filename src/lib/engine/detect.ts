import { isolationForestScores, localOutlierFactor, standardize } from "./anomaly";
import { GPU_CATALOG } from "./constants";
import { getDataset } from "./dataset";
import { applyFilters, type Filters } from "./filters";
import { round } from "./random";
import { formatCurrency } from "../format";
import { groupBy, mean, quantile } from "./stats";
import type { Anomaly, AnomalyKind, Severity, TrainingJob } from "./types";

const FEATURES = [
  "gpuUtilization",
  "memoryUtilization",
  "durationHours",
  "cost",
  "tokens",
  "gpuCount",
  "idleRatio",
  "costPerMillionTokens",
] as const;

function featureRow(job: TrainingJob): number[] {
  return [
    job.gpuUtilization,
    job.memoryUtilization,
    Math.log1p(job.durationHours),
    Math.log1p(job.cost),
    Math.log1p(job.tokens),
    Math.log2(job.gpuCount + 1),
    job.idleRatio,
    Math.log1p(job.costPerMillionTokens),
  ];
}

interface Cohort {
  utilP10: number;
  utilP50: number;
  utilP90: number;
  durP90: number;
  costP90: number;
  tokensP50: number;
  tokensP90: number;
  memP90: number;
}

function cohortStats(rows: TrainingJob[]): Cohort {
  const s = (xs: number[]) => [...xs].sort((a, b) => a - b);
  const util = s(rows.map((r) => r.gpuUtilization));
  const dur = s(rows.map((r) => r.durationHours));
  const cost = s(rows.map((r) => r.cost));
  const tok = s(rows.map((r) => r.tokens));
  const mem = s(rows.map((r) => r.memoryUtilization));
  return {
    utilP10: quantile(util, 0.1),
    utilP50: quantile(util, 0.5),
    utilP90: quantile(util, 0.9),
    durP90: quantile(dur, 0.9),
    costP90: quantile(cost, 0.9),
    tokensP50: quantile(tok, 0.5),
    tokensP90: quantile(tok, 0.9),
    memP90: quantile(mem, 0.9),
  };
}

function severityFrom(score: number, ratio: number): Severity {
  if (score > 0.62 || ratio > 2.5) return "critical";
  if (score > 0.55 || ratio > 1.6) return "warning";
  return "info";
}

const KIND_META: Record<AnomalyKind, { metric: string; unit: string; cause: string; action: string }> = {
  low_gpu_utilization: {
    metric: "GPU utilization",
    unit: "%",
    cause: "Input pipeline bottleneck — data loading cannot keep the accelerator fed.",
    action: "Profile the dataloader (workers, prefetch, sharding) before adding GPUs; then reduce GPU count.",
  },
  high_memory_pressure: {
    metric: "GPU memory utilization",
    unit: "%",
    cause: "Activation memory near VRAM ceiling, forcing recompute and allocator thrash.",
    action: "Enable activation checkpointing or halve batch size; consider BF16 to cut activation bytes.",
  },
  cost_spike: {
    metric: "Run cost",
    unit: "₹",
    cause: "Instance class or run duration deviated sharply from the cohort baseline.",
    action: "Review the launch template and check for accidental on-demand premium GPU selection.",
  },
  long_duration: {
    metric: "Duration",
    unit: "h",
    cause: "Throughput collapse mid-run — stragglers or checkpoint stalls.",
    action: "Inspect step-time telemetry around the drop and re-run with gradient accumulation tuned.",
  },
  abnormal_tokens: {
    metric: "Tokens consumed",
    unit: "tokens",
    cause: "Dataset duplication or padding blow-up inflating token throughput requirements.",
    action: "Deduplicate the corpus and enable sequence packing to remove padding waste.",
  },
  utilization_drop: {
    metric: "GPU utilization (min)",
    unit: "%",
    cause: "Sudden mid-run utilization drop, typical of an I/O stall or failed shard.",
    action: "Add step-time alerting and checkpoint resumption to recover without a full restart.",
  },
  repeated_failure: {
    metric: "Job status",
    unit: "",
    cause: "Run failed, and the configuration matches an earlier failed attempt.",
    action: "Reproduce at 1/10 scale before re-submitting the full-scale job.",
  },
  over_provisioned: {
    metric: "GPU count vs utilization",
    unit: "GPUs",
    cause: "Device count exceeds what the workload can saturate; scaling efficiency is negative.",
    action: "Halve the GPU count and re-measure step time before scaling back up.",
  },
};

export function detectAnomalies(filters: Filters, limit = 200) {
  const data = getDataset();
  const { current } = applyFilters(data.jobs, filters, data.windowEnd);
  if (current.length === 0) {
    return { anomalies: [] as Anomaly[], stats: { scanned: 0, flagged: 0, critical: 0, warning: 0, info: 0, contamination: 0, estimatedWaste: 0 }, byKind: [] as { kind: AnomalyKind; count: number }[] };
  }

  // Cap the scan for responsiveness; deterministic stride keeps it reproducible.
  const stride = Math.max(1, Math.floor(current.length / 2500));
  const scanned = current.filter((_, i) => i % stride === 0);

  const X = standardize(scanned.map(featureRow));
  const iso = isolationForestScores(X, 80, 256, 1337);
  const lofSample = localOutlierFactor(X, 12, 400);

  const cohorts = new Map<string, Cohort>();
  for (const [key, rows] of groupBy(scanned, (j) => `${j.modelName}|${j.workloadType}`)) {
    if (rows.length >= 8) cohorts.set(key, cohortStats(rows));
  }
  const globalCohort = cohortStats(scanned);

  const anomalies: Anomaly[] = [];

  scanned.forEach((job, i) => {
    const score = iso[i]!;
    const lof = lofSample[i]!;
    const cohort = cohorts.get(`${job.modelName}|${job.workloadType}`) ?? globalCohort;

    const kinds = new Set<AnomalyKind>(job.anomalyKinds);
    // Rule layer on top of the unsupervised scores.
    if (job.gpuUtilization < Math.max(0.2, cohort.utilP10 * 0.6)) kinds.add("low_gpu_utilization");
    if (job.memoryUtilization > 0.93) kinds.add("high_memory_pressure");
    if (job.cost > cohort.costP90 * 1.8) kinds.add("cost_spike");
    if (job.durationHours > cohort.durP90 * 1.8) kinds.add("long_duration");
    if (job.tokens > cohort.tokensP90 * 1.8) kinds.add("abnormal_tokens");
    if (job.minGpuUtilization < job.gpuUtilization * 0.45) kinds.add("utilization_drop");
    if (job.status === "Failed" && job.retryOf) kinds.add("repeated_failure");
    if (job.gpuCount >= 8 && job.gpuUtilization < 0.45) kinds.add("over_provisioned");

    const flagged = score > 0.5 || lof > 1.35;
    if (!flagged || kinds.size === 0) return;

    for (const kind of kinds) {
      const meta = KIND_META[kind];
      const { observed, expectedMin, expectedMax, ratio } = (() => {
        switch (kind) {
          case "low_gpu_utilization":
          case "utilization_drop":
            return {
              observed: round((kind === "utilization_drop" ? job.minGpuUtilization : job.gpuUtilization) * 100, 1),
              expectedMin: round(Math.max(45, cohort.utilP50 * 100 * 0.85), 1),
              expectedMax: round(Math.min(95, cohort.utilP90 * 100), 1),
              ratio: cohort.utilP50 / Math.max(0.01, job.gpuUtilization),
            };
          case "high_memory_pressure":
            return {
              observed: round(job.memoryUtilization * 100, 1),
              expectedMin: 55,
              expectedMax: round(Math.min(92, cohort.memP90 * 100), 1),
              ratio: job.memoryUtilization / 0.85,
            };
          case "cost_spike":
            return {
              observed: round(job.cost, 2),
              expectedMin: 0,
              expectedMax: round(cohort.costP90, 2),
              ratio: job.cost / Math.max(1, cohort.costP90),
            };
          case "long_duration":
            return {
              observed: round(job.durationHours, 2),
              expectedMin: 0,
              expectedMax: round(cohort.durP90, 2),
              ratio: job.durationHours / Math.max(0.1, cohort.durP90),
            };
          case "abnormal_tokens":
            return {
              observed: round(job.tokens / 1e6, 1),
              expectedMin: 0,
              expectedMax: round(cohort.tokensP90 / 1e6, 1),
              ratio: job.tokens / Math.max(1, cohort.tokensP50),
            };
          case "repeated_failure":
            return { observed: 1, expectedMin: 0, expectedMax: 0, ratio: 2 };
          case "over_provisioned":
          default:
            return {
              observed: job.gpuCount,
              expectedMin: 1,
              expectedMax: Math.max(1, Math.round(job.gpuCount / 2)),
              ratio: job.gpuCount / Math.max(1, Math.round(job.gpuCount / 2)),
            };
        }
      })();

      const severity = severityFrom(score, ratio);
      const wasteBase =
        kind === "repeated_failure"
          ? job.cost
          : kind === "over_provisioned"
            ? job.cost * 0.3
            : kind === "low_gpu_utilization"
              ? job.cost * (1 - job.gpuUtilization / 0.75) * 0.55
              : kind === "cost_spike"
                ? Math.max(0, job.cost - cohort.costP90)
                : job.cost * 0.15;

      anomalies.push({
        id: `${job.jobId}:${kind}`,
        jobId: job.jobId,
        kind,
        severity,
        timestamp: job.startedAt,
        metric: meta.metric,
        observed,
        expectedMin,
        expectedMax,
        unit: meta.unit,
        score: round(score, 4),
        title: `${meta.metric} outside expected range on ${job.jobId}`,
        explanation:
          kind === "over_provisioned"
            ? `${job.gpuCount} × ${job.gpuType} sustained only ${(job.gpuUtilization * 100).toFixed(1)}% utilization — scaling efficiency is negative beyond ${Math.max(1, Math.round(job.gpuCount / 2))} devices.`
             : `${meta.metric} measured ${kind === "cost_spike" ? formatCurrency(observed) : `${observed}${meta.unit}`} against a cohort expectation of ${kind === "cost_spike" ? `${formatCurrency(expectedMin)}–${formatCurrency(expectedMax)}` : `${expectedMin}${meta.unit}–${expectedMax}${meta.unit}`} for ${job.modelName} ${job.workloadType.toLowerCase()} runs (isolation-forest score ${score.toFixed(3)}, LOF ${lof.toFixed(2)}).`,
        likelyCause: meta.cause,
        recommendation: meta.action,
        estimatedWaste: round(Math.max(0, wasteBase), 2),
      });
    }
  });

  anomalies.sort((a, b) => {
    const rank = { critical: 0, warning: 1, info: 2 } as const;
    if (rank[a.severity] !== rank[b.severity]) return rank[a.severity] - rank[b.severity];
    return b.estimatedWaste - a.estimatedWaste;
  });

  const byKindMap = groupBy(anomalies, (a) => a.kind);
  return {
    anomalies: anomalies.slice(0, limit),
    stats: {
      scanned: scanned.length,
      flagged: anomalies.length,
      critical: anomalies.filter((a) => a.severity === "critical").length,
      warning: anomalies.filter((a) => a.severity === "warning").length,
      info: anomalies.filter((a) => a.severity === "info").length,
      contamination: round(anomalies.length / scanned.length, 4),
      estimatedWaste: round(anomalies.reduce((a, b) => a + b.estimatedWaste, 0), 2),
      meanIsolationScore: round(mean(iso), 4),
      features: [...FEATURES],
      gpuCatalogHourly: Object.fromEntries(Object.values(GPU_CATALOG).map((g) => [g.id, g.hourlyCost])),
    },
    byKind: [...byKindMap.entries()].map(([kind, rows]) => ({ kind, count: rows.length })).sort((a, b) => b.count - a.count),
  };
}
