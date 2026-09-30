"""AIComputeGuard API — FastAPI service backed by SQL (SQLite locally, Postgres in production)."""
from __future__ import annotations

import io
import json
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import datetime, timedelta
from typing import Literal

import numpy as np
import pandas as pd
from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import settings
from .db import BillingRecord, DatasetUpload, Job, SessionLocal, get_session, init_db
from .ml import ModelRegistry, detect_anomalies, optimize
from .simulation import Config, generate_jobs, simulate

registry = ModelRegistry()
MAX_UPLOAD_BYTES = 4_000_000


def load_df(session: Session, days: int | None = None) -> pd.DataFrame:
    q = select(Job)
    if days:
        q = q.where(Job.started_at >= datetime.utcnow() - timedelta(days=days))
    rows = session.execute(q).scalars().all()
    return pd.DataFrame([{c.name: getattr(r, c.name) for c in Job.__table__.columns} for r in rows])


def seed_if_empty() -> None:
    with SessionLocal() as s:
        if s.scalar(select(func.count()).select_from(Job)):
            return
        jobs = generate_jobs(settings.seed_jobs, settings.seed)
        s.add_all(Job(**j) for j in jobs)
        s.flush()
        for j in jobs:
            s.add(BillingRecord(job_id=j["job_id"], date=j["started_at"], category=j["workload_type"], amount=j["cost"] * 0.9))
            s.add(BillingRecord(job_id=j["job_id"], date=j["started_at"], category="Storage", amount=j["cost"] * 0.1))
        s.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    seed_if_empty()
    with SessionLocal() as s:
        registry.train(load_df(s))
    yield


app = FastAPI(title="AIComputeGuard API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins.split(","), allow_methods=["*"], allow_headers=["*"])


class ConfigIn(BaseModel):
    gpu_type: Literal["H100", "A100", "L40S", "T4"] = "A100"
    gpu_count: int = Field(8, ge=1, le=64)
    params_b: float = Field(7, ge=0.1, le=2000)
    batch_size: int = Field(16, ge=1, le=1024)
    sequence_length: int = Field(4096, ge=128, le=131072)
    precision: Literal["FP32", "FP16", "BF16"] = "BF16"
    tokens: float = Field(2e10, ge=1e5, le=1e13)
    epochs: int = Field(1, ge=1, le=20)
    workload_type: Literal["Training", "Fine-tuning", "Inference", "Evaluation"] = "Fine-tuning"

    def to_config(self) -> Config:
        return Config(**self.model_dump())


class OptimizeIn(BaseModel):
    config: ConfigIn
    max_slowdown_pct: float = Field(25, ge=0, le=300)
    min_gpu_utilization: float = Field(0.4, ge=0, le=1)


class WhatIfIn(BaseModel):
    baseline: ConfigIn
    scenario: ConfigIn


def jsonable(df: pd.DataFrame) -> list[dict]:
    return json.loads(df.to_json(orient="records", date_format="iso"))


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "models": list(registry.bundles)}


@app.get("/api/dashboard")
def dashboard(days: int = Query(30, ge=1, le=365), s: Session = Depends(get_session)) -> dict:
    df = load_df(s, days)
    if df.empty:
        return {"jobs": 0}
    daily = df.assign(date=df["started_at"].dt.date.astype(str)).groupby("date")["cost"].sum().round(2)
    return {
        "jobs": len(df), "total_cost": round(df["cost"].sum(), 2), "gpu_hours": round(df["gpu_hours"].sum(), 1),
        "avg_gpu_utilization": round(df["gpu_utilization"].mean() * 100, 1),
        "idle_gpu_hours": round((df["idle_hours"] * df["gpu_count"]).sum(), 1),
        "failed_jobs": int((df["status"] == "Failed").sum()),
        "cost_by_gpu": df.groupby("gpu_type")["cost"].sum().round(2).to_dict(),
        "daily_cost": [{"date": d, "cost": v} for d, v in daily.items()],
    }


@app.get("/api/workloads")
def workloads(
    page: int = Query(1, ge=1), page_size: int = Query(25, ge=5, le=200),
    sort_by: str = "cost", sort_dir: Literal["asc", "desc"] = "desc",
    gpu_type: str | None = None, status: str | None = None, s: Session = Depends(get_session),
) -> dict:
    col = getattr(Job, sort_by, None)
    if col is None:
        raise HTTPException(400, f"Unknown sort column {sort_by}")
    q = select(Job)
    if gpu_type:
        q = q.where(Job.gpu_type == gpu_type)
    if status:
        q = q.where(Job.status == status)
    total = s.scalar(select(func.count()).select_from(q.subquery()))
    q = q.order_by(col.desc() if sort_dir == "desc" else col.asc()).offset((page - 1) * page_size).limit(page_size)
    rows = s.execute(q).scalars().all()
    return {"total": total, "page": page, "page_size": page_size,
            "rows": [{c.name: getattr(r, c.name) for c in Job.__table__.columns} for r in rows]}


@app.get("/api/workloads/{job_id}")
def workload(job_id: str, s: Session = Depends(get_session)) -> dict:
    job = s.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Workload not found")
    return {c.name: getattr(job, c.name) for c in Job.__table__.columns}


@app.get("/api/cost")
def cost(days: int = Query(30, ge=1, le=365), s: Session = Depends(get_session)) -> dict:
    df = load_df(s, days)
    daily = df.assign(date=df["started_at"].dt.date).groupby("date")["cost"].sum()
    x = np.arange(len(daily))
    slope, intercept = np.polyfit(x, daily.to_numpy(), 1) if len(daily) > 1 else (0.0, float(daily.sum()))
    forecast = [max(0.0, intercept + slope * (len(daily) + i)) for i in range(14)]
    waste = {
        "low_utilization": float((df.loc[df.gpu_utilization < 0.45, "cost"] * 0.4).sum()),
        "failed_jobs": float(df.loc[df.status == "Failed", "cost"].sum()),
        "idle": float((df["idle_hours"] / df["duration_hours"].clip(lower=1e-6) * df["cost"]).sum()),
    }
    return {"total_spend": round(df["cost"].sum(), 2), "forecast_14d": round(sum(forecast), 2),
            "trend_slope_per_day": round(float(slope), 2), "waste": waste,
            "top_expensive": jsonable(df.nlargest(10, "cost")[["job_id", "model_name", "gpu_type", "gpu_count", "cost"]])}


@app.get("/api/anomalies")
def anomalies(days: int = Query(30, ge=1, le=365), contamination: float = Query(0.05, gt=0, lt=0.5), s: Session = Depends(get_session)) -> dict:
    df = load_df(s, days)
    items = detect_anomalies(df, contamination) if len(df) > 20 else []
    return {"scanned": len(df), "flagged": len(items), "items": items[:200]}


@app.post("/api/predict")
def predict(body: ConfigIn) -> dict:
    return registry.predict(body.to_config())


@app.get("/api/models")
def models() -> dict:
    return registry.summary()


@app.post("/api/models/retrain")
def retrain(s: Session = Depends(get_session)) -> dict:
    return registry.train(load_df(s))


@app.post("/api/optimize")
def optimize_endpoint(body: OptimizeIn) -> dict:
    return optimize(body.config.to_config(), body.max_slowdown_pct, body.min_gpu_utilization)


@app.post("/api/what-if")
def what_if(body: WhatIfIn) -> dict:
    a, b = simulate(body.baseline.to_config()), simulate(body.scenario.to_config())
    return {"baseline": a, "scenario": b, "delta": {
        "cost_pct": (b["cost"] - a["cost"]) / a["cost"] * 100,
        "duration_pct": (b["duration_hours"] - a["duration_hours"]) / a["duration_hours"] * 100,
        "savings": a["cost"] - b["cost"]}}


@app.post("/api/datasets/profile")
async def profile_dataset(file: UploadFile = File(...), s: Session = Depends(get_session)) -> dict:
    raw = await file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File must be under 4 MB")
    name = file.filename or "upload"
    try:
        df = pd.read_json(io.BytesIO(raw)) if name.endswith(".json") else pd.read_csv(io.BytesIO(raw))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"Could not parse file: {exc}") from exc
    missing_pct = float(df.isna().mean().mean() * 100) if df.size else 0.0
    dup = int(df.duplicated().sum())
    quality = max(0.0, 100 - missing_pct * 1.5 - dup / max(1, len(df)) * 100)
    profile = {
        "rows": len(df), "columns": df.shape[1], "missing_pct": round(missing_pct, 2), "duplicate_rows": dup,
        "quality_score": round(quality, 1),
        "columns_profile": [{"name": c, "dtype": str(df[c].dtype), "missing": int(df[c].isna().sum()),
                             "unique": int(df[c].nunique())} for c in df.columns],
    }
    s.add(DatasetUpload(file_name=name, rows=len(df), columns=df.shape[1], quality_score=quality,
                        profile_json=json.dumps(profile), uploaded_at=datetime.utcnow()))
    s.commit()
    return profile


@app.get("/api/simulate")
def simulate_get(body: ConfigIn = Depends()) -> dict:
    return {"config": asdict(body.to_config()), "result": simulate(body.to_config())}
