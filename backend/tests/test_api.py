import os

os.environ.setdefault("ACG_DATABASE_URL", "sqlite:///./test_acg.db")
os.environ.setdefault("ACG_SEED_JOBS", "400")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


def test_end_to_end():
    with TestClient(app) as c:
        assert c.get("/health").json()["status"] == "ok"
        d = c.get("/api/dashboard?days=60").json()
        assert d["jobs"] > 0 and d["total_cost"] > 0

        page = c.get("/api/workloads?page_size=10&sort_by=cost").json()
        assert len(page["rows"]) == 10
        job_id = page["rows"][0]["job_id"]
        assert c.get(f"/api/workloads/{job_id}").status_code == 200
        assert c.get("/api/workloads/nope").status_code == 404

        assert "forecast_14d" in c.get("/api/cost").json()
        assert c.get("/api/anomalies?days=60").json()["scanned"] > 0

        p = c.post("/api/predict", json={"gpu_type": "H100", "gpu_count": 8}).json()
        assert p["predicted"]["cost"]["value"] > 0

        o = c.post("/api/optimize", json={"config": {"gpu_type": "H100", "gpu_count": 32, "batch_size": 4}}).json()
        assert o["current"]["result"]["cost"] > 0

        w = c.post("/api/what-if", json={"baseline": {}, "scenario": {"gpu_type": "H100"}}).json()
        assert "delta" in w

        csv = b"job_id,gpu_type,cost\nj1,A100,10\nj2,H100,\nj2,H100,\n"
        prof = c.post("/api/datasets/profile", files={"file": ("x.csv", csv, "text/csv")}).json()
        assert prof["rows"] == 3 and prof["duplicate_rows"] == 1

        assert c.post("/api/predict", json={"gpu_count": 0}).status_code == 422
