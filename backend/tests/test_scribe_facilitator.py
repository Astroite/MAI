"""Scribe + facilitator integration.

LLM calls are patched so these tests assert engine-side invariants: cadence,
cooldown, phase boundary triggering, and scribe state folding.
"""

from types import SimpleNamespace

from sqlalchemy import text

from app import engine as engine_module
from app.db import SessionLocal
from app.engine import filter_facilitator_signals
from app.llm import StreamChunk, llm_adapter
from app.trace import trace_record


KNOWN_FACILITATOR_TAGS = {
    "phase_exhausted",
    "consider_subroom",
    "decision_pending",
    "clarification_needed",
    "disagreement_unproductive",
    "consensus_emerging",
    "pacing_warning",
}


async def _noop_autodrive_after(room_id, message):
    return None


async def _deterministic_stream(persona, context, phase, max_tokens, scribe_state=None, api_provider=None, **kwargs):
    yield StreamChunk(text="受控测试回复。", index=0)


async def _deterministic_complete_tool(
    persona,
    tool_name,
    tool_description,
    output_model,
    payload,
    max_tokens=1200,
    api_provider=None,
):
    if tool_name == "scribe_update":
        verdicts = [
            {"message_id": message["id"], "content": message["content"]}
            for message in payload.get("messages", [])
            if message.get("message_type") == "verdict"
        ]
        return {
            "consensus_added": [],
            "consensus_removed": [],
            "disagreements_added": [],
            "disagreements_resolved": [],
            "open_questions_added": [],
            "open_questions_answered": [],
            "decisions_added": verdicts,
            "artifacts_added": [],
            "dead_ends_added": [],
            "reasoning": "deterministic test update",
        }
    if tool_name == "facilitator_evaluation":
        latest_message_id = payload.get("latest_message_id")
        return {
            "signals": [
                {
                    "tag": "consensus_emerging",
                    "severity": "info",
                    "reasoning": "deterministic test signal",
                    "evidence_message_ids": [latest_message_id] if latest_message_id else [],
                }
            ],
            "overall_health": "productive",
            "pacing_note": "deterministic test pacing",
        }
    raise AssertionError(f"unexpected tool call: {tool_name}")


async def _lock_probe_complete_tool(
    persona,
    tool_name,
    tool_description,
    output_model,
    payload,
    max_tokens=1200,
    api_provider=None,
):
    if tool_name == "scribe_update":
        messages = payload.get("messages", [])
        room_id = messages[0]["room_id"] if messages else payload.get("room_id")
        async with SessionLocal() as probe:
            await probe.execute(text("PRAGMA busy_timeout=200"))
            await trace_record(probe, room_id, "lock_probe", "scribe LLM wait does not hold writer", {})
            await probe.commit()
    return await _deterministic_complete_tool(
        persona,
        tool_name,
        tool_description,
        output_model,
        payload,
        max_tokens=max_tokens,
        api_provider=api_provider,
    )


async def _failing_scribe_complete_tool(
    persona,
    tool_name,
    tool_description,
    output_model,
    payload,
    max_tokens=1200,
    api_provider=None,
):
    if tool_name == "scribe_update":
        raise ValueError("model returned malformed JSON tool arguments at line 1 column 10")
    return await _deterministic_complete_tool(
        persona,
        tool_name,
        tool_description,
        output_model,
        payload,
        max_tokens=max_tokens,
        api_provider=api_provider,
    )


def _patch_system_role_llm(monkeypatch):
    monkeypatch.setattr(engine_module, "maybe_autodrive_after", _noop_autodrive_after)
    monkeypatch.setattr(llm_adapter, "stream", _deterministic_stream)
    monkeypatch.setattr(engine_module.llm_adapter, "stream", _deterministic_stream)
    monkeypatch.setattr(llm_adapter, "complete_tool", _deterministic_complete_tool)
    monkeypatch.setattr(engine_module.llm_adapter, "complete_tool", _deterministic_complete_tool)


def test_scribe_folds_verdicts_into_decisions(
    client, review_format, architect_persona, instance_for_template, monkeypatch
):
    """A verdict must end up in scribe_state.decisions referencing the verdict message id."""
    _patch_system_role_llm(monkeypatch)
    room = client.post(
        "/rooms",
        json={"title": "pytest scribe decisions", "format_id": review_format["id"], "persona_ids": [architect_persona["id"]]},
    )
    assert room.status_code == 200
    room_id = room.json()["room"]["id"]
    architect_instance_id = instance_for_template(room_id, architect_persona["id"])

    for content in [
        "目标是评审结构化工具调用。",
        "目前的主要问题是如何保留证据？",
        "共识：工具输出必须能追溯消息。",
        "分歧：是否每轮都触发整理。",
    ]:
        assert client.post(f"/rooms/{room_id}/messages", json={"content": content}).status_code == 200

    verdict = client.post(f"/rooms/{room_id}/verdicts", json={"content": "采用结构化 tool-call 作为整理入口。"})
    assert verdict.status_code == 200
    verdict_id = verdict.json()["id"]

    state = client.get(f"/rooms/{room_id}/state").json()
    decisions = state["scribe_state"]["current_state"]["decisions"]
    assert any(item.get("message_id") == verdict_id for item in decisions), (
        "verdict must be folded into scribe_state.decisions"
    )
    assert state["facilitator_signals"], "facilitator should produce at least one signal batch"
    first_batch = state["facilitator_signals"][0]["signals"]
    assert first_batch, "facilitator batch must contain at least one signal"
    assert all(signal["tag"] in KNOWN_FACILITATOR_TAGS for signal in first_batch)

    turn = client.post(f"/rooms/{room_id}/turn", json={"speaker_persona_id": architect_instance_id})
    assert turn.status_code == 200
    payload = turn.json()
    assert payload[0]["author_actual"] == "ai"


def test_phase_transition_forces_system_role_updates(client, review_format, architect_persona, monkeypatch):
    _patch_system_role_llm(monkeypatch)
    room = client.post(
        "/rooms",
        json={"title": "pytest phase boundary", "format_id": review_format["id"], "persona_ids": [architect_persona["id"]]},
    )
    assert room.status_code == 200
    room_id = room.json()["room"]["id"]

    for content in ["边界触发测试 1", "边界触发测试 2", "边界触发测试 3"]:
        assert client.post(f"/rooms/{room_id}/messages", json={"content": content}).status_code == 200
    verdict = client.post(f"/rooms/{room_id}/verdicts", json={"content": "阶段切换时也要整理裁决。"})
    assert verdict.status_code == 200
    verdict_id = verdict.json()["id"]

    before = client.get(f"/rooms/{room_id}/state").json()
    # Scribe runs every 5 visible messages, so 3 user msgs + 1 verdict shouldn't
    # have triggered scribe yet.
    assert before["scribe_state"]["current_state"]["decisions"] == []

    transitioned = client.post(f"/rooms/{room_id}/phase/next", json={})
    assert transitioned.status_code == 200
    state = transitioned.json()
    decisions = state["scribe_state"]["current_state"]["decisions"]
    assert any(item.get("message_id") == verdict_id for item in decisions), (
        "phase boundary must run scribe and fold the pending verdict"
    )
    assert state["facilitator_signals"], "phase boundary must run facilitator"


def test_phase_boundary_scribe_does_not_hold_sqlite_writer_lock(
    client, review_format, architect_persona, monkeypatch
):
    _patch_system_role_llm(monkeypatch)
    monkeypatch.setattr(llm_adapter, "complete_tool", _lock_probe_complete_tool)
    monkeypatch.setattr(engine_module.llm_adapter, "complete_tool", _lock_probe_complete_tool)
    room = client.post(
        "/rooms",
        json={"title": "pytest phase boundary lock probe", "format_id": review_format["id"], "persona_ids": [architect_persona["id"]]},
    )
    assert room.status_code == 200
    room_id = room.json()["room"]["id"]

    for content in ["锁探测 1", "锁探测 2", "锁探测 3"]:
        assert client.post(f"/rooms/{room_id}/messages", json={"content": content}).status_code == 200
    verdict = client.post(f"/rooms/{room_id}/verdicts", json={"content": "阶段边界等待 LLM 时不能占用 SQLite 写锁。"})
    assert verdict.status_code == 200
    verdict_id = verdict.json()["id"]

    transitioned = client.post(f"/rooms/{room_id}/phase/next", json={})
    assert transitioned.status_code == 200
    decisions = transitioned.json()["scribe_state"]["current_state"]["decisions"]
    assert any(item.get("message_id") == verdict_id for item in decisions)


def test_scribe_tool_failure_does_not_break_phase_transition(
    client, review_format, architect_persona, monkeypatch
):
    _patch_system_role_llm(monkeypatch)
    monkeypatch.setattr(llm_adapter, "complete_tool", _failing_scribe_complete_tool)
    monkeypatch.setattr(engine_module.llm_adapter, "complete_tool", _failing_scribe_complete_tool)
    room = client.post(
        "/rooms",
        json={"title": "pytest scribe failure tolerated", "format_id": review_format["id"], "persona_ids": [architect_persona["id"]]},
    )
    assert room.status_code == 200
    room_id = room.json()["room"]["id"]

    for content in ["失败容忍 1", "失败容忍 2", "失败容忍 3"]:
        assert client.post(f"/rooms/{room_id}/messages", json={"content": content}).status_code == 200
    assert client.post(f"/rooms/{room_id}/verdicts", json={"content": "坏 JSON 不能阻断阶段切换。"}).status_code == 200

    transitioned = client.post(f"/rooms/{room_id}/phase/next", json={})
    assert transitioned.status_code == 200
    state = transitioned.json()
    assert state["scribe_state"]["current_state"]["decisions"] == []
    assert state["facilitator_signals"], "facilitator should still run when scribe fails"


def test_facilitator_cadence_cooldown_and_manual_request(client, review_format, architect_persona, monkeypatch):
    """Cadence is engine-side: every 5 visible msgs triggers facilitator;
    cooldown suppresses repeat batches; manual /facilitator forces a new batch."""
    _patch_system_role_llm(monkeypatch)
    room = client.post(
        "/rooms",
        json={
            "title": "pytest facilitator cooldown",
            "format_id": review_format["id"],
            "persona_ids": [architect_persona["id"]],
        },
    )
    assert room.status_code == 200
    room_id = room.json()["room"]["id"]

    for index in range(5):
        assert client.post(
            f"/rooms/{room_id}/messages",
            json={"content": f"第一批讨论 {index}"},
        ).status_code == 200
    state = client.get(f"/rooms/{room_id}/state").json()
    assert len(state["facilitator_signals"]) == 1, "first batch of 5 messages should produce 1 facilitator batch"

    for index in range(5):
        assert client.post(
            f"/rooms/{room_id}/messages",
            json={"content": f"第二批讨论 {index}"},
        ).status_code == 200
    state = client.get(f"/rooms/{room_id}/state").json()
    assert len(state["facilitator_signals"]) == 1, (
        "cooldown should suppress the second batch when no force=True is set"
    )

    manual = client.post(f"/rooms/{room_id}/facilitator")
    assert manual.status_code == 200
    assert len(manual.json()["facilitator_signals"]) == 2, (
        "manual /facilitator must bypass cooldown and add a batch"
    )


def _prev_signal(items):
    return SimpleNamespace(signals=list(items))


def test_filter_facilitator_signals_severity_escalation_passes():
    """Same tag with strictly higher severity must escape cooldown."""
    previous = [_prev_signal([{"tag": "consensus_emerging", "severity": "info"}])]
    candidates = [{"tag": "consensus_emerging", "severity": "warning"}]
    result = filter_facilitator_signals(candidates, previous, config={}, force=False)
    assert result == candidates, "warning must override prior info for the same tag"


def test_filter_facilitator_signals_same_or_lower_severity_suppressed():
    """Same tag at equal or lower severity stays suppressed."""
    previous = [_prev_signal([{"tag": "pacing_warning", "severity": "warning"}])]
    same = filter_facilitator_signals(
        [{"tag": "pacing_warning", "severity": "warning"}], previous, config={}, force=False
    )
    lower = filter_facilitator_signals(
        [{"tag": "pacing_warning", "severity": "info"}], previous, config={}, force=False
    )
    assert same == [], "equal severity must remain suppressed"
    assert lower == [], "lower severity must remain suppressed"


def test_filter_facilitator_signals_force_bypasses_dedupe():
    previous = [_prev_signal([{"tag": "decision_pending", "severity": "block"}])]
    candidate = [{"tag": "decision_pending", "severity": "info"}]
    result = filter_facilitator_signals(candidate, previous, config={}, force=True)
    assert result == candidate, "force=True must bypass cooldown entirely"


def test_filter_facilitator_signals_new_tag_passes():
    previous = [_prev_signal([{"tag": "consensus_emerging", "severity": "warning"}])]
    candidate = [{"tag": "decision_pending", "severity": "info"}]
    result = filter_facilitator_signals(candidate, previous, config={}, force=False)
    assert result == candidate, "a tag not seen before must always pass"
