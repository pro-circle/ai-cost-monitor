-- AIComputeGuard PostgreSQL schema (the API also creates these automatically on start-up).
CREATE TABLE IF NOT EXISTS training_jobs (
  job_id             VARCHAR(32) PRIMARY KEY,
  model_name         VARCHAR(64)  NOT NULL,
  params_b           DOUBLE PRECISION NOT NULL,
  workload_type      VARCHAR(24)  NOT NULL,
  gpu_type           VARCHAR(8)   NOT NULL,
  gpu_count          INTEGER      NOT NULL CHECK (gpu_count > 0),
  batch_size         INTEGER      NOT NULL,
  sequence_length    INTEGER      NOT NULL,
  precision          VARCHAR(8)   NOT NULL,
  epochs             INTEGER      NOT NULL,
  tokens             DOUBLE PRECISION NOT NULL,
  status             VARCHAR(16)  NOT NULL,
  cluster            VARCHAR(32)  NOT NULL,
  started_at         TIMESTAMP    NOT NULL,
  duration_hours     DOUBLE PRECISION NOT NULL,
  gpu_hours          DOUBLE PRECISION NOT NULL,
  gpu_utilization    DOUBLE PRECISION NOT NULL CHECK (gpu_utilization BETWEEN 0 AND 1),
  memory_utilization DOUBLE PRECISION NOT NULL,
  idle_hours         DOUBLE PRECISION NOT NULL,
  power_watts        DOUBLE PRECISION NOT NULL,
  cost               DOUBLE PRECISION NOT NULL,
  retry_of           VARCHAR(32)
);
CREATE INDEX IF NOT EXISTS ix_jobs_started ON training_jobs (started_at);
CREATE INDEX IF NOT EXISTS ix_jobs_gpu ON training_jobs (gpu_type);
CREATE INDEX IF NOT EXISTS ix_jobs_status ON training_jobs (status);
CREATE INDEX IF NOT EXISTS ix_jobs_model ON training_jobs (model_name);

CREATE TABLE IF NOT EXISTS billing_records (
  id        SERIAL PRIMARY KEY,
  job_id    VARCHAR(32) REFERENCES training_jobs(job_id) ON DELETE CASCADE,
  date      TIMESTAMP NOT NULL,
  category  VARCHAR(24) NOT NULL,
  amount    DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_billing_job ON billing_records (job_id);
CREATE INDEX IF NOT EXISTS ix_billing_date ON billing_records (date);

CREATE TABLE IF NOT EXISTS dataset_uploads (
  id            SERIAL PRIMARY KEY,
  file_name     VARCHAR(200) NOT NULL,
  rows          INTEGER NOT NULL,
  columns       INTEGER NOT NULL,
  quality_score DOUBLE PRECISION NOT NULL,
  profile_json  TEXT NOT NULL,
  uploaded_at   TIMESTAMP NOT NULL,
  cleaned       BOOLEAN DEFAULT FALSE
);
