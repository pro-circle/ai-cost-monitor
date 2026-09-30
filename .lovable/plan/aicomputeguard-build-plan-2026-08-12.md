# AIComputeGuard — Build Plan

Intelligent AI compute cost prediction and GPU resource optimization platform.

## How this runs (important)

The Lovable preview runs only the React/TanStack Start app on a serverless edge runtime — Python cannot execute there. So the project is built as a **monorepo with two interchangeable backends behind one API contract**:

- **`frontend/`** (this Lovable app): all 13 pages, plus a **demo-mode data layer** written as TanStack server functions. It generates the synthetic AI-infrastructure dataset and computes every metric, anomaly score, prediction and optimization result server-side, in TypeScript. Nothing is hardcoded; the preview is fully usable and self-contained.
- **`backend/`** (Flask + Python): the production analytics/ML brain — Pandas, NumPy, SciPy, scikit-learn, XGBoost, SQLAlchemy, Alembic, Supabase Postgres. Same routes, same JSON shapes.

A single switch decides which one the UI talks to: `VITE_API_MODE=demo | flask`. Every fetch goes through one `apiClient` so no page knows or cares which backend answered. That keeps the Data Science layer genuinely in Python (as required) while the app stays demonstrable at all times.

PySpark, NVIDIA DCGM and Prometheus are dropped per your decision.

## Design direction

Dark-first observability console, not a generic admin panel. Charcoal/near-black surfaces, electric blue primary with cyan highlights, thin hairline borders, tabular numerals, dense-but-readable data grids, restrained glass only on overlays and the top bar. Recharts for charts (edge-safe, no Plotly Python dependency in the frontend). JetBrains-Mono-style numerics against a clean geometric sans for headings.

## Phase 1 — Frontend shell and design system

- Tokenize the whole palette in `src/styles.css` (dark default). No hardcoded colors anywhere.
- App shell: collapsible left sidebar (12 nav items), top navbar with global search, date-range selector, data-source selector, notifications, system status, profile; DEMO DATA badge when in demo mode.
- Landing page at `/` — hero, the three-line tagline, feature cards, animated architecture flow (Workloads → Collection → Data Science → ML → Optimization → Savings), CTAs to Dashboard and Run Demo.
- Shared components: MetricCard, TrendCard, ChartCard, StatusBadge, FilterBar, DateRangePicker, LoadingSkeleton, EmptyState, ErrorState, DataTable (search/sort/filter/paginate/column visibility).

## Phase 2 — Demo data engine (TypeScript, server-side)

Seeded deterministic generator producing correlated records: 10,000 training jobs, ~120,000 telemetry points (aggregated on the server, never shipped raw to React), 10,000 billing rows, 10,000 token-usage rows across A100/H100/L40S/T4, Llama/Mistral/Qwen/custom models, and training/fine-tune/inference/eval workloads. Realistic physics-ish relationships between GPU count, utilization, tokens, duration and cost, plus deliberately injected anomalies (sub-20% utilization, VRAM near-limits, cost spikes, runaway durations, failures).

On top of it, in TypeScript, mirroring the Python modules: feature engineering, descriptive/diagnostic stats, correlation, ridge + gradient-boosted-tree regressors for cost and duration with MAE/RMSE/R²/MAPE and model selection, Isolation-Forest-style anomaly scoring with LOF-style density check, coordinate-descent config search for optimization, and a template-bound insight generator that only emits sentences backed by computed numbers.

## Phase 3 — Pages (all backed by real computation)

1. **Dashboard** — 6 KPI cards with sparklines and prior-period deltas; GPU utilization over time (avg/peak/min, 24h/7d/30d/custom), cost trend + monthly projection, cost by GPU type, cost vs tokens scatter, utilization histogram, training time vs GPU count, cost breakdown. All filters cascade to every chart.
2. **Workloads** — full table with the specified columns, filters and efficiency score.
3. **Workload detail** — job info, resource config, four utilization + power charts, cost split, four efficiency scores, anomaly findings with explanation and recommended action.
4. **GPU Analytics** — per-model/job/time/cluster breakdowns, GPU-hours vs idle vs active, weighted efficiency score with Excellent→Critical banding, time×job utilization heatmap.
5. **Cost Intelligence** — spend rollups, forecast, per-unit cost metrics, top-10 expensive workloads, wasted-compute detector (low util, idle, failures, repeats, over-provisioning, bad sequence/batch sizing).
6. **Predictions** — cost model training + model comparison table with the selected model highlighted; training-time prediction form (React Hook Form + Zod) returning duration, GPU hours, cost, throughput and a confidence interval.
7. **Anomalies** — severity-grouped feed; each item shows metric, expected range, observed value, cause, recommendation.
8. **Optimization** — current vs recommended config side by side, savings amount and %, expected performance delta, constraint report.
9. **What-If Simulator** — live sliders for GPU type/count, batch, sequence length, precision, tokens, steps; instant duration/GPU-hours/cost/cost-per-1M-tokens/utilization/savings and a comparison chart of saved scenarios.
10. **Recommendations** — categorized cards with reason, impact, savings, confidence, action.
11. **Datasets** — CSV/JSON upload with size and schema validation, preview, missing/duplicate/outlier/type detection, quality score, cleaning pipeline with before/after stats, cleaned-file download.
12. **Explore (EDA)** — summary stats, correlation matrix, dynamic X/Y plotting, histograms, box plots, feature importance, time series.
13. **Insights & Research** — research gap vs existing approaches, key findings, and the generated natural-language insights.
14. **Reports** — build a report (executive summary → savings) and export PDF/CSV/JSON.
15. **Settings** — efficiency-score weights, API mode, currency, thresholds.

## Phase 4 — Flask backend in-repo

`backend/app/` split into `api/ models/ schemas/ services/ analytics/ ml/ optimization/ data_processing/ utils/ config/`, plus `migrations/`, `tests/`, `requirements.txt`, `run.py`.

- SQLAlchemy models for users, datasets, training_jobs, gpu_metrics, workload_configurations, billing_records, token_usage, predictions, anomalies, recommendations, optimization_results, model_versions — with indexes on job_id, timestamp, gpu_type, model_name, workload_type. Alembic migrations.
- ML pipeline files exactly as specified (`data_loader.py`, `preprocessing.py`, `feature_engineering.py`, `train_models.py`, `evaluate_models.py`, `predict.py`, `anomaly_detection.py`, `optimization.py`), joblib persistence, model versioning rows.
- All REST endpoints from your spec, JWT auth with hashed passwords, Zod-mirrored Pydantic validation, CORS, upload limits, uniform `{ data, error, meta }` envelope, no stack traces leaked.
- `scripts/seed_synthetic.py` writes the same synthetic dataset into Postgres, so demo mode and Flask mode show equivalent data.
- Pytest for services/ML/API; Vitest + RTL for frontend units.

## Phase 5 — Deployment

- `docker-compose.yml`: frontend, backend, postgres — `docker compose up --build`.
- **Local dev**: compose, or Vite + `flask run` + local Postgres.
- **Production**: frontend to Firebase Hosting, Flask to Render (free tier), Postgres on Supabase. Render free instances cold-start, so a Supabase `pg_cron` job pings `/api/health` every ~10 minutes to keep it warm — documented with the exact SQL.
- `.env.example` for `DATABASE_URL`, `SECRET_KEY`, `JWT_SECRET`, `VITE_API_URL`, `VITE_API_MODE`. No secrets in code. You supply your own Supabase connection string; I can write the migrations but cannot run them against your project.
- README plus API docs, DB schema docs, ML pipeline docs and a data dictionary. Demo credentials included.

## Verification before I call it done

Frontend builds and typechecks clean; every route renders with real computed data; no placeholder buttons; charts fed by server functions; Python modules importable and unit-tested; compose file validated. I cannot execute Python or run migrations inside this environment, so those steps are verified by tests and documented commands rather than a live run — I'll state clearly anything that needs your machine.

## Scope note

This is a large build spanning ~15 pages, a full analytics/ML layer in TypeScript, and a parallel Python backend. I'll deliver it in the phase order above so the app is usable and impressive early, then deepen the Python side.
