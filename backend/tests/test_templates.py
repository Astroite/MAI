from types import SimpleNamespace

from app import engine as engine_module
from app.llm import llm_adapter


def test_create_debate_format(client):
    phases = client.get("/templates/phases").json()
    assert len(phases) >= 2
    body = {
        "name": "pytest custom format",
        "description": "created by smoke test",
        "phase_sequence": [
            {"phase_template_id": phases[0]["id"], "phase_template_version": phases[0]["version"]},
            {"phase_template_id": phases[1]["id"], "phase_template_version": phases[1]["version"]},
        ],
        "tags": ["pytest", "custom"],
    }
    response = client.post("/templates/formats", json=body)
    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == body["name"]
    assert payload["is_builtin"] is False
    assert payload["phase_sequence"][0]["phase_template_id"] == phases[0]["id"]
    assert payload["phase_sequence"][0]["transitions"][0]["target"] == "next"

    formats = client.get("/templates/formats").json()
    assert any(item["id"] == payload["id"] for item in formats)


def test_update_persona_and_format_templates(client):
    persona = client.post(
        "/templates/personas",
        json={
            "kind": "discussant",
            "name": "pytest editable persona",
            "description": "before",
            "backing_model": "openai/gpt-4o-mini",
            "system_prompt": "before prompt",
            "temperature": 0.4,
            "config": {},
            "tags": ["pytest"],
        },
    ).json()
    updated_persona = client.patch(
        f"/templates/personas/{persona['id']}",
        json={
            "name": "pytest edited persona",
            "description": "after",
            "config": {"deep_thinking": True},
            "tags": ["pytest", "edited"],
        },
    )
    assert updated_persona.status_code == 200
    persona_payload = updated_persona.json()
    assert persona_payload["id"] == persona["id"]
    assert persona_payload["version"] == 2
    assert persona_payload["name"] == "pytest edited persona"
    assert persona_payload["config"]["deep_thinking"] is True

    builtin_persona = next(item for item in client.get("/templates/personas").json() if item["is_builtin"])
    forked_persona = client.patch(
        f"/templates/personas/{builtin_persona['id']}",
        json={"name": "pytest forked builtin persona", "tags": ["pytest", "fork"]},
    ).json()
    assert forked_persona["id"] != builtin_persona["id"]
    assert forked_persona["forked_from_id"] == builtin_persona["id"]
    assert forked_persona["is_builtin"] is False

    phases = client.get("/templates/phases").json()
    debate_format = client.post(
        "/templates/formats",
        json={
            "name": "pytest editable format",
            "description": "before",
            "phase_sequence": [{"phase_template_id": phases[0]["id"], "phase_template_version": phases[0]["version"]}],
            "tags": ["pytest"],
        },
    ).json()
    updated_format = client.patch(
        f"/templates/formats/{debate_format['id']}",
        json={
            "name": "pytest edited format",
            "phase_sequence": [{"phase_template_id": phases[1]["id"], "phase_template_version": phases[1]["version"]}],
            "tags": ["pytest", "edited"],
        },
    )
    assert updated_format.status_code == 200
    format_payload = updated_format.json()
    assert format_payload["id"] == debate_format["id"]
    assert format_payload["version"] == 2
    assert format_payload["phase_sequence"][0]["phase_template_id"] == phases[1]["id"]


def test_api_provider_crud_and_persona_link(client):
    created = client.post(
        "/templates/api-providers",
        json={
            "name": "测试 OpenAI",
            "provider_slug": "openai",
            "api_key": "sk-test-abcd1234",
            "api_base": "https://example.test/v1",
        },
    )
    assert created.status_code == 200
    detail = created.json()
    assert detail["api_key"] == "sk-test-abcd1234"
    assert detail["api_key_preview"] == "...1234"
    assert detail["has_api_key"] is True
    provider_id = detail["id"]

    listing = client.get("/templates/api-providers")
    assert listing.status_code == 200
    item = next(row for row in listing.json() if row["id"] == provider_id)
    assert "api_key" not in item
    assert item["api_key_preview"] == "...1234"
    assert item["has_api_key"] is True

    full = client.get(f"/templates/api-providers/{provider_id}").json()
    assert full["api_key"] == "sk-test-abcd1234"

    renamed = client.patch(
        f"/templates/api-providers/{provider_id}",
        json={"name": "测试 OpenAI 改名", "api_base": "https://other.test/v1"},
    )
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "测试 OpenAI 改名"
    assert renamed.json()["api_base"] == "https://other.test/v1"
    assert renamed.json()["api_key"] == "sk-test-abcd1234"

    persona = client.post(
        "/templates/personas",
        json={
            "kind": "discussant",
            "name": "pytest provider-bound persona",
            "description": "",
            "backing_model": "openai/gpt-4o-mini",
            "api_provider_id": provider_id,
            "system_prompt": "你是评审者。",
            "temperature": 0.4,
            "config": {},
            "tags": ["pytest"],
        },
    )
    assert persona.status_code == 200
    assert persona.json()["api_provider_id"] == provider_id

    deleted = client.delete(f"/templates/api-providers/{provider_id}")
    assert deleted.status_code == 200

    refreshed = next(
        row for row in client.get("/templates/personas").json() if row["id"] == persona.json()["id"]
    )
    assert refreshed["api_provider_id"] is None

    assert client.get(f"/templates/api-providers/{provider_id}").status_code == 404


def test_api_provider_credentials_reach_llm_adapter(client, review_format, monkeypatch):
    """Bound ApiProvider credentials must flow into LLMAdapter.stream."""
    captured: dict = {}

    async def stream_capture(persona, context, phase, max_tokens, scribe_state=None, api_provider=None):
        captured["api_provider"] = api_provider
        captured["persona_id"] = persona.id
        yield SimpleNamespace(text="ok", index=0)

    monkeypatch.setattr(llm_adapter, "stream", stream_capture)
    monkeypatch.setattr(engine_module.llm_adapter, "stream", stream_capture)

    provider = client.post(
        "/templates/api-providers",
        json={"name": "credential test", "provider_slug": "openai", "api_key": "sk-credential-test"},
    ).json()
    persona = client.post(
        "/templates/personas",
        json={
            "kind": "discussant",
            "name": "pytest credential carrier",
            "description": "",
            "backing_model": "openai/gpt-4o-mini",
            "api_provider_id": provider["id"],
            "system_prompt": "test",
            "temperature": 0.4,
            "config": {},
            "tags": ["pytest"],
        },
    ).json()
    room = client.post(
        "/rooms",
        json={
            "title": "pytest credential injection",
            "format_id": review_format["id"],
            "persona_ids": [persona["id"]],
        },
    ).json()
    room_id = room["room"]["id"]
    assert client.post(f"/rooms/{room_id}/messages", json={"content": "测试凭据注入。"}).status_code == 200

    turn = client.post(f"/rooms/{room_id}/turn", json={"speaker_persona_id": persona["id"]})
    assert turn.status_code == 200
    assert captured["persona_id"] == persona["id"]
    assert captured["api_provider"] is not None
    assert captured["api_provider"].api_key == "sk-credential-test"
