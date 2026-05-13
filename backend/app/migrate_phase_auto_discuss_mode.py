"""Backfill explicit auto-discuss continuation mode.

Story Mode used to rely on the free-form `story` tag to bypass casual-mode
geometric decay. This migration moves existing story-tagged phases onto the
explicit `auto_discuss_mode = 'continuous'` field so runtime behavior no longer
depends on tags carrying scheduling semantics.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection

MIGRATION_NAME = "phase_auto_discuss_mode_v1"


def run(sync_conn: Connection) -> None:
    inspector = inspect(sync_conn)
    table_names = set(inspector.get_table_names())

    if "_migrations" not in table_names or "phase_templates" not in table_names:
        return

    already = sync_conn.execute(
        text("SELECT 1 FROM _migrations WHERE name = :name"),
        {"name": MIGRATION_NAME},
    ).first()
    if already is not None:
        return

    columns = {col["name"] for col in inspector.get_columns("phase_templates")}
    if "auto_discuss_mode" not in columns:
        return

    now = datetime.now(timezone.utc)
    if sync_conn.engine.dialect.name == "postgresql":
        sync_conn.execute(
            text(
                "UPDATE phase_templates "
                "SET auto_discuss_mode = 'continuous', updated_at = :now "
                "WHERE auto_discuss = TRUE AND tags ? 'story'"
            ),
            {"now": now},
        )
    else:
        sync_conn.execute(
            text(
                "UPDATE phase_templates "
                "SET auto_discuss_mode = 'continuous', updated_at = :now "
                "WHERE auto_discuss = 1 AND tags LIKE :story_tag"
            ),
            {"now": now, "story_tag": '%"story"%'},
        )

    sync_conn.execute(
        text("INSERT INTO _migrations (name, applied_at) VALUES (:name, :applied_at)"),
        {"name": MIGRATION_NAME, "applied_at": now},
    )
