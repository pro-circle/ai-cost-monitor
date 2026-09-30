import { costIntelligence, gpuAnalytics, wastedCompute } from "./analytics";
import { getDataset } from "./dataset";
import { detectAnomalies } from "./detect";
import { applyFilters, type Filters } from "./filters";
import { optimizeConfiguration } from "./optimize";
import { round } from "./random";
import { groupBy, mean, sum } from "./stats";
import type { Recommendation, WorkloadConfig } from "./types";
import { formatCurrency } from "../format";

function configFromJob(job: {
  gpuType: WorkloadConfig["gpuType"];
  gpuCount: number;
  paramsB: number;
  batchSize: number;
  sequenceLength: number;
  precision: WorkloadConfig["precision"];
  tokens: number;
  epochs: number;
  trainingSteps: number;
  workloadType: WorkloadConfig["workloadType"];
}): WorkloadConfig {
  return {
    gpuType: job.gpuType,
    gpuCount: job.gpuCount,
    paramsB: job.paramsB,
    batchSize: job.batchSize,
    sequenceLength: job.sequenceLength,
    precision: job.precision,
    tokens: job.tokens,
    epochs: job.epochs,
    trainingSteps: job.trainingSteps,
    workloadType: job.workloadType,
  };
}

/** Data-driven recommendations. Every number is computed, never templated blindly. */
export function buildRecommendations(filters: Filters): Recommendation[] {
  const data = getDataset();
  const { current } = applyFilters(data.jobs, filters, data.windowEnd);
  if (current.length === 0) return [];

  const recs: Recommendation[] = [];
  const totalCost = sum(current.map((j) => j.cost));
  const waste = wastedCompute(filters);

  // 1. Cost: fleet-level under-utilization
  const lowUtil = current.filter((j) => j.gpuUtilization < 0.45);
  if (lowUtil.length > 0) {
    const lowCost = sum(lowUtil.map((j) => j.cost));
    recs.push({
      id: "rec-low-utilization",
      category: "GPU utilization",
      title: `${lowUtil.length} workloads run below 45% GPU utilization`,
      reason: `Mean utilization across these runs is ${(mean(lowUtil.map((j) => j.gpuUtilization)) * 100).toFixed(1)}%, and they represent ${((lowCost / totalCost) * 100).toFixed(1)}% of spend (${formatCurrency(lowCost)}).`,
      expectedImpact: "Right-sizing device counts recovers idle GPU-hours without changing token throughput.",
      estimatedSavings: round(waste.buckets.find((b) => b.key === "low_utilization")?.waste ?? 0, 2),
      confidence: 0.86,
      action: "Halve GPU count on the flagged runs and re-measure step time before scaling back up.",
      jobIds: lowUtil.slice(0, 6).map((j) => j.jobId),
    });
  }

  // 2. Configuration: FP32 workloads that could move to BF16
  const fp32 = current.filter((j) => j.precision === "FP32");
  if (fp32.length > 0) {
    const sample = fp32.slice(0, 40);
    const savings = sum(
      sample.map((j) => {
        const opt = optimizeConfiguration(configFromJob(j), { allowGpuTypeChange: false, allowPrecisionChange: true });
        return Math.max(0, opt.recommended?.savings ?? 0);
      }),
    );
    const scaled = savings * (fp32.length / sample.length);
    recs.push({
      id: "rec-precision",
      category: "Memory",
      title: `${fp32.length} runs still execute in FP32`,
      reason: `FP32 halves tensor-core throughput and doubles activation bytes. Optimizing ${sample.length} sampled runs to BF16 yielded ${formatCurrency(savings)} in modelled savings.`,
      expectedImpact: "BF16 keeps numerical range while roughly halving memory footprint per activation.",
      estimatedSavings: round(scaled, 2),
      confidence: 0.79,
      action: "Switch the training precision flag to BF16 and validate loss curves for one epoch.",
      jobIds: fp32.slice(0, 6).map((j) => j.jobId),
    });
  }

  // 3. Cost concentration
  const sorted = [...current].sort((a, b) => b.cost - a.cost);
  const top3 = sorted.slice(0, 3);
  const top3Share = (sum(top3.map((j) => j.cost)) / totalCost) * 100;
  if (top3Share > 8) {
    recs.push({
      id: "rec-cost-concentration",
      category: "Cost",
      title: `${top3.length} workloads drive ${top3Share.toFixed(1)}% of total compute cost`,
      reason: `${top3.map((j) => `${j.jobId} (${formatCurrency(j.cost)})`).join(", ")} dominate spend in this window.`,
      expectedImpact: "Optimizing the heaviest runs first gives the largest absolute cost reduction per engineering hour.",
      estimatedSavings: round(sum(top3.map((j) => (optimizeConfiguration(configFromJob(j)).recommended?.savings ?? 0))), 2),
      confidence: 0.83,
      action: "Run the optimization engine on each of these job configurations and apply the recommended profile.",
      jobIds: top3.map((j) => j.jobId),
    });
  }

  // 4. Training: failures
  const failed = current.filter((j) => j.status === "Failed");
  if (failed.length > 0) {
    recs.push({
      id: "rec-failures",
      category: "Training",
      title: `${failed.length} failed runs burned ${formatCurrency(sum(failed.map((j) => j.cost)))}`,
      reason: `Failure rate is ${((failed.length / current.length) * 100).toFixed(1)}% of workloads in this window; ${failed.filter((j) => j.retryOf).length} were retries of an earlier failed configuration.`,
      expectedImpact: "Pre-flight validation at reduced scale removes almost all of this spend.",
      estimatedSavings: round(sum(failed.map((j) => j.cost)) * 0.7, 2),
      confidence: 0.9,
      action: "Add a 1/10-scale smoke run gate to the submission pipeline.",
      jobIds: failed.slice(0, 6).map((j) => j.jobId),
    });
  }

  // 5. Performance: sequence length oversizing
  const oversizedCtx = current.filter((j) => j.sequenceLength >= 16384 && j.memoryUtilization < 0.55);
  if (oversizedCtx.length > 0) {
    recs.push({
      id: "rec-sequence",
      category: "Performance",
      title: `${oversizedCtx.length} runs use 16k+ context at under 55% memory pressure`,
      reason: `Attention cost grows with sequence length; these runs average ${(mean(oversizedCtx.map((j) => j.memoryUtilization)) * 100).toFixed(1)}% VRAM use, so context is oversized for the data.`,
      expectedImpact: "Halving context length reduces attention FLOPs superlinearly.",
      estimatedSavings: round(waste.buckets.find((b) => b.key === "excessive_sequence")?.waste ?? 0, 2),
      confidence: 0.72,
      action: "Measure the 99th-percentile sample length and set sequence length just above it with packing enabled.",
      jobIds: oversizedCtx.slice(0, 6).map((j) => j.jobId),
    });
  }

  // 6. GPU type arbitrage
  const byGpu = gpuAnalytics(filters).perGpu;
  const worst = [...byGpu].sort((a, b) => a.efficiencyScore - b.efficiencyScore)[0];
  const best = [...byGpu].sort((a, b) => b.efficiencyScore - a.efficiencyScore)[0];
  if (worst && best && worst.gpuType !== best.gpuType && best.efficiencyScore - worst.efficiencyScore > 6) {
    recs.push({
      id: "rec-gpu-mix",
      category: "Configuration",
      title: `${worst.gpuType} fleet scores ${worst.efficiencyScore} vs ${best.efficiencyScore} on ${best.gpuType}`,
      reason: `${worst.gpuType} runs average ${worst.avgUtilization}% utilization at ${formatCurrency(worst.spec.hourlyCost)}/GPU-hour, versus ${best.avgUtilization}% on ${best.gpuType}.`,
      expectedImpact: "Migrating a share of the workload mix raises fleet-wide efficiency at equal throughput.",
      estimatedSavings: round(worst.cost * 0.12, 2),
      confidence: 0.68,
      action: `Pilot three ${worst.gpuType} workloads on ${best.gpuType} and compare cost per million tokens.`,
      jobIds: [],
    });
  }

  // 7. Idle capacity
  const idleWaste = waste.buckets.find((b) => b.key === "idle_gpus");
  if (idleWaste && idleWaste.waste > 0) {
    recs.push({
      id: "rec-idle",
      category: "Cost",
      title: `Idle GPU time costs ${formatCurrency(idleWaste.waste)} in this window`,
      reason: `${idleWaste.jobs} workloads hold devices idle for more than 20% of wall-clock time.`,
      expectedImpact: "Queue packing and preemptible backfill convert idle capacity into useful work.",
      estimatedSavings: round(idleWaste.waste * 0.75, 2),
      confidence: 0.75,
      action: "Enable backfill scheduling and shorten reservation windows to the measured p95 run time.",
      jobIds: [],
    });
  }

  return recs.sort((a, b) => b.estimatedSavings - a.estimatedSavings);
}

/** Natural-language insights derived only from computed analytics. */
export function buildInsights(filters: Filters): { id: string; category: string; text: string; magnitude: number }[] {
  const data = getDataset();
  const { current, previous } = applyFilters(data.jobs, filters, data.windowEnd);
  if (current.length === 0) return [];

  const insights: { id: string; category: string; text: string; magnitude: number }[] = [];
  const totalCost = sum(current.map((j) => j.cost));

  const util = mean(current.map((j) => j.gpuUtilization)) * 100;
  const prevUtil = previous.length ? mean(previous.map((j) => j.gpuUtilization)) * 100 : util;
  if (Math.abs(util - prevUtil) > 0.5) {
    const dir = util < prevUtil ? "decreased" : "increased";
    insights.push({
      id: "ins-util",
      category: "GPU utilization",
      text: `GPU utilization ${dir} by ${Math.abs(((util - prevUtil) / prevUtil) * 100).toFixed(1)}% versus the previous period (now ${util.toFixed(1)}%).`,
      magnitude: Math.abs(util - prevUtil),
    });
  }

  const byWorkload = groupBy(current, (j) => j.workloadType);
  const shares = [...byWorkload.entries()]
    .map(([k, rows]) => ({ k, share: (sum(rows.map((r) => r.cost)) / totalCost) * 100 }))
    .sort((a, b) => b.share - a.share);
  if (shares[0]) {
    insights.push({
      id: "ins-workload-share",
      category: "Cost",
      text: `${shares[0].k} workloads account for ${shares[0].share.toFixed(1)}% of compute expenditure in this window.`,
      magnitude: shares[0].share,
    });
  }

  const sorted = [...current].sort((a, b) => b.cost - a.cost);
  const top3Share = (sum(sorted.slice(0, 3).map((j) => j.cost)) / totalCost) * 100;
  insights.push({
    id: "ins-concentration",
    category: "Cost",
    text: `3 workloads are responsible for ${top3Share.toFixed(1)}% of total GPU cost (${formatCurrency(sum(sorted.slice(0, 3).map((j) => j.cost)))}).`,
    magnitude: top3Share,
  });

  const anomalies = detectAnomalies(filters, 30);
  const worst = anomalies.anomalies[0];
  if (worst) {
    insights.push({
      id: "ins-anomaly",
      category: "Anomalies",
      text: `Job ${worst.jobId} shows ${worst.metric.toLowerCase()} of ${worst.unit === "₹" ? formatCurrency(worst.observed) : `${worst.observed}${worst.unit}`} against an expected ${worst.unit === "₹" ? `${formatCurrency(worst.expectedMin)}–${formatCurrency(worst.expectedMax)}` : `${worst.expectedMin}${worst.unit}–${worst.expectedMax}${worst.unit}`} for comparable workloads.`,
      magnitude: worst.estimatedWaste,
    });
  }

  const bigJob = sorted.find((j) => j.gpuCount >= 8 && j.gpuUtilization < 0.55);
  if (bigJob) {
    const opt = optimizeConfiguration(configFromJob(bigJob));
    if (opt.recommended && opt.recommended.savings > 0) {
      const monthly = opt.recommended.savings * 30;
      insights.push({
        id: "ins-optimize",
        category: "Optimization",
        text: `Reducing ${bigJob.jobId} from ${bigJob.gpuCount} to ${opt.recommended.config.gpuCount} GPUs is estimated to save ${formatCurrency(opt.recommended.savings)} per run (~${formatCurrency(monthly)}/month at daily cadence).`,
        magnitude: opt.recommended.savings,
      });
    }
  }

  const ci = costIntelligence(filters);
  insights.push({
    id: "ins-forecast",
    category: "Forecast",
    text: `At the current run-rate of ${formatCurrency(ci.totals.dailySpend)}/day, the next 30 days project to ${formatCurrency(ci.totals.monthlySpend)} (trend R² ${ci.totals.trendR2}).`,
    magnitude: ci.totals.monthlySpend,
  });

  const tokenHogs = [...current]
    .map((j) => ({ j, ratio: j.tokens / Math.max(1, mean(current.filter((x) => x.workloadType === j.workloadType).map((x) => x.tokens))) }))
    .sort((a, b) => b.ratio - a.ratio)[0];
  if (tokenHogs && tokenHogs.ratio > 1.8) {
    insights.push({
      id: "ins-tokens",
      category: "Performance",
      text: `Job ${tokenHogs.j.jobId} consumes ${tokenHogs.ratio.toFixed(1)}× more tokens than similar ${tokenHogs.j.workloadType.toLowerCase()} workloads.`,
      magnitude: tokenHogs.ratio,
    });
  }

  return insights;
}
