from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache
from pathlib import Path

_ENV_FILE = Path(__file__).parent / ".env"


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "postgresql://licenta:licenta@localhost:5432/licenta"

    # JWT
    JWT_SECRET: str = "change-me-in-production"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours

    # Redis (task queue for agent pool)
    REDIS_URL: str = "redis://localhost:6379/0"

    # Agent pool
    AGENT_WORKER_COUNT: int = 5
    AGENT_TASK_TIMEOUT: int = 120  # seconds a chat request will wait for a worker

    # Google Gemini - shared by all agent workers
    GOOGLE_API_KEY: str = ""
    MODEL_NAME: str = "gemini-2.5-flash"
    MAX_AGENT_ITERATIONS: int = 10

    # Container image name (only needed for the ZIP download feature)
    CONTAINER_IMAGE_NAME: str = "licenta-container:latest"

    # CORS
    ALLOWED_ORIGINS: list[str] = ["*"]

    # GitHub (for serving private-repo release info)
    GITHUB_TOKEN: str = ""
    GITHUB_REPO: str = "redusca/Licenta-App"

    model_config = SettingsConfigDict(env_file=_ENV_FILE, env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
