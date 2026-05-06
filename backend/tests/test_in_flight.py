import asyncio
import threading
import time

from app.engine import ACTIVE_CALLS, InFlightCall
from app.llm import llm_adapter
from app import engine as engine_module


def test_room_state_exposes_in_flight_partial(client, review_format, discussant_personas):
    speaker = discussant_personas[0]
    room = client.post(
        "/rooms",
        json={"title": "pytest reconnect", "format_id": review_format["id"], "persona_ids": [speaker["id"]]},
    ).json()
    room_id = room["room"]["id"]
    call = InFlightCall(
        room_id=room_id,
        message_id="msg-reconnect",
        persona_id=speaker["id"],
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
        assert partial["persona_id"] == speaker["id"]
        assert partial["content"] == "partial answer"
        assert partial["last_chunk_index"] == 3
    finally:
        ACTIVE_CALLS.pop(room_id, None)


def test_parallel_turn_exposes_multiple_in_flight_partials(client, discussant_personas):
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
        assert {item["persona_id"] for item in partials} == {p["id"] for p in personas}
    finally:
        thread.join(timeout=20)
    assert not thread.is_alive()
    turn = turn_result["response"]
    assert turn.status_code == 200
    assert {message["author_persona_id"] for message in turn.json()} == {p["id"] for p in personas}


def test_chunk_idle_timeout_truncates_message(client, review_format, architect_persona, monkeypatch):
    monkeypatch.setattr(engine_module, "CHUNK_IDLE_TIMEOUT_SECONDS", 0.05)

    async def stalled_stream(persona, context, phase, max_tokens, scribe_state=None, api_provider=None):
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
    assert client.post(f"/rooms/{room_id}/messages", json={"content": "请触发空闲超时。"}).status_code == 200

    turn = client.post(f"/rooms/{room_id}/turn", json={"speaker_persona_id": architect_persona["id"]})
    assert turn.status_code == 200
    assert turn.json()[0]["truncated_reason"] == "timeout"
