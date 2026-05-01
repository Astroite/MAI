from collections.abc import AsyncIterator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from .config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()
engine = create_async_engine(settings.database_url, echo=False, pool_pre_ping=True, poolclass=NullPool)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


async def create_schema() -> None:
    from . import models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(
            text(
                """
                ALTER TABLE room_runtime_state
                ADD COLUMN IF NOT EXISTS phase_exit_suggested boolean DEFAULT false NOT NULL
                """
            )
        )
        await conn.execute(
            text(
                """
                ALTER TABLE room_runtime_state
                ADD COLUMN IF NOT EXISTS phase_exit_matched_conditions jsonb DEFAULT '[]'::jsonb NOT NULL
                """
            )
        )
        await conn.execute(
            text(
                """
                ALTER TABLE room_runtime_state
                ADD COLUMN IF NOT EXISTS phase_exit_suppressed_after_message_id varchar(36)
                """
            )
        )
        await conn.execute(
            text(
                """
                ALTER TABLE room_runtime_state
                ADD COLUMN IF NOT EXISTS max_phase_rounds integer DEFAULT 3 NOT NULL
                """
            )
        )
        await conn.execute(
            text(
                """
                ALTER TABLE room_runtime_state
                ADD COLUMN IF NOT EXISTS max_account_daily_tokens integer DEFAULT 250000 NOT NULL
                """
            )
        )
        await conn.execute(
            text(
                """
                ALTER TABLE room_runtime_state
                ADD COLUMN IF NOT EXISTS max_account_monthly_tokens integer DEFAULT 3000000 NOT NULL
                """
            )
        )
