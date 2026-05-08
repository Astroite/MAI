"""Shared test fixtures, .env.test loader, and isolated test runtime.

Tests require a real LiteLLM-backed provider. Put credentials in
`backend/tests/.env.test` (gitignored). Without an OPENAI_API_KEY the suite
exits early with a clear message — there is no mock fallback.

By default pytest uses a clean SQLite database under `backend/tests/.runtime/`
so test rooms and templates never pollute the normal development database.
Set DATABASE_URL in `.env.test` when you intentionally want a different test DB.
"""

import os
from pathlib import Path

import pytest
from dotenv import dotenv_values, load_dotenv

TEST_DIR = Path(__file__).parent
ENV_TEST_PATH = TEST_DIR / ".env.test"
RUNTIME_DIR = TEST_DIR / ".runtime"
TEST_DB_PATH = RUNTIME_DIR / "mai_test.sqlite3"

env_test_values = dotenv_values(ENV_TEST_PATH) if ENV_TEST_PATH.exists() else {}

# Must configure before importing app.* so Settings / LiteLLM pick up the env.
load_dotenv(ENV_TEST_PATH, override=True)

RUNTIME_DIR.mkdir(parents=True, exist_ok=True)

if not env_test_values.get("DATABASE_URL"):
    os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{TEST_DB_PATH.resolve().as_posix()}"
    for suffix in ("", "-journal", "-wal", "-shm"):
        TEST_DB_PATH.with_name(f"{TEST_DB_PATH.name}{suffix}").unlink(missing_ok=True)

if not env_test_values.get("TRACE_PAYLOAD_DIR"):
    os.environ["TRACE_PAYLOAD_DIR"] = str(RUNTIME_DIR / "trace_payloads")

if not env_test_values.get("UPLOAD_DIR"):
    os.environ["UPLOAD_DIR"] = str(RUNTIME_DIR / "uploads")

if not os.environ.get("OPENAI_API_KEY"):
    raise pytest.UsageError(
        "backend/tests/.env.test must define OPENAI_API_KEY "
        "(and optionally OPENAI_API_BASE). No mock fallback exists."
    )

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _autoconfigure_default_provider():
    """Engine no longer falls back to env vars at runtime — a real
    ApiProvider must be configured. Bootstrap one from .env.test so the
    test suite can run without each test having to set it up."""
    with TestClient(app) as c:
        providers = c.get("/templates/api-providers").json()
        provider = next(
            (p for p in providers if p["name"] == "__pytest_default__"), None
        )
        if provider is None:
            created = c.post(
                "/templates/api-providers",
                json={
                    "name": "__pytest_default__",
                    "provider_slug": "openai",
                    "api_key": os.environ["OPENAI_API_KEY"],
                    "api_base": os.environ.get("OPENAI_API_BASE") or None,
                },
            )
            provider = created.json()
        c.patch(
            "/settings",
            json={
                "default_api_provider_id": provider["id"],
                "default_backing_model": os.environ.get(
                    "OPENAI_TEST_MODEL", "openai/gpt-4o-mini"
                ),
            },
        )
    yield


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def review_format(client):
    formats = client.get("/templates/formats").json()
    return next(item for item in formats if item["name"] == "方案评审")


@pytest.fixture
def roundtable_format(client):
    formats = client.get("/templates/formats").json()
    return next(
        item for item in formats
        if "圆桌" in item["name"] or "round" in item["name"].lower()
    )


@pytest.fixture
def discussant_personas(client):
    return client.get("/templates/personas?kind=discussant").json()


@pytest.fixture
def architect_persona(discussant_personas):
    return next(item for item in discussant_personas if item["name"] == "架构师")


def room_instance_id_for_template(client, room_id: str, template_id: str) -> str:
    """Resolve a room's PersonaInstance id from the template id it was
    spawned from. Tests that pass `template_id` into room creation use this
    to assert against `author_persona_id` / `speaker_persona_id` which carry
    instance ids post-refactor."""
    state = client.get(f"/rooms/{room_id}/state").json()
    for persona in state["personas"]:
        if persona["template_id"] == template_id:
            return persona["id"]
    raise KeyError(f"no instance for template {template_id} in room {room_id}")


@pytest.fixture
def instance_for_template(client):
    def _resolver(room_id: str, template_id: str) -> str:
        return room_instance_id_for_template(client, room_id, template_id)

    return _resolver
