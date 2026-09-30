import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  costBreakdown,
  costByGpuType,
  costIntelligence,
  costTrend,
  costVsTokens,
  dashboardSummary,
  edaOverview,
  gpuAnalytics,
  listWorkloads,
  trainingTimeVsGpuCount,
  utilizationHistogram,
  utilizationSeries,
  workloadDetail,
  workloadFacets,
  EDA_NUMERIC_FIELDS,
} from "@/lib/engine/analytics";
import { cleanDataset, jobsToRows, parseDataset, profileDataset, toCsv } from "@/lib/engine/data-quality";
import { datasetMeta, getDataset } from "@/lib/engine/dataset";
import { detectAnomalies } from "@/lib/engine/detect";
import { optimizeConfiguration, whatIf } from "@/lib/engine/optimize";
import { getModelBundle, modelRegistry, predictWorkload, retrainModels } from "@/lib/engine/predict";
import { buildInsights, buildRecommendations } from "@/lib/engine/recommend";
import { GPU_TYPES, PRECISIONS, WORKLOAD_TYPES } from "@/lib/engine/constants";
import { toFilters, toWorkloadQuery } from "./normalize";

/* --------------------------------- schemas --------------------------------- */

const gpuType = z.enum(["A100", "H100", "L40S", "T4"]);
const workloadType = z.enum(["Training", "Fine-tuning", "Inference", "Evaluation"]);
const precision = z.enum(["FP32", "FP16", "BF16"]);
const status = z.enum(["Running", "Completed", "Failed", "Queued", "Anomalous"]);

const filtersSchema = z.object({
  range: z.enum(["24h", "7d", "30d", "60d", "custom"]).optional(),
  from: z.string().nullable().optional(),
  to: z.string().nullable().optional(),
  gpuTypes: z.array(gpuType).optional(),
  workloadTypes: z.array(workloadType).optional(),
  models: z.array(z.string()).optional(),
  statuses: z.array(status).optional(),
  clusters: z.array(z.string()).optional(),
  minCost: z.number().nullable().optional(),
  maxCost: z.number().nullable().optional(),
  minUtilization: z.number().nullable().optional(),
  maxUtilization: z.number().nullable().optional(),
  search: z.string().nullable().optional(),
});

const configSchema = z.object({
  gpuType,
  gpuCount: z.number().int().min(1).max(64),
  paramsB: z.number().min(0.1).max(2000),
  batchSize: z.number().int().min(1).max(1024),
  sequenceLength: z.number().int().min(128).max(131072),
  precision,
  tokens: z.number().min(1e5).max(1e13),
  epochs: z.number().int().min(1).max(20),
  trainingSteps: z.number().int().min(1).max(1e9),
  workloadType,
});

export type FiltersInput = z.infer<typeof filtersSchema>;
export type ConfigInput = z.infer<typeof configSchema>;

const MAX_UPLOAD_CHARS = 4_000_000; // ~4 MB of text

/* ------------------------------- dashboard --------------------------------- */

export const fetchDashboard = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => filtersSchema.parse(raw))
  .handler(async ({ data }) => {
    const f = toFilters(data);
    const summary = dashboardSummary(f);
    return {
      ...summary,
      utilization: utilizationSeries(f),
      costTrend: costTrend(f),
      costByGpuType: costByGpuType(f),
      costVsTokens: costVsTokens(f),
      utilizationHistogram: utilizationHistogram(f),
      trainingTimeVsGpuCount: trainingTimeVsGpuCount(f),
      costBreakdown: costBreakdown(f),
      insights: buildInsights(f).slice(0, 4),
    };
  });

/* -------------------------------- workloads -------------------------------- */

export const fetchWorkloads = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    filtersSchema
      .extend({
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(5).max(200).optional(),
        sortBy: z.string().optional(),
        sortDir: z.enum(["asc", "desc"]).optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    return listWorkloads(toWorkloadQuery({ sortBy: "cost", sortDir: "desc", page: 1, pageSize: 25, ...data }));
  });

export const fetchFacets = createServerFn({ method: "GET" }).handler(async () => ({
  ...workloadFacets(),
  precisions: PRECISIONS,
  gpuTypeOrder: GPU_TYPES,
  workloadTypeOrder: [...WORKLOAD_TYPES],
  dataset: datasetMeta(),
}));

export const fetchWorkloadDetail = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => z.object({ jobId: z.string().min(1).max(64) }).parse(raw))
  .handler(async ({ data }) => {
    const detail = workloadDetail(data.jobId);
    if (!detail) return { found: false as const };
    const anomalies = detectAnomalies({ range: "60d", search: data.jobId }, 20).anomalies.filter(
      (a) => a.jobId === data.jobId,
    );
    const optimization = optimizeConfiguration({
      gpuType: detail.job.gpuType,
      gpuCount: detail.job.gpuCount,
      paramsB: detail.job.paramsB,
      batchSize: detail.job.batchSize,
      sequenceLength: detail.job.sequenceLength,
      precision: detail.job.precision,
      tokens: detail.job.tokens,
      epochs: detail.job.epochs,
      trainingSteps: detail.job.trainingSteps,
      workloadType: detail.job.workloadType,
    });
    return {
      found: true as const,
      ...detail,
      anomalies,
      optimization: {
        currentCost: optimization.current.result.cost,
        recommended: optimization.recommended,
      },
    };
  });

/* ------------------------------ gpu + cost --------------------------------- */

export const fetchGpuAnalytics = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => filtersSchema.parse(raw))
  .handler(async ({ data }) => gpuAnalytics(toFilters(data)));

export const fetchCostIntelligence = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => filtersSchema.parse(raw))
  .handler(async ({ data }) => costIntelligence(toFilters(data)));

/* -------------------------------- anomalies -------------------------------- */

export const fetchAnomalies = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => filtersSchema.extend({ limit: z.number().int().min(10).max(500).optional() }).parse(raw))
  .handler(async ({ data }) => {
    return detectAnomalies(toFilters(data), data.limit ?? 150);
  });

/* ------------------------- recommendations + insights ---------------------- */

export const fetchRecommendations = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => filtersSchema.parse(raw))
  .handler(async ({ data }) => ({ recommendations: buildRecommendations(toFilters(data)) }));

export const fetchInsights = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => filtersSchema.parse(raw))
  .handler(async ({ data }) => ({ insights: buildInsights(toFilters(data)) }));

/* ------------------------------ ML pipeline -------------------------------- */

export const fetchModels = createServerFn({ method: "GET" }).handler(async () => ({
  models: modelRegistry(),
  costReports: getModelBundle("cost").reports,
  durationReports: getModelBundle("duration").reports,
}));

export const trainCostModels = createServerFn({ method: "POST" }).handler(async () => {
  const { cost, duration } = retrainModels();
  return {
    trainedAt: cost.trainedAt,
    cost: { reports: cost.reports, selected: cost.best.name, version: cost.version, rows: cost.rows },
    duration: { reports: duration.reports, selected: duration.best.name, version: duration.version, rows: duration.rows },
  };
});

export const predictCost = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        gpuType,
        gpuCount: z.number().int().min(1).max(64),
        paramsB: z.number().min(0.1).max(2000),
        batchSize: z.number().int().min(1).max(1024),
        sequenceLength: z.number().int().min(128).max(131072),
        tokens: z.number().min(1e5).max(1e13),
        epochs: z.number().int().min(1).max(20),
        precision,
        workloadType,
      })
      .parse(raw),
  )
  .handler(async ({ data }) => predictWorkload(data));

/* ------------------------- optimization + what-if -------------------------- */

export const runOptimization = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        config: configSchema,
        constraints: z
          .object({
            maxDurationIncreasePct: z.number().min(0).max(300).optional(),
            minGpuUtilization: z.number().min(0).max(1).optional(),
            maxMemoryUtilization: z.number().min(0.1).max(1).optional(),
            allowGpuTypeChange: z.boolean().optional(),
            allowPrecisionChange: z.boolean().optional(),
          })
          .optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => optimizeConfiguration(data.config, data.constraints ?? {}));

export const runWhatIf = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => z.object({ baseline: configSchema, scenario: configSchema }).parse(raw))
  .handler(async ({ data }) => whatIf(data.baseline, data.scenario));

/* ----------------------------------- EDA ----------------------------------- */

export const fetchEda = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    filtersSchema
      .extend({
        x: z.enum(EDA_NUMERIC_FIELDS).optional(),
        y: z.enum(EDA_NUMERIC_FIELDS).optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    return {
      ...edaOverview(toFilters(data), data.x ?? "gpuCount", data.y ?? "cost"),
      fields: [...EDA_NUMERIC_FIELDS],
    };
  });

/* -------------------------------- datasets --------------------------------- */

export const profileUpload = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z.object({ fileName: z.string().min(1).max(200), content: z.string().max(MAX_UPLOAD_CHARS) }).parse(raw),
  )
  .handler(async ({ data }) => {
    try {
      const { headers, rows } = parseDataset(data.fileName, data.content);
      if (rows.length === 0) return { ok: false as const, error: "The file contains headers but no data rows." };
      const profile = profileDataset(headers, rows);
      return {
        ok: true as const,
        fileName: data.fileName,
        headers,
        preview: rows.slice(0, 25),
        profile,
      };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "The file could not be parsed." };
    }
  });

export const cleanUpload = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z.object({ fileName: z.string().min(1).max(200), content: z.string().max(MAX_UPLOAD_CHARS) }).parse(raw),
  )
  .handler(async ({ data }) => {
    try {
      const { headers, rows } = parseDataset(data.fileName, data.content);
      const report = cleanDataset(headers, rows);
      return {
        ok: true as const,
        steps: report.steps,
        before: report.before,
        after: report.after,
        engineeredFeatures: report.engineeredFeatures,
        headers: report.headers,
        preview: report.rows.slice(0, 25),
        csv: toCsv(report.headers, report.rows.slice(0, 5000)),
        truncated: report.rows.length > 5000,
      };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "The file could not be cleaned." };
    }
  });

export const fetchSampleDataset = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => z.object({ limit: z.number().int().min(50).max(10000).optional() }).parse(raw ?? {}))
  .handler(async ({ data }) => {
    const jobs = getDataset().jobs.slice(0, data.limit ?? 500);
    const { headers, rows } = jobsToRows(jobs as unknown as Record<string, unknown>[]);
    const profile = profileDataset(headers, rows);
    return { fileName: "aicomputeguard_training_jobs_sample.csv", headers, rows: rows.slice(0, 25), profile, csv: toCsv(headers, rows) };
  });

export const fetchDatasetMeta = createServerFn({ method: "GET" }).handler(async () => datasetMeta());

/* --------------------------------- reports --------------------------------- */

export const generateReport = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    filtersSchema
      .extend({
        sections: z.array(z.string()).optional(),
        title: z.string().max(120).optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    const { sections, title } = data;
    const filters = toFilters(data);
    const summary = dashboardSummary(filters);
    const cost = costIntelligence(filters);
    const gpu = gpuAnalytics(filters);
    const anomalies = detectAnomalies(filters, 25);
    const recommendations = buildRecommendations(filters);
    const insights = buildInsights(filters);
    const models = modelRegistry();

    return {
      title: title ?? "AI Compute Intelligence Report",
      generatedAt: new Date().toISOString(),
      window: summary.window,
      sections: sections ?? [
        "executive-summary",
        "infrastructure",
        "gpu-analytics",
        "cost-analysis",
        "anomalies",
        "predictions",
        "optimization",
        "savings",
      ],
      dataset: datasetMeta(),
      executiveSummary: {
        kpis: summary.kpis.map((k) => ({ label: k.label, value: k.value, unit: k.unit, changePct: k.changePct })),
        insights: insights.map((i) => i.text),
      },
      infrastructure: {
        counts: summary.counts,
        fleet: gpu.fleet,
        perGpu: gpu.perGpu.map((g) => ({
          gpuType: g.gpuType,
          jobs: g.jobs,
          gpuHours: g.gpuHours,
          idleHours: g.idleHours,
          avgUtilization: g.avgUtilization,
          efficiencyScore: g.efficiencyScore,
          cost: g.cost,
        })),
      },
      costAnalysis: { totals: cost.totals, breakdown: cost.breakdown, topExpensive: cost.topExpensive, waste: cost.waste },
      anomalies: { stats: anomalies.stats, byKind: anomalies.byKind, items: anomalies.anomalies.slice(0, 15) },
      predictions: models,
      recommendations,
      savings: {
        potential: cost.waste.totalWaste,
        share: cost.totals.totalSpend ? Number(((cost.waste.totalWaste / cost.totals.totalSpend) * 100).toFixed(1)) : 0,
        fromRecommendations: Number(recommendations.reduce((a, b) => a + b.estimatedSavings, 0).toFixed(2)),
      },
    };
  });
