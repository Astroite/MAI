"""Test the persona-split one-shot migration against a synthesized
old-schema sqlite database. Verifies template copy, instance derivation,
message/runtime reference rewrite, idempotency, and legacy table drop.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect, text

from app import migrate_personas


OLD_SCHEMA_DDL = [
    """
    CREATE TABLE personas (
        id VARCHAR(36) PRIMARY KEY,
        version INTEGER NOT NULL DEFAULT 1,
        schema_version INTEGER NOT NULL DEFAULT 1,
        status VARCHAR(32) NOT NULL DEFAULT 'published',
        forked_from_id VARCHAR(36),
        forked_from_version INTEGER,
        owner_user_id VARCHAR(36),
        is_builtin BOOLEAN NOT NULL DEFAULT 0,
        kind VARCHAR(32) NOT NULL,
        name VARCHAR(120) NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        backing_model VARCHAR(160) NOT NULL,
        api_provider_id VARCHAR(36),
        system_prompt TEXT NOT NULL,
        temperature FLOAT NOT NULL DEFAULT 0.4,
        config JSON NOT NULL DEFAULT '{}',
        tags JSON NOT NULL DEFAULT '[]',
        created_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP NOT NULL
    )
    """,
    """
    CREATE TABLE room_personas (
        room_id VARCHAR(36) NOT NULL,
        persona_id VARCHAR(36) NOT NULL,
        joined_at TIMESTAMP NOT NULL,
        PRIMARY KEY (room_id, persona_id)
    )
    """,
    """
    CREATE TABLE rooms (
        id VARCHAR(36) PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        created_at TIMESTAMP NOT NULL
    )
    """,
    """
    CREATE TABLE messages (
        id VARCHAR(36) PRIMARY KEY,
        room_id VARCHAR(36) NOT NULL,
        author_persona_id VARCHAR(36),
        user_masquerade_persona_id VARCHAR(36),
        content TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL
    )
    """,
    """
    CREATE TABLE room_runtime_state (
        room_id VARCHAR(36) PRIMARY KEY,
        current_masquerade_persona_id VARCHAR(36),
        updated_at TIMESTAMP NOT NULL
    )
    """,
]

# Tables that the migration's INSERT INTO persona_templates needs to exist.
NEW_TABLE_DDL = [
    """
    CREATE TABLE persona_templates (
        id VARCHAR(36) PRIMARY KEY,
        version INTEGER NOT NULL DEFAULT 1,
        schema_version INTEGER NOT NULL DEFAULT 1,
        status VARCHAR(32) NOT NULL DEFAULT 'published',
        forked_from_id VARCHAR(36),
        forked_from_version INTEGER,
        owner_user_id VARCHAR(36),
        is_builtin BOOLEAN NOT NULL DEFAULT 0,
        kind VARCHAR(32) NOT NULL,
        name VARCHAR(120) NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        backing_model VARCHAR(160) NOT NULL,
        api_provider_id VARCHAR(36),
        system_prompt TEXT NOT NULL,
        temperature FLOAT NOT NULL DEFAULT 0.4,
        config JSON NOT NULL DEFAULT '{}',
        tags JSON NOT NULL DEFAULT '[]',
        created_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP NOT NULL
    )
    """,
    """
    CREATE TABLE persona_instances (
        id VARCHAR(36) PRIMARY KEY,
        room_id VARCHAR(36) NOT NULL,
        template_id VARCHAR(36) NOT NULL,
        template_version INTEGER NOT NULL DEFAULT 1,
        position INTEGER NOT NULL DEFAULT 0,
        kind VARCHAR(32) NOT NULL,
        name VARCHAR(120) NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        backing_model VARCHAR(160) NOT NULL,
        api_provider_id VARCHAR(36),
        system_prompt TEXT NOT NULL,
        temperature FLOAT NOT NULL DEFAULT 0.4,
        config JSON NOT NULL DEFAULT '{}',
        tags JSON NOT NULL DEFAULT '[]',
        created_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP NOT NULL
    )
    """,
    """
    CREATE TABLE _migrations (
        name VARCHAR(120) PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL
    )
    """,
]


def _seed_old_shape(conn: sqlite3.Connection) -> None:
    for ddl in OLD_SCHEMA_DDL + NEW_TABLE_DDL:
        conn.execute(ddl)
    now = "2026-01-01 00:00:00"

    personas = [
        ("p-arch", "discussant", "架构师", "openai/gpt-4o-mini", "你是架构师"),
        ("p-perf", "discussant", "性能批评者", "openai/gpt-4o-mini", "你是性能批评者"),
        ("p-scribe", "scribe", "书记官", "openai/gpt-4o-mini", "你是书记官"),
    ]
    for pid, kind, name, model, prompt in personas:
        conn.execute(
            """
            INSERT INTO personas (id, kind, name, backing_model, system_prompt, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (pid, kind, name, model, prompt, now, now),
        )

    conn.execute("INSERT INTO rooms (id, title, created_at) VALUES ('r-1', 'room one', ?)", (now,))
    conn.execute("INSERT INTO rooms (id, title, created_at) VALUES ('r-2', 'room two', ?)", (now,))

    # r-1 has all three personas; r-2 only architect + scribe.
    for room, pid in [
        ("r-1", "p-arch"),
        ("r-1", "p-perf"),
        ("r-1", "p-scribe"),
        ("r-2", "p-arch"),
        ("r-2", "p-scribe"),
    ]:
        conn.execute(
            "INSERT INTO room_personas (room_id, persona_id, joined_at) VALUES (?, ?, ?)",
            (room, pid, now),
        )

    conn.execute(
        """
        INSERT INTO messages (id, room_id, author_persona_id, user_masquerade_persona_id, content, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        ("m-1", "r-1", "p-arch", None, "hello from architect", now),
    )
    conn.execute(
        """
        INSERT INTO messages (id, room_id, author_persona_id, user_masquerade_persona_id, content, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        ("m-2", "r-1", None, "p-perf", "user-as-perf", now),
    )
    conn.execute(
        """
        INSERT INTO messages (id, room_id, author_persona_id, user_masquerade_persona_id, content, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        ("m-3", "r-2", "p-arch", None, "architect in r-2", now),
    )
    conn.execute(
        """
        INSERT INTO room_runtime_state (room_id, current_masquerade_persona_id, updated_at)
        VALUES ('r-1', 'p-perf', ?)
        """,
        (now,),
    )
    conn.execute(
        """
        INSERT INTO room_runtime_state (room_id, current_masquerade_persona_id, updated_at)
        VALUES ('r-2', NULL, ?)
        """,
        (now,),
    )
    conn.commit()


def test_migration_copies_templates_and_rewrites_references(tmp_path: Path) -> None:
    db_path = tmp_path / "old.sqlite3"
    raw = sqlite3.connect(db_path)
    _seed_old_shape(raw)
    raw.close()

    engine = create_engine(f"sqlite:///{db_path}")
    with engine.begin() as conn:
        migrate_personas.run(conn)
    with engine.connect() as conn:
        names = set(inspect(conn).get_table_names())
        assert "personas" not in names
        assert "room_personas" not in names
        assert {"persona_templates", "persona_instances", "_migrations"} <= names

        templates = conn.execute(
            text("SELECT id, name FROM persona_templates ORDER BY id")
        ).fetchall()
        assert sorted(t.id for t in templates) == ["p-arch", "p-perf", "p-scribe"]

        instances = conn.execute(
            text(
                "SELECT id, room_id, template_id, name, position "
                "FROM persona_instances ORDER BY room_id, position"
            )
        ).fetchall()
        assert len(instances) == 5
        # Per-room positions reset at 0
        positions_by_room: dict[str, list[int]] = {}
        for row in instances:
            positions_by_room.setdefault(row.room_id, []).append(row.position)
        assert positions_by_room["r-1"] == [0, 1, 2]
        assert positions_by_room["r-2"] == [0, 1]

        # (room_id, old_persona_id) -> instance_id map
        idx = {(row.room_id, row.template_id): row.id for row in instances}

        # author_persona_id rewrites
        m1_author = conn.execute(
            text("SELECT author_persona_id FROM messages WHERE id = 'm-1'")
        ).scalar()
        assert m1_author == idx[("r-1", "p-arch")]
        m2_masq = conn.execute(
            text("SELECT user_masquerade_persona_id FROM messages WHERE id = 'm-2'")
        ).scalar()
        assert m2_masq == idx[("r-1", "p-perf")]
        m3_author = conn.execute(
            text("SELECT author_persona_id FROM messages WHERE id = 'm-3'")
        ).scalar()
        assert m3_author == idx[("r-2", "p-arch")]
        # Same template across two rooms -> distinct instance ids
        assert idx[("r-1", "p-arch")] != idx[("r-2", "p-arch")]

        # runtime state rewrite
        r1_masq = conn.execute(
            text("SELECT current_masquerade_persona_id FROM room_runtime_state WHERE room_id = 'r-1'")
        ).scalar()
        assert r1_masq == idx[("r-1", "p-perf")]
        r2_masq = conn.execute(
            text("SELECT current_masquerade_persona_id FROM room_runtime_state WHERE room_id = 'r-2'")
        ).scalar()
        assert r2_masq is None

        sentinel = conn.execute(text("SELECT name FROM _migrations")).fetchall()
        assert [r.name for r in sentinel] == ["persona_split_v1"]

    # Idempotency: second run is a no-op (would otherwise raise on duplicate inserts).
    with engine.begin() as conn:
        migrate_personas.run(conn)
    with engine.connect() as conn:
        n = conn.execute(text("SELECT COUNT(*) FROM persona_instances")).scalar()
        assert n == 5

    engine.dispose()


def test_migration_on_fresh_db_marks_applied(tmp_path: Path) -> None:
    db_path = tmp_path / "fresh.sqlite3"
    raw = sqlite3.connect(db_path)
    for ddl in NEW_TABLE_DDL:
        raw.execute(ddl)
    raw.commit()
    raw.close()

    engine = create_engine(f"sqlite:///{db_path}")
    with engine.begin() as conn:
        migrate_personas.run(conn)
    with engine.connect() as conn:
        sentinel = conn.execute(text("SELECT name FROM _migrations")).fetchall()
        assert [r.name for r in sentinel] == ["persona_split_v1"]
    engine.dispose()
