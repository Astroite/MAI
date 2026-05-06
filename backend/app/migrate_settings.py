"""One-shot data migrations tied to the AppSettings + default-API rollout.

Currently performs `clear_builtin_backing_model_v1`: blanks the
`backing_model` on built-in `persona_templates` (and any `persona_instances`
derived from a built-in) so the runtime resolver falls through to
`AppSettings.default_backing_model`. User-authored templates and instances
the user has explicitly customized are left alone.

Idempotent via the `_migrations` sentinel row.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection

MIGRATION_NAME = "clear_builtin_backing_model_v1"


def run(sync_conn: Connection) -> None:
    inspector = inspect(sync_conn)
    table_names = set(inspector.get_table_names())

    if "_migrations" not in table_names:
        return

    already = sync_conn.execute(
        text("SELECT 1 FROM _migrations WHERE name = :name"),
        {"name": MIGRATION_NAME},
    ).first()
    if already is not None:
        return

    if {"persona_templates", "persona_instances"} <= table_names:
        sync_conn.execute(
            text("UPDATE persona_templates SET backing_model = '' WHERE is_builtin = 1")
            if sync_conn.engine.dialect.name == "sqlite"
            else text("UPDATE persona_templates SET backing_model = '' WHERE is_builtin = TRUE")
        )
        sync_conn.execute(
            text(
                "UPDATE persona_instances SET backing_model = '' "
                "WHERE template_id IN (SELECT id FROM persona_templates WHERE backing_model = '')"
            )
        )

    sync_conn.execute(
        text("INSERT INTO _migrations (name, applied_at) VALUES (:name, :applied_at)"),
        {"name": MIGRATION_NAME, "applied_at": datetime.now(timezone.utc)},
    )
