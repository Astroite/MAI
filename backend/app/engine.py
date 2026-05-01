import asyncio
from dataclasses import dataclass
from typing import Any, Literal

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import SessionLocal
from .event_bus import event_bus
from .ids import new_id
from .llm import llm_adapter
from .models import (
    Decision,
    FacilitatorSignal,
    Message,
    Persona,
    PhaseTemplate,
    Room,
    RoomPersona,
    RoomPhaseInstance,
    RoomPhasePlan,
    RoomRuntimeState,
    RoomSnapshot,
    ScribeState,
    now_utc,
)
from .schemas import FacilitatorEvaluation, ScribeUpdate
from .trace import trace_record


DEFAULT_SCRIBE_STATE = {
    "consensus": [],
    "disagreements": [],
    "open_questions": [],
    "decisions": [],
    "artifacts": [],
    "dead_ends": [],
}

SCRIBE_TOOL_DESCRIPTION = (
    "Fold new discussion messages into a structured scribe diff. "
    "Only add or remove items that are directly supported by message evidence."
)
FACILITATOR_TOOL_DESCRIPTION = (
    "Evaluate the hidden health and pacing of a multi-agent discussion. "
    "Return concise signals for the user; do not join the argument."
)

CHUNK_IDLE_TIMEOUT_SECONDS = 30.0


@dataclass
class NextSpeakerResult:
    kind: Literal["wait", "single", "parallel", "phase_done"]
    persona_ids: list[str]
    reason: str


@dataclass
class InFlightCall:
    room_id: str
    message_id: str
    persona_id: str
    task: asyncio.Task
    cancel_reason: str | None = None
    partial_text: str = ""
    last_chunk_index: int = -1

    def append_chunk(self, text: str, index: int) -> None:
        self.partial_text += text
        self.last_chunk_index = max(self.last_chunk_index, index)

    def cancel(self, reason: str) -> None:
        self.cancel_reason = reason
        self.task.cancel()


ACTIVE_CALLS: dict[str, dict[str, InFlightCall]] = {}


def active_calls_for_room(room_id: str) -> list[InFlightCall]:
    return list(ACTIVE_CALLS.get(room_id, {}).values())


def _register_active_call(call: InFlightCall) -> None:
    ACTIVE_CALLS.setdefault(call.room_id, {})[call.message_id] = call


def _unregister_active_call(call: InFlightCall) -> None:
    room_calls = ACTIVE_CALLS.get(call.room_id)
    if not room_calls or room_calls.get(call.message_id) is not call:
        return
    del room_calls[call.message_id]
    if not room_calls:
        ACTIVE_CALLS.pop(call.room_id, None)


async def get_current_phase(session: AsyncSession, runtime: RoomRuntimeState) -> RoomPhaseInstance | None:
    if not runtime.current_phase_instance_id:
        return None
    return await session.get(RoomPhaseInstance, runtime.current_phase_instance_id)


async def get_phase_template(session: AsyncSession, phase_instance: RoomPhaseInstance | None) -> PhaseTemplate | None:
    if phase_instance is None:
        return None
    return await session.get(PhaseTemplate, phase_instance.phase_template_id)


async def get_room_discussants(session: AsyncSession, room_id: str) -> list[Persona]:
    stmt = (
        select(Persona)
        .join(RoomPersona, RoomPersona.persona_id == Persona.id)
        .where(and_(RoomPersona.room_id == room_id, Persona.kind == "discussant"))
        .order_by(Persona.name)
    )
    return list((await session.scalars(stmt)).all())


async def get_room_system_persona(session: AsyncSession, room_id: str, kind: Literal["scribe", "facilitator"]) -> Persona:
    room_stmt = (
        select(Persona)
        .join(RoomPersona, RoomPersona.persona_id == Persona.id)
        .where(and_(RoomPersona.room_id == room_id, Persona.kind == kind))
        .order_by(Persona.is_builtin, Persona.name)
        .limit(1)
    )
    persona = await session.scalar(room_stmt)
    if persona:
        return persona
    fallback_stmt = select(Persona).where(and_(Persona.kind == kind, Persona.is_builtin.is_(True))).order_by(Persona.name).limit(1)
    persona = await session.scalar(fallback_stmt)
    if persona is None:
        raise ValueError(f"{kind} persona not found")
    return persona


async def allowed_persona_ids(
    session: AsyncSession,
    room_id: str,
    phase_template: PhaseTemplate | None,
    plan: RoomPhasePlan | None,
) -> list[str]:
    discussants = await get_room_discussants(session, room_id)
    if not phase_template:
        return [p.id for p in discussants]
    allowed = phase_template.allowed_speakers or {"type": "all"}
    if allowed["type"] == "all":
        return [p.id for p in discussants]
    if allowed["type"] == "specific":
        room_ids = {p.id for p in discussants}
        return [pid for pid in allowed.get("persona_ids", []) if pid in room_ids]
    bindings = (plan.variable_bindings if plan else {}) or {}
    ids: list[str] = []
    for variable_name in allowed.get("variable_names", []):
        ids.extend(bindings.get(variable_name, []))
    room_ids = {p.id for p in discussants}
    return [pid for pid in ids if pid in room_ids]


async def pick_next_speaker(
    session: AsyncSession,
    room: Room,
    runtime: RoomRuntimeState,
    requested_persona_id: str | None,
) -> NextSpeakerResult:
    if runtime.frozen:
        return NextSpeakerResult("wait", [], "room frozen")
    phase = await get_current_phase(session, runtime)
    if phase is None:
        return NextSpeakerResult("wait", [], "no running phase")
    template = await get_phase_template(session, phase)
    plan = await session.get(RoomPhasePlan, {"room_id": room.id, "position": phase.plan_position})
    if await check_phase_exit(session, room, runtime, emit=False):
        return NextSpeakerResult("phase_done", [], "exit condition met")

    allowed = await allowed_persona_ids(session, room.id, template, plan)
    if not allowed:
        return NextSpeakerResult("wait", [], "no discussants in room")

    ordering = (template.ordering_rule if template else {"type": "mention_driven"})["type"]
    if requested_persona_id:
        if requested_persona_id not in allowed:
            return NextSpeakerResult("wait", [], "requested persona not allowed in current phase")
        return NextSpeakerResult("single", [requested_persona_id], "user picked speaker")
    if ordering in {"mention_driven", "user_picks"}:
        return NextSpeakerResult("wait", [], f"{ordering} waits for user")
    if ordering == "parallel":
        spoken = await _spoken_counts(session, room.id, phase.id)
        remaining = [pid for pid in allowed if spoken.get(pid, 0) == 0]
        return NextSpeakerResult("parallel", remaining or allowed, "parallel phase")

    spoken = await _spoken_counts(session, room.id, phase.id)
    total = sum(spoken.values())
    if ordering in {"round_robin", "alternating", "question_paired"}:
        next_id = allowed[total % len(allowed)]
        return NextSpeakerResult("single", [next_id], ordering)
    return NextSpeakerResult("wait", [], "unknown ordering")


async def _spoken_counts(session: AsyncSession, room_id: str, phase_instance_id: str) -> dict[str, int]:
    stmt = (
        select(Message.author_persona_id, func.count(Message.id))
        .where(
            Message.room_id == room_id,
            Message.phase_instance_id == phase_instance_id,
            Message.author_persona_id.is_not(None),
            Message.message_type.in_(["speech", "question", "answer"]),
        )
        .group_by(Message.author_persona_id)
    )
    return {pid: count for pid, count in (await session.execute(stmt)).all()}


async def _account_token_totals(session: AsyncSession) -> tuple[int, int]:
    now = now_utc()
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = day_start.replace(day=1)
    token_expr = func.coalesce(Message.prompt_tokens, 0) + func.coalesce(Message.completion_tokens, 0)
    daily = await session.scalar(select(func.coalesce(func.sum(token_expr), 0)).where(Message.created_at >= day_start))
    monthly = await session.scalar(select(func.coalesce(func.sum(token_expr), 0)).where(Message.created_at >= month_start))
    return int(daily or 0), int(monthly or 0)


def _token_limit_exceeded(runtime: RoomRuntimeState, room_total: int, account_daily_total: int, account_monthly_total: int) -> bool:
    return (
        room_total > runtime.max_room_tokens
        or account_daily_total > runtime.max_account_daily_tokens
        or account_monthly_total > runtime.max_account_monthly_tokens
    )


async def run_room_turn(
    session: AsyncSession,
    room_id: str,
    requested_persona_id: str | None = None,
) -> list[Message]:
    room = await session.get(Room, room_id)
    runtime = await session.get(RoomRuntimeState, room_id)
    if room is None or runtime is None:
        raise ValueError("room not found")
    result = await pick_next_speaker(session, room, runtime, requested_persona_id)
    await trace_record(
        session,
        room_id,
        "scheduling_decision",
        f"pick_next_speaker -> {result.kind}",
        {"requested_persona_id": requested_persona_id, "result": result.__dict__},
    )
    await session.commit()

    if result.kind == "phase_done":
        await emit_phase_exit(session, room, runtime)
        await session.commit()
        return []
    if result.kind == "wait":
        return []

    if result.kind == "parallel":
        return await _stream_parallel_messages(room.id, result.persona_ids)

    messages: list[Message] = []
    for persona_id in result.persona_ids:
        message = await _stream_one_message(session, room, runtime, persona_id)
        messages.append(message)
    return messages


async def _stream_parallel_messages(room_id: str, persona_ids: list[str]) -> list[Message]:
    if not persona_ids:
        return []
    tasks = [_stream_one_message_in_new_session(room_id, persona_id) for persona_id in persona_ids]
    return list(await asyncio.gather(*tasks))


async def _stream_one_message_in_new_session(room_id: str, persona_id: str) -> Message:
    async with SessionLocal() as session:
        room = await session.get(Room, room_id)
        runtime = await session.get(RoomRuntimeState, room_id)
        if room is None or runtime is None:
            raise ValueError("room not found")
        return await _stream_one_message(session, room, runtime, persona_id)


async def _stream_one_message(
    session: AsyncSession,
    room: Room,
    runtime: RoomRuntimeState,
    persona_id: str,
) -> Message:
    persona = await session.get(Persona, persona_id)
    if persona is None:
        raise ValueError("persona not found")
    phase = await get_current_phase(session, runtime)
    template = await get_phase_template(session, phase)
    context = list(
        (
            await session.scalars(
                select(Message)
                .where(Message.room_id == room.id, Message.visibility_to_models.is_(True))
                .order_by(Message.created_at)
            )
        ).all()
    )
    scribe = await session.get(ScribeState, room.id)
    scribe_state = normalize_scribe_state(scribe.current_state if scribe else None)
    tmp_message_id = new_id()
    partial = ""
    chunk_count = 0
    prompt_tokens = estimate_tokens("\n".join(m.content for m in context[-20:]))
    account_daily_total, account_monthly_total = await _account_token_totals(session)
    task = asyncio.current_task()
    if task is None:
        raise RuntimeError("streaming requires an asyncio task")
    call = InFlightCall(room_id=room.id, message_id=tmp_message_id, persona_id=persona.id, task=task)
    _register_active_call(call)

    await trace_record(
        session,
        room.id,
        "llm_call_started",
        f"{persona.name} started",
        {"persona_id": persona.id, "phase": template.name if template else None, "context_message_count": len(context)},
    )
    await session.commit()

    truncated_reason = None
    stream_iter = llm_adapter.stream(
        persona, context, template, runtime.max_message_tokens, scribe_state
    ).__aiter__()
    try:
        while True:
            try:
                chunk = await asyncio.wait_for(
                    stream_iter.__anext__(), timeout=CHUNK_IDLE_TIMEOUT_SECONDS
                )
            except StopAsyncIteration:
                break
            except asyncio.TimeoutError:
                truncated_reason = "timeout"
                break
            if call.cancel_reason:
                truncated_reason = call.cancel_reason
                break
            partial += chunk.text
            chunk_count += 1
            call.append_chunk(chunk.text, chunk.index)
            await event_bus.publish(
                room.id,
                {
                    "type": "message.streaming",
                    "message_id": tmp_message_id,
                    "persona_id": persona.id,
                    "chunk_text": chunk.text,
                    "chunk_index": chunk.index,
                    "cumulative_tokens_estimate": estimate_tokens(partial),
                },
            )
            generated_tokens = prompt_tokens + estimate_tokens(partial)
            if _token_limit_exceeded(
                runtime,
                runtime.token_counter_total + generated_tokens,
                account_daily_total + generated_tokens,
                account_monthly_total + generated_tokens,
            ):
                truncated_reason = "limit_exceeded"
                break
    except asyncio.CancelledError:
        truncated_reason = call.cancel_reason or "cancelled"
    finally:
        aclose = getattr(stream_iter, "aclose", None)
        if aclose is not None:
            try:
                await aclose()
            except Exception:
                pass
        _unregister_active_call(call)

    completion_tokens = estimate_tokens(partial)
    generated_tokens = prompt_tokens + completion_tokens
    locked_runtime = await session.get(RoomRuntimeState, room.id, with_for_update=True, populate_existing=True)
    if locked_runtime is None:
        raise ValueError("room runtime not found")
    runtime = locked_runtime
    if truncated_reason is None and _token_limit_exceeded(
        runtime,
        runtime.token_counter_total + generated_tokens,
        account_daily_total + generated_tokens,
        account_monthly_total + generated_tokens,
    ):
        truncated_reason = "limit_exceeded"
    if truncated_reason:
        partial = format_truncated_partial(partial, truncated_reason)
        completion_tokens = estimate_tokens(partial)

    message = Message(
        id=tmp_message_id,
        room_id=room.id,
        phase_instance_id=phase.id if phase else None,
        message_type="speech",
        author_persona_id=persona.id,
        author_model=persona.backing_model,
        author_actual="ai",
        content=partial,
        content_chunks_count=chunk_count,
        truncated_reason=truncated_reason,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cost_usd=0,
    )
    runtime.token_counter_total += prompt_tokens + completion_tokens
    session.add(message)
    await session.flush()
    await trace_record(
        session,
        room.id,
        "llm_call_completed" if truncated_reason is None else "llm_call_cancelled",
        f"{persona.name} appended",
        {"message_id": message.id, "completion": partial, "truncated_reason": truncated_reason},
    )
    await session.commit()
    if truncated_reason:
        await event_bus.publish(
            room.id,
            {
                "type": "message.cancelled",
                "message_id": message.id,
                "reason": truncated_reason,
                "partial_text": partial,
                "partial_tokens": completion_tokens,
            },
        )
    await event_bus.publish(
        room.id,
        {
            "type": "message.appended",
            "message": message_to_event(message),
            "final_tokens": {"prompt": prompt_tokens, "completion": completion_tokens},
            "final_cost_usd": 0,
        },
    )
    await after_message_appended(session, room.id, message)
    return message


async def after_message_appended(session: AsyncSession, room_id: str, message: Message) -> None:
    count = await session.scalar(
        select(func.count(Message.id)).where(
            Message.room_id == room_id,
            Message.visibility_to_models.is_(True),
            Message.message_type.in_(["speech", "question", "answer", "verdict", "user_doc"]),
        )
    )
    if count and count % 5 == 0:
        await run_scribe_update(session, room_id, message.id)
        await run_facilitator_eval(session, room_id, message.id)
    room = await session.get(Room, room_id)
    runtime = await session.get(RoomRuntimeState, room_id)
    if room and runtime:
        await check_phase_exit(session, room, runtime, emit=True)
    await session.commit()


async def run_scribe_update(session: AsyncSession, room_id: str, latest_message_id: str) -> None:
    state = await session.get(ScribeState, room_id)
    if state is None:
        state = ScribeState(room_id=room_id, current_state=DEFAULT_SCRIBE_STATE.copy())
        session.add(state)
        await session.flush()
    current = normalize_scribe_state(state.current_state)
    messages = list(
        (
            await session.scalars(
                select(Message)
                .where(Message.room_id == room_id, Message.visibility_to_models.is_(True))
                .order_by(Message.created_at)
            )
        ).all()
    )
    start_index = 0
    if state.last_event_message_id:
        for index, message in enumerate(messages):
            if message.id == state.last_event_message_id:
                start_index = index + 1
                break
    new_messages = messages[start_index:]
    scribe = await get_room_system_persona(session, room_id, "scribe")
    update = await llm_adapter.complete_tool(
        scribe,
        "scribe_update",
        SCRIBE_TOOL_DESCRIPTION,
        ScribeUpdate,
        {
            "current_state": current,
            "latest_message_id": latest_message_id,
            "messages": [message_to_tool_payload(message) for message in new_messages],
        },
    )
    current = apply_scribe_update(current, update)
    state.current_state = current
    state.last_event_message_id = new_messages[-1].id if new_messages else state.last_event_message_id or latest_message_id
    await trace_record(session, room_id, "scribe_update", "ScribeState tool folded", {"update": update, "state": current})
    await session.flush()
    await event_bus.publish(room_id, {"type": "scribe.updated", "scribe_state": current})


async def run_facilitator_eval(
    session: AsyncSession,
    room_id: str,
    latest_message_id: str,
    force: bool = False,
) -> FacilitatorSignal | None:
    facilitator = await get_room_system_persona(session, room_id, "facilitator")
    config = facilitator.config or {}
    if config.get("disabled") and not force:
        await trace_record(session, room_id, "facilitator_signal", "facilitator disabled", {"latest_message_id": latest_message_id})
        await session.flush()
        return None
    context_window = int(config.get("context_window_messages", 8))
    recent = list(
        (
            await session.scalars(
                select(Message)
                .where(Message.room_id == room_id, Message.visibility_to_models.is_(True))
                .order_by(Message.created_at.desc())
                .limit(context_window)
            )
        ).all()
    )
    runtime = await session.get(RoomRuntimeState, room_id)
    phase = await get_current_phase(session, runtime) if runtime else None
    template = await get_phase_template(session, phase)
    history_limit = max(1, int(config.get("cooldown_per_tag_rounds", 5)))
    previous = list(
        (
            await session.scalars(
                select(FacilitatorSignal)
                .where(FacilitatorSignal.room_id == room_id)
                .order_by(FacilitatorSignal.created_at.desc())
                .limit(history_limit)
            )
        ).all()
    )
    evaluation = await llm_adapter.complete_tool(
        facilitator,
        "facilitator_evaluation",
        FACILITATOR_TOOL_DESCRIPTION,
        FacilitatorEvaluation,
        {
            "latest_message_id": latest_message_id,
            "recent_messages": [message_to_tool_payload(message) for message in recent],
            "current_phase": phase_to_tool_payload(phase, template),
            "previous_signals": [facilitator_signal_to_tool_payload(item) for item in previous],
            "manual_request": force,
        },
    )
    signals = evaluation.get("signals") or [default_facilitator_signal(recent)]
    signals = (await limit_facilitator_signals(session, runtime, phase, template, latest_message_id)) + signals
    signals = filter_facilitator_signals(signals, previous, config, force)
    if not signals:
        await trace_record(
            session,
            room_id,
            "facilitator_signal",
            "all facilitator signals suppressed by cooldown",
            {"evaluation": evaluation, "cooldown_per_tag_rounds": history_limit},
        )
        await session.flush()
        return None
    overall = evaluation.get("overall_health") or "productive"
    pacing = evaluation.get("pacing_note") or "节奏正常。"

    meta = Message(
        room_id=room_id,
        message_type="facilitator_signal",
        author_actual="system",
        visibility="observer_only",
        visibility_to_models=False,
        content="\n".join(f"{s['tag']}: {s['reasoning']}" for s in signals),
    )
    session.add(meta)
    await session.flush()
    item = FacilitatorSignal(
        room_id=room_id,
        message_id=meta.id,
        trigger_after_message_id=latest_message_id,
        signals=signals,
        overall_health=overall,
        pacing_note=pacing,
    )
    session.add(item)
    await trace_record(session, room_id, "facilitator_signal", overall, {"evaluation": evaluation})
    await session.flush()
    await event_bus.publish(
        room_id,
        {
            "type": "facilitator.signal",
            "signal": {
                "id": item.id,
                "signals": signals,
                "overall_health": overall,
                "pacing_note": pacing,
                "message_id": meta.id,
            },
        },
    )
    return item


async def run_manual_facilitator_eval(session: AsyncSession, room_id: str) -> FacilitatorSignal | None:
    latest_visible_message_id = await latest_visible_message_id_for_room(session, room_id)
    if latest_visible_message_id is None:
        raise ValueError("no visible messages to evaluate")
    return await run_facilitator_eval(session, room_id, latest_visible_message_id, force=True)


async def limit_facilitator_signals(
    session: AsyncSession,
    runtime: RoomRuntimeState | None,
    phase: RoomPhaseInstance | None,
    template: PhaseTemplate | None,
    latest_message_id: str,
) -> list[dict[str, Any]]:
    if runtime is None:
        return []
    notes: list[str] = []
    severity: Literal["suggest", "warning"] = "suggest"

    def add_note(used: int, limit: int, label: str) -> None:
        nonlocal severity
        if limit <= 0:
            return
        ratio = used / limit
        if ratio >= 0.85:
            notes.append(f"{label} 已用 {used}/{limit}，接近硬限制")
            if ratio >= 0.95:
                severity = "warning"

    add_note(runtime.token_counter_total, runtime.max_room_tokens, "房间 token")
    account_daily_total, account_monthly_total = await _account_token_totals(session)
    add_note(account_daily_total, runtime.max_account_daily_tokens, "账号日 token")
    add_note(account_monthly_total, runtime.max_account_monthly_tokens, "账号月 token")

    if phase is not None and template is not None and runtime.max_phase_rounds:
        plan = await session.get(RoomPhasePlan, {"room_id": phase.room_id, "position": phase.plan_position})
        allowed = await allowed_persona_ids(session, phase.room_id, template, plan)
        counts = await _spoken_counts(session, phase.room_id, phase.id)
        phase_turn_budget = max(1, len(allowed)) * runtime.max_phase_rounds
        add_note(sum(counts.values()), phase_turn_budget, "当前 phase 轮次")

    if not notes:
        return []
    return [
        {
            "tag": "pacing_warning",
            "severity": severity,
            "reasoning": "；".join(notes) + "。",
            "evidence_message_ids": [latest_message_id],
        }
    ]


async def check_phase_exit(session: AsyncSession, room: Room, runtime: RoomRuntimeState, emit: bool = True) -> bool:
    phase = await get_current_phase(session, runtime)
    template = await get_phase_template(session, phase)
    if phase is None or template is None:
        return False
    plan = await session.get(RoomPhasePlan, {"room_id": room.id, "position": phase.plan_position})
    allowed = await allowed_persona_ids(session, room.id, template, plan)
    counts = await _spoken_counts(session, room.id, phase.id)
    latest_message_id = await session.scalar(
        select(Message.id).where(Message.room_id == room.id).order_by(Message.created_at.desc())
    )
    matched: list[dict] = []
    if runtime.max_phase_rounds and sum(counts.values()) >= max(1, len(allowed)) * runtime.max_phase_rounds:
        matched.append({"type": "phase_round_limit", "max": runtime.max_phase_rounds})
    for condition in template.exit_conditions or []:
        ctype = condition.get("type")
        if ctype == "user_manual":
            continue
        if ctype == "rounds":
            n = int(condition.get("n", 1))
            if sum(counts.values()) >= max(1, len(allowed)) * n:
                matched.append(condition)
        if ctype == "all_spoken":
            min_each = int(condition.get("min_each", 1))
            if allowed and all(counts.get(pid, 0) >= min_each for pid in allowed):
                matched.append(condition)
        if ctype == "all_voted":
            if allowed and all(counts.get(pid, 0) >= 1 for pid in allowed):
                matched.append(condition)
        if ctype == "token_budget":
            if runtime.token_counter_total >= int(condition.get("max", runtime.max_room_tokens)):
                matched.append(condition)
        if ctype == "facilitator_suggests":
            latest = await session.scalar(
                select(FacilitatorSignal).where(FacilitatorSignal.room_id == room.id).order_by(FacilitatorSignal.created_at.desc())
            )
            tags = {s.get("tag") for s in (latest.signals if latest else [])}
            if tags.intersection(set(condition.get("trigger_if", []))):
                matched.append(condition)
    if matched and latest_message_id and runtime.phase_exit_suppressed_after_message_id == latest_message_id:
        return False
    if matched and emit and not runtime.phase_exit_suggested:
        await emit_phase_exit(session, room, runtime, matched)
    return bool(matched)


async def emit_phase_exit(
    session: AsyncSession,
    room: Room,
    runtime: RoomRuntimeState,
    matched: list[dict] | None = None,
) -> None:
    runtime.phase_exit_suggested = True
    runtime.phase_exit_matched_conditions = matched or []
    await trace_record(session, room.id, "phase_transition", "phase exit suggested", {"matched": matched or []})
    await event_bus.publish(room.id, {"type": "phase.exit_suggested", "matched_conditions": matched or []})
    if runtime.auto_transition:
        await transition_to_next_phase(session, room.id)


async def continue_current_phase(session: AsyncSession, room_id: str) -> None:
    runtime = await session.get(RoomRuntimeState, room_id)
    if runtime is None:
        raise ValueError("runtime not found")
    latest_message_id = await session.scalar(
        select(Message.id).where(Message.room_id == room_id).order_by(Message.created_at.desc())
    )
    runtime.phase_exit_suggested = False
    runtime.phase_exit_matched_conditions = []
    runtime.phase_exit_suppressed_after_message_id = latest_message_id
    await trace_record(
        session,
        room_id,
        "phase_transition",
        "phase exit suggestion ignored",
        {"suppressed_after_message_id": latest_message_id},
    )
    await event_bus.publish(room_id, {"type": "phase.exit_continued"})


async def transition_to_next_phase(session: AsyncSession, room_id: str, target_position: int | None = None) -> RoomPhaseInstance | None:
    runtime = await session.get(RoomRuntimeState, room_id)
    if runtime is None:
        raise ValueError("runtime not found")
    current = await get_current_phase(session, runtime)
    exiting_phase = current is not None
    if current:
        current.status = "completed"
        current.completed_at = now_utc()
        start_position = current.plan_position + 1
    else:
        start_position = 0
    position = target_position if target_position is not None else start_position
    plan = await session.get(RoomPhasePlan, {"room_id": room_id, "position": position})
    if plan is None:
        runtime.current_phase_instance_id = None
        runtime.phase_exit_suggested = False
        runtime.phase_exit_matched_conditions = []
        runtime.phase_exit_suppressed_after_message_id = None
        await trace_record(session, room_id, "phase_transition", "no next phase", {"target_position": position})
        await session.flush()
        if exiting_phase:
            await run_phase_boundary_tasks(session, room_id)
        return None
    instance = RoomPhaseInstance(
        room_id=room_id,
        plan_position=position,
        phase_template_id=plan.phase_template_id,
        phase_template_version=plan.phase_template_version,
        status="running",
    )
    session.add(instance)
    await session.flush()
    runtime.current_phase_instance_id = instance.id
    runtime.phase_exit_suggested = False
    runtime.phase_exit_matched_conditions = []
    runtime.phase_exit_suppressed_after_message_id = None
    marker = Message(
        room_id=room_id,
        phase_instance_id=instance.id,
        message_type="meta",
        author_actual="system",
        visibility="observer_only",
        visibility_to_models=False,
        content=f"进入阶段 #{position + 1}",
    )
    session.add(marker)
    await trace_record(session, room_id, "phase_transition", f"entered phase {position}", {"phase_instance_id": instance.id})
    await session.flush()
    if exiting_phase:
        await run_phase_boundary_tasks(session, room_id)
    await event_bus.publish(
        room_id,
        {"type": "phase.transitioned", "phase_instance_id": instance.id, "plan_position": position},
    )
    return instance


async def run_phase_boundary_tasks(session: AsyncSession, room_id: str) -> None:
    latest_visible_message_id = await latest_visible_message_id_for_room(session, room_id)
    if latest_visible_message_id:
        await run_scribe_update(session, room_id, latest_visible_message_id)
        await run_facilitator_eval(session, room_id, latest_visible_message_id)


async def latest_visible_message_id_for_room(session: AsyncSession, room_id: str) -> str | None:
    return await session.scalar(
        select(Message.id)
        .where(Message.room_id == room_id, Message.visibility_to_models.is_(True))
        .order_by(Message.created_at.desc())
    )


async def freeze_room(session: AsyncSession, room_id: str) -> None:
    room = await session.get(Room, room_id)
    runtime = await session.get(RoomRuntimeState, room_id)
    if room is None or runtime is None:
        raise ValueError("room not found")
    active_calls = active_calls_for_room(room_id)
    for active_call in active_calls:
        active_call.cancel("frozen")
    runtime.frozen = True
    room.status = "frozen"
    room.frozen_at = now_utc()
    snapshot = RoomSnapshot(room_id=room_id, full_state=await snapshot_room(session, room_id))
    session.add(snapshot)
    await trace_record(
        session,
        room_id,
        "state_mutation",
        "room frozen",
        {
            "snapshot_id": snapshot.id,
            "cancelled_message_id": active_calls[0].message_id if active_calls else None,
            "cancelled_message_ids": [call.message_id for call in active_calls],
        },
    )
    await session.flush()
    await event_bus.publish(room_id, {"type": "room.frozen"})


async def unfreeze_room(session: AsyncSession, room_id: str) -> None:
    room = await session.get(Room, room_id)
    runtime = await session.get(RoomRuntimeState, room_id)
    if room is None or runtime is None:
        raise ValueError("room not found")
    runtime.frozen = False
    room.status = "active"
    room.frozen_at = None
    await trace_record(session, room_id, "state_mutation", "room unfrozen", {})
    await session.flush()
    await event_bus.publish(room_id, {"type": "room.unfrozen"})


async def snapshot_room(session: AsyncSession, room_id: str) -> dict:
    messages = list((await session.scalars(select(Message).where(Message.room_id == room_id).order_by(Message.created_at))).all())
    runtime = await session.get(RoomRuntimeState, room_id)
    scribe = await session.get(ScribeState, room_id)
    return {
        "runtime": {
            "frozen": runtime.frozen if runtime else None,
            "current_phase_instance_id": runtime.current_phase_instance_id if runtime else None,
            "token_counter_total": runtime.token_counter_total if runtime else None,
        },
        "messages": [message_to_event(m) for m in messages],
        "scribe_state": scribe.current_state if scribe else DEFAULT_SCRIBE_STATE,
    }


async def append_verdict(
    session: AsyncSession,
    room_id: str,
    content: str,
    is_locked: bool,
    dead_end: bool,
    revoke_message_id: str | None = None,
) -> Message:
    runtime = await session.get(RoomRuntimeState, room_id)
    phase_id = runtime.current_phase_instance_id if runtime else None
    message = Message(
        room_id=room_id,
        phase_instance_id=phase_id,
        parent_message_id=revoke_message_id,
        message_type="verdict_revoke" if revoke_message_id else "verdict",
        author_actual="user_as_judge",
        visibility="public",
        visibility_to_models=True,
        content=content,
        completion_tokens=estimate_tokens(content),
        cost_usd=0,
    )
    session.add(message)
    await session.flush()
    if revoke_message_id:
        decision = await session.scalar(
            select(Decision).where(
                Decision.room_id == room_id,
                Decision.scribe_event_message_id == revoke_message_id,
                Decision.revoked_by_message_id.is_(None),
            )
        )
        if decision:
            decision.revoked_by_message_id = message.id
    if not revoke_message_id and not dead_end:
        session.add(
            Decision(
                room_id=room_id,
                scribe_event_message_id=message.id,
                content=content,
                is_locked=is_locked,
                locked_by_message_id=message.id if is_locked else None,
            )
        )
    if dead_end:
        meta = Message(
            room_id=room_id,
            phase_instance_id=phase_id,
            message_type="meta",
            author_actual="user_as_judge",
            visibility="public",
            visibility_to_models=True,
            content=f"死路：{content}",
        )
        session.add(meta)
    await trace_record(session, room_id, "user_action", "judge verdict", {"message_id": message.id})
    await session.flush()
    await event_bus.publish(room_id, {"type": "message.appended", "message": message_to_event(message)})
    await after_message_appended(session, room_id, message)
    return message


def normalize_scribe_state(raw: dict[str, Any] | None) -> dict[str, list[dict[str, Any]]]:
    raw = raw or {}
    return {key: list(raw.get(key) or []) for key in DEFAULT_SCRIBE_STATE}


def apply_scribe_update(current: dict[str, Any], update: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    next_state = normalize_scribe_state(current)
    _remove_items(next_state["consensus"], update.get("consensus_removed") or [])
    _remove_items(next_state["disagreements"], update.get("disagreements_resolved") or [])
    _remove_items(next_state["open_questions"], update.get("open_questions_answered") or [])
    _append_items(next_state["consensus"], update.get("consensus_added") or [])
    _append_items(next_state["disagreements"], update.get("disagreements_added") or [])
    _append_items(next_state["open_questions"], update.get("open_questions_added") or [])
    _append_items(next_state["decisions"], update.get("decisions_added") or [])
    _append_items(next_state["artifacts"], update.get("artifacts_added") or [])
    _append_items(next_state["dead_ends"], update.get("dead_ends_added") or [])
    return next_state


def _append_items(target: list[dict[str, Any]], additions: list[dict[str, Any]]) -> None:
    existing_message_ids = {item.get("message_id") for item in target if item.get("message_id")}
    existing_contents = {item.get("content") for item in target if item.get("content")}
    for item in additions:
        message_id = item.get("message_id")
        content = item.get("content")
        if message_id and message_id in existing_message_ids:
            continue
        if not message_id and content and content in existing_contents:
            continue
        target.append(dict(item))
        if message_id:
            existing_message_ids.add(message_id)
        if content:
            existing_contents.add(content)


def _remove_items(target: list[dict[str, Any]], identifiers: list[str]) -> None:
    if not identifiers:
        return
    remove = set(identifiers)
    target[:] = [item for item in target if (item.get("id") or item.get("message_id") or item.get("content")) not in remove]


def default_facilitator_signal(recent: list[Message]) -> dict[str, Any]:
    return {
        "tag": "consensus_emerging",
        "severity": "info",
        "reasoning": "讨论仍在产出可整理的观点，暂不需要强制干预。",
        "evidence_message_ids": [message.id for message in recent[:3]],
    }


def filter_facilitator_signals(
    signals: list[dict[str, Any]],
    previous: list[FacilitatorSignal],
    config: dict[str, Any],
    force: bool,
) -> list[dict[str, Any]]:
    enabled_tags = set(config.get("enabled_signal_tags") or [])
    filtered = [signal for signal in signals if not enabled_tags or signal.get("tag") in enabled_tags]
    if force:
        return filtered
    recent_tags = {
        signal.get("tag")
        for item in previous
        for signal in (item.signals or [])
        if signal.get("tag")
    }
    return [signal for signal in filtered if signal.get("tag") not in recent_tags]


def facilitator_signal_to_tool_payload(item: FacilitatorSignal) -> dict[str, Any]:
    return {
        "id": item.id,
        "message_id": item.message_id,
        "trigger_after_message_id": item.trigger_after_message_id,
        "signals": item.signals or [],
        "overall_health": item.overall_health,
        "pacing_note": item.pacing_note,
        "created_at": item.created_at.isoformat() if item.created_at else None,
    }


def phase_to_tool_payload(phase: RoomPhaseInstance | None, template: PhaseTemplate | None) -> dict[str, Any] | None:
    if phase is None or template is None:
        return None
    return {
        "phase_instance_id": phase.id,
        "plan_position": phase.plan_position,
        "phase_template_id": template.id,
        "name": template.name,
        "description": template.description,
        "ordering_rule": template.ordering_rule,
        "exit_conditions": template.exit_conditions,
        "role_constraints": template.role_constraints,
        "prompt_template": template.prompt_template,
    }


def format_truncated_partial(partial: str, reason: str) -> str:
    labels = {
        "limit_exceeded": "房间 token limit",
        "frozen": "房间冻结",
        "timeout": "调用超时",
        "cancelled": "调用取消",
    }
    label = labels.get(reason, reason)
    suffix = f"\n\n[已因{label}截断]"
    if partial:
        return partial[: max(0, len(partial) - len(suffix))] + suffix
    return f"[已因{label}取消，尚未生成内容]"


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4) if text else 0


def message_to_tool_payload(message: Message) -> dict[str, Any]:
    return {
        "id": message.id,
        "room_id": message.room_id,
        "phase_instance_id": message.phase_instance_id,
        "parent_message_id": message.parent_message_id,
        "message_type": message.message_type,
        "author_persona_id": message.author_persona_id,
        "author_model": message.author_model,
        "author_actual": message.author_actual,
        "visibility": message.visibility,
        "visibility_to_models": message.visibility_to_models,
        "content": message.content,
        "created_at": message.created_at.isoformat() if message.created_at else None,
    }


def message_to_event(message: Message) -> dict:
    return {
        "id": message.id,
        "room_id": message.room_id,
        "phase_instance_id": message.phase_instance_id,
        "parent_message_id": message.parent_message_id,
        "message_type": message.message_type,
        "author_persona_id": message.author_persona_id,
        "author_model": message.author_model,
        "author_actual": message.author_actual,
        "user_masquerade_persona_id": message.user_masquerade_persona_id,
        "visibility": message.visibility,
        "visibility_to_models": message.visibility_to_models,
        "content": message.content,
        "content_chunks_count": message.content_chunks_count,
        "truncated_reason": message.truncated_reason,
        "prompt_tokens": message.prompt_tokens,
        "completion_tokens": message.completion_tokens,
        "cost_usd": float(message.cost_usd or 0),
        "user_revealed_at": message.user_revealed_at.isoformat() if message.user_revealed_at else None,
        "created_at": message.created_at.isoformat() if message.created_at else None,
    }
