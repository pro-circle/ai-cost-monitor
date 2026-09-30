from collections.abc import Iterator

from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text, create_engine,
)
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Job(Base):
    __tablename__ = "training_jobs"
    job_id = Column(String(32), primary_key=True)
    model_name = Column(String(64), index=True, nullable=False)
    params_b = Column(Float, nullable=False)
    workload_type = Column(String(24), index=True, nullable=False)
    gpu_type = Column(String(8), index=True, nullable=False)
    gpu_count = Column(Integer, nullable=False)
    batch_size = Column(Integer, nullable=False)
    sequence_length = Column(Integer, nullable=False)
    precision = Column(String(8), nullable=False)
    epochs = Column(Integer, nullable=False)
    tokens = Column(Float, nullable=False)
    status = Column(String(16), index=True, nullable=False)
    cluster = Column(String(32), index=True, nullable=False)
    started_at = Column(DateTime, index=True, nullable=False)
    duration_hours = Column(Float, nullable=False)
    gpu_hours = Column(Float, nullable=False)
    gpu_utilization = Column(Float, nullable=False)
    memory_utilization = Column(Float, nullable=False)
    idle_hours = Column(Float, nullable=False)
    power_watts = Column(Float, nullable=False)
    cost = Column(Float, nullable=False)
    retry_of = Column(String(32), nullable=True)


class BillingRecord(Base):
    __tablename__ = "billing_records"
    id = Column(Integer, primary_key=True, autoincrement=True)
    job_id = Column(String(32), ForeignKey("training_jobs.job_id", ondelete="CASCADE"), index=True)
    date = Column(DateTime, index=True, nullable=False)
    category = Column(String(24), nullable=False)
    amount = Column(Float, nullable=False)


class DatasetUpload(Base):
    __tablename__ = "dataset_uploads"
    id = Column(Integer, primary_key=True, autoincrement=True)
    file_name = Column(String(200), nullable=False)
    rows = Column(Integer, nullable=False)
    columns = Column(Integer, nullable=False)
    quality_score = Column(Float, nullable=False)
    profile_json = Column(Text, nullable=False)
    uploaded_at = Column(DateTime, nullable=False)
    cleaned = Column(Boolean, default=False)


def init_db() -> None:
    Base.metadata.create_all(engine)


def get_session() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
