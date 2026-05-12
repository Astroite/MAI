import asyncio
import threading
import time

import pytest

from app.engine import ACTIVE_CALLS, InFlightCall, drain_active_calls
from app.llm import llm_adapter
from app import engine as engine_module


def test_room_state_exposes_in_flight_partial(client, review_format, discussant_personas, instance_for_template):
    speaker = discussant_personas[0]
    room = client.post(
        "/rooms",
        json={"title": "pytest reconnect", "format_id": review_format["id"], "persona_ids": [speaker["id"]]},
    ).json()
    room_id = room["room"]["id"]
    speaker_instance_id = instance_for_template(room_id, speaker["id"])
    call = InFlightCall(
        room_id=room_id,
        message_id="msg-reconnect",
        persona_id=speaker_instance_id,
        task=object(),
        partial_text="partial answer",
        last_chunk_index=3,
    )
    ACTIVE_CALLS.setdefault(room_id, {})[call.message_id] = call
    try:
        state = client.get(f"/rooms/{room_id}/state")
        assert state.status_code == 200
        partial = state.json()["in_flight_partial"][0]
        assert partial["message_id"] == "msg-reconnect"
        assert partial["persona_id"] == speaker_instance_id
        assert partial["content"] == "partial answer"
        assert partial["last_chunk_index"] == 3
    finally:
        ACTIVE_CALLS.pop(room_id, None)


def test_parallel_turn_exposes_multiple_in_flight_partials(client, discussant_personas, monkeypatch):
    async def noop_autodrive_after(room_id, message):
        return None

    async def controlled_stream(persona, context, phase, max_tokens, scribe_state=None, api_provider=None, **kwargs):
        yield type("Chunk", (), {"text": f"{persona.name} partial", "index": 0})()
        await asyncio.sleep(0.15)
        yield type("Chunk", (), {"text": " done", "index": 1})()

    monkeypatch.setattr(engine_module, "maybe_autodrive_after", noop_autodrive_after)
    monkeypatch.setattr(llm_adapter, "stream", controlled_stream)
    monkeypatch.setattr(engine_module.llm_adapter, "stream", controlled_stream)

    personas = discussant_personas[:2]
    phase = client.post(
        "/templates/phases",
        json={
            "name": "pytest parallel phase",
            "description": "parallel streaming test",
            "declared_variables": [],
            "allowed_speakers": {"type": "all"},
            "ordering_rule": {"type": "parallel"},
            "exit_conditions": [{"type": "user_manual"}],
            "role_constraints": "",
            "prompt_template": "请同时给出一句独立观点。",
            "tags": ["pytest"],
        },
    ).json()
    debate_format = client.post(
        "/templates/formats",
        json={
            "name": "pytest parallel format",
            "phase_sequence": [{"phase_template_id": phase["id"], "phase_template_version": phase["version"]}],
            "tags": ["pytest"],
        },
    ).json()
    room = client.post(
        "/rooms",
        json={
            "title": "pytest parallel streams",
            "format_id": debate_format["id"],
            "persona_ids": [p["id"] for p in personas],
        },
    ).json()
    room_id = room["room"]["id"]
    state0 = client.get(f"/rooms/{room_id}/state").json()
    instance_ids = {p["id"] for p in state0["personas"] if p["kind"] == "discussant"}
    assert client.post(f"/rooms/{room_id}/messages", json={"content": "请并行发言。"}).status_code == 200

    turn_result = {}

    def run_turn():
        turn_result["response"] = client.post(f"/rooms/{room_id}/turn", json={})

    thread = threading.Thread(target=run_turn)
    thread.start()
    partials = []
    try:
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if len(ACTIVE_CALLS.get(room_id, {})) >= 2:
                state = client.get(f"/rooms/{room_id}/state").json()
                partials = state["in_flight_partial"]
                if len(partials) >= 2:
                    break
            time.sleep(0.02)
        assert len(ACTIVE_CALLS.get(room_id, {})) >= 2
        assert len(partials) >= 2
        assert {item["persona_id"] for item in partials} == instance_ids
    finally:
        thread.join(timeout=20)
    assert not thread.is_alive()
    turn = turn_result["response"]
    assert turn.status_code == 200
    assert {message["author_persona_id"] for message in turn.json()} == instance_ids


def test_chunk_idle_timeout_truncates_message(client, review_format, architect_persona, instance_for_template, monkeypatch):
    monkeypatch.setattr(engine_module, "CHUNK_IDLE_TIMEOUT_SECONDS", 0.05)

    async def stalled_stream(persona, context, phase, max_tokens, scribe_state=None, api_provider=None, **kwargs):
        await asyncio.sleep(5)
        yield  # pragma: no cover

    monkeypatch.setattr(llm_adapter, "stream", stalled_stream)
    monkeypatch.setattr(engine_module.llm_adapter, "stream", stalled_stream)

    room = client.post(
        "/rooms",
        json={"title": "pytest chunk timeout", "format_id": review_format["id"], "persona_ids": [architect_persona["id"]]},
    )
    assert room.status_code == 200
    room_id = room.json()["room"]["id"]
    architect_instance_id = instance_for_template(room_id, architect_persona["id"])
    assert client.post(f"/rooms/{room_id}/messages", json={"content": "请触发空闲超时。"}).status_code == 200

    turn = client.post(f"/rooms/{room_id}/turn", json={"speaker_persona_id": architect_instance_id})
    assert turn.status_code == 200
    assert turn.json()[0]["truncated_reason"] == "timeout"


@pytest.mark.asyncio
async def test_drain_active_calls_times_out_without_force_killing():
    room_id = "pytest-drain-timeout"
    release = asyncio.Event()

    async def stubborn_call():
        try:
            await asyncio.sleep(3600)
        except asyncio.CancelledError:
            await release.wait()

    task = asyncio.create_task(stubborn_call())
    call = InFlightCall(
        room_id=room_id,
        message_id="msg-timeout",
        persona_id="persona-timeout",
        task=task,
    )
    ACTIVE_CALLS.setdefault(room_id, {})[call.message_id] = call
    try:
        await asyncio.sleep(0)
        result = await drain_active_calls(
            room_id,
            "pytest_timeout",
            timeout_seconds=0.01,
            require_clean=True,
        )
        assert result.cancelled == ["msg-timeout"]
        assert result.completed == []
        assert "msg-timeout" in result.timed_out
        assert result.clean is False
        assert ACTIVE_CALLS[room_id]["msg-timeout"] is call
    finally:
        release.set()
        try:
            await asyncio.wait_for(task, timeout=1)
        except asyncio.CancelledError:
            pass
        ACTIVE_CALLS.pop(room_id, None)
