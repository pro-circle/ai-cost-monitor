import { mean } from "./stats";

/**
 * Isolation Forest + Local Outlier Factor (deterministic implementations).
 * Mirrors sklearn.ensemble.IsolationForest / sklearn.neighbors.LocalOutlierFactor
 * behaviour closely enough that scores are comparable across backends.
 */

interface ITreeNode {
  size: number;
  depth: number;
  feature?: number;
  threshold?: number;
  left?: ITreeNode;
  right?: ITreeNode;
}

function harmonic(n: number): number {
  if (n <= 1) return 0;
  return 2 * (Math.log(n - 1) + 0.5772156649) - (2 * (n - 1)) / n;
}

function buildITree(
  X: number[][],
  indices: number[],
  depth: number,
  maxDepth: number,
  rand: () => number,
): ITreeNode {
  if (depth >= maxDepth || indices.length <= 1) return { size: indices.length, depth };
  const d = X[0]!.length;
  const feature = Math.floor(rand() * d);
  let lo = Infinity;
  let hi = -Infinity;
  for (const i of indices) {
    const v = X[i]![feature]!;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo === hi) return { size: indices.length, depth };
  const threshold = lo + rand() * (hi - lo);
  const left: number[] = [];
  const right: number[] = [];
  for (const i of indices) (X[i]![feature]! < threshold ? left : right).push(i);
  return {
    size: indices.length,
    depth,
    feature,
    threshold,
    left: buildITree(X, left, depth + 1, maxDepth, rand),
    right: buildITree(X, right, depth + 1, maxDepth, rand),
  };
}

function pathLength(node: ITreeNode, x: number[]): number {
  let cur = node;
  let depth = 0;
  while (cur.feature !== undefined) {
    depth += 1;
    cur = x[cur.feature]! < cur.threshold! ? cur.left! : cur.right!;
  }
  return depth + harmonic(cur.size);
}

export function isolationForestScores(X: number[][], nTrees = 80, sampleSize = 256, seed = 42): number[] {
  if (X.length === 0) return [];
  const n = Math.min(sampleSize, X.length);
  const maxDepth = Math.ceil(Math.log2(Math.max(2, n)));
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const trees: ITreeNode[] = [];
  for (let t = 0; t < nTrees; t += 1) {
    const indices: number[] = [];
    for (let i = 0; i < n; i += 1) indices.push(Math.floor(rand() * X.length));
    trees.push(buildITree(X, indices, 0, maxDepth, rand));
  }
  const c = harmonic(n) || 1;
  return X.map((row) => {
    let total = 0;
    for (const t of trees) total += pathLength(t, row);
    return 2 ** (-(total / trees.length) / c); // 0.5 = normal, →1 = anomalous
  });
}

/** LOF over a deterministic sample of the data (k nearest neighbours). */
export function localOutlierFactor(X: number[][], k = 12, sampleLimit = 1200): number[] {
  const n = X.length;
  if (n === 0) return [];
  const step = Math.max(1, Math.floor(n / sampleLimit));
  const refIdx: number[] = [];
  for (let i = 0; i < n; i += step) refIdx.push(i);
  const ref = refIdx.map((i) => X[i]!);

  const dist = (a: number[], b: number[]) => {
    let s = 0;
    for (let j = 0; j < a.length; j += 1) s += (a[j]! - b[j]!) ** 2;
    return Math.sqrt(s);
  };

  const kdistCache = new Map<number, { kdist: number; neighbours: number[] }>();
  const knn = (point: number[], skip = -1) => {
    const pairs: { i: number; d: number }[] = [];
    for (let i = 0; i < ref.length; i += 1) {
      if (i === skip) continue;
      pairs.push({ i, d: dist(point, ref[i]!) });
    }
    pairs.sort((a, b) => a.d - b.d);
    const top = pairs.slice(0, k);
    return { kdist: top[top.length - 1]?.d ?? 0, neighbours: top.map((p) => p.i) };
  };

  for (let i = 0; i < ref.length; i += 1) kdistCache.set(i, knn(ref[i]!, i));

  const lrd = (point: number[], neighbours: number[]) => {
    const reach = neighbours.map((j) => Math.max(kdistCache.get(j)!.kdist, dist(point, ref[j]!)));
    const m = mean(reach);
    return m === 0 ? 1e6 : 1 / m;
  };

  const refLrd = ref.map((p, i) => lrd(p, kdistCache.get(i)!.neighbours));

  return X.map((point) => {
    const { neighbours } = knn(point);
    const own = lrd(point, neighbours);
    const ratios = neighbours.map((j) => refLrd[j]! / own);
    return mean(ratios); // ~1 normal, >1.5 outlier
  });
}

export function zScores(values: number[]): number[] {
  const m = mean(values);
  const sd = Math.sqrt(mean(values.map((v) => (v - m) ** 2))) || 1;
  return values.map((v) => (v - m) / sd);
}

export function standardize(rows: number[][]): number[][] {
  if (rows.length === 0) return rows;
  const d = rows[0]!.length;
  const means: number[] = [];
  const sds: number[] = [];
  for (let j = 0; j < d; j += 1) {
    const col = rows.map((r) => r[j]!);
    const m = mean(col);
    means.push(m);
    sds.push(Math.sqrt(mean(col.map((v) => (v - m) ** 2))) || 1);
  }
  return rows.map((r) => r.map((v, j) => (v - means[j]!) / sds[j]!));
}
