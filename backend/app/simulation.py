"""Analytical GPU workload model and synthetic data generator (mirrors the web app engine)."""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta

import numpy as np

GPU_CATALOG = {
    "H100": {"vram": 80, "tflops": 989, "hourly": 4.10, "tdp": 700},
    "A100": {"vram": 80, "tflops": 312, "hourly": 2.40, "tdp": 400},
    "L40S": {"vram": 48, "tflops": 362, "hourly": 1.30, "tdp": 350},
    "T4": {"vram": 16, "tflops": 65, "hourly": 0.45, "tdp": 70},
}
PRECISION_BYTES = {"FP32": 4, "FP16": 2, "BF16": 2}
PRECISION_SPEED = {"FP32": 0.35, "FP16": 1.0, "BF16": 1.0}
WORKLOAD_FACTOR = {"Training": 6.0, "Fine-tuning": 6.0, "Inference": 2.0, "Evaluation": 2.0}
MODELS = [("Llama-3-8B", 8), ("Mistral-7B", 7.2), ("Llama-3-70B", 70), ("Qwen2-1.5B", 1.5), ("Phi-3-mini", 3.8), ("Gemma-2-27B", 27)]
CLUSTERS = ["us-east-a", "us-west-b", "eu-central-a", "ap-south-a"]


@dataclass
class Config:
    gpu_type: str
    gpu_count: int
    params_b: float
    batch_size: int
    sequence_length: int
    precision: str
    tokens: float
    epochs: int
    workload_type: str


def memory_gb(c: Config) -> float:
    b = PRECISION_BYTES[c.precision]
    train = c.workload_type in ("Training", "Fine-tuning")
    weights = c.params_b * b * (4 if train else 1.2)  # weights + grads + optimizer
    activations = c.batch_size * c.sequence_length * math.sqrt(c.params_b) * 1.6e-5 * b
    return (weights + activations) / c.gpu_count


def simulate(c: Config) -> dict:
    gpu = GPU_CATALOG[c.gpu_type]
    mem = memory_gb(c)
    mem_util = min(1.0, mem / gpu["vram"])
    batch_eff = 1 - math.exp(-c.batch_size * c.sequence_length / 32768)
    scale_eff = 1 / (1 + 0.035 * max(0, c.gpu_count - 1) ** 0.8)
    util = max(0.08, min(0.97, 0.9 * batch_eff * scale_eff))
    flops = WORKLOAD_FACTOR[c.workload_type] * c.params_b * 1e9 * c.tokens * c.epochs
    throughput = gpu["tflops"] * 1e12 * PRECISION_SPEED[c.precision] * util * c.gpu_count
    hours = flops / throughput / 3600
    gpu_hours = hours * c.gpu_count
    gpu_cost = gpu_hours * gpu["hourly"]
    cost = gpu_cost * 1.12  # cpu / storage / network overhead
    return {
        "duration_hours": hours,
        "gpu_hours": gpu_hours,
        "gpu_utilization": util,
        "memory_utilization": mem_util,
        "cost": cost,
        "cost_per_million_tokens": cost / max(1e-6, c.tokens * c.epochs / 1e6),
        "tokens_per_second": c.tokens * c.epochs / max(1.0, hours * 3600),
        "feasible": mem <= gpu["vram"],
        "infeasible_reason": None if mem <= gpu["vram"] else f"needs {mem:.1f} GB per GPU, {gpu['vram']} GB available",
    }


def generate_jobs(n: int, seed: int) -> list[dict]:
    rng = np.random.default_rng(seed)
    end = datetime.utcnow().replace(minute=0, second=0, microsecond=0)
    jobs: list[dict] = []
    for i in range(n):
        model, params = MODELS[rng.integers(len(MODELS))]
        wl = rng.choice(["Training", "Fine-tuning", "Inference", "Evaluation"], p=[0.25, 0.4, 0.2, 0.15])
        gpu_type = rng.choice(list(GPU_CATALOG), p=[0.3, 0.4, 0.2, 0.1])
        count = int(rng.choice([1, 2, 4, 8, 16]))
        cfg = Config(
            gpu_type=str(gpu_type), gpu_count=count, params_b=params,
            batch_size=int(rng.choice([2, 4, 8, 16, 32, 64])),
            sequence_length=int(rng.choice([1024, 2048, 4096, 8192])),
            precision=str(rng.choice(["BF16", "FP16", "FP32"], p=[0.6, 0.3, 0.1])),
            tokens=float(10 ** rng.uniform(7.5, 10.3)), epochs=int(rng.integers(1, 4)), workload_type=str(wl),
        )
        sim = simulate(cfg)
        noise = float(rng.lognormal(0, 0.18))
        util = float(np.clip(sim["gpu_utilization"] * rng.normal(1, 0.12), 0.05, 0.99))
        hours = sim["duration_hours"] * noise
        idle = hours * float(rng.beta(1.2, 8))
        status = str(rng.choice(["Completed", "Failed", "Running"], p=[0.88, 0.07, 0.05]))
        jobs.append({
            "job_id": f"job-{i:05d}", "model_name": model, "params_b": params, "workload_type": cfg.workload_type,
            "gpu_type": cfg.gpu_type, "gpu_count": count, "batch_size": cfg.batch_size,
            "sequence_length": cfg.sequence_length, "precision": cfg.precision, "epochs": cfg.epochs,
            "tokens": cfg.tokens, "status": status, "cluster": CLUSTERS[rng.integers(len(CLUSTERS))],
            "started_at": end - timedelta(hours=float(rng.uniform(0, 60 * 24))),
            "duration_hours": hours, "gpu_hours": hours * count, "gpu_utilization": util,
            "memory_utilization": float(min(0.99, sim["memory_utilization"])), "idle_hours": idle,
            "power_watts": GPU_CATALOG[cfg.gpu_type]["tdp"] * (0.35 + 0.6 * util),
            "cost": sim["cost"] * noise, "retry_of": f"job-{i - 1:05d}" if i and rng.random() < 0.03 else None,
        })
    return jobs
