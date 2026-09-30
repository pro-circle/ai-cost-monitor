import { mean } from "./stats";
import type { ModelMetrics, TrainedModelReport } from "./types";

/**
 * Small, dependency-free supervised learning implementations used by the demo
 * data layer. These mirror the Python pipeline (scikit-learn / XGBoost) so the
 * TypeScript demo mode and the Flask backend expose the same contract.
 */

export interface Dataset {
  features: string[];
  X: number[][];
  y: number[];
}

export function trainTestSplit(data: Dataset, testRatio = 0.2, seedOffset = 7) {
  const idx = data.X.map((_, i) => i);
  // deterministic shuffle
  for (let i = idx.length - 1; i > 0; i -= 1) {
    const j = (i * 1103515245 + seedOffset * 12345) % (i + 1);
    const tmp = idx[i]!;
    idx[i] = idx[j]!;
    idx[j] = tmp;
  }
  const testCount = Math.max(1, Math.floor(idx.length * testRatio));
  const testIdx = idx.slice(0, testCount);
  const trainIdx = idx.slice(testCount);
  const take = (ids: number[]) => ({
    features: data.features,
    X: ids.map((i) => data.X[i]!),
    y: ids.map((i) => data.y[i]!),
  });
  return { train: take(trainIdx), test: take(testIdx) };
}

export function metrics(yTrue: number[], yPred: number[]): ModelMetrics {
  const n = Math.min(yTrue.length, yPred.length);
  let ae = 0;
  let se = 0;
  let ape = 0;
  for (let i = 0; i < n; i += 1) {
    const d = yTrue[i]! - yPred[i]!;
    ae += Math.abs(d);
    se += d * d;
    ape += Math.abs(d) / Math.max(1e-6, Math.abs(yTrue[i]!));
  }
  const my = mean(yTrue.slice(0, n));
  let sst = 0;
  for (let i = 0; i < n; i += 1) sst += (yTrue[i]! - my) ** 2;
  const mse = se / n;
  return {
    mae: ae / n,
    mse,
    rmse: Math.sqrt(mse),
    r2: sst === 0 ? 0 : 1 - se / sst,
    mape: (ape / n) * 100,
  };
}

/* ------------------------------- Ridge regression ------------------------------ */

export interface LinearModel {
  kind: "linear";
  weights: number[];
  bias: number;
  featureMeans: number[];
  featureStds: number[];
}

export function fitRidge(data: Dataset, lambda = 1e-3, epochs = 400, lr = 0.08): LinearModel {
  const d = data.features.length;
  const featureMeans = Array.from({ length: d }, (_, j) => mean(data.X.map((r) => r[j]!)));
  const featureStds = Array.from({ length: d }, (_, j) => {
    const m = featureMeans[j]!;
    const v = mean(data.X.map((r) => (r[j]! - m) ** 2));
    return Math.sqrt(v) || 1;
  });
  const Z = data.X.map((r) => r.map((v, j) => (v - featureMeans[j]!) / featureStds[j]!));
  const yMean = mean(data.y);
  const yStd = Math.sqrt(mean(data.y.map((v) => (v - yMean) ** 2))) || 1;
  const t = data.y.map((v) => (v - yMean) / yStd);

  const w = new Array<number>(d).fill(0);
  let b = 0;
  const n = Z.length;
  for (let e = 0; e < epochs; e += 1) {
    const gw = new Array<number>(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i += 1) {
      const row = Z[i]!;
      let p = b;
      for (let j = 0; j < d; j += 1) p += w[j]! * row[j]!;
      const err = p - t[i]!;
      for (let j = 0; j < d; j += 1) gw[j]! += (err * row[j]!) / n;
      gb += err / n;
    }
    for (let j = 0; j < d; j += 1) w[j] = w[j]! - lr * (gw[j]! + lambda * w[j]!);
    b -= lr * gb;
  }
  // de-standardize target scale into the model
  return {
    kind: "linear",
    weights: w.map((v) => v * yStd),
    bias: b * yStd + yMean,
    featureMeans,
    featureStds,
  };
}

export function predictLinear(model: LinearModel, x: number[]): number {
  let p = model.bias;
  for (let j = 0; j < model.weights.length; j += 1) {
    p += model.weights[j]! * ((x[j]! - model.featureMeans[j]!) / model.featureStds[j]!);
  }
  return p;
}

/* ------------------------------ Regression trees ------------------------------ */

interface TreeNode {
  leaf?: number;
  feature?: number;
  threshold?: number;
  left?: TreeNode;
  right?: TreeNode;
}

function buildTree(
  X: number[][],
  residuals: number[],
  indices: number[],
  depth: number,
  maxDepth: number,
  minSamples: number,
  featureSubset: number[],
): TreeNode {
  const target = indices.map((i) => residuals[i]!);
  const nodeValue = mean(target);
  if (depth >= maxDepth || indices.length < minSamples * 2) return { leaf: nodeValue };

  let bestGain = 0;
  let bestFeature = -1;
  let bestThreshold = 0;
  const baseSse = target.reduce((a, v) => a + (v - nodeValue) ** 2, 0);

  for (const f of featureSubset) {
    const values = indices.map((i) => X[i]![f]!);
    const sorted = [...new Set(values)].sort((a, b) => a - b);
    if (sorted.length < 2) continue;
    const candidates: number[] = [];
    const steps = Math.min(8, sorted.length - 1);
    for (let s = 1; s <= steps; s += 1) {
      candidates.push(sorted[Math.floor((sorted.length * s) / (steps + 1))]!);
    }
    for (const thr of candidates) {
      const leftVals: number[] = [];
      const rightVals: number[] = [];
      for (let k = 0; k < indices.length; k += 1) {
        if (values[k]! <= thr) leftVals.push(target[k]!);
        else rightVals.push(target[k]!);
      }
      if (leftVals.length < minSamples || rightVals.length < minSamples) continue;
      const lm = mean(leftVals);
      const rm = mean(rightVals);
      const sse =
        leftVals.reduce((a, v) => a + (v - lm) ** 2, 0) + rightVals.reduce((a, v) => a + (v - rm) ** 2, 0);
      const gain = baseSse - sse;
      if (gain > bestGain) {
        bestGain = gain;
        bestFeature = f;
        bestThreshold = thr;
      }
    }
  }

  if (bestFeature < 0) return { leaf: nodeValue };
  const leftIdx: number[] = [];
  const rightIdx: number[] = [];
  for (const i of indices) {
    if (X[i]![bestFeature]! <= bestThreshold) leftIdx.push(i);
    else rightIdx.push(i);
  }
  return {
    feature: bestFeature,
    threshold: bestThreshold,
    left: buildTree(X, residuals, leftIdx, depth + 1, maxDepth, minSamples, featureSubset),
    right: buildTree(X, residuals, rightIdx, depth + 1, maxDepth, minSamples, featureSubset),
  };
}

function predictTree(node: TreeNode, x: number[]): number {
  let cur = node;
  while (cur.leaf === undefined) {
    cur = x[cur.feature!]! <= cur.threshold! ? cur.left! : cur.right!;
  }
  return cur.leaf;
}

function treeGain(node: TreeNode, out: Map<number, number>, weight = 1) {
  if (node.leaf !== undefined) return;
  out.set(node.feature!, (out.get(node.feature!) ?? 0) + weight);
  treeGain(node.left!, out, weight * 0.6);
  treeGain(node.right!, out, weight * 0.6);
}

export interface EnsembleModel {
  kind: "forest" | "boosted";
  base: number;
  learningRate: number;
  trees: TreeNode[];
  featureCount: number;
}

export function fitRandomForest(data: Dataset, nTrees = 24, maxDepth = 7): EnsembleModel {
  const trees: TreeNode[] = [];
  const n = data.X.length;
  const featureCount = data.features.length;
  const subsetSize = Math.max(2, Math.round(featureCount * 0.7));
  for (let t = 0; t < nTrees; t += 1) {
    const indices: number[] = [];
    for (let i = 0; i < n; i += 1) {
      // deterministic bootstrap
      const pickIdx = (i * 7919 + t * 104729) % n;
      indices.push(pickIdx);
    }
    const subset = Array.from({ length: featureCount }, (_, j) => j)
      .sort((a, b) => ((a * 31 + t * 17) % 97) - ((b * 31 + t * 17) % 97))
      .slice(0, subsetSize);
    trees.push(buildTree(data.X, data.y, indices, 0, maxDepth, 6, subset));
  }
  return { kind: "forest", base: 0, learningRate: 1 / nTrees, trees, featureCount };
}

export function fitGradientBoosting(
  data: Dataset,
  nTrees = 70,
  maxDepth = 4,
  learningRate = 0.12,
  colSample = 1,
): EnsembleModel {
  const base = mean(data.y);
  const preds = new Array<number>(data.X.length).fill(base);
  const trees: TreeNode[] = [];
  const featureCount = data.features.length;
  const allIdx = data.X.map((_, i) => i);
  const subsetSize = Math.max(2, Math.round(featureCount * colSample));
  for (let t = 0; t < nTrees; t += 1) {
    const residuals = data.y.map((v, i) => v - preds[i]!);
    const subset = Array.from({ length: featureCount }, (_, j) => j)
      .sort((a, b) => ((a * 13 + t * 29) % 101) - ((b * 13 + t * 29) % 101))
      .slice(0, subsetSize);
    const tree = buildTree(data.X, residuals, allIdx, 0, maxDepth, 5, subset);
    trees.push(tree);
    for (let i = 0; i < preds.length; i += 1) preds[i]! += learningRate * predictTree(tree, data.X[i]!);
  }
  return { kind: "boosted", base, learningRate, trees, featureCount };
}

export function predictEnsemble(model: EnsembleModel, x: number[]): number {
  if (model.kind === "forest") {
    let s = 0;
    for (const t of model.trees) s += predictTree(t, x);
    return s / model.trees.length;
  }
  let p = model.base;
  for (const t of model.trees) p += model.learningRate * predictTree(t, x);
  return p;
}

export function ensembleImportance(model: EnsembleModel, features: string[]) {
  const gains = new Map<number, number>();
  for (const t of model.trees) treeGain(t, gains);
  const total = [...gains.values()].reduce((a, b) => a + b, 0) || 1;
  return features
    .map((feature, i) => ({ feature, importance: (gains.get(i) ?? 0) / total }))
    .sort((a, b) => b.importance - a.importance);
}

export type AnyModel = LinearModel | EnsembleModel;

export function predict(model: AnyModel, x: number[]): number {
  return model.kind === "linear" ? predictLinear(model, x) : predictEnsemble(model, x);
}

export interface TrainingOutcome {
  reports: TrainedModelReport[];
  best: { name: string; model: AnyModel; metrics: ModelMetrics };
  residualStd: number;
}

/** Trains the full model zoo and selects the best model by test R². */
export function trainModelZoo(data: Dataset): TrainingOutcome {
  const { train, test } = trainTestSplit(data, 0.2);

  const candidates: { name: string; algorithm: string; model: AnyModel }[] = [
    { name: "Linear Regression", algorithm: "Ridge (L2, gradient descent)", model: fitRidge(train) },
    { name: "Random Forest", algorithm: "Bagged regression trees", model: fitRandomForest(train) },
    {
      name: "Gradient Boosting",
      algorithm: "Greedy stage-wise boosting",
      model: fitGradientBoosting(train, 60, 3, 0.14, 1),
    },
    {
      name: "XGBoost",
      algorithm: "Boosted trees, column subsampling + shrinkage",
      model: fitGradientBoosting(train, 90, 4, 0.1, 0.8),
    },
  ];

  const scored = candidates.map((c) => {
    const yPred = test.X.map((row) => predict(c.model, row));
    return { ...c, metrics: metrics(test.y, yPred), yPred };
  });

  let bestIdx = 0;
  scored.forEach((s, i) => {
    if (s.metrics.r2 > scored[bestIdx]!.metrics.r2) bestIdx = i;
  });

  const reports: TrainedModelReport[] = scored.map((s, i) => ({
    name: s.name,
    algorithm: s.algorithm,
    metrics: s.metrics,
    trainSize: train.X.length,
    testSize: test.X.length,
    featureImportance:
      s.model.kind === "linear"
        ? data.features
            .map((feature, j) => ({
              feature,
              importance: Math.abs((s.model as LinearModel).weights[j]!),
            }))
            .map((f, _j, arr) => ({
              feature: f.feature,
              importance: f.importance / (arr.reduce((a, b) => a + b.importance, 0) || 1),
            }))
            .sort((a, b) => b.importance - a.importance)
        : ensembleImportance(s.model as EnsembleModel, data.features),
    selected: i === bestIdx,
  }));

  const bestScored = scored[bestIdx]!;
  const residuals = test.y.map((v, i) => v - bestScored.yPred[i]!);
  const residualStd = Math.sqrt(mean(residuals.map((r) => r * r)));

  return {
    reports,
    best: { name: bestScored.name, model: bestScored.model, metrics: bestScored.metrics },
    residualStd,
  };
}
