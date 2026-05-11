"""Regression tests for the legacy provider/model -> ApiModel migration."""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine, text

from app import migrate_api_models


DDL = [
    """
    CREATE TABLE _migrations (
        name VARCHAR(120) PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL
    )
    """,
    """
    CREATE TABLE api_providers (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        provider_slug VARCHAR(64) NOT NULL,
        api_key TEXT NOT NULL,
        api_base TEXT,
        created_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP NOT NULL
    )
    """,
    """
    CREATE TABLE api_models (
        id VARCHAR(36) PRIMARY KEY,
        api_provider_id VARCHAR(36) NOT NULL,
        display_name VARCHAR(120) NOT NULL,
        model_name VARCHAR(240) NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT 1,
        is_default BOOLEAN NOT NULL DEFAULT 0,
        context_window INTEGER,
        tags JSON NOT NULL DEFAULT '[]',
        created_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP NOT NULL
    )
    """,
    """
    CREATE TABLE app_settings (
        id INTEGER PRIMARY KEY,
        default_backing_model VARCHAR(160),
        default_api_provider_id VARCHAR(36),
        default_api_model_id VARCHAR(36),
        updated_at TIMESTAMP NOT NULL
    )
    """,
    """
    CREATE TABLE persona_templates (
        id VARCHAR(36) PRIMARY KEY,
        api_provider_id VARCHAR(36),
        api_model_id VARCHAR(36),
        backing_model VARCHAR(160) NOT NULL
    )
    """,
    """
    CREATE TABLE persona_instances (
        id VARCHAR(36) PRIMARY KEY,
        api_provider_id VARCHAR(36),
        api_model_id VARCHAR(36),
        backing_model VARCHAR(160) NOT NULL
    )
    """,
]


def test_legacy_fields_are_migrated_to_api_model_ids(tmp_path: Path) -> None:
    db_path = tmp_path / "api-models.sqlite3"
    engine = create_engine(f"sqlite:///{db_path}")
    now = "2026-01-01 00:00:00"
    with engine.begin() as conn:
        for ddl in DDL:
            conn.execute(text(ddl))
        conn.execute(
            text(
                "INSERT INTO api_providers (id, name, provider_slug, api_key, created_at, updated_at) "
                "VALUES ('provider-1', 'OpenAI', 'openai', 'sk-test', :now, :now)"
            ),
            {"now": now},
        )
        conn.execute(
            text(
                "INSERT INTO app_settings "
                "(id, default_api_provider_id, default_backing_model, updated_at) "
                "VALUES (1, 'provider-1', 'openai/gpt-4o-mini', :now)"
            ),
            {"now": now},
        )
        conn.execute(
            text(
                "INSERT INTO persona_templates (id, api_provider_id, backing_model) "
                "VALUES ('template-1', 'provider-1', 'openai/gpt-4o')"
            )
        )
        conn.execute(
            text(
                "INSERT INTO persona_instances (id, api_provider_id, backing_model) "
                "VALUES ('instance-1', 'provider-1', 'openai/gpt-4o')"
            )
        )

    with engine.begin() as conn:
        migrate_api_models.run(conn)

    with engine.connect() as conn:
        models = conn.execute(
            text("SELECT id, model_name, is_default FROM api_models ORDER BY model_name")
        ).mappings().all()
        assert [row["model_name"] for row in models] == ["openai/gpt-4o", "openai/gpt-4o-mini"]
        default_model = next(row for row in models if row["model_name"] == "openai/gpt-4o-mini")
        persona_model = next(row for row in models if row["model_name"] == "openai/gpt-4o")
        assert bool(default_model["is_default"]) is True

        settings_model_id = conn.execute(
            text("SELECT default_api_model_id FROM app_settings WHERE id = 1")
        ).scalar()
        template_model_id = conn.execute(
            text("SELECT api_model_id FROM persona_templates WHERE id = 'template-1'")
        ).scalar()
        instance_model_id = conn.execute(
            text("SELECT api_model_id FROM persona_instances WHERE id = 'instance-1'")
        ).scalar()
        assert settings_model_id == default_model["id"]
        assert template_model_id == persona_model["id"]
        assert instance_model_id == persona_model["id"]

        sentinel = conn.execute(text("SELECT name FROM _migrations")).scalar()
        assert sentinel == "api_models_v1"

    with engine.begin() as conn:
        migrate_api_models.run(conn)
    with engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM api_models")).scalar() == 2

    engine.dispose()
