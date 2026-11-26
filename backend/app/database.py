from collections.abc import AsyncGenerator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession

from app.config import normalize_async_database_url, settings


def _make_engine(database_url: str):
    normalized_url, connect_args = normalize_async_database_url(database_url)
    is_sqlite = normalized_url.startswith("sqlite")

    engine_kwargs: dict = {
        "echo": False,
        "future": True,
        "connect_args": connect_args,
    }
    if not is_sqlite:
        engine_kwargs["pool_pre_ping"] = True
        engine_kwargs["pool_recycle"] = 300

    async_engine = create_async_engine(normalized_url, **engine_kwargs)

    if is_sqlite:
        @event.listens_for(async_engine.sync_engine, "connect")
        def _enable_sqlite_fks(dbapi_connection, _connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return async_engine


engine = _make_engine(settings.DATABASE_URL)
async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def init_db() -> None:
    """Create database tables using the direct (unpooled) connection when available."""
    import app.models  # noqa: F401

    if settings.DATABASE_URL_UNPOOLED:
        ddl_engine = _make_engine(settings.DATABASE_URL_UNPOOLED)
        try:
            async with ddl_engine.begin() as conn:
                await conn.run_sync(SQLModel.metadata.create_all)
        finally:
            await ddl_engine.dispose()
        return

    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Yield an async database session for FastAPI request handling."""
    async with async_session_maker() as session:
        yield session
