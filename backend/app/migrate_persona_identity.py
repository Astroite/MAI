"""Backfill the new `identity` column on persona templates + instances.

Before this change, persona `name` doubled as the role label ("架构师",
"维护者"). We now split: `name` holds the person's real name
("陆知谦") and `identity` holds the role. This migration:

1. Updates the 12 built-in persona templates and every PersonaInstance
   row spawned from them to the new (name, identity) pairs. Keys on
   deterministic `builtin_id("persona", key)` so user-duplicated copies
   are untouched.
2. For user-authored rows, copies the existing `name` → `identity`
   while leaving `name` alone, so the user can rename later via UI.

Idempotent via the `_migrations` sentinel row. Runs synchronously
inside `db.create_schema` via `conn.run_sync`.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection

from .ids import builtin_id

MIGRATION_NAME = "persona_identity_v1"

# (key, new_name, identity). Must stay in sync with BUILTIN_PERSONAS in
# seed.py — the migration is what backfills older DBs; seed.py is what
# fresh DBs read on first boot.
BUILTIN_NAMES: list[tuple[str, str, str]] = [
    ("architect", "陆知谦", "架构师"),
    ("performance_critic", "沈挽", "性能批评者"),
    ("maintainer", "周恒", "维护者"),
    ("product_strategist", "林若雪", "产品策略师"),
    ("ux_researcher", "苏念", "用户研究员"),
    ("security_reviewer", "冯允中", "安全审计者"),
    ("devils_advocate", "蒋砚秋", "反方律师"),
    ("steelmanner", "江砚之", "钢人化支持者"),
    ("systems_operator", "季扬", "运维负责人"),
    ("research_scout", "孟野", "研究侦察员"),
    ("scribe", "文素", "书记官"),
    ("facilitator", "仲白", "上帝副手"),
]


def run(sync_conn: Connection) -> None:
    inspector = inspect(sync_conn)
    table_names = set(inspector.get_table_names())

    if "_migrations" not in table_names:
        return
    if "persona_templates" not in table_names or "persona_instances" not in table_names:
        return

    already = sync_conn.execute(
        text("SELECT 1 FROM _migrations WHERE name = :name"),
        {"name": MIGRATION_NAME},
    ).first()
    if already is not None:
        return

    is_sqlite = sync_conn.engine.dialect.name == "sqlite"
    builtin_filter_tpl = "is_builtin = 1" if is_sqlite else "is_builtin = TRUE"
    non_builtin_filter_tpl = "is_builtin = 0" if is_sqlite else "is_builtin = FALSE"
    now = datetime.now(timezone.utc)

    # 1. Built-in backfill — key by deterministic builtin_id so any
    # user-duplicated copy (is_builtin=0) is left untouched.
    for key, new_name, identity in BUILTIN_NAMES:
        persona_id = builtin_id("persona", key)
        sync_conn.execute(
            text(
                f"UPDATE persona_templates "
                f"SET name = :name, identity = :identity, updated_at = :now "
                f"WHERE id = :id AND {builtin_filter_tpl}"
            ),
            {"id": persona_id, "name": new_name, "identity": identity, "now": now},
        )
        # Update every room-spawned instance that came from this template
        # so already-active rooms see the rename immediately.
        sync_conn.execute(
            text(
                "UPDATE persona_instances "
                "SET name = :name, identity = :identity, updated_at = :now "
                "WHERE template_id = :id"
            ),
            {"id": persona_id, "name": new_name, "identity": identity, "now": now},
        )

    # 2. User-authored templates: copy old name → identity if identity is
    # still blank. Leave name alone.
    sync_conn.execute(
        text(
            f"UPDATE persona_templates "
            f"SET identity = name, updated_at = :now "
            f"WHERE {non_builtin_filter_tpl} AND (identity = '' OR identity IS NULL)"
        ),
        {"now": now},
    )
    # User-authored instances: any row still blank after step 1.
    sync_conn.execute(
        text(
            "UPDATE persona_instances "
            "SET identity = name, updated_at = :now "
            "WHERE identity = '' OR identity IS NULL"
        ),
        {"now": now},
    )

    sync_conn.execute(
        text("INSERT INTO _migrations (name, applied_at) VALUES (:name, :applied_at)"),
        {"name": MIGRATION_NAME, "applied_at": now},
    )
