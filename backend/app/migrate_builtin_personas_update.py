"""Standing migration: keep built-in persona content in sync with seed.py.

Unlike one-shot migrations (which use a _migrations sentinel and run only
once), this runs on EVERY startup. It is intentionally idempotent:

  UPDATE ... WHERE id = builtin_id AND is_builtin AND version < :seed_version

If the DB row is already at the seed version, the WHERE clause matches 0 rows
and the startup cost is just N cheap indexed point-lookups (one per persona).

Usage — bumping a built-in persona's content:
  1. Edit the persona fields in BUILTIN_PERSONAS in seed.py.
  2. Add (or increment) a "version" key on that persona's dict, e.g.
         "version": 2
     Personas without a "version" key are treated as version 1.
  3. Restart the backend. This migration propagates the change to every
     existing DB automatically.

What gets updated: name, identity, description, system_prompt, temperature,
  color, icon, tags, version.
What does NOT get updated: id, kind, status, is_builtin, config, backing_model,
  api_provider_id, api_model_id, talkativeness, created_at.
  (kind is identity-defining; config is instance-level; talkativeness and
  model wiring are user-adjustable on the template and should not be reset.)

User-duplicated copies of built-in personas have different UUIDs (generated
at fork time, not via builtin_id), so they are never touched.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection

from .ids import builtin_id
from .seed import BUILTIN_PERSONAS


def _jp(value) -> str:
    return json.dumps(value, ensure_ascii=False)


def run(sync_conn: Connection) -> None:
    inspector = inspect(sync_conn)
    if "persona_templates" not in set(inspector.get_table_names()):
        return

    is_sqlite = sync_conn.engine.dialect.name == "sqlite"
    builtin_filter = "is_builtin = 1" if is_sqlite else "is_builtin = TRUE"
    now = datetime.now(timezone.utc)

    for p in BUILTIN_PERSONAS:
        key = p["key"]
        seed_version = p.get("version", 1)
        persona_id = builtin_id("persona", key)

        sync_conn.execute(
            text(
                f"UPDATE persona_templates "
                f"SET name=:name, identity=:identity, description=:description, "
                f"system_prompt=:system_prompt, temperature=:temperature, "
                f"color=:color, icon=:icon, tags=:tags, "
                f"version=:version, updated_at=:now "
                f"WHERE id=:id AND {builtin_filter} AND version < :version"
            ),
            {
                "id": persona_id,
                "name": p["name"],
                "identity": p["identity"],
                "description": p["description"],
                "system_prompt": p["system_prompt"],
                "temperature": p["temperature"],
                "color": p["color"],
                "icon": p["icon"],
                "tags": _jp(p["tags"]),
                "version": seed_version,
                "now": now,
            },
        )
