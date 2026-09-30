import { outlierIndices, summarize } from "./stats";
import { round } from "./random";

/** Dataset ingestion, validation, profiling and cleaning (mirrors the Flask data_processing package). */

export type CellValue = string | number | null;
export type Row = Record<string, CellValue>;

export interface ColumnProfile {
  name: string;
  normalizedName: string;
  inferredType: "numeric" | "categorical" | "datetime" | "boolean" | "empty";
  missing: number;
  missingPct: number;
  unique: number;
  outliers: number;
  min?: number | undefined;
  max?: number | undefined;
  mean?: number | undefined;
  std?: number | undefined;
  examples: string[];
}

export interface DatasetProfile {
  rows: number;
  columns: number;
  missingCells: number;
  missingPct: number;
  duplicateRows: number;
  outlierCells: number;
  typeIssues: number;
  qualityScore: number;
  columnProfiles: ColumnProfile[];
  schema: { present: string[]; missingRequired: string[]; recognizedAs: string };
}

export const SCHEMA_TEMPLATES: Record<string, string[]> = {
  "training logs": ["job_id", "model_name", "gpu_type", "gpu_count", "duration_hours", "tokens"],
  "gpu metrics": ["job_id", "timestamp", "gpu_utilization", "memory_utilization", "power_watts"],
  "billing data": ["job_id", "date", "amount"],
  "token usage": ["job_id", "total_tokens"],
  "workload configuration": ["job_id", "batch_size", "sequence_length", "precision"],
};

export function normalizeColumnName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\w]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

export function parseCsv(text: string): { headers: string[]; rows: Row[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new Error("The file is empty.");
  const headers = splitCsvLine(lines[0]!);
  if (headers.length < 2) throw new Error("Could not detect delimited columns — expected a comma-separated file.");
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i]!);
    const row: Row = {};
    headers.forEach((h, j) => {
      const raw = cells[j];
      row[h] = raw === undefined || raw === "" || raw.toLowerCase() === "null" || raw.toLowerCase() === "nan" ? null : raw;
    });
    rows.push(row);
  }
  return { headers, rows };
}

export function parseJson(text: string): { headers: string[]; rows: Row[] } {
  const parsed: unknown = JSON.parse(text);
  const arr = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { data?: unknown }).data)
      ? ((parsed as { data: unknown[] }).data)
      : null;
  if (!arr) throw new Error("Expected a JSON array of records, or an object with a `data` array.");
  const headers = [...new Set(arr.flatMap((r) => (typeof r === "object" && r ? Object.keys(r) : [])))];
  const rows = arr.map((r) => {
    const rec = (r ?? {}) as Record<string, unknown>;
    const row: Row = {};
    for (const h of headers) {
      const v = rec[h];
      row[h] = v === null || v === undefined || v === "" ? null : typeof v === "number" ? v : String(v);
    }
    return row;
  });
  return { headers, rows };
}

export function parseDataset(fileName: string, text: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".json")) return parseJson(text);
  if (lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt")) return parseCsv(text);
  // sniff
  const trimmed = text.trimStart();
  return trimmed.startsWith("[") || trimmed.startsWith("{") ? parseJson(text) : parseCsv(text);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?/;

function inferType(values: CellValue[]): ColumnProfile["inferredType"] {
  const present = values.filter((v) => v !== null);
  if (present.length === 0) return "empty";
  const numeric = present.filter((v) => typeof v === "number" || (typeof v === "string" && v !== "" && !Number.isNaN(Number(v))));
  if (numeric.length / present.length > 0.9) return "numeric";
  const dates = present.filter((v) => typeof v === "string" && DATE_RE.test(v));
  if (dates.length / present.length > 0.8) return "datetime";
  const bools = present.filter((v) => typeof v === "string" && ["true", "false", "yes", "no", "0", "1"].includes(v.toLowerCase()));
  if (bools.length === present.length && new Set(present.map(String)).size <= 2) return "boolean";
  return "categorical";
}

export function profileDataset(headers: string[], rows: Row[]): DatasetProfile {
  const columnProfiles: ColumnProfile[] = headers.map((h) => {
    const values = rows.map((r) => r[h] ?? null);
    const type = inferType(values);
    const missing = values.filter((v) => v === null).length;
    const unique = new Set(values.filter((v) => v !== null).map(String)).size;
    let outliers = 0;
    let stats: ReturnType<typeof summarize> | undefined;
    if (type === "numeric") {
      const nums = values.filter((v) => v !== null).map((v) => Number(v)).filter((v) => Number.isFinite(v));
      outliers = outlierIndices(nums).length;
      stats = summarize(nums);
    }
    return {
      name: h,
      normalizedName: normalizeColumnName(h),
      inferredType: type,
      missing,
      missingPct: round(rows.length ? (missing / rows.length) * 100 : 0, 2),
      unique,
      outliers,
      min: stats ? round(stats.min, 4) : undefined,
      max: stats ? round(stats.max, 4) : undefined,
      mean: stats ? round(stats.mean, 4) : undefined,
      std: stats ? round(stats.std, 4) : undefined,
      examples: values.filter((v) => v !== null).slice(0, 3).map(String),
    };
  });

  const seen = new Set<string>();
  let duplicateRows = 0;
  for (const row of rows) {
    const key = headers.map((h) => String(row[h] ?? "")).join("\u0001");
    if (seen.has(key)) duplicateRows += 1;
    else seen.add(key);
  }

  const normalized = headers.map(normalizeColumnName);
  let recognizedAs = "custom dataset";
  let missingRequired: string[] = [];
  let bestOverlap = 0;
  for (const [name, required] of Object.entries(SCHEMA_TEMPLATES)) {
    const overlap = required.filter((r) => normalized.includes(r)).length;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      recognizedAs = name;
      missingRequired = required.filter((r) => !normalized.includes(r));
    }
  }
  if (bestOverlap < 2) {
    recognizedAs = "custom dataset";
    missingRequired = [];
  }

  const missingCells = columnProfiles.reduce((a, c) => a + c.missing, 0);
  const outlierCells = columnProfiles.reduce((a, c) => a + c.outliers, 0);
  const typeIssues = columnProfiles.filter((c) => c.inferredType === "empty").length;
  const totalCells = Math.max(1, rows.length * headers.length);

  const qualityScore = round(
    Math.max(
      0,
      100 -
        (missingCells / totalCells) * 100 * 1.4 -
        (rows.length ? (duplicateRows / rows.length) * 100 : 0) * 1.2 -
        (outlierCells / totalCells) * 100 * 0.5 -
        typeIssues * 3 -
        missingRequired.length * 4,
    ),
    1,
  );

  return {
    rows: rows.length,
    columns: headers.length,
    missingCells,
    missingPct: round((missingCells / totalCells) * 100, 2),
    duplicateRows,
    outlierCells,
    typeIssues,
    qualityScore,
    columnProfiles,
    schema: { present: normalized, missingRequired, recognizedAs },
  };
}

export interface CleaningReport {
  steps: { step: string; detail: string; affected: number }[];
  before: DatasetProfile;
  after: DatasetProfile;
  engineeredFeatures: string[];
  headers: string[];
  rows: Row[];
}

const ENGINEERED = [
  "cost_per_gpu_hour",
  "cost_per_million_tokens",
  "tokens_per_second",
  "gpu_efficiency",
  "memory_efficiency",
  "compute_efficiency",
  "idle_ratio",
  "training_efficiency",
  "cost_per_training_step",
];

function num(row: Row, key: string): number | null {
  const v = row[key];
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function cleanDataset(headers: string[], rows: Row[]): CleaningReport {
  const before = profileDataset(headers, rows);
  const steps: CleaningReport["steps"] = [];

  // 1. normalize column names
  const nameMap = new Map(headers.map((h) => [h, normalizeColumnName(h)]));
  const renamed = [...new Set([...nameMap.values()])];
  steps.push({
    step: "Normalize column names",
    detail: "snake_case, trimmed, special characters removed",
    affected: headers.filter((h) => nameMap.get(h) !== h).length,
  });

  let working: Row[] = rows.map((r) => {
    const out: Row = {};
    for (const h of headers) out[nameMap.get(h)!] = r[h] ?? null;
    return out;
  });

  // 2. type coercion
  const numericCols = before.columnProfiles.filter((c) => c.inferredType === "numeric").map((c) => c.normalizedName);
  let coerced = 0;
  working = working.map((r) => {
    const out: Row = { ...r };
    for (const c of numericCols) {
      const v = out[c];
      if (typeof v === "string") {
        const n = Number(v.replace(/[$,%\s]/g, ""));
        out[c] = Number.isFinite(n) ? n : null;
        coerced += 1;
      }
    }
    return out;
  });
  steps.push({ step: "Convert data types", detail: `${numericCols.length} numeric columns coerced`, affected: coerced });

  // 3. missing values — median for numeric, mode for categorical
  let imputed = 0;
  const fill = new Map<string, CellValue>();
  for (const col of renamed) {
    const values = working.map((r) => r[col]);
    if (numericCols.includes(col)) {
      const nums = values.filter((v): v is number => typeof v === "number").sort((a, b) => a - b);
      fill.set(col, nums.length ? nums[Math.floor(nums.length / 2)]! : 0);
    } else {
      const counts = new Map<string, number>();
      for (const v of values) if (v !== null) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
      const mode = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
      fill.set(col, mode);
    }
  }
  working = working.map((r) => {
    const out: Row = { ...r };
    for (const col of renamed) {
      if (out[col] === null) {
        out[col] = fill.get(col) ?? null;
        imputed += 1;
      }
    }
    return out;
  });
  steps.push({ step: "Handle missing values", detail: "median imputation (numeric) / mode imputation (categorical)", affected: imputed });

  // 4. deduplicate
  const seen = new Set<string>();
  const deduped: Row[] = [];
  for (const r of working) {
    const key = renamed.map((c) => String(r[c] ?? "")).join("\u0001");
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(r);
    }
  }
  steps.push({ step: "Remove duplicates", detail: "exact-match row deduplication", affected: working.length - deduped.length });
  working = deduped;

  // 5. outlier winsorization
  let winsorized = 0;
  for (const col of numericCols) {
    const nums = working.map((r) => num(r, col)).filter((v): v is number => v !== null);
    const s = summarize(nums);
    const lo = s.p25 - 3 * (s.p75 - s.p25);
    const hi = s.p75 + 3 * (s.p75 - s.p25);
    working = working.map((r) => {
      const v = num(r, col);
      if (v === null) return r;
      if (v < lo || v > hi) {
        winsorized += 1;
        return { ...r, [col]: Math.min(hi, Math.max(lo, v)) };
      }
      return r;
    });
  }
  steps.push({ step: "Detect and cap outliers", detail: "3×IQR winsorization (extreme values clipped, rows preserved)", affected: winsorized });

  // 6. engineered features (only when inputs exist)
  const engineered: string[] = [];
  const has = (c: string) => renamed.includes(c);
  working = working.map((r) => {
    const out: Row = { ...r };
    const cost = num(r, "cost") ?? num(r, "total_cost") ?? num(r, "amount");
    const gpuHours = num(r, "gpu_hours") ?? (num(r, "duration_hours") ?? 0) * (num(r, "gpu_count") ?? 1);
    const tokens = num(r, "tokens") ?? num(r, "total_tokens");
    const duration = num(r, "duration_hours");
    const util = num(r, "gpu_utilization");
    const mem = num(r, "memory_utilization");
    const idle = num(r, "idle_hours");
    const steps_ = num(r, "training_steps");

    if (cost !== null && gpuHours) out["cost_per_gpu_hour"] = round(cost / gpuHours, 4);
    if (cost !== null && tokens) out["cost_per_million_tokens"] = round(cost / (tokens / 1e6), 4);
    if (tokens && duration) out["tokens_per_second"] = round(tokens / (duration * 3600), 2);
    if (util !== null) out["gpu_efficiency"] = round(util > 1 ? util / 100 : util, 4);
    if (mem !== null) out["memory_efficiency"] = round(1 - Math.abs((mem > 1 ? mem / 100 : mem) - 0.78) / 0.78, 4);
    if (util !== null && mem !== null)
      out["compute_efficiency"] = round(
        ((util > 1 ? util / 100 : util) * 0.6 + (mem > 1 ? mem / 100 : mem) * 0.4),
        4,
      );
    if (idle !== null && duration) out["idle_ratio"] = round(idle / duration, 4);
    if (util !== null && idle !== null && duration)
      out["training_efficiency"] = round((util > 1 ? util / 100 : util) * (1 - idle / duration), 4);
    if (cost !== null && steps_) out["cost_per_training_step"] = round(cost / steps_, 6);
    return out;
  });
  for (const f of ENGINEERED) {
    if (working.some((r) => r[f] !== undefined && r[f] !== null)) engineered.push(f);
  }
  steps.push({
    step: "Generate engineered features",
    detail: engineered.length ? engineered.join(", ") : "no source columns available for feature engineering",
    affected: engineered.length,
  });

  const finalHeaders = [...renamed, ...engineered];
  const normalizedRows = working.map((r) => {
    const out: Row = {};
    for (const h of finalHeaders) out[h] = r[h] ?? null;
    return out;
  });

  return {
    steps,
    before,
    after: profileDataset(finalHeaders, normalizedRows),
    engineeredFeatures: engineered,
    headers: finalHeaders,
    rows: normalizedRows,
  };
}

export function toCsv(headers: string[], rows: Row[]): string {
  const esc = (v: CellValue) => {
    if (v === null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h] ?? null)).join(","))].join("\n");
}

/** Serializes the built-in synthetic dataset as a CSV-ready record set. */
export function jobsToRows(jobs: Record<string, unknown>[]): { headers: string[]; rows: Row[] } {
  const headers = jobs.length ? Object.keys(jobs[0]!).map(normalizeColumnName) : [];
  const rows = jobs.map((j) => {
    const out: Row = {};
    Object.entries(j).forEach(([k, v]) => {
      const key = normalizeColumnName(k);
      out[key] = v === null || v === undefined ? null : typeof v === "number" ? v : Array.isArray(v) ? v.join("|") : String(v);
    });
    return out;
  });
  return { headers, rows };
}
