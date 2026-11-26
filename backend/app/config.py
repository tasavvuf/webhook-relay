from pathlib import Path
from typing import Optional
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]
ROOT_DIR = BACKEND_DIR.parent


def normalize_async_database_url(url: str) -> tuple[str, dict]:
    """Convert Postgres URLs to asyncpg format and extract driver-safe connect_args."""
    if url.startswith("sqlite"):
        return url, {"check_same_thread": False}

    normalized = url
    if normalized.startswith("postgres://"):
        normalized = normalized.replace("postgres://", "postgresql+asyncpg://", 1)
    elif normalized.startswith("postgresql://"):
        normalized = normalized.replace("postgresql://", "postgresql+asyncpg://", 1)

    parsed = urlparse(normalized)
    query_items = dict(parse_qsl(parsed.query, keep_blank_values=True))

    sslmode = query_items.pop("sslmode", None)
    query_items.pop("channel_binding", None)

    rebuilt = urlunparse(parsed._replace(query=urlencode(query_items)))

    connect_args: dict = {}
    if sslmode in {"require", "verify-ca", "verify-full"} or (
        parsed.hostname and parsed.hostname.endswith(".neon.tech")
    ):
        connect_args["ssl"] = "require"

    # Neon pooled endpoints use PgBouncer transaction pooling, which does not
    # support asyncpg's default prepared statement cache across connections.
    if parsed.hostname and "-pooler" in parsed.hostname:
        connect_args["statement_cache_size"] = 0
        connect_args["prepared_statement_cache_size"] = 0

    return rebuilt, connect_args


class Settings(BaseSettings):
    """Application configuration loaded from environment variables."""

    DATABASE_URL: str = "sqlite+aiosqlite:///./relay.db"
    DATABASE_URL_UNPOOLED: Optional[str] = None
    CORS_ORIGINS: str | list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    CORS_ORIGIN_REGEX: Optional[str] = r"^https://.*\.vercel\.app$"
    DELIVERY_TIMEOUT_SECONDS: float = 10.0
    MAX_DELIVERY_ATTEMPTS: int = 3
    BACKOFF_BASE_SECONDS: float = 2.0

    model_config = SettingsConfigDict(
        env_file=(
            ROOT_DIR / ".env",
            ROOT_DIR / ".env.local",
            BACKEND_DIR / ".env",
            BACKEND_DIR / ".env.local",
        ),
        extra="ignore",
    )

    @property
    def cors_origins_list(self) -> list[str]:
        if isinstance(self.CORS_ORIGINS, list):
            return self.CORS_ORIGINS
        stripped = self.CORS_ORIGINS.strip()
        if not stripped:
            return []
        if stripped.startswith("["):
            import json

            return [str(item) for item in json.loads(stripped)]
        return [origin.strip() for origin in stripped.split(",") if origin.strip()]

    @property
    def async_database_url(self) -> str:
        url, _ = normalize_async_database_url(self.DATABASE_URL)
        return url

    @property
    def database_connect_args(self) -> dict:
        _, connect_args = normalize_async_database_url(self.DATABASE_URL)
        return connect_args

    @property
    def unpooled_database_url(self) -> Optional[str]:
        if not self.DATABASE_URL_UNPOOLED:
            return None
        url, _ = normalize_async_database_url(self.DATABASE_URL_UNPOOLED)
        return url


settings = Settings()
