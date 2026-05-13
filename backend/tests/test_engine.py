import asyncio
import time

from app.db import SessionLocal
from app import engine as engine_module
from app.engine import ACTIVE_CALLS, pick_next_speaker
from app.llm import llm_adapter
from app.models import Message, PersonaInstance, Room, RoomRuntimeState


def _wait_for_ai_message(client, room_id, *, after_count: int, timeout: float = 30.0) -> list:
    """Poll /state until at least one new ai-authored message appears."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        messages = client.get(f"/rooms/{room_id}/state").json()["messages"]
        ai_messages = [m for m in messages if m["author_actual"] == "ai"]
        if len(ai_messages) > after_count:
            return ai_messages
        time.sleep(0.1)
    return [
        m
        for m in client.get(f"/rooms/{room_id}/state").json()["messages"]
        if m["author_actual"] == "ai"
    ]


def _instance_ids_by_template(client, room_id: str) -> dict[str, str]:
    return {
        p["template_id"]: p["id"]
        for p in client.get(f"/rooms/{room_id}/state").json()["personas"]
    }


def test_pick_next_speaker_ordering_rules(client, discussant_personas):
    async def pick(room_id: str):
        async with SessionLocal() as session:
            room = await session.get(Room, room_id)
            runtime = await session.get(RoomRuntimeState, room_id)
            assert room is not None
            assert runtime is not None
            result = await pick_next_speaker(session, room, runtime, None)
            return result.kind, result.persona_ids, result.reason

    personas = discussant_personas[:2]
    template_ids = [persona["id"] for persona in personas]
    results = {}
    instance_ids_by_ordering = {}
    for ordering in ["mention_driven", "user_picks", "parallel", "round_robin", "alternating", "question_paired"]:
        phase = client.post(
            "/templates/phases",
            json={
                "name": f"pytest ordering {ordering}",
                "description": "ordering unit test",
                "declared_variables": [],
                "allowed_speakers": {"type": "all"},
                "ordering_rule": {"type": ordering},
                "exit_conditions": [{"type": "user_manual"}],
                "role_constraints": "",
                "prompt_template": "请发言。",
                "tags": ["pytest", "ordering"],
            },
        ).json()
        debate_format = client.post(
            "/templates/formats",
            json={
                "name": f"pytest ordering format {ordering}",
                "phase_sequence": [{"phase_template_id": phase["id"], "phase_template_version": phase["version"]}],
                "tags": ["pytest", "ordering"],
            },
        ).json()
        room = client.post(
            "/rooms",
            json={
                "title": f"pytest ordering room {ordering}",
                "format_id": debate_format["id"],
                "persona_ids": template_ids,
            },
        ).json()
        room_id = room["room"]["id"]
        instance_map = _instance_ids_by_template(client, room_id)
        instance_ids_by_ordering[ordering] = {instance_map[t] for t in template_ids}
        results[ordering] = asyncio.run(pick(room_id))

    # mention_driven and question_paired fall back to round-robin when no
    # @-mention is found in the latest user/question message — the room is
    # empty here, so both fall through. pick_next_speaker returns
    # PersonaInstance ids — match against the per-room instance map.
    assert results["mention_driven"][0] == "single"
    assert "round-robin" in results["mention_driven"][2]
    assert len(results["mention_driven"][1]) == 1
    assert results["mention_driven"][1][0] in instance_ids_by_ordering["mention_driven"]
    assert results["user_picks"][0] == "wait"
    assert results["parallel"][0] == "parallel"
    assert set(results["parallel"][1]) == instance_ids_by_ordering["parallel"]
    # round_robin: reason is just the ordering name.
    rr = results["round_robin"]
    assert rr[0] == "single" and rr[2] == "round_robin"
    assert rr[1][0] in instance_ids_by_ordering["round_robin"]
    # alternating: reason is "alternating skip last speaker" — even with no
    # prior AI message, the branch still executes (excluded set is empty).
    alt = results["alternating"]
    assert alt[0] == "single" and "alternating" in alt[2]
    assert alt[1][0] in instance_ids_by_ordering["alternating"]
    # question_paired: no question in the room → falls through to round-robin.
    qp = results["question_paired"]
    assert qp[0] == "single" and "round-robin" in qp[2]
    assert qp[1][0] in instance_ids_by_ordering["question_paired"]


def test_freeze_cancels_active_turn(client, review_format, architect_persona):
    room = client.post(
        "/rooms",
        json={
            "title": "pytest freeze active turn",
            "format_id": review_format["id"],
            "persona_ids": [architect_persona["id"]],
        },
    )
    assert room.status_code == 200
    room_id = room.json()["room"]["id"]
    # Posting a user message kicks off auto-drive in the background, which
    # registers an in-flight call we can freeze mid-stream.
    assert client.post(
        f"/rooms/{room_id}/messages",
        json={"content": "请给出一个可以被冻结的长回复。"},
    ).status_code == 200

    deadline = time.monotonic() + 10
    while room_id not in ACTIVE_CALLS and time.monotonic() < deadline:
        time.sleep(0.02)
    assert room_id in ACTIVE_CALLS, "autodrive should have registered an in-flight call"

    freeze = client.post(f"/rooms/{room_id}/freeze")
    assert freeze.status_code == 200

    # _unregister_active_call runs in finally before the truncated message
    # is committed, so wait for the message itself, not just the registry.
    deadline = time.monotonic() + 15
    truncated_seen = False
    while time.monotonic() < deadline:
        state = client.get(f"/rooms/{room_id}/state").json()
        if any(message.get("truncated_reason") == "frozen" for message in state["messages"]):
            truncated_seen = True
            break
        time.sleep(0.1)
    assert truncated_seen, "auto-drive's cancelled stream should have left a truncated message"

    state = client.get(f"/rooms/{room_id}/state").json()
    assert state["room"]["status"] == "frozen"


def test_append_message_rejects_unknown_message_type(client):
    room = client.post("/rooms", json={"title": "pytest message type contract", "persona_ids": []})
    assert room.status_code == 200
    room_id = room.json()["room"]["id"]

    rejected = client.post(
        f"/rooms/{room_id}/messages",
        json={"content": "非法消息类型。", "message_type": "contract_drift"},
    )

    assert rejected.status_code == 422


def test_auto_discuss_mode_controls_casual_decay(client, discussant_personas, monkeypatch):
    def make_room(mode: str, tags: list[str]) -> str:
        phase = client.post(
            "/templates/phases",
            json={
                "name": f"pytest auto discuss {mode} {'-'.join(tags)}",
                "description": "auto discuss mode test",
                "declared_variables": [],
                "allowed_speakers": {"type": "all"},
                "ordering_rule": {"type": "casual"},
                "exit_conditions": [{"type": "user_manual"}],
                "role_constraints": "",
                "prompt_template": "继续。",
                "auto_discuss": True,
                "auto_discuss_mode": mode,
                "tags": tags,
            },
        ).json()
        debate_format = client.post(
            "/templates/formats",
            json={
                "name": f"pytest auto discuss format {mode} {'-'.join(tags)}",
                "phase_sequence": [
                    {
                        "phase_template_id": phase["id"],
                        "phase_template_version": phase["version"],
                    }
                ],
                "tags": tags,
            },
        ).json()
        room = client.post(
            "/rooms",
            json={
                "title": f"pytest auto discuss room {mode}",
                "format_id": debate_format["id"],
                "persona_ids": [discussant_personas[0]["id"]],
            },
        ).json()
        return room["room"]["id"]

    async def should_continue(room_id: str) -> bool:
        async with SessionLocal() as session:
            runtime = await session.get(RoomRuntimeState, room_id)
            runtime.consecutive_ai_turns = 2
            await session.commit()
        async with SessionLocal() as session:
            return await engine_module._should_auto_discuss(session, room_id)

    monkeypatch.setattr(engine_module.random, "random", lambda: 0.99)

    continuous_room_id = make_room("continuous", ["pytest", "casual"])
    story_tag_decay_room_id = make_room("decay", ["pytest", "story", "casual"])

    assert asyncio.run(should_continue(continuous_room_id)) is True
    assert asyncio.run(should_continue(story_tag_decay_room_id)) is False


def test_pause_waits_for_active_turn_without_truncating(
    client, discussant_personas, monkeypatch
):
    async def controlled_stream(
        persona,
        context,
        phase,
        max_tokens,
        scribe_state=None,
        api_provider=None,
        **kwargs,
    ):
        yield type("Chunk", (), {"text": "first ", "index": 0})()
        await asyncio.sleep(0.25)
        yield type("Chunk", (), {"text": "done", "index": 1})()

    monkeypatch.setattr(llm_adapter, "stream", controlled_stream)
    monkeypatch.setattr(engine_module.llm_adapter, "stream", controlled_stream)

    phase = client.post(
        "/templates/phases",
        json={
            "name": "pytest graceful pause story phase",
            "description": "story pause test",
            "declared_variables": [],
            "allowed_speakers": {"type": "all"},
            "ordering_rule": {"type": "casual"},
            "exit_conditions": [{"type": "user_manual"}],
            "role_constraints": "",
            "prompt_template": "请继续演。",
            "auto_discuss": True,
            "auto_discuss_mode": "continuous",
            "tags": ["pytest", "story", "casual"],
        },
    ).json()
    debate_format = client.post(
        "/templates/formats",
        json={
            "name": "pytest graceful pause story format",
            "phase_sequence": [
                {
                    "phase_template_id": phase["id"],
                    "phase_template_version": phase["version"],
                }
            ],
            "tags": ["pytest", "story"],
        },
    ).json()
    room = client.post(
        "/rooms",
        json={
            "title": "pytest graceful pause story room",
            "format_id": debate_format["id"],
            "persona_ids": [discussant_personas[0]["id"]],
        },
    ).json()
    room_id = room["room"]["id"]

    resume = client.post(f"/rooms/{room_id}/autodrive/resume")
    assert resume.status_code == 200
    assert resume.json()["status"] == "scheduled"

    deadline = time.monotonic() + 5
    while room_id not in ACTIVE_CALLS and time.monotonic() < deadline:
        time.sleep(0.02)
    assert room_id in ACTIVE_CALLS, "autodrive should have started the current turn"

    pause = client.post(f"/rooms/{room_id}/pause")
    assert pause.status_code == 200
    state = pause.json()
    ai_messages = [m for m in state["messages"] if m["author_actual"] == "ai"]
    assert len(ai_messages) == 1
    assert ai_messages[0]["content"] == "first done"
    assert ai_messages[0]["truncated_reason"] is None
    assert state["room"]["status"] == "frozen"
    assert state["runtime"]["frozen"] is True

    time.sleep(0.5)
    final_state = client.get(f"/rooms/{room_id}/state").json()
    final_ai_messages = [m for m in final_state["messages"] if m["author_actual"] == "ai"]
    assert len(final_ai_messages) == 1


def test_autodrive_user_message_triggers_persona_reply(
    client, roundtable_format, discussant_personas
):
    speakers = discussant_personas[:2]
    room = client.post(
        "/rooms",
        json={
            "title": "pytest autodrive happy",
            "format_id": roundtable_format["id"],
            "persona_ids": [p["id"] for p in speakers],
        },
    ).json()
    room_id = room["room"]["id"]
    speaker_instance_ids = {
        instance["id"]
        for instance in room["personas"]
        if instance["template_id"] in {p["id"] for p in speakers}
    }

    before = len([m for m in room["messages"] if m["author_actual"] == "ai"])
    post = client.post(f"/rooms/{room_id}/messages", json={"content": "请大家自我介绍一下当前关注点。"})
    assert post.status_code == 200

    ai_messages = _wait_for_ai_message(client, room_id, after_count=before)
    assert len(ai_messages) > before, "autodrive should produce at least one persona reply"
    assert ai_messages[-1]["author_persona_id"] in speaker_instance_ids


def test_autodrive_does_not_recurse_on_persona_reply(
    client, roundtable_format, discussant_personas
):
    """A single user message must produce at most one autodrive round, never N or infinite."""
    room = client.post(
        "/rooms",
        json={
            "title": "pytest autodrive non-recurse",
            "format_id": roundtable_format["id"],
            "persona_ids": [p["id"] for p in discussant_personas[:3]],
        },
    ).json()
    room_id = room["room"]["id"]

    before = len([m for m in room["messages"] if m["author_actual"] == "ai"])
    assert client.post(
        f"/rooms/{room_id}/messages",
        json={"content": "开始第一轮发言。"},
    ).status_code == 200

    ai_messages = _wait_for_ai_message(client, room_id, after_count=before, timeout=30.0)
    assert len(ai_messages) == before + 1, (
        f"expected exactly 1 autodrive reply, got {len(ai_messages) - before}"
    )

    # Real LLM is slow enough that any ghost follow-up would land within a few
    # seconds. Wait long enough that a rogue chain would complete.
    time.sleep(8.0)
    ai_messages_after = [
        m for m in client.get(f"/rooms/{room_id}/state").json()["messages"]
        if m["author_actual"] == "ai"
    ]
    assert len(ai_messages_after) == before + 1, "autodrive must not chain on its own reply"


def test_autodrive_mention_driven_fallback(client, discussant_personas):
    """Default `open` phase uses mention_driven; without @, fall back to round-robin."""
    speakers = discussant_personas[:2]
    # No format_id => default `open` phase => mention_driven ordering.
    room = client.post(
        "/rooms",
        json={
            "title": "pytest mention fallback",
            "persona_ids": [p["id"] for p in speakers],
        },
    ).json()
    room_id = room["room"]["id"]
    instance_map = {p["template_id"]: p["id"] for p in room["personas"]}

    before = len([m for m in room["messages"] if m["author_actual"] == "ai"])
    # No @-mention: should still produce a reply via round-robin fallback.
    assert client.post(
        f"/rooms/{room_id}/messages",
        json={"content": "请你们开始讨论。"},
    ).status_code == 200
    ai_messages = _wait_for_ai_message(client, room_id, after_count=before)
    assert len(ai_messages) > before, "mention_driven should fall back to round-robin"

    # Wait for the autodrive lock to release before the next post.
    time.sleep(1.0)

    # @-mentioned: the named persona must be the next speaker.
    target = speakers[1]
    target_instance_id = instance_map[target["id"]]
    before2 = len(ai_messages)
    assert client.post(
        f"/rooms/{room_id}/messages",
        json={"content": f"@{target['name']} 你怎么看？"},
    ).status_code == 200
    ai_messages2 = _wait_for_ai_message(client, room_id, after_count=before2)
    assert len(ai_messages2) > before2
    assert ai_messages2[-1]["author_persona_id"] == target_instance_id, (
        f"expected @{target['name']} to speak, got persona {ai_messages2[-1]['author_persona_id']}"
    )


def test_autodrive_short_circuits_when_frozen(
    client, roundtable_format, discussant_personas
):
    room = client.post(
        "/rooms",
        json={
            "title": "pytest autodrive frozen",
            "format_id": roundtable_format["id"],
            "persona_ids": [discussant_personas[0]["id"]],
        },
    ).json()
    room_id = room["room"]["id"]
    assert client.post(f"/rooms/{room_id}/freeze").status_code == 200

    before = len([m for m in room["messages"] if m["author_actual"] == "ai"])
    # Posting a message on a frozen room is rejected (409); even if it
    # weren't, autodrive would short-circuit on runtime.frozen.
    post = client.post(f"/rooms/{room_id}/messages", json={"content": "这条不应触发任何 ai 回复。"})
    assert post.status_code == 409  # _ensure_not_frozen rejects user message

    time.sleep(2.0)
    ai_messages = [
        m for m in client.get(f"/rooms/{room_id}/state").json()["messages"]
        if m["author_actual"] == "ai"
    ]
    assert len(ai_messages) == before, "frozen room must not produce any persona reply"


def test_resume_autodrive_reports_frozen_reason(client, roundtable_format, discussant_personas):
    room = client.post(
        "/rooms",
        json={
            "title": "pytest autodrive frozen reason",
            "format_id": roundtable_format["id"],
            "persona_ids": [discussant_personas[0]["id"]],
        },
    ).json()
    room_id = room["room"]["id"]
    assert client.post(f"/rooms/{room_id}/freeze").status_code == 200

    resume = client.post(f"/rooms/{room_id}/autodrive/resume")
    assert resume.status_code == 200
    assert resume.json()["status"] == "skipped"
    assert resume.json()["reason"] == "frozen"


def test_resume_autodrive_reports_no_available_speaker(client, discussant_personas):
    room = _make_ordering_room(
        client,
        discussant_personas,
        "user_picks",
        suffix="resume-skip",
        count=1,
    )
    room_id = room["room"]["id"]

    resume = client.post(f"/rooms/{room_id}/autodrive/resume")
    assert resume.status_code == 200
    assert resume.json()["status"] == "skipped"
    assert resume.json()["reason"] == "no_available_speaker"


def test_resume_autodrive_reports_in_flight_reason(
    client, roundtable_format, discussant_personas, instance_for_template
):
    room = client.post(
        "/rooms",
        json={
            "title": "pytest autodrive in-flight reason",
            "format_id": roundtable_format["id"],
            "persona_ids": [discussant_personas[0]["id"]],
        },
    ).json()
    room_id = room["room"]["id"]
    speaker_instance_id = instance_for_template(room_id, discussant_personas[0]["id"])
    ACTIVE_CALLS.setdefault(room_id, {})["msg-in-flight"] = engine_module.InFlightCall(
        room_id=room_id,
        message_id="msg-in-flight",
        persona_id=speaker_instance_id,
        task=object(),
    )
    try:
        resume = client.post(f"/rooms/{room_id}/autodrive/resume")
        assert resume.status_code == 200
        assert resume.json()["status"] == "skipped"
        assert resume.json()["reason"] == "in_flight"
    finally:
        ACTIVE_CALLS.pop(room_id, None)


def test_resume_autodrive_reports_scheduled_without_running_llm(
    client, roundtable_format, discussant_personas, monkeypatch
):
    async def noop_autodrive_runner(room_id, lock):
        if lock.locked():
            return
        async with lock:
            return

    monkeypatch.setattr(engine_module, "_autodrive_runner", noop_autodrive_runner)
    room = client.post(
        "/rooms",
        json={
            "title": "pytest autodrive scheduled reason",
            "format_id": roundtable_format["id"],
            "persona_ids": [discussant_personas[0]["id"]],
        },
    ).json()
    room_id = room["room"]["id"]

    resume = client.post(f"/rooms/{room_id}/autodrive/resume")
    assert resume.status_code == 200
    assert resume.json()["status"] == "scheduled"
    assert resume.json().get("reason") is None


def _make_ordering_room(client, discussant_personas, ordering: str, *, suffix: str, count: int = 2):
    template_ids = [p["id"] for p in discussant_personas[:count]]
    phase = client.post(
        "/templates/phases",
        json={
            "name": f"pytest {ordering} {suffix}",
            "description": f"{ordering} positive test",
            "declared_variables": [],
            "allowed_speakers": {"type": "all"},
            "ordering_rule": {"type": ordering},
            "exit_conditions": [{"type": "user_manual"}],
            "role_constraints": "",
            "prompt_template": "请发言。",
            "tags": ["pytest", ordering, suffix],
        },
    ).json()
    debate_format = client.post(
        "/templates/formats",
        json={
            "name": f"pytest {ordering} fmt {suffix}",
            "phase_sequence": [
                {"phase_template_id": phase["id"], "phase_template_version": phase["version"]}
            ],
            "tags": ["pytest", ordering, suffix],
        },
    ).json()
    room = client.post(
        "/rooms",
        json={
            "title": f"pytest {ordering} room {suffix}",
            "format_id": debate_format["id"],
            "persona_ids": template_ids,
        },
    ).json()
    return room


def test_question_paired_routes_to_at_mention(client, discussant_personas):
    """When the latest visible message is a question containing @<name>,
    question_paired must route the next turn to that persona instance."""
    room = _make_ordering_room(client, discussant_personas, "question_paired", suffix="hit")
    room_id = room["room"]["id"]
    instance_map = _instance_ids_by_template(client, room_id)
    target_template_id = discussant_personas[1]["id"]
    target_instance_id = instance_map[target_template_id]

    async def insert_question_and_pick():
        async with SessionLocal() as session:
            runtime = await session.get(RoomRuntimeState, room_id)
            target = await session.get(PersonaInstance, target_instance_id)
            session.add(
                Message(
                    room_id=room_id,
                    phase_instance_id=runtime.current_phase_instance_id,
                    message_type="question",
                    author_actual="user",
                    visibility="public",
                    visibility_to_models=True,
                    content=f"@{target.name} 你怎么看？",
                )
            )
            await session.commit()
        async with SessionLocal() as session:
            room_obj = await session.get(Room, room_id)
            runtime = await session.get(RoomRuntimeState, room_id)
            return await pick_next_speaker(session, room_obj, runtime, None)

    result = asyncio.run(insert_question_and_pick())
    assert result.kind == "single"
    assert result.persona_ids == [target_instance_id]
    assert "question_paired matched" in result.reason


def test_question_paired_falls_through_when_latest_is_not_question(client, discussant_personas):
    """If the most recent visible message is not a question, question_paired
    must release back to round-robin (no stale pairing on old questions)."""
    room = _make_ordering_room(client, discussant_personas, "question_paired", suffix="stale")
    room_id = room["room"]["id"]
    instance_map = _instance_ids_by_template(client, room_id)
    target_instance_id = instance_map[discussant_personas[1]["id"]]

    async def setup_and_pick():
        async with SessionLocal() as session:
            runtime = await session.get(RoomRuntimeState, room_id)
            target = await session.get(PersonaInstance, target_instance_id)
            # Old question with @mention …
            session.add(
                Message(
                    room_id=room_id,
                    phase_instance_id=runtime.current_phase_instance_id,
                    message_type="question",
                    author_actual="user",
                    visibility="public",
                    visibility_to_models=True,
                    content=f"@{target.name} 你怎么看？",
                )
            )
            await session.flush()
            # … followed by a non-question speech: pairing should release.
            session.add(
                Message(
                    room_id=room_id,
                    phase_instance_id=runtime.current_phase_instance_id,
                    message_type="speech",
                    author_actual="user",
                    visibility="public",
                    visibility_to_models=True,
                    content="换个话题继续。",
                )
            )
            await session.commit()
        async with SessionLocal() as session:
            room_obj = await session.get(Room, room_id)
            runtime = await session.get(RoomRuntimeState, room_id)
            return await pick_next_speaker(session, room_obj, runtime, None)

    result = asyncio.run(setup_and_pick())
    assert result.kind == "single"
    assert "round-robin" in result.reason


def test_alternating_skips_last_ai_speaker(client, discussant_personas):
    """alternating must avoid picking the persona who spoke last AI turn."""
    room = _make_ordering_room(client, discussant_personas, "alternating", suffix="skip", count=3)
    room_id = room["room"]["id"]
    instance_map = _instance_ids_by_template(client, room_id)
    last_speaker_instance_id = instance_map[discussant_personas[0]["id"]]

    async def insert_ai_message_and_pick():
        async with SessionLocal() as session:
            runtime = await session.get(RoomRuntimeState, room_id)
            session.add(
                Message(
                    room_id=room_id,
                    phase_instance_id=runtime.current_phase_instance_id,
                    message_type="speech",
                    author_actual="ai",
                    author_persona_id=last_speaker_instance_id,
                    visibility="public",
                    visibility_to_models=True,
                    content="我先说一段。",
                )
            )
            await session.commit()
        async with SessionLocal() as session:
            room_obj = await session.get(Room, room_id)
            runtime = await session.get(RoomRuntimeState, room_id)
            return await pick_next_speaker(session, room_obj, runtime, None)

    result = asyncio.run(insert_ai_message_and_pick())
    assert result.kind == "single"
    assert result.persona_ids[0] != last_speaker_instance_id, (
        "alternating should not pick the persona who just spoke"
    )
    assert "alternating" in result.reason
