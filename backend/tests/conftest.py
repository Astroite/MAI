"""Shared test fixtures and .env.test loader.

Tests require a real LiteLLM-backed provider. Put credentials in
`backend/tests/.env.test` (gitignored). Without an OPENAI_API_KEY the suite
exits early with a clear message — there is no mock fallback.
"""

import os
from pathlib import Path

import pytest
from dotenv import load_dotenv

# Must load before importing app.* so Settings / LiteLLM pick up the env.
load_dotenv(Path(__file__).parent / ".env.test", override=False)

if not os.environ.get("OPENAI_API_KEY"):
    raise pytest.UsageError(
        "backend/tests/.env.test must define OPENAI_API_KEY "
        "(and optionally OPENAI_API_BASE). No mock fallback exists."
    )

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


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
