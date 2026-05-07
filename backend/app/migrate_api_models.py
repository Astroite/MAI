"""One-shot migration for splitting provider credentials from model choices.

Creates `api_models` rows from legacy `(api_provider_id, backing_model)` pairs
and points settings/personas at those rows. Existing legacy fields are kept as
compatibility snapshots.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection

MIGRATION_NAME = "api_models_v1"


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
        sync_conn.execute(
            text("UPDATE api_providers SET vendor = provider_slug WHERE vendor IS NULL OR vendor = '' OR vendor = 'custom'")
        )

    if "api_models" not in table_names:
        _mark_applied(sync_conn)
        return

    if "app_settings" in table_names:
        row = sync_conn.execute(
            text(
                "SELECT id, default_api_provider_id, default_backing_model "
                "FROM app_settings WHERE id = 1"
            )
        ).mappings().first()
        if row and row["default_api_provider_id"] and (row["default_backing_model"] or "").strip():
            model_id = _ensure_model(
                sync_conn,
                row["default_api_provider_id"],
                row["default_backing_model"].strip(),
                is_default=True,
            )
            sync_conn.execute(
                text("UPDATE app_settings SET default_api_model_id = :model_id WHERE id = 1"),
                {"model_id": model_id},
            )

    for table in ("persona_templates", "persona_instances"):
        if table not in table_names:
            continue
        columns = {col["name"] for col in inspector.get_columns(table)}
        if not {"id", "api_provider_id", "api_model_id", "backing_model"} <= columns:
            continue
        rows = sync_conn.execute(
            text(
                f"SELECT id, api_provider_id, backing_model FROM {table} "
                "WHERE api_model_id IS NULL AND api_provider_id IS NOT NULL "
                "AND backing_model IS NOT NULL AND backing_model <> ''"
            )
        ).mappings().all()
        for row in rows:
            model_id = _ensure_model(sync_conn, row["api_provider_id"], row["backing_model"].strip())
            sync_conn.execute(
                text(f"UPDATE {table} SET api_model_id = :model_id WHERE id = :id"),
                {"model_id": model_id, "id": row["id"]},
            )

    _mark_applied(sync_conn)


def _ensure_model(
    sync_conn: Connection,
    provider_id: str,
    model_name: str,
    is_default: bool = False,
) -> str:
    existing = sync_conn.execute(
        text(
            "SELECT id FROM api_models "
            "WHERE api_provider_id = :provider_id AND model_name = :model_name "
            "LIMIT 1"
        ),
        {"provider_id": provider_id, "model_name": model_name},
    ).first()
    if existing is not None:
        model_id = existing[0]
        if is_default:
            sync_conn.execute(
                text("UPDATE api_models SET is_default = :is_default WHERE id = :id"),
                {"id": model_id, "is_default": True},
            )
        return model_id

    now = datetime.now(timezone.utc)
    model_id = uuid.uuid4().hex
    tags_expr = "CAST(:tags AS JSONB)" if sync_conn.dialect.name == "postgresql" else ":tags"
    sync_conn.execute(
        text(
            f"""
            INSERT INTO api_models (
                id, api_provider_id, display_name, model_name, enabled,
                is_default, context_window, tags, created_at, updated_at
            ) VALUES (
                :id, :api_provider_id, :display_name, :model_name, :enabled,
                :is_default, :context_window, {tags_expr}, :created_at, :updated_at
            )
            """
        ),
        {
            "id": model_id,
            "api_provider_id": provider_id,
            "display_name": model_name.split("/")[-1] or model_name,
            "model_name": model_name,
            "enabled": True,
            "is_default": is_default,
            "context_window": None,
            "tags": json.dumps([], ensure_ascii=False),
            "created_at": now,
            "updated_at": now,
        },
    )
    return model_id


def _mark_applied(sync_conn: Connection) -> None:
    sync_conn.execute(
        text("INSERT INTO _migrations (name, applied_at) VALUES (:name, :applied_at)"),
        {"name": MIGRATION_NAME, "applied_at": datetime.now(timezone.utc)},
    )
