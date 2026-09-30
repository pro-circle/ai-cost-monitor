"""Cost/duration regression, anomaly detection and configuration search."""
from __future__ import annotations

import itertools
from dataclasses import asdict
from datetime import datetime

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor, IsolationForest, RandomForestRegressor
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split

from .simulation import GPU_CATALOG, Config, simulate

FEATURES = ["params_b", "gpu_count", "batch_size", "sequence_length", "log_tokens", "epochs",
            "gpu_tflops", "gpu_hourly", "prec_bytes", "is_train"]


def featurize(df: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame({
        "params_b": df["params_b"], "gpu_count": df["gpu_count"], "batch_size": df["batch_size"],
        "sequence_length": df["sequence_length"], "log_tokens": np.log10(df["tokens"]), "epochs": df["epochs"],
        "gpu_tflops": df["gpu_type"].map(lambda g: GPU_CATALOG[g]["tflops"]),
        "gpu_hourly": df["gpu_type"].map(lambda g: GPU_CATALOG[g]["hourly"]),
        "prec_bytes": df["precision"].map({"FP32": 4, "FP16": 2, "BF16": 2}),
        "is_train": df["workload_type"].isin(["Training", "Fine-tuning"]).astype(int),
    })
    return out[FEATURES]


class ModelRegistry:
    def __init__(self) -> None:
        self.bundles: dict[str, dict] = {}

    def train(self, df: pd.DataFrame) -> dict:
        df = df[df["status"] == "Completed"]
        X = featurize(df)
        for target in ("cost", "duration_hours"):
            y = np.log1p(df[target].to_numpy())
            Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=7)
            candidates = {
                "Ridge": Ridge(alpha=1.0),
                "RandomForest": RandomForestRegressor(n_estimators=150, random_state=7, n_jobs=-1),
                "GradientBoosting": GradientBoostingRegressor(random_state=7),
            }
            reports = []
            for name, model in candidates.items():
                model.fit(Xtr, ytr)
                p, t = np.expm1(model.predict(Xte)), np.expm1(yte)
                imp = getattr(model, "feature_importances_", None)
                if imp is None:
                    imp = np.abs(model.coef_) / (np.abs(model.coef_).sum() or 1)
                reports.append({
                    "name": name, "model": model, "residual_std": float(np.std(yte - model.predict(Xte))),
                    "metrics": {
                        "mae": float(mean_absolute_error(t, p)), "rmse": float(np.sqrt(mean_squared_error(t, p))),
                        "r2": float(r2_score(t, p)), "mape": float(np.mean(np.abs((t - p) / np.maximum(t, 1e-6))) * 100),
                    },
                    "feature_importance": sorted(
                        [{"feature": f, "importance": float(v)} for f, v in zip(FEATURES, imp)],
                        key=lambda d: -d["importance"]),
                })
            best = max(reports, key=lambda r: r["metrics"]["r2"])
            prev = self.bundles.get(target, {}).get("version", 0)
            self.bundles[target] = {"best": best, "reports": reports, "version": prev + 1,
                                    "trained_at": datetime.utcnow().isoformat(), "rows": len(df)}
        return self.summary()

    def summary(self) -> dict:
        return {
            t: {
                "selected": b["best"]["name"], "version": b["version"], "trained_at": b["trained_at"], "rows": b["rows"],
                "reports": [{k: v for k, v in r.items() if k != "model"} for r in b["reports"]],
            }
            for t, b in self.bundles.items()
        }

    def predict(self, c: Config) -> dict:
        row = pd.DataFrame([{**asdict(c)}])
        X = featurize(row)
        out = {}
        for target in ("cost", "duration_hours"):
            b = self.bundles[target]
            mu = float(b["best"]["model"].predict(X)[0])
            sd = b["best"]["residual_std"]
            out[target] = {"value": float(np.expm1(mu)), "lower": float(np.expm1(mu - 1.96 * sd)),
                           "upper": float(np.expm1(mu + 1.96 * sd)), "model": b["best"]["name"],
                           "r2": b["best"]["metrics"]["r2"]}
        return {"predicted": out, "analytical": simulate(c)}


def detect_anomalies(df: pd.DataFrame, contamination: float = 0.05) -> list[dict]:
    feats = pd.DataFrame({
        "util": df["gpu_utilization"], "mem": df["memory_utilization"],
        "idle_ratio": df["idle_hours"] / df["duration_hours"].clip(lower=1e-6),
        "cost_per_tok": np.log10(df["cost"] / (df["tokens"] / 1e6)),
        "hours": np.log10(df["duration_hours"].clip(lower=1e-3)),
    })
    forest = IsolationForest(contamination=contamination, random_state=7).fit(feats)
    scores = -forest.score_samples(feats)
    flagged = forest.predict(feats) == -1
    results = []
    for (_, job), score, is_out, (_, f) in zip(df.iterrows(), scores, flagged, feats.iterrows()):
        if not is_out:
            continue
        if f["util"] < 0.35:
            kind, cause = "low_gpu_utilization", "Input pipeline or small batch starving the GPU"
        elif f["mem"] > 0.93:
            kind, cause = "high_memory_pressure", "Batch/sequence too large for device memory"
        elif f["idle_ratio"] > 0.25:
            kind, cause = "idle_gpus", "GPUs reserved but idle between steps"
        else:
            kind, cause = "cost_spike", "Cost per token far above peers"
        severity = "critical" if score > np.quantile(scores, 0.99) else "warning" if score > np.quantile(scores, 0.97) else "info"
        results.append({"job_id": job["job_id"], "kind": kind, "severity": severity, "score": float(score),
                        "likely_cause": cause, "estimated_waste": float(job["cost"] * (1 - min(1, f["util"] / 0.75)) * 0.5)})
    return sorted(results, key=lambda r: -r["score"])


def optimize(c: Config, max_slowdown_pct: float = 25, min_util: float = 0.4) -> dict:
    base = simulate(c)
    best, alts = None, []
    for gpu, count, batch, prec in itertools.product(GPU_CATALOG, [1, 2, 4, 8, 16, 32], [4, 8, 16, 32, 64, 128], ["BF16", "FP16", "FP32"]):
        cand = Config(**{**asdict(c), "gpu_type": gpu, "gpu_count": count, "batch_size": batch, "precision": prec})
        r = simulate(cand)
        slow = (r["duration_hours"] - base["duration_hours"]) / base["duration_hours"] * 100
        if not r["feasible"] or slow > max_slowdown_pct or r["gpu_utilization"] < min_util or r["cost"] >= base["cost"]:
            continue
        item = {"config": asdict(cand), "result": r, "savings": base["cost"] - r["cost"],
                "savings_pct": (base["cost"] - r["cost"]) / base["cost"] * 100, "duration_delta_pct": slow}
        alts.append(item)
    alts.sort(key=lambda a: -a["savings"])
    if alts:
        best = alts[0]
    return {"current": {"config": asdict(c), "result": base}, "recommended": best, "alternatives": alts[1:6]}
