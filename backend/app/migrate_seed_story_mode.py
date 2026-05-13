"""Backfill the `故事模式 / story_mode` built-in phase + format on existing dev DBs.

`seed_builtins` only seeds when the target table is empty (per the project's
intentional "no upsert for built-ins" rule), so anyone who initialized their
DB before story mode shipped won't see it. This migration inserts just the
two missing rows by deterministic builtin id, idempotent via `_migrations`.

Runs synchronously inside `db.create_schema` via `conn.run_sync`.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection

from .ids import builtin_id

MIGRATION_NAME = "seed_story_mode_v1"

PHASE_KEY = "story_mode"
FORMAT_KEY = "story_format"

PHASE_PAYLOAD = {
    "name": "故事模式",
    "description": "无目标的自由演绎：各角色用对白与动作推进剧情，让故事自然涌现。用户随时可以加入或喊停。",
    "declared_variables": [],
    "allowed_speakers": {"type": "all"},
    "ordering_rule": {"type": "casual"},
    "exit_conditions": [{"type": "user_manual"}],
    "auto_discuss": True,
    "auto_discuss_mode": "continuous",
    "role_constraints": (
        "保持角色身份与说话风格一致，不要打破第四面墙、不要复述其他人说过的内容、不要做总结或评价。"
        "每次发言短一些（1-3 句最好），像真实对话或剧本对白。"
        "可以用 *...* 描写动作或心情。如果当下没什么想说，输出 `<silent/>` 让别人接。"
    ),
    "prompt_template": (
        "以你的人设身份接续当前场景：可以回应他人的话、推进剧情、抛出转折、流露情绪或动作。"
        "如果还没有场景，先用一两句建立一个开场（地点、动作或开口的一句话）。"
        "保持简短自然，不要分析、不要总结。"
    ),
    "tags": ["builtin", "story", "casual"],
}

FORMAT_PAYLOAD = {
    "name": "故事模式",
    "description": "纯聊天室：让人设自由对话，看故事自然演绎。永不自动结束，由用户喊停。",
    "tags": ["builtin", "story", "casual"],
}


def _json_param(value):
    """SQLite stores JSONType as TEXT; PG stores JSONB. text() bind-params
    accept native dicts/lists for PG but need a string for SQLite."""
    return json.dumps(value, ensure_ascii=False)


def run(sync_conn: Connection) -> None:
    inspector = inspect(sync_conn)
    table_names = set(inspector.get_table_names())

    if "_migrations" not in table_names:
        return
    if "phase_templates" not in table_names or "debate_formats" not in table_names:
        return

    already = sync_conn.execute(
        text("SELECT 1 FROM _migrations WHERE name = :name"),
        {"name": MIGRATION_NAME},
    ).first()
    if already is not None:
        return

    is_sqlite = sync_conn.engine.dialect.name == "sqlite"
    now = datetime.now(timezone.utc)

    phase_id = builtin_id("phase", PHASE_KEY)
    format_id = builtin_id("format", FORMAT_KEY)

    # Insert phase if not present.
    phase_exists = sync_conn.execute(
        text("SELECT 1 FROM phase_templates WHERE id = :id"),
        {"id": phase_id},
    ).first()
    if phase_exists is None:
        sync_conn.execute(
            text(
                "INSERT INTO phase_templates "
                "(id, version, schema_version, status, is_builtin, name, description, "
                "declared_variables, allowed_speakers, ordering_rule, exit_conditions, "
                "auto_discuss, auto_discuss_mode, role_constraints, prompt_template, tags, created_at, updated_at) "
                "VALUES (:id, 1, 1, 'published', :is_builtin, :name, :description, "
                ":declared_variables, :allowed_speakers, :ordering_rule, :exit_conditions, "
                ":auto_discuss, :auto_discuss_mode, :role_constraints, :prompt_template, :tags, :now, :now)"
            ),
            {
                "id": phase_id,
                "is_builtin": 1 if is_sqlite else True,
                "name": PHASE_PAYLOAD["name"],
                "description": PHASE_PAYLOAD["description"],
                "declared_variables": _json_param(PHASE_PAYLOAD["declared_variables"]),
                "allowed_speakers": _json_param(PHASE_PAYLOAD["allowed_speakers"]),
                "ordering_rule": _json_param(PHASE_PAYLOAD["ordering_rule"]),
                "exit_conditions": _json_param(PHASE_PAYLOAD["exit_conditions"]),
                "auto_discuss": 1 if is_sqlite else True,
                "auto_discuss_mode": PHASE_PAYLOAD["auto_discuss_mode"],
                "role_constraints": PHASE_PAYLOAD["role_constraints"],
                "prompt_template": PHASE_PAYLOAD["prompt_template"],
                "tags": _json_param(PHASE_PAYLOAD["tags"]),
                "now": now,
            },
        )

    # Insert format if not present. The phase_sequence references the phase id we just ensured.
    format_exists = sync_conn.execute(
        text("SELECT 1 FROM debate_formats WHERE id = :id"),
        {"id": format_id},
    ).first()
    if format_exists is None:
        phase_sequence = [{"phase_template_id": phase_id, "transitions": []}]
        sync_conn.execute(
            text(
                "INSERT INTO debate_formats "
                "(id, version, schema_version, status, is_builtin, name, description, "
                "phase_sequence, tags, created_at, updated_at) "
                "VALUES (:id, 1, 1, 'published', :is_builtin, :name, :description, "
                ":phase_sequence, :tags, :now, :now)"
            ),
            {
                "id": format_id,
                "is_builtin": 1 if is_sqlite else True,
                "name": FORMAT_PAYLOAD["name"],
                "description": FORMAT_PAYLOAD["description"],
                "phase_sequence": _json_param(phase_sequence),
                "tags": _json_param(FORMAT_PAYLOAD["tags"]),
                "now": now,
            },
        )

    sync_conn.execute(
        text("INSERT INTO _migrations (name, applied_at) VALUES (:name, :applied_at)"),
        {"name": MIGRATION_NAME, "applied_at": now},
    )
