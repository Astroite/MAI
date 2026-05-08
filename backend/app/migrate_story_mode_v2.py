"""Tighten the story_mode phase's role_constraints + prompt_template.

The first cut allowed multi-AI rooms to drift into a single omniscient-narrator
voice because the prompt didn't explicitly forbid speaking-for-others. This
migration updates the built-in story_mode phase row with stricter wording.

Idempotent via the `_migrations` sentinel row. Only touches the row when
`is_builtin = 1` so any user-duplicated copy is left alone.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection

from .ids import builtin_id

MIGRATION_NAME = "story_mode_v2_no_narrator"

PHASE_KEY = "story_mode"

NEW_ROLE_CONSTRAINTS = (
    "你只演自己一个角色。**绝对不要写其他角色的对白或动作**——他们会自己开口。"
    "保持自己的说话风格和性格,不要打破第四面墙、不要复述其他人刚说过的内容、不要做总结或评价。"
    "每次发言短一些(1-3 句最好),像真实对白或剧本台词。"
    "可以用 *...* 描写自己的动作或心情(只描写自己的)。"
    "如果当下没什么想说,输出 `<silent/>` 让别人接。"
)

NEW_PROMPT_TEMPLATE = (
    "以你自己这一个角色的身份,只说你这一刻会说的话或会做的动作。"
    "可以回应别人刚说的话、推进自己的行动、流露情绪、抛出对别人的疑问——但**不要替任何其他人说话或行动**。"
    "如果还没有场景,先用一两句从你自己的视角建立开场(我在哪、我看到什么、我开口说的第一句)。"
    "保持简短自然,不要分析、不要总结。"
)


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

    is_sqlite = sync_conn.engine.dialect.name == "sqlite"
    builtin_filter = "is_builtin = 1" if is_sqlite else "is_builtin = TRUE"

    sync_conn.execute(
        text(
            f"UPDATE phase_templates "
            f"SET role_constraints = :rc, prompt_template = :pt, updated_at = :now "
            f"WHERE id = :id AND {builtin_filter}"
        ),
        {
            "id": builtin_id("phase", PHASE_KEY),
            "rc": NEW_ROLE_CONSTRAINTS,
            "pt": NEW_PROMPT_TEMPLATE,
            "now": datetime.now(timezone.utc),
        },
    )

    sync_conn.execute(
        text("INSERT INTO _migrations (name, applied_at) VALUES (:name, :applied_at)"),
        {"name": MIGRATION_NAME, "applied_at": datetime.now(timezone.utc)},
    )
