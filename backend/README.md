# AIComputeGuard API (FastAPI)

Standalone Python service mirroring the web app's analytics engine: SQL storage, scikit-learn
cost/duration models, Isolation-Forest anomaly detection, configuration optimizer and what-if simulator.

## Run locally (SQLite)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
# open http://localhost:8000/docs
```

On first start it creates the tables, seeds 3,000 synthetic jobs and trains the models.

## Test

```bash
cd backend && pytest -q
```

## Run with PostgreSQL (Docker)

```bash
cd backend
cp .env.example .env   # set POSTGRES_PASSWORD
docker compose up --build
```

`db/schema.sql` is applied on first database start; the API also runs `create_all` defensively.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | /health | Liveness + loaded models |
| GET | /api/dashboard?days= | KPIs, cost by GPU, daily cost |
| GET | /api/workloads | Paged, sortable job list (`page`, `page_size`, `sort_by`, `sort_dir`, `gpu_type`, `status`) |
| GET | /api/workloads/{job_id} | One job |
| GET | /api/cost?days= | Spend, 14-day forecast, waste, top jobs |
| GET | /api/anomalies?days=&contamination= | Isolation-Forest flags |
| POST | /api/predict | Cost/duration prediction with 95% interval |
| GET | /api/models · POST /api/models/retrain | Model leaderboard / retrain |
| POST | /api/optimize | Cheapest feasible setup under limits |
| POST | /api/what-if | Compare two setups |
| POST | /api/datasets/profile | Upload CSV/JSON (≤4 MB) and get a quality profile |

## Deploy

Any container host (Render, Fly.io, Railway, Cloud Run, ECS): build `backend/Dockerfile`, set
`ACG_DATABASE_URL` to a managed Postgres URL (`postgresql+psycopg://...`) and `ACG_CORS_ORIGINS`
to the web app's published URL.
