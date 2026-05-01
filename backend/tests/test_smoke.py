import asyncio

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import SessionLocal
from app.main import app
from app.models import Decision


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
