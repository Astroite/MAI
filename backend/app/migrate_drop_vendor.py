"""Drop the legacy `api_providers.vendor` column.

`vendor` was a free-form display label that always shadowed `provider_slug`
and was never read by the engine. The settings UI now derives a friendly
type label from `provider_slug` directly.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection

MIGRATION_NAME = "drop_api_provider_vendor_v1"


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

    if "api_providers" in table_names:
        columns = {col["name"] for col in inspector.get_columns("api_providers")}
        if "vendor" in columns:
            sync_conn.execute(text("ALTER TABLE api_providers DROP COLUMN vendor"))

    sync_conn.execute(
        text("INSERT INTO _migrations (name, applied_at) VALUES (:name, :applied_at)"),
        {"name": MIGRATION_NAME, "applied_at": datetime.now(timezone.utc)},
    )
