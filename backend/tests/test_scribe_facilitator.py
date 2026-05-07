"""Scribe + facilitator integration. Real LLM means we cannot pin exact
content; assertions check structural invariants (cadence, cooldown, phase
boundary triggering) rather than specific tags or strings."""

from types import SimpleNamespace

from app.engine import filter_facilitator_signals


KNOWN_FACILITATOR_TAGS = {
    "phase_exhausted",
    "consider_subroom",
    "decision_pending",
    "clarification_needed",
    "disagreement_unproductive",
    "consensus_emerging",
    "pacing_warning",
}


def test_scribe_folds_verdicts_into_decisions(client, review_format, architect_persona, instance_for_template):
    """A verdict must end up in scribe_state.decisions referencing the verdict message id."""
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
    assert any(item["message_id"] == verdict_id for item in decisions), (
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


def test_phase_transition_forces_system_role_updates(client, review_format, architect_persona):
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
    assert any(item["message_id"] == verdict_id for item in decisions), (
        "phase boundary must run scribe and fold the pending verdict"
    )
    assert state["facilitator_signals"], "phase boundary must run facilitator"


def test_facilitator_cadence_cooldown_and_manual_request(client, review_format, architect_persona):
    """Cadence is engine-side: every 5 visible msgs triggers facilitator;
    cooldown suppresses repeat batches; manual /facilitator forces a new batch."""
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
