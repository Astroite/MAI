import asyncio
import threading
import time
from types import SimpleNamespace

from fastapi.testclient import TestClient
from sqlalchemy import select

from app import engine as engine_module
from app.db import SessionLocal
from app.engine import ACTIVE_CALLS, InFlightCall, pick_next_speaker
from app.llm import llm_adapter
from app.main import app
from app.models import Decision, Persona, Room, RoomRuntimeState


def test_health_and_builtin_templates():
    with TestClient(app) as client:
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json()["database"] == "ok"

        phases = client.get("/templates/phases")
        assert phases.status_code == 200
        assert len(phases.json()) >= 10

        formats = client.get("/templates/formats")
        assert formats.status_code == 200
        assert any(item["name"] == "方案评审" for item in formats.json())

        recipes = client.get("/templates/recipes")
        assert recipes.status_code == 200
        assert any(item["name"] == "方案评审默认配方" for item in recipes.json())


def test_deep_thinking_extra_params_route_by_model_family():
    def persona(model: str, config: dict | None = None) -> Persona:
        return Persona(
            id="pytest-%s" % model.replace("/", "-"),
            kind="discussant",
            name=model,
            description="",
            backing_model=model,
            system_prompt="",
            temperature=0.4,
            config=config or {},
            tags=["pytest"],
            is_builtin=False,
        )

    assert llm_adapter._build_extra_params(persona("anthropic/claude-sonnet-4-5", {"deep_thinking": True})) == {
        "thinking": {"type": "enabled", "budget_tokens": 10000}
    }
    assert llm_adapter._build_extra_params(persona("openai/o3", {"deep_thinking": True})) == {
        "reasoning_effort": "high"
    }
    assert llm_adapter._build_extra_params(persona("mock/generalist", {"deep_thinking": True})) == {}
    assert llm_adapter._build_extra_params(persona("openai/o3")) == {}


def test_create_debate_format():
    with TestClient(app) as client:
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


def test_update_persona_and_format_templates():
    with TestClient(app) as client:
        persona = client.post(
            "/templates/personas",
            json={
                "kind": "discussant",
                "name": "pytest editable persona",
                "description": "before",
                "backing_model": "mock/generalist",
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


def test_layered_limit_update_and_phase_round_exit():
    with TestClient(app) as client:
        personas = client.get("/templates/personas?kind=discussant").json()
        speaker = personas[0]
        phase = client.post(
            "/templates/phases",
            json={
                "name": "pytest manual limited phase",
                "description": "manual exit so max_phase_rounds is the active guard",
                "declared_variables": [],
                "allowed_speakers": {"type": "all"},
                "ordering_rule": {"type": "user_picks"},
                "exit_conditions": [{"type": "user_manual"}],
                "role_constraints": "",
                "prompt_template": "请用一句话回应。",
                "tags": ["pytest"],
            },
        ).json()
        debate_format = client.post(
            "/templates/formats",
            json={
                "name": "pytest limited format",
                "phase_sequence": [{"phase_template_id": phase["id"], "phase_template_version": phase["version"]}],
                "tags": ["pytest"],
            },
        ).json()
        room = client.post(
            "/rooms",
            json={"title": "pytest layered limits", "format_id": debate_format["id"], "persona_ids": [speaker["id"]]},
        ).json()
        room_id = room["room"]["id"]

        limits = client.patch(
            f"/rooms/{room_id}/limits",
            json={
                "max_message_tokens": 400,
                "max_room_tokens": 2000,
                "max_phase_rounds": 1,
                "max_account_daily_tokens": 5000,
                "max_account_monthly_tokens": 50000,
            },
        )
        assert limits.status_code == 200
        runtime = limits.json()
        assert runtime["max_phase_rounds"] == 1
        assert runtime["max_account_daily_tokens"] == 5000
        assert runtime["max_account_monthly_tokens"] == 50000

        turn = client.post(f"/rooms/{room_id}/turn", json={"speaker_persona_id": speaker["id"]})
        assert turn.status_code == 200
        state = client.get(f"/rooms/{room_id}/state").json()
        assert state["runtime"]["phase_exit_suggested"] is True
        assert any(item["type"] == "phase_round_limit" for item in state["runtime"]["phase_exit_matched_conditions"])


def test_room_message_and_mock_turn():
    with TestClient(app) as client:
        formats = client.get("/templates/formats").json()
        personas = client.get("/templates/personas?kind=discussant").json()
        review = next(item for item in formats if item["name"] == "方案评审")
        speaker = next(item for item in personas if item["name"] == "架构师")
        body = {
            "title": "pytest smoke",
            "format_id": review["id"],
            "persona_ids": [speaker["id"]],
        }
        room = client.post("/rooms", json=body)
        assert room.status_code == 200
        room_id = room.json()["room"]["id"]

        message = client.post("/rooms/%s/messages" % room_id, json={"content": "请评审 SSE + append-only 的方案。"})
        assert message.status_code == 200

        turn = client.post("/rooms/%s/turn" % room_id, json={"speaker_persona_id": speaker["id"]})
        assert turn.status_code == 200
        payload = turn.json()
        assert payload
        assert payload[0]["author_actual"] == "ai"

        state = client.get("/rooms/%s/state" % room_id).json()
        assert state["runtime"]["phase_exit_suggested"] is True
        assert state["runtime"]["phase_exit_matched_conditions"][0]["type"] == "all_spoken"

        continued = client.post("/rooms/%s/phase/continue" % room_id)
        assert continued.status_code == 200
        assert continued.json()["runtime"]["phase_exit_suggested"] is False

        subroom = client.post(
            "/rooms/%s/subrooms" % room_id,
            json={"title": "pytest subroom", "format_id": review["id"], "persona_ids": [speaker["id"]]},
        )
        assert subroom.status_code == 200
        subroom_id = subroom.json()["room"]["id"]
        assert subroom.json()["room"]["parent_room_id"] == room_id

        merge = client.post(
            "/rooms/%s/merge_back" % subroom_id,
            json={
                "conclusion": "子讨论认为 SSE 可以保留。",
                "key_reasoning": ["父讨论只需要结构化合并包"],
                "unresolved": [],
            },
        )
        assert merge.status_code == 200
        parent_state = client.get("/rooms/%s/state" % room_id).json()
        assert any("子讨论合并结论" in message["content"] for message in parent_state["messages"])


def test_room_state_exposes_in_flight_partial():
    with TestClient(app) as client:
        formats = client.get("/templates/formats").json()
        personas = client.get("/templates/personas?kind=discussant").json()
        review = next(item for item in formats if item["name"] == "方案评审")
        speaker = personas[0]
        room = client.post(
            "/rooms",
            json={"title": "pytest reconnect", "format_id": review["id"], "persona_ids": [speaker["id"]]},
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


def test_parallel_turn_exposes_multiple_in_flight_partials():
    with TestClient(app) as client:
        personas = client.get("/templates/personas?kind=discussant").json()[:2]
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
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                if len(ACTIVE_CALLS.get(room_id, {})) >= 2:
                    state = client.get(f"/rooms/{room_id}/state").json()
                    partials = state["in_flight_partial"]
                    if len(partials) >= 2:
                        break
                time.sleep(0.01)
            assert len(ACTIVE_CALLS.get(room_id, {})) >= 2
            assert len(partials) >= 2
            assert {item["persona_id"] for item in partials} == {p["id"] for p in personas}
        finally:
            thread.join(timeout=5)
        assert not thread.is_alive()
        turn = turn_result["response"]
        assert turn.status_code == 200
        assert {message["author_persona_id"] for message in turn.json()} == {p["id"] for p in personas}


def test_pick_next_speaker_ordering_rules():
    async def pick(room_id: str):
        async with SessionLocal() as session:
            room = await session.get(Room, room_id)
            runtime = await session.get(RoomRuntimeState, room_id)
            assert room is not None
            assert runtime is not None
            result = await pick_next_speaker(session, room, runtime, None)
            return result.kind, result.persona_ids, result.reason

    with TestClient(app) as client:
        personas = client.get("/templates/personas?kind=discussant").json()[:2]
        persona_ids = {persona["id"] for persona in personas}
        results = {}
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
                    "persona_ids": list(persona_ids),
                },
            ).json()
            results[ordering] = asyncio.run(pick(room["room"]["id"]))

        assert results["mention_driven"][0] == "wait"
        assert results["user_picks"][0] == "wait"
        assert results["parallel"][0] == "parallel"
        assert set(results["parallel"][1]) == persona_ids
        for ordering in ["round_robin", "alternating", "question_paired"]:
            kind, picked, reason = results[ordering]
            assert kind == "single"
            assert reason == ordering
            assert len(picked) == 1
            assert picked[0] in persona_ids


def test_masquerade_reveal_flow():
    with TestClient(app) as client:
        formats = client.get("/templates/formats").json()
        personas = client.get("/templates/personas?kind=discussant").json()
        review = next(item for item in formats if item["name"] == "方案评审")
        speaker = personas[0]
        room = client.post(
            "/rooms",
            json={"title": "pytest masquerade reveal", "format_id": review["id"], "persona_ids": [speaker["id"]]},
        ).json()
        room_id = room["room"]["id"]

        masquerade = client.post(
            f"/rooms/{room_id}/masquerade",
            json={"persona_id": speaker["id"], "content": "我以该人设补充一个受控观点。"},
        )
        assert masquerade.status_code == 200
        masquerade_payload = masquerade.json()
        assert masquerade_payload["author_actual"] == "user_as_persona"
        assert masquerade_payload["author_persona_id"] == speaker["id"]
        assert masquerade_payload["user_masquerade_persona_id"] == speaker["id"]
        assert masquerade_payload["user_revealed_at"] is None

        revealed = client.post(f"/rooms/{room_id}/messages/{masquerade_payload['id']}/reveal")
        assert revealed.status_code == 200
        assert revealed.json()["user_revealed_at"]

        normal = client.post(f"/rooms/{room_id}/messages", json={"content": "普通用户消息。"}).json()
        rejected = client.post(f"/rooms/{room_id}/messages/{normal['id']}/reveal")
        assert rejected.status_code == 400


def test_hidden_facilitator_messages_are_filtered_from_llm_context(monkeypatch):
    captured = {}

    async def capture_stream(persona, context, phase, max_tokens, scribe_state=None):
        captured["contents"] = [message.content for message in context]
        yield SimpleNamespace(text="可见上下文已检查。", index=0)

    monkeypatch.setattr(llm_adapter, "stream", capture_stream)

    with TestClient(app) as client:
        formats = client.get("/templates/formats").json()
        personas = client.get("/templates/personas?kind=discussant").json()
        review = next(item for item in formats if item["name"] == "方案评审")
        speaker = personas[0]
        room = client.post(
            "/rooms",
            json={"title": "pytest visibility filtering", "format_id": review["id"], "persona_ids": [speaker["id"]]},
        ).json()
        room_id = room["room"]["id"]

        for index in range(5):
            assert client.post(f"/rooms/{room_id}/messages", json={"content": f"可见讨论消息 {index}"}).status_code == 200
        state = client.get(f"/rooms/{room_id}/state").json()
        hidden_messages = [message for message in state["messages"] if message["visibility_to_models"] is False]
        assert hidden_messages

        turn = client.post(f"/rooms/{room_id}/turn", json={"speaker_persona_id": speaker["id"]})
        assert turn.status_code == 200
        assert "contents" in captured
        assert any("可见讨论消息" in content for content in captured["contents"])
        assert all(message["content"] not in captured["contents"] for message in hidden_messages)


def test_structured_scribe_and_facilitator_tools():
    with TestClient(app) as client:
        formats = client.get("/templates/formats").json()
        personas = client.get("/templates/personas?kind=discussant").json()
        review = next(item for item in formats if item["name"] == "方案评审")
        speaker = next(item for item in personas if item["name"] == "架构师")
        room = client.post(
            "/rooms",
            json={"title": "pytest tool loop", "format_id": review["id"], "persona_ids": [speaker["id"]]},
        )
        assert room.status_code == 200
        room_id = room.json()["room"]["id"]

        for content in [
            "目标是评审结构化工具调用。",
            "目前的主要问题是如何保留证据？",
            "共识：工具输出必须能追溯消息。",
            "分歧：是否每轮都触发整理。",
        ]:
            message = client.post("/rooms/%s/messages" % room_id, json={"content": content})
            assert message.status_code == 200

        verdict = client.post("/rooms/%s/verdicts" % room_id, json={"content": "采用结构化 tool-call 作为整理入口。"})
        assert verdict.status_code == 200
        verdict_id = verdict.json()["id"]

        state = client.get("/rooms/%s/state" % room_id).json()
        scribe = state["scribe_state"]["current_state"]
        assert any(item["message_id"] == verdict_id for item in scribe["decisions"])
        assert any("工具输出" in item["content"] for item in scribe["consensus"])
        assert state["facilitator_signals"]
        assert state["facilitator_signals"][0]["signals"]

        turn = client.post("/rooms/%s/turn" % room_id, json={"speaker_persona_id": speaker["id"]})
        assert turn.status_code == 200
        assert "已裁决" in turn.json()[0]["content"]
        assert "采用结构化 tool-call" in turn.json()[0]["content"]


def test_phase_transition_forces_system_role_updates():
    with TestClient(app) as client:
        formats = client.get("/templates/formats").json()
        personas = client.get("/templates/personas?kind=discussant").json()
        review = next(item for item in formats if item["name"] == "方案评审")
        speaker = next(item for item in personas if item["name"] == "架构师")
        room = client.post(
            "/rooms",
            json={"title": "pytest phase boundary", "format_id": review["id"], "persona_ids": [speaker["id"]]},
        )
        assert room.status_code == 200
        room_id = room.json()["room"]["id"]

        for content in ["边界触发测试 1", "边界触发测试 2", "边界触发测试 3"]:
            assert client.post("/rooms/%s/messages" % room_id, json={"content": content}).status_code == 200
        verdict = client.post("/rooms/%s/verdicts" % room_id, json={"content": "阶段切换时也要整理裁决。"})
        assert verdict.status_code == 200

        before = client.get("/rooms/%s/state" % room_id).json()
        assert before["scribe_state"]["current_state"]["decisions"] == []

        transitioned = client.post("/rooms/%s/phase/next" % room_id, json={})
        assert transitioned.status_code == 200
        state = transitioned.json()
        assert any(
            item["message_id"] == verdict.json()["id"]
            for item in state["scribe_state"]["current_state"]["decisions"]
        )
        assert state["facilitator_signals"]


def test_facilitator_cooldown_and_manual_request():
    with TestClient(app) as client:
        formats = client.get("/templates/formats").json()
        personas = client.get("/templates/personas?kind=discussant").json()
        review = next(item for item in formats if item["name"] == "方案评审")
        speaker = next(item for item in personas if item["name"] == "架构师")
        room = client.post(
            "/rooms",
            json={"title": "pytest facilitator cooldown", "format_id": review["id"], "persona_ids": [speaker["id"]]},
        )
        assert room.status_code == 200
        room_id = room.json()["room"]["id"]

        for index in range(5):
            assert client.post("/rooms/%s/messages" % room_id, json={"content": f"第一批讨论 {index}"}).status_code == 200
        state = client.get("/rooms/%s/state" % room_id).json()
        assert len(state["facilitator_signals"]) == 1
        first_tag = state["facilitator_signals"][0]["signals"][0]["tag"]

        for index in range(5):
            assert client.post("/rooms/%s/messages" % room_id, json={"content": f"第二批讨论 {index}"}).status_code == 200
        state = client.get("/rooms/%s/state" % room_id).json()
        assert len(state["facilitator_signals"]) == 1
        assert state["facilitator_signals"][0]["signals"][0]["tag"] == first_tag

        manual = client.post("/rooms/%s/facilitator" % room_id)
        assert manual.status_code == 200
        assert len(manual.json()["facilitator_signals"]) == 2


def test_facilitator_semantic_tags_for_phase_and_subroom():
    with TestClient(app) as client:
        room = client.post("/rooms", json={"title": "pytest facilitator semantic tags", "persona_ids": []})
        assert room.status_code == 200
        room_id = room.json()["room"]["id"]

        for content in [
            "阶段目标已完成，可以进入下一阶段。",
            "这里还有一个独立争议，适合开子讨论单独处理。",
            "需要用户裁决最终方向。",
        ]:
            assert client.post("/rooms/%s/messages" % room_id, json={"content": content}).status_code == 200

        state = client.post("/rooms/%s/facilitator" % room_id)
        assert state.status_code == 200
        tags = {signal["tag"] for signal in state.json()["facilitator_signals"][0]["signals"]}
        assert {"phase_exhausted", "consider_subroom", "decision_pending"}.issubset(tags)


def test_verdict_revoke_and_dead_end_messages():
    with TestClient(app) as client:
        room = client.post("/rooms", json={"title": "pytest verdict controls", "persona_ids": []})
        assert room.status_code == 200
        room_id = room.json()["room"]["id"]

        verdict = client.post("/rooms/%s/verdicts" % room_id, json={"content": "锁定 SSE 方案。", "is_locked": True})
        assert verdict.status_code == 200
        verdict_id = verdict.json()["id"]

        revoke = client.post(
            "/rooms/%s/verdicts" % room_id,
            json={"content": "证据更新，撤销 SSE 方案裁决。", "revoke_message_id": verdict_id},
        )
        assert revoke.status_code == 200
        assert revoke.json()["message_type"] == "verdict_revoke"
        assert revoke.json()["parent_message_id"] == verdict_id

        dead_end = client.post(
            "/rooms/%s/verdicts" % room_id,
            json={"content": "轮询所有 provider SDK 的方案成本过高。", "dead_end": True},
        )
        assert dead_end.status_code == 200

        state = client.get("/rooms/%s/state" % room_id).json()
        assert any(message["content"].startswith("死路：轮询所有 provider SDK") for message in state["messages"])

    async def fetch_decision() -> Decision:
        async with SessionLocal() as session:
            return await session.scalar(select(Decision).where(Decision.scribe_event_message_id == verdict_id))

    decision = asyncio.run(fetch_decision())
    assert decision is not None
    assert decision.revoked_by_message_id == revoke.json()["id"]


def test_decision_lock_toggle_creates_audit_meta():
    with TestClient(app) as client:
        room = client.post("/rooms", json={"title": "pytest decision lock", "persona_ids": []})
        assert room.status_code == 200
        room_id = room.json()["room"]["id"]

        verdict = client.post(
            "/rooms/%s/verdicts" % room_id,
            json={"content": "采纳子讨论结论。", "is_locked": False},
        )
        assert verdict.status_code == 200

        state = client.get("/rooms/%s/state" % room_id).json()
        assert state["decisions"]
        decision_id = state["decisions"][0]["id"]
        assert state["decisions"][0]["is_locked"] is False

        locked = client.patch(
            "/rooms/%s/decisions/%s" % (room_id, decision_id),
            json={"is_locked": True},
        )
        assert locked.status_code == 200
        assert locked.json()["is_locked"] is True
        assert locked.json()["locked_by_message_id"]

        state = client.get("/rooms/%s/state" % room_id).json()
        audit_messages = [
            message
            for message in state["messages"]
            if message["message_type"] == "meta" and message["content"].startswith("锁定决议：")
        ]
        assert audit_messages

        unlocked = client.patch(
            "/rooms/%s/decisions/%s" % (room_id, decision_id),
            json={"is_locked": False},
        )
        assert unlocked.status_code == 200
        assert unlocked.json()["is_locked"] is False
        assert unlocked.json()["locked_by_message_id"] is None


def test_chunk_idle_timeout_truncates_message(monkeypatch):
    monkeypatch.setattr(engine_module, "CHUNK_IDLE_TIMEOUT_SECONDS", 0.05)

    async def stalled_stream(persona, context, phase, max_tokens, scribe_state=None):
        await asyncio.sleep(5)
        yield  # pragma: no cover

    monkeypatch.setattr(llm_adapter, "stream", stalled_stream)

    with TestClient(app) as client:
        formats = client.get("/templates/formats").json()
        personas = client.get("/templates/personas?kind=discussant").json()
        review = next(item for item in formats if item["name"] == "方案评审")
        speaker = next(item for item in personas if item["name"] == "架构师")
        room = client.post(
            "/rooms",
            json={"title": "pytest chunk timeout", "format_id": review["id"], "persona_ids": [speaker["id"]]},
        )
        assert room.status_code == 200
        room_id = room.json()["room"]["id"]
        assert client.post("/rooms/%s/messages" % room_id, json={"content": "请触发空闲超时。"}).status_code == 200

        turn = client.post("/rooms/%s/turn" % room_id, json={"speaker_persona_id": speaker["id"]})
        assert turn.status_code == 200
        assert turn.json()[0]["truncated_reason"] == "timeout"


def test_freeze_cancels_active_mock_turn():
    with TestClient(app) as client:
        formats = client.get("/templates/formats").json()
        personas = client.get("/templates/personas?kind=discussant").json()
        review = next(item for item in formats if item["name"] == "方案评审")
        speaker = next(item for item in personas if item["name"] == "架构师")
        room = client.post(
            "/rooms",
            json={"title": "pytest freeze active turn", "format_id": review["id"], "persona_ids": [speaker["id"]]},
        )
        assert room.status_code == 200
        room_id = room.json()["room"]["id"]
        assert client.post("/rooms/%s/messages" % room_id, json={"content": "请给出一个可以被冻结的长回复。"}).status_code == 200

        turn_result = {}

        def run_turn():
            turn_result["response"] = client.post("/rooms/%s/turn" % room_id, json={"speaker_persona_id": speaker["id"]})

        thread = threading.Thread(target=run_turn)
        thread.start()
        deadline = time.monotonic() + 2
        while room_id not in ACTIVE_CALLS and time.monotonic() < deadline:
            time.sleep(0.01)
        assert room_id in ACTIVE_CALLS

        freeze = client.post("/rooms/%s/freeze" % room_id)
        assert freeze.status_code == 200
        thread.join(timeout=3)
        assert not thread.is_alive()

        turn = turn_result["response"]
        assert turn.status_code == 200
        assert turn.json()[0]["truncated_reason"] == "frozen"
        state = client.get("/rooms/%s/state" % room_id).json()
        assert state["room"]["status"] == "frozen"
