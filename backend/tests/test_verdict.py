import asyncio
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Decision


def test_verdict_revoke_and_dead_end_messages(client):
    room = client.post("/rooms", json={"title": "pytest verdict controls", "persona_ids": []})
    assert room.status_code == 200
    room_id = room.json()["room"]["id"]

    verdict = client.post(f"/rooms/{room_id}/verdicts", json={"content": "锁定 SSE 方案。", "is_locked": True})
    assert verdict.status_code == 200
    verdict_id = verdict.json()["id"]

    revoke = client.post(
        f"/rooms/{room_id}/verdicts",
        json={"content": "证据更新，撤销 SSE 方案裁决。", "revoke_message_id": verdict_id},
    )
    assert revoke.status_code == 200
    assert revoke.json()["message_type"] == "verdict_revoke"
    assert revoke.json()["parent_message_id"] == verdict_id

    dead_end = client.post(
        f"/rooms/{room_id}/verdicts",
        json={"content": "轮询所有 provider SDK 的方案成本过高。", "dead_end": True},
    )
    assert dead_end.status_code == 200

    state = client.get(f"/rooms/{room_id}/state").json()
    assert any(message["content"].startswith("死路：轮询所有 provider SDK") for message in state["messages"])

    async def fetch_decision() -> Decision:
        async with SessionLocal() as session:
            return await session.scalar(select(Decision).where(Decision.scribe_event_message_id == verdict_id))

    decision = asyncio.run(fetch_decision())
    assert decision is not None
    assert decision.revoked_by_message_id == revoke.json()["id"]


def test_decision_lock_toggle_creates_audit_meta(client):
    room = client.post("/rooms", json={"title": "pytest decision lock", "persona_ids": []})
    assert room.status_code == 200
    room_id = room.json()["room"]["id"]

    verdict = client.post(
        f"/rooms/{room_id}/verdicts",
        json={"content": "采纳子讨论结论。", "is_locked": False},
    )
    assert verdict.status_code == 200

    state = client.get(f"/rooms/{room_id}/state").json()
    assert state["decisions"]
    decision_id = state["decisions"][0]["id"]
    assert state["decisions"][0]["is_locked"] is False

    locked = client.patch(
        f"/rooms/{room_id}/decisions/{decision_id}",
        json={"is_locked": True},
    )
    assert locked.status_code == 200
    assert locked.json()["is_locked"] is True
    assert locked.json()["locked_by_message_id"]

    state = client.get(f"/rooms/{room_id}/state").json()
    audit_messages = [
        message
        for message in state["messages"]
        if message["message_type"] == "meta" and message["content"].startswith("锁定决议：")
    ]
    assert audit_messages

    unlocked = client.patch(
        f"/rooms/{room_id}/decisions/{decision_id}",
        json={"is_locked": False},
    )
    assert unlocked.status_code == 200
    assert unlocked.json()["is_locked"] is False
    assert unlocked.json()["locked_by_message_id"] is None
