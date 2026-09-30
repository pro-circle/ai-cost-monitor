import { GPU_CATALOG, GPU_TYPES, MODEL_CATALOG, WORKLOAD_TYPES } from "./constants";
import { getDataset, getTelemetry } from "./dataset";
import { applyFilters, type Filters } from "./filters";
import { boxPlot, correlationMatrix, groupBy, histogram, linearFit, mean, quantile, summarize, sum } from "./stats";
import { round } from "./random";
import type { BillingRecord, GpuTypeId, TrainingJob, WorkloadType } from "./types";

/* ------------------------------- small helpers ------------------------------- */

function pctChange(current: number, previous: number): number {
  if (!previous) return 0;
  return ((current - previous) / previous) * 100;
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function bucketKey(ms: number, bucketMs: number): number {
  return Math.floor(ms / bucketMs) * bucketMs;
}

export interface Kpi {
  key: string;
  label: string;
  value: number;
  previous: number;
  changePct: number;
  unit: "currency" | "percent" | "hours" | "number";
  direction: "up-good" | "down-good";
  status: "good" | "warn" | "bad";
  sparkline: { t: number; v: number }[];
  hint: string;
}

function sparkline(jobs: TrainingJob[], fromMs: number, toMs: number, valueFn: (j: TrainingJob[]) => number) {
  const buckets = 14;
  const span = Math.max(1, toMs - fromMs);
  const width = span / buckets;
  const out: { t: number; v: number }[] = [];
  for (let i = 0; i < buckets; i += 1) {
    const lo = fromMs + i * width;
    const hi = lo + width;
    const slice = jobs.filter((j) => {
      const t = Date.parse(j.startedAt);
      return t >= lo && t < hi;
    });
    out.push({ t: lo, v: round(valueFn(slice), 3) });
  }
  return out;
}

/* --------------------------------- dashboard -------------------------------- */

export function dashboardSummary(filters: Filters) {
  const data = getDataset();
  const { current, previous, window } = applyFilters(data.jobs, filters, data.windowEnd);

  const totalCost = sum(current.map((j) => j.cost));
  const prevCost = sum(previous.map((j) => j.cost));
  const util = current.length ? mean(current.map((j) => j.gpuUtilization)) * 100 : 0;
  const prevUtil = previous.length ? mean(previous.map((j) => j.gpuUtilization)) * 100 : 0;
  const gpuHours = sum(current.map((j) => j.gpuHours));
  const prevGpuHours = sum(previous.map((j) => j.gpuHours));
  const tokens = sum(current.map((j) => j.tokens));
  const prevTokens = sum(previous.map((j) => j.tokens));
  const costPerM = tokens > 0 ? totalCost / (tokens / 1e6) : 0;
  const prevCostPerM = prevTokens > 0 ? prevCost / (prevTokens / 1e6) : 0;

  const spanDays = Math.max(1, (window.toMs - window.fromMs) / 86400_000);
  const dailyRate = totalCost / spanDays;
  const predictedMonthly = dailyRate * 30;
  const prevPredictedMonthly = (prevCost / spanDays) * 30;

  const waste = wastedCompute(filters);
  const potentialSavings = waste.totalWaste;

  const kpis: Kpi[] = [
    {
      key: "total_cost",
      label: "Total Compute Cost",
      value: round(totalCost, 2),
      previous: round(prevCost, 2),
      changePct: round(pctChange(totalCost, prevCost), 1),
      unit: "currency",
      direction: "down-good",
      status: totalCost <= prevCost ? "good" : "warn",
      sparkline: sparkline(current, window.fromMs, window.toMs, (s) => sum(s.map((j) => j.cost))),
      hint: `${current.length.toLocaleString()} workloads in range`,
    },
    {
      key: "gpu_utilization",
      label: "GPU Utilization",
      value: round(util, 1),
      previous: round(prevUtil, 1),
      changePct: round(pctChange(util, prevUtil), 1),
      unit: "percent",
      direction: "up-good",
      status: util >= 70 ? "good" : util >= 50 ? "warn" : "bad",
      sparkline: sparkline(current, window.fromMs, window.toMs, (s) => (s.length ? mean(s.map((j) => j.gpuUtilization)) * 100 : 0)),
      hint: "Fleet-wide mean MFU-derived utilization",
    },
    {
      key: "gpu_hours",
      label: "Total GPU Hours",
      value: round(gpuHours, 1),
      previous: round(prevGpuHours, 1),
      changePct: round(pctChange(gpuHours, prevGpuHours), 1),
      unit: "hours",
      direction: "down-good",
      status: "good",
      sparkline: sparkline(current, window.fromMs, window.toMs, (s) => sum(s.map((j) => j.gpuHours))),
      hint: `${round(sum(current.map((j) => j.idleHours * j.gpuCount)), 1).toLocaleString()} idle GPU-hours included`,
    },
    {
      key: "cost_per_million_tokens",
      label: "Cost / 1M Tokens",
      value: round(costPerM, 3),
      previous: round(prevCostPerM, 3),
      changePct: round(pctChange(costPerM, prevCostPerM), 1),
      unit: "currency",
      direction: "down-good",
      status: costPerM <= prevCostPerM ? "good" : "warn",
      sparkline: sparkline(current, window.fromMs, window.toMs, (s) => {
        const tk = sum(s.map((j) => j.tokens));
        return tk > 0 ? sum(s.map((j) => j.cost)) / (tk / 1e6) : 0;
      }),
      hint: `${(tokens / 1e9).toFixed(1)}B tokens processed`,
    },
    {
      key: "predicted_monthly_cost",
      label: "Predicted Monthly Cost",
      value: round(predictedMonthly, 2),
      previous: round(prevPredictedMonthly, 2),
      changePct: round(pctChange(predictedMonthly, prevPredictedMonthly), 1),
      unit: "currency",
      direction: "down-good",
      status: predictedMonthly <= prevPredictedMonthly ? "good" : "warn",
      sparkline: sparkline(current, window.fromMs, window.toMs, (s) => sum(s.map((j) => j.cost)) * (30 / spanDays) / 14),
      hint: `Run-rate projection from $${round(dailyRate, 2).toLocaleString()}/day`,
    },
    {
      key: "potential_savings",
      label: "Potential Savings",
      value: round(potentialSavings, 2),
      previous: 0,
      changePct: round(totalCost > 0 ? (potentialSavings / totalCost) * 100 : 0, 1),
      unit: "currency",
      direction: "up-good",
      status: potentialSavings / Math.max(1, totalCost) > 0.15 ? "bad" : "warn",
      sparkline: sparkline(current, window.fromMs, window.toMs, (s) =>
        sum(s.filter((j) => j.gpuUtilization < 0.45).map((j) => j.cost * 0.35)),
      ),
      hint: `${round(totalCost > 0 ? (potentialSavings / totalCost) * 100 : 0, 1)}% of spend is recoverable`,
    },
  ];

  return {
    kpis,
    window: { from: new Date(window.fromMs).toISOString(), to: new Date(window.toMs).toISOString(), label: window.label },
    counts: {
      jobs: current.length,
      running: current.filter((j) => j.status === "Running").length,
      failed: current.filter((j) => j.status === "Failed").length,
      anomalous: current.filter((j) => j.anomalyKinds.length > 0).length,
    },
  };
}

export function utilizationSeries(filters: Filters) {
  const data = getDataset();
  const { current, window } = applyFilters(data.jobs, filters, data.windowEnd);
  const span = window.toMs - window.fromMs;
  const buckets = span <= 36 * 3600_000 ? 24 : span <= 8 * 86400_000 ? 28 : 30;
  const bucketMs = span / buckets;
  const map = new Map<number, TrainingJob[]>();
  for (const job of current) {
    const key = bucketKey(Date.parse(job.startedAt) - window.fromMs, bucketMs) + window.fromMs;
    const arr = map.get(key);
    if (arr) arr.push(job);
    else map.set(key, [job]);
  }
  const out: { t: number; avg: number; peak: number; min: number; jobs: number }[] = [];
  for (let i = 0; i < buckets; i += 1) {
    const key = window.fromMs + i * bucketMs;
    const slice = map.get(bucketKey(key - window.fromMs, bucketMs) + window.fromMs) ?? [];
    out.push({
      t: Math.round(key),
      avg: slice.length ? round(mean(slice.map((j) => j.gpuUtilization)) * 100, 2) : 0,
      peak: slice.length ? round(Math.max(...slice.map((j) => j.peakGpuUtilization)) * 100, 2) : 0,
      min: slice.length ? round(Math.min(...slice.map((j) => j.minGpuUtilization)) * 100, 2) : 0,
      jobs: slice.length,
    });
  }
  return out;
}

export function costTrend(filters: Filters) {
  const data = getDataset();
  const { current, window } = applyFilters(data.jobs, filters, data.windowEnd);
  const byDay = groupBy(current, (j) => dayKey(j.startedAt));
  const days = [...byDay.keys()].sort();
  const daily = days.map((d) => ({
    date: d,
    cost: round(sum(byDay.get(d)!.map((j) => j.cost)), 2),
    gpuHours: round(sum(byDay.get(d)!.map((j) => j.gpuHours)), 2),
    jobs: byDay.get(d)!.length,
  }));
  // cumulative + trend projection using OLS on day index
  const xs = daily.map((_, i) => i);
  const fit = linearFit(xs, daily.map((d) => d.cost));
  const withTrend = daily.map((d, i) => ({
    ...d,
    trend: round(Math.max(0, fit.intercept + fit.slope * i), 2),
  }));
  const spanDays = Math.max(1, (window.toMs - window.fromMs) / 86400_000);
  const totalCost = sum(daily.map((d) => d.cost));
  const weekly = round((totalCost / spanDays) * 7, 2);
  return {
    daily: withTrend,
    weekly,
    monthlyProjection: round((totalCost / spanDays) * 30, 2),
    trendR2: round(fit.r2, 3),
    trendSlopePerDay: round(fit.slope, 2),
  };
}

export function costByGpuType(filters: Filters) {
  const data = getDataset();
  const { current } = applyFilters(data.jobs, filters, data.windowEnd);
  const grouped = groupBy(current, (j) => j.gpuType);
  return GPU_TYPES.filter((g) => grouped.has(g)).map((g) => {
    const rows = grouped.get(g)!;
    return {
      gpuType: g,
      cost: round(sum(rows.map((j) => j.cost)), 2),
      gpuHours: round(sum(rows.map((j) => j.gpuHours)), 1),
      avgUtilization: round(mean(rows.map((j) => j.gpuUtilization)) * 100, 1),
      jobs: rows.length,
      hourlyRate: GPU_CATALOG[g].hourlyCost,
      costPerMillionTokens: round(sum(rows.map((j) => j.cost)) / Math.max(0.0001, sum(rows.map((j) => j.tokens)) / 1e6), 3),
    };
  });
}

export function costVsTokens(filters: Filters, limit = 600) {
  const data = getDataset();
  const { current } = applyFilters(data.jobs, filters, data.windowEnd);
  const step = Math.max(1, Math.floor(current.length / limit));
  return current
    .filter((_, i) => i % step === 0)
    .map((j) => ({
      jobId: j.jobId,
      tokensM: round(j.tokens / 1e6, 2),
      cost: j.cost,
      gpuType: j.gpuType,
      workloadType: j.workloadType,
      utilization: round(j.gpuUtilization * 100, 1),
    }));
}

export function utilizationHistogram(filters: Filters) {
  const data = getDataset();
  const { current } = applyFilters(data.jobs, filters, data.windowEnd);
  return histogram(current.map((j) => j.gpuUtilization * 100), 20, 0, 100).map((b) => ({
    bin: `${b.from.toFixed(0)}-${b.to.toFixed(0)}%`,
    count: b.count,
    from: round(b.from, 1),
  }));
}

export function trainingTimeVsGpuCount(filters: Filters) {
  const data = getDataset();
  const { current } = applyFilters(data.jobs, filters, data.windowEnd);
  const grouped = groupBy(
    current.filter((j) => j.workloadType === "Training" || j.workloadType === "Fine-tuning"),
    (j) => String(j.gpuCount),
  );
  return [...grouped.entries()]
    .map(([k, rows]) => ({
      gpuCount: Number(k),
      medianDuration: round(quantile([...rows.map((r) => r.durationHours)].sort((a, b) => a - b), 0.5), 2),
      avgDuration: round(mean(rows.map((r) => r.durationHours)), 2),
      avgCost: round(mean(rows.map((r) => r.cost)), 2),
      avgUtilization: round(mean(rows.map((r) => r.gpuUtilization)) * 100, 1),
      jobs: rows.length,
    }))
    .sort((a, b) => a.gpuCount - b.gpuCount);
}

export function costBreakdown(filters: Filters) {
  const data = getDataset();
  const { current } = applyFilters(data.jobs, filters, data.windowEnd);
  const jobIds = new Set(current.map((j) => j.jobId));
  const rows = data.billing.filter((b) => b.jobId && jobIds.has(b.jobId));
  const grouped = groupBy(rows, (r) => r.category);
  const categories: BillingRecord["category"][] = [
    "Training",
    "Fine-tuning",
    "Inference",
    "Evaluation",
    "Idle resources",
    "Failed jobs",
    "Storage",
    "Network",
    "Other",
  ];
  const total = sum(rows.map((r) => r.amount));
  return categories
    .filter((c) => grouped.has(c))
    .map((c) => {
      const amount = sum(grouped.get(c)!.map((r) => r.amount));
      return { category: c, amount: round(amount, 2), share: round(total ? (amount / total) * 100 : 0, 1) };
    })
    .sort((a, b) => b.amount - a.amount);
}

/* -------------------------------- workloads --------------------------------- */

export interface WorkloadQuery extends Filters {
  page?: number;
  pageSize?: number;
  sortBy?: keyof TrainingJob;
  sortDir?: "asc" | "desc";
}

export function listWorkloads(query: WorkloadQuery) {
  const data = getDataset();
  const { current } = applyFilters(data.jobs, query, data.windowEnd);
  const sortBy = query.sortBy ?? "cost";
  const dir = query.sortDir === "asc" ? 1 : -1;
  const sorted = [...current].sort((a, b) => {
    const av = a[sortBy];
    const bv = b[sortBy];
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(200, query.pageSize ?? 25);
  const start = (page - 1) * pageSize;
  return {
    rows: sorted.slice(start, start + pageSize),
    total: sorted.length,
    page,
    pageSize,
    totals: {
      cost: round(sum(current.map((j) => j.cost)), 2),
      gpuHours: round(sum(current.map((j) => j.gpuHours)), 1),
      avgEfficiency: round(current.length ? mean(current.map((j) => j.efficiencyScore)) : 0, 1),
    },
  };
}

export function workloadFacets() {
  const data = getDataset();
  return {
    gpuTypes: GPU_TYPES,
    workloadTypes: [...WORKLOAD_TYPES] as WorkloadType[],
    models: MODEL_CATALOG.map((m) => m.name),
    statuses: ["Running", "Completed", "Failed", "Queued", "Anomalous"],
    clusters: [...new Set(data.jobs.map((j) => j.cluster))].sort(),
    costRange: [0, Math.ceil(Math.max(...data.jobs.map((j) => j.cost)))] as [number, number],
  };
}

export function workloadDetail(jobId: string) {
  const data = getDataset();
  const job = data.jobs.find((j) => j.jobId === jobId);
  if (!job) return null;
  const telemetry = getTelemetry(jobId).map((p) => ({
    t: p.t,
    gpuUtil: round(p.gpuUtil * 100, 1),
    memUtil: round(p.memUtil * 100, 1),
    cpuUtil: round(p.cpuUtil * 100, 1),
    ramUtil: round(p.ramUtil * 100, 1),
    powerWatts: p.powerWatts,
    temperatureC: p.temperatureC,
  }));

  const peers = data.jobs.filter(
    (j) => j.modelName === job.modelName && j.workloadType === job.workloadType && j.jobId !== job.jobId,
  );
  const peerStats = {
    count: peers.length,
    medianCost: round(quantile([...peers.map((p) => p.cost)].sort((a, b) => a - b), 0.5), 2),
    medianUtilization: round(quantile([...peers.map((p) => p.gpuUtilization)].sort((a, b) => a - b), 0.5) * 100, 1),
    medianDuration: round(quantile([...peers.map((p) => p.durationHours)].sort((a, b) => a - b), 0.5), 2),
    medianTokens: round(quantile([...peers.map((p) => p.tokens)].sort((a, b) => a - b), 0.5) / 1e6, 1),
  };

  const billing = data.billing.filter((b) => b.jobId === jobId);
  const tokens = data.tokenUsage.find((t) => t.jobId === jobId) ?? null;

  return { job, telemetry, peerStats, billing, tokens };
}

/* ------------------------------- GPU analytics ------------------------------ */

export function gpuAnalytics(filters: Filters) {
  const data = getDataset();
  const { current, window } = applyFilters(data.jobs, filters, data.windowEnd);

  const byGpu = groupBy(current, (j) => j.gpuType);
  const perGpu = GPU_TYPES.filter((g) => byGpu.has(g)).map((g) => {
    const rows = byGpu.get(g)!;
    const gpuHours = sum(rows.map((j) => j.gpuHours));
    const idle = sum(rows.map((j) => j.idleHours * j.gpuCount));
    return {
      gpuType: g,
      spec: GPU_CATALOG[g],
      jobs: rows.length,
      avgUtilization: round(mean(rows.map((j) => j.gpuUtilization)) * 100, 1),
      peakUtilization: round(Math.max(...rows.map((j) => j.peakGpuUtilization)) * 100, 1),
      memoryUtilization: round(mean(rows.map((j) => j.memoryUtilization)) * 100, 1),
      avgPowerWatts: round(mean(rows.map((j) => j.powerWatts)), 0),
      energyKwh: round(sum(rows.map((j) => j.energyKwh)), 1),
      avgTemperatureC: round(mean(rows.map((j) => j.temperatureC)), 1),
      gpuHours: round(gpuHours, 1),
      idleHours: round(idle, 1),
      activeHours: round(gpuHours - idle, 1),
      cost: round(sum(rows.map((j) => j.cost)), 2),
      efficiencyScore: round(mean(rows.map((j) => j.efficiencyScore)), 1),
    };
  });

  const byModel = [...groupBy(current, (j) => j.modelName).entries()]
    .map(([modelName, rows]) => ({
      modelName,
      jobs: rows.length,
      avgUtilization: round(mean(rows.map((j) => j.gpuUtilization)) * 100, 1),
      gpuHours: round(sum(rows.map((j) => j.gpuHours)), 1),
      cost: round(sum(rows.map((j) => j.cost)), 2),
      efficiencyScore: round(mean(rows.map((j) => j.efficiencyScore)), 1),
    }))
    .sort((a, b) => b.gpuHours - a.gpuHours);

  const byCluster = [...groupBy(current, (j) => j.cluster).entries()]
    .map(([cluster, rows]) => ({
      cluster,
      jobs: rows.length,
      avgUtilization: round(mean(rows.map((j) => j.gpuUtilization)) * 100, 1),
      idleRatio: round(mean(rows.map((j) => j.idleRatio)) * 100, 1),
      gpuHours: round(sum(rows.map((j) => j.gpuHours)), 1),
      cost: round(sum(rows.map((j) => j.cost)), 2),
      efficiencyScore: round(mean(rows.map((j) => j.efficiencyScore)), 1),
    }))
    .sort((a, b) => b.cost - a.cost);

  const byWorkload = [...groupBy(current, (j) => j.workloadType).entries()].map(([workloadType, rows]) => ({
    workloadType,
    jobs: rows.length,
    avgUtilization: round(mean(rows.map((j) => j.gpuUtilization)) * 100, 1),
    gpuHours: round(sum(rows.map((j) => j.gpuHours)), 1),
    cost: round(sum(rows.map((j) => j.cost)), 2),
    efficiencyScore: round(mean(rows.map((j) => j.efficiencyScore)), 1),
  }));

  // Heatmap: hour-of-day (x) × GPU type (y) average utilization
  const heatmap: { gpuType: GpuTypeId; hour: number; utilization: number; jobs: number }[] = [];
  for (const g of GPU_TYPES) {
    const rows = byGpu.get(g) ?? [];
    for (let h = 0; h < 24; h += 1) {
      const slice = rows.filter((j) => new Date(j.startedAt).getUTCHours() === h);
      heatmap.push({
        gpuType: g,
        hour: h,
        utilization: slice.length ? round(mean(slice.map((j) => j.gpuUtilization)) * 100, 1) : 0,
        jobs: slice.length,
      });
    }
  }

  const fleet = {
    avgUtilization: round(current.length ? mean(current.map((j) => j.gpuUtilization)) * 100 : 0, 1),
    memoryUtilization: round(current.length ? mean(current.map((j) => j.memoryUtilization)) * 100 : 0, 1),
    gpuHours: round(sum(current.map((j) => j.gpuHours)), 1),
    idleHours: round(sum(current.map((j) => j.idleHours * j.gpuCount)), 1),
    energyKwh: round(sum(current.map((j) => j.energyKwh)), 1),
    efficiencyScore: round(current.length ? mean(current.map((j) => j.efficiencyScore)) : 0, 1),
    window: { from: new Date(window.fromMs).toISOString(), to: new Date(window.toMs).toISOString() },
  };

  return { perGpu, byModel, byCluster, byWorkload, heatmap, fleet };
}

/* ----------------------------- cost intelligence ---------------------------- */

export function wastedCompute(filters: Filters) {
  const data = getDataset();
  const { current } = applyFilters(data.jobs, filters, data.windowEnd);

  const lowUtil = current.filter((j) => j.gpuUtilization < 0.45 && j.status !== "Queued");
  const idle = current.filter((j) => j.idleRatio > 0.2);
  const failed = current.filter((j) => j.status === "Failed");
  const repeated = current.filter((j) => j.retryOf !== null);
  const overProvisioned = current.filter((j) => j.gpuCount >= 8 && j.gpuUtilization < 0.5);
  const longSequences = current.filter((j) => j.sequenceLength >= 16384 && j.memoryUtilization < 0.55);
  const badBatch = current.filter((j) => j.batchSize <= 4 && j.gpuUtilization < 0.6);

  const buckets = [
    {
      key: "low_utilization",
      label: "Low GPU utilization",
      jobs: lowUtil.length,
      waste: round(sum(lowUtil.map((j) => j.cost * (1 - j.gpuUtilization / 0.75) * 0.55)), 2),
      detail: "Jobs running below 45% GPU utilization pay for idle silicon.",
    },
    {
      key: "idle_gpus",
      label: "Idle GPUs",
      jobs: idle.length,
      waste: round(sum(idle.map((j) => j.idleHours * j.gpuCount * GPU_CATALOG[j.gpuType].hourlyCost * 0.6)), 2),
      detail: "GPU-hours billed while the device was not executing work.",
    },
    {
      key: "failed_jobs",
      label: "Failed jobs",
      jobs: failed.length,
      waste: round(sum(failed.map((j) => j.cost)), 2),
      detail: "Compute spent on runs that produced no usable artifact.",
    },
    {
      key: "repeated_jobs",
      label: "Repeated jobs",
      jobs: repeated.length,
      waste: round(sum(repeated.map((j) => j.cost * 0.8)), 2),
      detail: "Retries of previously failed configurations.",
    },
    {
      key: "over_provisioned",
      label: "Over-provisioned GPUs",
      jobs: overProvisioned.length,
      waste: round(sum(overProvisioned.map((j) => j.cost * 0.3)), 2),
      detail: "8+ GPU jobs that never exceeded 50% utilization.",
    },
    {
      key: "excessive_sequence",
      label: "Excessive sequence lengths",
      jobs: longSequences.length,
      waste: round(sum(longSequences.map((j) => j.cost * 0.18)), 2),
      detail: "16k+ context with low memory pressure — context is oversized.",
    },
    {
      key: "inefficient_batch",
      label: "Inefficient batch sizes",
      jobs: badBatch.length,
      waste: round(sum(badBatch.map((j) => j.cost * 0.22)), 2),
      detail: "Micro-batches starve the accelerator pipeline.",
    },
  ];

  return { buckets, totalWaste: round(sum(buckets.map((b) => b.waste)), 2), totalCost: round(sum(current.map((j) => j.cost)), 2) };
}

export function costIntelligence(filters: Filters) {
  const data = getDataset();
  const { current, previous, window } = applyFilters(data.jobs, filters, data.windowEnd);
  const spanDays = Math.max(1, (window.toMs - window.fromMs) / 86400_000);
  const totalCost = sum(current.map((j) => j.cost));
  const tokens = sum(current.map((j) => j.tokens));
  const gpuHours = sum(current.map((j) => j.gpuHours));
  const steps = sum(current.map((j) => j.trainingSteps));

  const byDay = groupBy(current, (j) => dayKey(j.startedAt));
  const dailySeries = [...byDay.keys()].sort().map((d) => ({
    date: d,
    cost: round(sum(byDay.get(d)!.map((j) => j.cost)), 2),
  }));
  const xs = dailySeries.map((_, i) => i);
  const fit = linearFit(xs, dailySeries.map((d) => d.cost));
  const forecast = Array.from({ length: 14 }, (_, i) => {
    const idx = dailySeries.length + i;
    const base = Math.max(0, fit.intercept + fit.slope * idx);
    return {
      date: new Date(window.toMs + (i + 1) * 86400_000).toISOString().slice(0, 10),
      forecast: round(base, 2),
      lower: round(base * 0.86, 2),
      upper: round(base * 1.14, 2),
    };
  });

  const topExpensive = [...current].sort((a, b) => b.cost - a.cost).slice(0, 10);

  return {
    totals: {
      totalSpend: round(totalCost, 2),
      previousSpend: round(sum(previous.map((j) => j.cost)), 2),
      dailySpend: round(totalCost / spanDays, 2),
      monthlySpend: round((totalCost / spanDays) * 30, 2),
      forecastedSpend: round(sum(forecast.map((f) => f.forecast)), 2),
      costPerGpuHour: round(gpuHours ? totalCost / gpuHours : 0, 3),
      costPerMillionTokens: round(tokens ? totalCost / (tokens / 1e6) : 0, 3),
      costPerTrainingStep: round(steps ? totalCost / steps : 0, 5),
      avgCostPerWorkload: round(current.length ? totalCost / current.length : 0, 2),
      trendR2: round(fit.r2, 3),
      trendSlopePerDay: round(fit.slope, 2),
    },
    dailySeries,
    forecast,
    breakdown: costBreakdown(filters),
    byGpuType: costByGpuType(filters),
    topExpensive: topExpensive.map((j) => ({
      jobId: j.jobId,
      modelName: j.modelName,
      workloadType: j.workloadType,
      gpuType: j.gpuType,
      gpuCount: j.gpuCount,
      cost: j.cost,
      share: round(totalCost ? (j.cost / totalCost) * 100 : 0, 2),
      gpuUtilization: round(j.gpuUtilization * 100, 1),
      efficiencyScore: round(j.efficiencyScore, 1),
    })),
    waste: wastedCompute(filters),
  };
}

/* ---------------------------------- EDA ------------------------------------ */

export const EDA_NUMERIC_FIELDS = [
  "cost",
  "gpuHours",
  "durationHours",
  "gpuUtilization",
  "memoryUtilization",
  "cpuUtilization",
  "ramUtilization",
  "powerWatts",
  "tokens",
  "tokensPerSecond",
  "batchSize",
  "sequenceLength",
  "gpuCount",
  "paramsB",
  "trainingSteps",
  "costPerMillionTokens",
  "efficiencyScore",
  "idleRatio",
] as const;

export type EdaField = (typeof EDA_NUMERIC_FIELDS)[number];

export function edaOverview(filters: Filters, x: EdaField = "gpuCount", y: EdaField = "cost") {
  const data = getDataset();
  const { current } = applyFilters(data.jobs, filters, data.windowEnd);

  const summaries = EDA_NUMERIC_FIELDS.map((f) => ({
    field: f,
    ...summarize(current.map((j) => j[f] as number)),
  }));

  const corr = correlationMatrix(
    EDA_NUMERIC_FIELDS.slice(0, 12).map((f) => ({ key: f, values: current.map((j) => j[f] as number) })),
  );

  const step = Math.max(1, Math.floor(current.length / 500));
  const scatter = current
    .filter((_, i) => i % step === 0)
    .map((j) => ({ x: j[x] as number, y: j[y] as number, gpuType: j.gpuType, jobId: j.jobId }));
  const fit = linearFit(scatter.map((p) => p.x), scatter.map((p) => p.y));

  const boxes = (["gpuUtilization", "memoryUtilization", "idleRatio", "efficiencyScore"] as EdaField[]).map((f) =>
    boxPlot(f, current.map((j) => j[f] as number)),
  );

  const timeSeries = [...groupBy(current, (j) => dayKey(j.startedAt)).entries()]
    .map(([date, rows]) => ({
      date,
      cost: round(sum(rows.map((r) => r.cost)), 2),
      utilization: round(mean(rows.map((r) => r.gpuUtilization)) * 100, 1),
      tokensB: round(sum(rows.map((r) => r.tokens)) / 1e9, 3),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    rowCount: current.length,
    summaries,
    correlation: corr,
    scatter: { x, y, points: scatter, fit: { slope: round(fit.slope, 4), intercept: round(fit.intercept, 3), r2: round(fit.r2, 3) } },
    histograms: {
      cost: histogram(current.map((j) => j.cost), 20).map((b) => ({ bin: b.from.toFixed(0), count: b.count })),
      utilization: utilizationHistogram(filters),
    },
    boxes,
    timeSeries,
  };
}
