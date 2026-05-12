import uuid

import pytest

from app.db import SessionLocal
from app.main import _template_assistant_runtime
from app.model_runtime import resolve_model_runtime
from app.models import AppSettings, PersonaInstance


def _suffix(label: str) -> str:
    return f"{label}-{uuid.uuid4().hex[:8]}"


def _create_provider_and_model(client, label: str, *, enabled: bool = True):
    suffix = _suffix(label)
    provider = client.post(
        "/templates/api-providers",
        json={
            "name": f"pytest runtime provider {suffix}",
            "provider_slug": "openai",
            "api_key": f"pytest-key-{suffix}",
            "api_base": f"https://pytest.example/{suffix}",
        },
    )
    assert provider.status_code == 200
    provider_payload = provider.json()
    model_name = f"pytest-model-{suffix}"
    api_model = client.post(
        "/templates/api-models",
        json={
            "api_provider_id": provider_payload["id"],
            "display_name": model_name,
            "model_name": model_name,
            "enabled": enabled,
        },
    )
    assert api_model.status_code == 200
    return provider_payload, api_model.json()


def _create_persona_instance(client, review_format, *, api_model_id: str | None = None) -> str:
    suffix = _suffix("persona")
    body = {
        "kind": "discussant",
        "name": f"Runtime {suffix}",
        "description": "",
        "system_prompt": "runtime test",
        "temperature": 0.4,
        "config": {},
        "tags": ["pytest", "runtime"],
    }
    if api_model_id is not None:
        body["api_model_id"] = api_model_id
    template = client.post("/templates/personas", json=body)
    assert template.status_code == 200
    room = client.post(
        "/rooms",
        json={
            "title": f"pytest runtime room {suffix}",
            "format_id": review_format["id"],
            "persona_ids": [template.json()["id"]],
        },
    )
    assert room.status_code == 200
    state = client.get(f"/rooms/{room.json()['room']['id']}/state").json()
    return state["personas"][0]["id"]


async def _set_settings(**changes) -> None:
    async with SessionLocal() as session:
        row = await session.get(AppSettings, 1)
        assert row is not None
        for key, value in changes.items():
            setattr(row, key, value)
        await session.commit()


async def _set_instance(instance_id: str, **changes) -> None:
    async with SessionLocal() as session:
        persona = await session.get(PersonaInstance, instance_id)
        assert persona is not None
        for key, value in changes.items():
            setattr(persona, key, value)
        await session.commit()


async def _resolve_instance(instance_id: str):
    async with SessionLocal() as session:
        persona = await session.get(PersonaInstance, instance_id)
        assert persona is not None
        return await resolve_model_runtime(session, persona)


@pytest.mark.asyncio
async def test_persona_api_model_id_has_priority(client, review_format):
    _, persona_model = _create_provider_and_model(client, "persona-priority")
    _, settings_model = _create_provider_and_model(client, "settings-priority")
    instance_id = _create_persona_instance(client, review_format, api_model_id=persona_model["id"])
    await _set_settings(
        default_api_model_id=settings_model["id"],
        default_api_provider_id=None,
        default_backing_model=None,
    )

    runtime = await _resolve_instance(instance_id)

    assert runtime.source == "persona"
    assert runtime.api_model_id == persona_model["id"]
    assert runtime.model_name == persona_model["model_name"]


@pytest.mark.asyncio
async def test_settings_api_model_id_fallback(client, review_format):
    _, settings_model = _create_provider_and_model(client, "settings-fallback")
    instance_id = _create_persona_instance(client, review_format)
    await _set_settings(
        default_api_model_id=settings_model["id"],
        default_api_provider_id=None,
        default_backing_model=None,
    )

    runtime = await _resolve_instance(instance_id)

    assert runtime.source == "settings"
    assert runtime.api_model_id == settings_model["id"]
    assert runtime.model_name == settings_model["model_name"]


@pytest.mark.asyncio
async def test_legacy_persona_fallback(client, review_format):
    provider, _ = _create_provider_and_model(client, "legacy-persona")
    instance_id = _create_persona_instance(client, review_format)
    await _set_settings(
        default_api_model_id=None,
        default_api_provider_id=None,
        default_backing_model=None,
    )
    await _set_instance(
        instance_id,
        api_model_id=None,
        backing_model="legacy-persona-model",
        api_provider_id=provider["id"],
    )

    runtime = await _resolve_instance(instance_id)

    assert runtime.source == "legacy_persona"
    assert runtime.api_model_id is None
    assert runtime.model_name == "legacy-persona-model"
    assert runtime.provider_id == provider["id"]


@pytest.mark.asyncio
async def test_legacy_settings_fallback(client, review_format):
    provider, _ = _create_provider_and_model(client, "legacy-settings")
    instance_id = _create_persona_instance(client, review_format)
    await _set_settings(
        default_api_model_id=None,
        default_api_provider_id=provider["id"],
        default_backing_model="legacy-settings-model",
    )

    runtime = await _resolve_instance(instance_id)

    assert runtime.source == "legacy_settings"
    assert runtime.api_model_id is None
    assert runtime.model_name == "legacy-settings-model"
    assert runtime.provider_id == provider["id"]


@pytest.mark.asyncio
async def test_disabled_api_model_errors(client, review_format):
    _, api_model = _create_provider_and_model(client, "disabled", enabled=False)
    instance_id = _create_persona_instance(client, review_format)
    await _set_settings(
        default_api_model_id=None,
        default_api_provider_id=None,
        default_backing_model=None,
    )
    await _set_instance(instance_id, api_model_id=api_model["id"])

    with pytest.raises(ValueError, match="is disabled"):
        await _resolve_instance(instance_id)


@pytest.mark.asyncio
async def test_missing_legacy_provider_errors(client, review_format):
    instance_id = _create_persona_instance(client, review_format)
    await _set_settings(
        default_api_model_id=None,
        default_api_provider_id=None,
        default_backing_model=None,
    )
    await _set_instance(
        instance_id,
        api_model_id=None,
        backing_model="legacy-missing-provider-model",
        api_provider_id=None,
    )

    with pytest.raises(ValueError, match="no API provider configured"):
        await _resolve_instance(instance_id)


@pytest.mark.asyncio
async def test_resolve_does_not_modify_persona_instance(client, review_format):
    _, api_model = _create_provider_and_model(client, "no-overlay")
    instance_id = _create_persona_instance(client, review_format, api_model_id=api_model["id"])
    await _set_settings(
        default_api_model_id=None,
        default_api_provider_id=None,
        default_backing_model=None,
    )

    async with SessionLocal() as session:
        persona = await session.get(PersonaInstance, instance_id)
        assert persona is not None
        assert persona.backing_model == ""
        assert persona.api_provider_id is None
        runtime = await resolve_model_runtime(session, persona)

        assert runtime.model_name == api_model["model_name"]
        assert persona.backing_model == ""
        assert persona.api_provider_id is None
        assert persona.api_model_id == api_model["id"]


@pytest.mark.asyncio
async def test_template_assistant_runtime_reuses_default_resolver(client):
    provider, api_model = _create_provider_and_model(client, "template-assistant")
    await _set_settings(
        default_api_model_id=api_model["id"],
        default_api_provider_id=None,
        default_backing_model=None,
    )

    async with SessionLocal() as session:
        persona, runtime = await _template_assistant_runtime(session)

    assert persona is not None
    assert runtime.source == "settings"
    assert runtime.api_model_id == api_model["id"]
    assert runtime.provider_id == provider["id"]
    assert persona.backing_model == api_model["model_name"]
