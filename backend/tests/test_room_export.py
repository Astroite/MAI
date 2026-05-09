"""Test the room export endpoint and Markdown rendering.

These tests inject messages directly via SessionLocal to avoid spending real
LLM credits — the export logic doesn't need a live model in the loop, only
fixture rows in the right shapes.

A custom phase/format is created inline (rather than relying on a built-in
review_format fixture) because some test DBs end up with the built-in formats
suppressed by the story_mode migration; using a freshly-created format keeps
this test independent of seed state.
"""
import asyncio

from app.db import SessionLocal
from app.models import Message


def _add_message(room_id: str, **kwargs) -> str:
    async def _go() -> str:
        async with SessionLocal() as session:
            msg = Message(room_id=room_id, **kwargs)
            session.add(msg)
            await session.flush()
            await session.commit()
            return msg.id

    return asyncio.run(_go())


def _make_minimal_format(client) -> dict:
    phase = client.post(
        "/templates/phases",
        json={
            "name": "pytest export phase",
            "description": "manual exit, all-speakers",
            "declared_variables": [],
            "allowed_speakers": {"type": "all"},
            "ordering_rule": {"type": "user_picks"},
            "exit_conditions": [{"type": "user_manual"}],
            "role_constraints": "",
            "prompt_template": "请回应。",
            "tags": ["pytest", "export"],
        },
    ).json()
    return client.post(
        "/templates/formats",
        json={
            "name": "pytest export format",
            "phase_sequence": [
                {"phase_template_id": phase["id"], "phase_template_version": phase["version"]}
            ],
            "tags": ["pytest", "export"],
        },
    ).json()


def test_export_room_filters_internal_messages_and_includes_discussion(
    client, discussant_personas, instance_for_template
):
    speaker = discussant_personas[0]
    fmt = _make_minimal_format(client)
    room = client.post(
        "/rooms",
        json={
            "title": "pytest export filter",
            "format_id": fmt["id"],
            "persona_ids": [speaker["id"]],
        },
    )
    assert room.status_code == 200
    room_id = room.json()["room"]["id"]
    speaker_instance_id = instance_for_template(room_id, speaker["id"])

    msg_resp = client.post(
        f"/rooms/{room_id}/messages",
        json={"content": "DISCUSSION_USER_LINE — please review the SSE plan."},
    )
    assert msg_resp.status_code == 200

    _add_message(
        room_id,
        message_type="speech",
        author_actual="ai",
        author_persona_id=speaker_instance_id,
        visibility="public",
        visibility_to_models=True,
        content="DISCUSSION_AI_LINE — looks reasonable to me.",
    )
    _add_message(
        room_id,
        message_type="user_doc",
        author_actual="user",
        visibility="public",
        visibility_to_models=True,
        content="DISCUSSION_DOC_LINE — extracted document body.",
    )
    _add_message(
        room_id,
        message_type="verdict",
        author_actual="ai",
        author_persona_id=speaker_instance_id,
        visibility="public",
        visibility_to_models=True,
        content="VERDICT_LINE — rule of three applies.",
    )
    _add_message(
        room_id,
        message_type="facilitator_signal",
        author_actual="system",
        visibility="public",
        visibility_to_models=False,
        content="FACILITATOR_SECRET_LINE — this should NOT leak into export.",
    )
    _add_message(
        room_id,
        message_type="silence",
        author_actual="ai",
        author_persona_id=speaker_instance_id,
        visibility="public",
        visibility_to_models=True,
        content="SILENCE_PLACEHOLDER — should NOT leak into export.",
    )

    resp = client.get(f"/rooms/{room_id}/export")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/markdown")
    cd = resp.headers["content-disposition"]
    assert "attachment;" in cd
    assert ".md" in cd

    body = resp.text
    assert "# pytest export filter" in body
    assert "DISCUSSION_USER_LINE" in body
    assert "DISCUSSION_AI_LINE" in body
    assert "DISCUSSION_DOC_LINE" in body
    assert "VERDICT_LINE" in body
    assert "## ⚖ 裁决" in body

    assert "FACILITATOR_SECRET_LINE" not in body
    assert "SILENCE_PLACEHOLDER" not in body
    assert "facilitator" not in body.lower()

    assert "我" in body
    assert speaker["name"] in body


def test_export_room_unsupported_format_returns_400(client, discussant_personas):
    speaker = discussant_personas[0]
    fmt = _make_minimal_format(client)
    room = client.post(
        "/rooms",
        json={
            "title": "pytest export bad format",
            "format_id": fmt["id"],
            "persona_ids": [speaker["id"]],
        },
    ).json()
    room_id = room["room"]["id"]

    resp = client.get(f"/rooms/{room_id}/export?format=pdf")
    assert resp.status_code == 400


def test_export_room_404_when_room_missing(client):
    resp = client.get("/rooms/does-not-exist/export")
    assert resp.status_code == 404
