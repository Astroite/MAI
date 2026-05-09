"""Pure-unit tests for the facilitator signal filter (cooldown, severity
escalation, force bypass, new-tag passthrough). Engine-driven scribe and
facilitator integration tests previously lived here but required a live LLM."""

from types import SimpleNamespace

from app.engine import filter_facilitator_signals


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
