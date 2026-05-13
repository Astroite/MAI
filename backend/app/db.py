from collections.abc import AsyncIterator
from pathlib import Path
from urllib.parse import urlparse

from sqlalchemy import event, inspect, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from .config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()


def _is_sqlite(url: str) -> bool:
    return url.startswith("sqlite")


def _ensure_sqlite_dir(url: str) -> None:
    # sqlite+aiosqlite:///absolute/or/relative/path.db -> path part
    parsed = urlparse(url)
    path_part = parsed.path
    if not path_part:
        return
    # urlparse gives "/F:/..." on Windows for sqlite:///F:/...; strip leading slash if drive-prefixed
    if len(path_part) > 2 and path_part[0] == "/" and path_part[2] == ":":
        path_part = path_part[1:]
    db_path = Path(path_part)
    if db_path.parent and not db_path.parent.exists():
        db_path.parent.mkdir(parents=True, exist_ok=True)


_sqlite_mode = _is_sqlite(settings.database_url)
if _sqlite_mode:
    _ensure_sqlite_dir(settings.database_url)
    engine = create_async_engine(settings.database_url, echo=False)
else:
    engine = create_async_engine(settings.database_url, echo=False, pool_pre_ping=True, poolclass=NullPool)

if _sqlite_mode:
    @event.listens_for(engine.sync_engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_conn, _connection_record):  # type: ignore[no-redef]
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        # WAL mode lets a writer (e.g. an autodrive background task) coexist
        # with concurrent readers + lets a second writer wait its turn instead
        # of erroring out with `database is locked`.
        cursor.execute("PRAGMA journal_mode=WAL")
        # 15 s of patience before "database is locked" — long enough for an
        # autodrive task to finish responding to a cancel signal (which only
        # propagates between LLM stream chunks).
        cursor.execute("PRAGMA busy_timeout=15000")
        # NORMAL is the WAL-recommended sync level: durable across crashes,
        # roughly 5–10× faster than the FULL default for write-heavy bursts.
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()


SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


# Columns added after the initial schema. Listed here so both fresh and migrated
# databases converge to the same shape regardless of dialect. Each entry is
# (column_name, postgres_ddl, sqlite_ddl).
_ADDED_COLUMNS: dict[str, list[tuple[str, str, str]]] = {
    "room_runtime_state": [
        ("phase_exit_suggested", "boolean DEFAULT false NOT NULL", "BOOLEAN DEFAULT 0 NOT NULL"),
        ("phase_exit_matched_conditions", "jsonb DEFAULT '[]'::jsonb NOT NULL", "JSON DEFAULT '[]' NOT NULL"),
        ("phase_exit_suppressed_after_message_id", "varchar(36)", "VARCHAR(36)"),
        ("max_phase_rounds", "integer DEFAULT 3 NOT NULL", "INTEGER DEFAULT 3 NOT NULL"),
        ("max_account_daily_tokens", "integer DEFAULT 250000 NOT NULL", "INTEGER DEFAULT 250000 NOT NULL"),
        ("max_account_monthly_tokens", "integer DEFAULT 3000000 NOT NULL", "INTEGER DEFAULT 3000000 NOT NULL"),
        ("consecutive_ai_turns", "integer DEFAULT 0 NOT NULL", "INTEGER DEFAULT 0 NOT NULL"),
        ("max_consecutive_ai_turns", "integer DEFAULT 10 NOT NULL", "INTEGER DEFAULT 10 NOT NULL"),
        ("phase_extra_rounds", "integer DEFAULT 0 NOT NULL", "INTEGER DEFAULT 0 NOT NULL"),
    ],
    "personas": [
        ("api_provider_id", "varchar(36)", "VARCHAR(36)"),
    ],
    "persona_templates": [
        ("api_model_id", "varchar(36)", "VARCHAR(36)"),
        ("talkativeness", "double precision DEFAULT 1.0 NOT NULL", "REAL DEFAULT 1.0 NOT NULL"),
        ("color", "varchar(16) DEFAULT '#3b82f6' NOT NULL", "VARCHAR(16) DEFAULT '#3b82f6' NOT NULL"),
        ("icon", "varchar(48) DEFAULT 'Sparkles' NOT NULL", "VARCHAR(48) DEFAULT 'Sparkles' NOT NULL"),
        ("identity", "varchar(120) DEFAULT '' NOT NULL", "VARCHAR(120) DEFAULT '' NOT NULL"),
    ],
    "persona_instances": [
        ("api_model_id", "varchar(36)", "VARCHAR(36)"),
        ("talkativeness", "double precision DEFAULT 1.0 NOT NULL", "REAL DEFAULT 1.0 NOT NULL"),
        ("color", "varchar(16) DEFAULT '#3b82f6' NOT NULL", "VARCHAR(16) DEFAULT '#3b82f6' NOT NULL"),
        ("icon", "varchar(48) DEFAULT 'Sparkles' NOT NULL", "VARCHAR(48) DEFAULT 'Sparkles' NOT NULL"),
        ("identity", "varchar(120) DEFAULT '' NOT NULL", "VARCHAR(120) DEFAULT '' NOT NULL"),
        ("world_character_id", "varchar(36)", "VARCHAR(36)"),
    ],
    "api_providers": [
        ("last_tested_ok", "boolean", "BOOLEAN"),
        ("last_tested_at", "timestamp with time zone", "DATETIME"),
        ("last_tested_error", "text", "TEXT"),
    ],
    "app_settings": [
        ("default_api_model_id", "varchar(36)", "VARCHAR(36)"),
    ],
    "messages": [
        ("user_masquerade_name", "varchar(120)", "VARCHAR(120)"),
    ],
    "rooms": [
        ("background", "text DEFAULT '' NOT NULL", "TEXT DEFAULT '' NOT NULL"),
        ("world_id", "varchar(36)", "VARCHAR(36)"),
        ("scene_index", "integer", "INTEGER"),
        ("in_world_time_start", "text DEFAULT '' NOT NULL", "TEXT DEFAULT '' NOT NULL"),
        ("in_world_time_end", "text DEFAULT '' NOT NULL", "TEXT DEFAULT '' NOT NULL"),
        ("in_world_duration_hint", "text DEFAULT '' NOT NULL", "TEXT DEFAULT '' NOT NULL"),
        ("sealed_at", "timestamp with time zone", "DATETIME"),
    ],
    "phase_templates": [
        ("auto_discuss", "boolean DEFAULT false NOT NULL", "BOOLEAN DEFAULT 0 NOT NULL"),
        ("auto_discuss_mode", "varchar(32) DEFAULT 'decay' NOT NULL", "VARCHAR(32) DEFAULT 'decay' NOT NULL"),
    ],
    "world_character_memories": [
        ("last_used_scene_index", "integer", "INTEGER"),
        ("seal_draft_id", "varchar(36)", "VARCHAR(36)"),
    ],
    "world_character_relations": [
        ("last_updated_seal_draft_id", "varchar(36)", "VARCHAR(36)"),
    ],
    "world_timeline_events": [
        ("seal_draft_id", "varchar(36)", "VARCHAR(36)"),
    ],
}


def _ensure_added_columns(sync_conn: Connection) -> None:
    inspector = inspect(sync_conn)
    table_names = set(inspector.get_table_names())
    dialect = sync_conn.engine.dialect.name
    for table, columns in _ADDED_COLUMNS.items():
        if table not in table_names:
            continue
        existing = {col["name"] for col in inspector.get_columns(table)}
        for name, pg_ddl, sqlite_ddl in columns:
            if name in existing:
                continue
            ddl = pg_ddl if dialect == "postgresql" else sqlite_ddl
            sync_conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))


async def create_schema() -> None:
    from . import models  # noqa: F401
    from . import migrate_api_models
    from . import migrate_builtin_personas_update
    from . import migrate_drop_vendor
    from . import migrate_persona_identity
    from . import migrate_personas
    from . import migrate_seed_new_personas
    from . import migrate_seed_story_mode
    from . import migrate_phase_auto_discuss_mode
    from . import migrate_settings
    from . import migrate_story_mode_v2

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_ensure_added_columns)
        await conn.run_sync(migrate_personas.run)
        await conn.run_sync(migrate_settings.run)
        await conn.run_sync(migrate_api_models.run)
        await conn.run_sync(migrate_drop_vendor.run)
        await conn.run_sync(migrate_seed_story_mode.run)
        await conn.run_sync(migrate_story_mode_v2.run)
        await conn.run_sync(migrate_phase_auto_discuss_mode.run)
        await conn.run_sync(migrate_persona_identity.run)
        await conn.run_sync(migrate_seed_new_personas.run)
        await conn.run_sync(migrate_builtin_personas_update.run)
