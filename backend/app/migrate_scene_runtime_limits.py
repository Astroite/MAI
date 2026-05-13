"""Raise legacy Story Scene runtime limits that still use room defaults.

Scene rooms originally inherited ordinary discussion-room caps. That made a
fresh Story World scene stop after only a few rounds, because the generic phase
round and consecutive-AI-turn guards still apply even though story phases are
manual-exit. This migration only touches active/unsealed scenes whose fields
are still exactly at the old defaults, preserving custom user edits.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection

from .runtime_defaults import (
    DEFAULT_MAX_ACCOUNT_DAILY_TOKENS,
    DEFAULT_MAX_ACCOUNT_MONTHLY_TOKENS,
    DEFAULT_MAX_CONSECUTIVE_AI_TURNS,
    DEFAULT_MAX_MESSAGE_TOKENS,
    DEFAULT_MAX_PHASE_ROUNDS,
    DEFAULT_MAX_ROOM_TOKENS,
    SCENE_DEFAULT_MAX_ACCOUNT_DAILY_TOKENS,
    SCENE_DEFAULT_MAX_ACCOUNT_MONTHLY_TOKENS,
    SCENE_DEFAULT_MAX_CONSECUTIVE_AI_TURNS,
    SCENE_DEFAULT_MAX_MESSAGE_TOKENS,
    SCENE_DEFAULT_MAX_PHASE_ROUNDS,
    SCENE_DEFAULT_MAX_ROOM_TOKENS,
)

MIGRATION_NAME = "scene_runtime_limits_v1"

UPDATES = (
    ("max_message_tokens", DEFAULT_MAX_MESSAGE_TOKENS, SCENE_DEFAULT_MAX_MESSAGE_TOKENS),
    ("max_room_tokens", DEFAULT_MAX_ROOM_TOKENS, SCENE_DEFAULT_MAX_ROOM_TOKENS),
    ("max_phase_rounds", DEFAULT_MAX_PHASE_ROUNDS, SCENE_DEFAULT_MAX_PHASE_ROUNDS),
    (
        "max_account_daily_tokens",
        DEFAULT_MAX_ACCOUNT_DAILY_TOKENS,
        SCENE_DEFAULT_MAX_ACCOUNT_DAILY_TOKENS,
    ),
    (
        "max_account_monthly_tokens",
        DEFAULT_MAX_ACCOUNT_MONTHLY_TOKENS,
        SCENE_DEFAULT_MAX_ACCOUNT_MONTHLY_TOKENS,
    ),
    (
        "max_consecutive_ai_turns",
        DEFAULT_MAX_CONSECUTIVE_AI_TURNS,
        SCENE_DEFAULT_MAX_CONSECUTIVE_AI_TURNS,
    ),
)


def run(sync_conn: Connection) -> None:
    inspector = inspect(sync_conn)
    table_names = set(inspector.get_table_names())

    if "_migrations" not in table_names:
        return
    if "rooms" not in table_names or "room_runtime_state" not in table_names:
        return

    already = sync_conn.execute(
        text("SELECT 1 FROM _migrations WHERE name = :name"),
        {"name": MIGRATION_NAME},
    ).first()
    if already is not None:
        return

    for column, old_value, new_value in UPDATES:
        sync_conn.execute(
            text(
                f"UPDATE room_runtime_state "
                f"SET {column} = :new_value "
                f"WHERE {column} = :old_value "
                f"AND EXISTS ("
                f"  SELECT 1 FROM rooms "
                f"  WHERE rooms.id = room_runtime_state.room_id "
                f"  AND rooms.world_id IS NOT NULL "
                f"  AND rooms.sealed_at IS NULL "
                f"  AND rooms.status <> 'archived'"
                f")"
            ),
            {"old_value": old_value, "new_value": new_value},
        )

    sync_conn.execute(
        text("INSERT INTO _migrations (name, applied_at) VALUES (:name, :applied_at)"),
        {"name": MIGRATION_NAME, "applied_at": datetime.now(timezone.utc)},
    )
