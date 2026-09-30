/** Descriptive statistics, correlation and distribution utilities (pure). */

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return s / (xs.length - 1);
}

export function stdDev(xs: number[]): number {
  return Math.sqrt(variance(xs));
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next === undefined ? sorted[base]! : sorted[base]! + rest * (next - sorted[base]!);
}

export interface Summary {
  count: number;
  mean: number;
  std: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  p95: number;
  max: number;
  missing: number;
  skewness: number;
}

export function summarize(values: (number | null | undefined)[]): Summary {
  const xs = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const missing = values.length - xs.length;
  const sorted = [...xs].sort((a, b) => a - b);
  const m = mean(xs);
  const sd = stdDev(xs);
  const skew = sd === 0 || xs.length < 3 ? 0 : mean(xs.map((x) => ((x - m) / sd) ** 3));
  return {
    count: xs.length,
    mean: m,
    std: sd,
    min: sorted[0] ?? 0,
    p25: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
    p95: quantile(sorted, 0.95),
    max: sorted[sorted.length - 1] ?? 0,
    missing,
    skewness: skew,
  };
}

export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return 0;
  return num / Math.sqrt(dx * dy);
}

export function correlationMatrix(columns: { key: string; values: number[] }[]) {
  return columns.map((row) => ({
    key: row.key,
    values: columns.map((col) => ({ key: col.key, value: pearson(row.values, col.values) })),
  }));
}

export interface HistogramBin {
  bin: string;
  from: number;
  to: number;
  count: number;
}

export function histogram(xs: number[], bins = 20, min?: number, max?: number): HistogramBin[] {
  if (xs.length === 0) return [];
  const lo = min ?? Math.min(...xs);
  const hi = max ?? Math.max(...xs);
  const width = (hi - lo) / bins || 1;
  const out: HistogramBin[] = Array.from({ length: bins }, (_, i) => ({
    from: lo + i * width,
    to: lo + (i + 1) * width,
    bin: `${(lo + i * width).toFixed(0)}`,
    count: 0,
  }));
  for (const x of xs) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((x - lo) / width)));
    out[idx]!.count += 1;
  }
  return out;
}

export interface BoxPlotStats {
  key: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  outliers: number;
}

export function boxPlot(key: string, xs: number[]): BoxPlotStats {
  const sorted = [...xs].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  const inliers = sorted.filter((x) => x >= lo && x <= hi);
  return {
    key,
    min: inliers[0] ?? q1,
    q1,
    median: quantile(sorted, 0.5),
    q3,
    max: inliers[inliers.length - 1] ?? q3,
    outliers: sorted.length - inliers.length,
  };
}

/** Tukey-fence outlier indices. */
export function outlierIndices(xs: number[], k = 1.5): number[] {
  const sorted = [...xs].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const lo = q1 - k * iqr;
  const hi = q3 + k * iqr;
  const idx: number[] = [];
  xs.forEach((x, i) => {
    if (x < lo || x > hi) idx.push(i);
  });
  return idx;
}

/** Ordinary least squares on a single predictor: returns slope/intercept/r2. */
export function linearFit(xs: number[], ys: number[]) {
  const n = Math.min(xs.length, ys.length);
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = my - slope * mx;
  const r = pearson(xs, ys);
  return { slope, intercept, r2: r * r };
}

export function sum(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

export function groupBy<T, K extends string>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = keyFn(item);
    const arr = map.get(k);
    if (arr) arr.push(item);
    else map.set(k, [item]);
  }
  return map;
}
