"""One-shot data migration: split `personas` + `room_personas` into
`persona_templates` + `persona_instances`.

Runs synchronously inside `db.create_schema` via `conn.run_sync`. Idempotent
via the `_migrations` sentinel row (`name='persona_split_v1'`). On a fresh
database (no `personas` table) the sentinel is set immediately and the body
is skipped.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection

MIGRATION_NAME = "persona_split_v1"


def run(sync_conn: Connection) -> None:
    inspector = inspect(sync_conn)
    table_names = set(inspector.get_table_names())

    # Sentinel table is created by Base.metadata.create_all before we run.
    if "_migrations" not in table_names:
        return

    already = sync_conn.execute(
        text("SELECT 1 FROM _migrations WHERE name = :name"),
        {"name": MIGRATION_NAME},
    ).first()
    if already is not None:
        return

    if "personas" not in table_names:
        # Fresh database — nothing to migrate, just mark done.
        _mark_applied(sync_conn)
        return

    template_columns = {col["name"] for col in inspector.get_columns("personas")}
    has_room_personas = "room_personas" in table_names

    # 1) Copy personas → persona_templates (preserve ids).
    _copy_templates(sync_conn, template_columns)

    instance_map: dict[tuple[str, str], str] = {}
    if has_room_personas:
        # 2) Build per-room persona_instances from room_personas.
        instance_map = _spawn_instances(sync_conn)

    # 3) Rewrite Message / RoomRuntimeState references.
    if instance_map:
        _rewrite_references(sync_conn, instance_map)

    # 4) Drop legacy tables.
    if has_room_personas:
        sync_conn.execute(text("DROP TABLE room_personas"))
    sync_conn.execute(text("DROP TABLE personas"))

    _mark_applied(sync_conn)


def _mark_applied(sync_conn: Connection) -> None:
    sync_conn.execute(
        text("INSERT INTO _migrations (name, applied_at) VALUES (:name, :applied_at)"),
        {"name": MIGRATION_NAME, "applied_at": datetime.now(timezone.utc)},
    )


def _copy_templates(sync_conn: Connection, source_columns: set[str]) -> None:
    rows = sync_conn.execute(text("SELECT * FROM personas")).mappings().all()
    if not rows:
        return
    target_cols = [
        "id",
        "version",
        "schema_version",
        "status",
        "forked_from_id",
        "forked_from_version",
        "owner_user_id",
        "is_builtin",
        "kind",
        "name",
        "description",
        "backing_model",
        "api_provider_id",
        "system_prompt",
        "temperature",
        "config",
        "tags",
        "created_at",
        "updated_at",
    ]
    placeholders = ", ".join(f":{c}" for c in target_cols)
    columns = ", ".join(target_cols)
    insert_sql = text(f"INSERT INTO persona_templates ({columns}) VALUES ({placeholders})")
    for row in rows:
        params = {c: row.get(c) if c in source_columns else None for c in target_cols}
        sync_conn.execute(insert_sql, params)


def _spawn_instances(sync_conn: Connection) -> dict[tuple[str, str], str]:
    """For each (room_id, persona_id), insert a persona_instances row that
    snapshots the template fields. Returns the (room_id, old_persona_id)
    -> new_instance_id map used to rewrite downstream references.
    """
    rp_rows = sync_conn.execute(
        text("SELECT room_id, persona_id FROM room_personas ORDER BY room_id, persona_id")
    ).mappings().all()
    if not rp_rows:
        return {}

    # Cache template lookups so we don't re-query identical persona ids.
    template_cache: dict[str, dict] = {}
    insert_sql = text(
        """
        INSERT INTO persona_instances (
            id, room_id, template_id, template_version, position,
            kind, name, description, backing_model, api_provider_id,
            system_prompt, temperature, config, tags,
            created_at, updated_at
        ) VALUES (
            :id, :room_id, :template_id, :template_version, :position,
            :kind, :name, :description, :backing_model, :api_provider_id,
            :system_prompt, :temperature, :config, :tags,
            :created_at, :updated_at
        )
        """
    )

    instance_map: dict[tuple[str, str], str] = {}
    position_per_room: dict[str, int] = defaultdict(int)
    for row in rp_rows:
        room_id = row["room_id"]
        persona_id = row["persona_id"]
        template = template_cache.get(persona_id)
        if template is None:
            template = sync_conn.execute(
                text(
                    "SELECT id, version, kind, name, description, backing_model, "
                    "api_provider_id, system_prompt, temperature, config, tags, "
                    "created_at, updated_at FROM persona_templates WHERE id = :id"
                ),
                {"id": persona_id},
            ).mappings().first()
            if template is None:
                # Dangling room_persona reference — skip silently.
                continue
            template_cache[persona_id] = dict(template)

        instance_id = uuid.uuid4().hex
        position = position_per_room[room_id]
        position_per_room[room_id] += 1
        sync_conn.execute(
            insert_sql,
            {
                "id": instance_id,
                "room_id": room_id,
                "template_id": template["id"],
                "template_version": template["version"],
                "position": position,
                "kind": template["kind"],
                "name": template["name"],
                "description": template["description"] or "",
                "backing_model": template["backing_model"],
                "api_provider_id": template["api_provider_id"],
                "system_prompt": template["system_prompt"],
                "temperature": template["temperature"],
                "config": template["config"],
                "tags": template["tags"],
                "created_at": template["created_at"],
                "updated_at": template["updated_at"],
            },
        )
        instance_map[(room_id, persona_id)] = instance_id

    return instance_map


def _rewrite_references(
    sync_conn: Connection, instance_map: dict[tuple[str, str], str]
) -> None:
    update_messages_author = text(
        "UPDATE messages SET author_persona_id = :new "
        "WHERE room_id = :room AND author_persona_id = :old"
    )
    update_messages_masquerade = text(
        "UPDATE messages SET user_masquerade_persona_id = :new "
        "WHERE room_id = :room AND user_masquerade_persona_id = :old"
    )
    update_runtime = text(
        "UPDATE room_runtime_state SET current_masquerade_persona_id = :new "
        "WHERE room_id = :room AND current_masquerade_persona_id = :old"
    )
    for (room_id, old_pid), new_iid in instance_map.items():
        params = {"new": new_iid, "old": old_pid, "room": room_id}
        sync_conn.execute(update_messages_author, params)
        sync_conn.execute(update_messages_masquerade, params)
        sync_conn.execute(update_runtime, params)
