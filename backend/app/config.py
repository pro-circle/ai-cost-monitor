from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="ACG_")

    database_url: str = "sqlite:///./aicomputeguard.db"
    cors_origins: str = "*"
    seed_jobs: int = 3000
    seed: int = 42


settings = Settings()
