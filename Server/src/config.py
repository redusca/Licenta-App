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

    # Docker / container management
    DOCKER_SOCKET: str = "unix:///var/run/docker.sock"
    CONTAINER_IMAGE_NAME: str = "licenta-container:latest"
    CONTAINER_INTERNAL_PORT: int = 8001
    # Shared Docker network for server-hosted containers (set in docker-compose)
    CONTAINER_NETWORK: str = ""
    # Google Gemini API key injected into every server-hosted container
    GOOGLE_API_KEY: str = ""
    # Gemini model used by all containers
    MODEL_NAME: str = "gemini-2.5-flash"

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
