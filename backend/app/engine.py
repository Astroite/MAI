import asyncio
import random
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import SessionLocal
from .event_bus import event_bus
from .ids import new_id
from .llm import llm_adapter
from .models import (
    ApiProvider,
    ApiModel,
    AppSettings,
    Decision,
    FacilitatorSignal,
    Message,
    PersonaInstance,
    PhaseTemplate,
    Room,
    RoomPhaseInstance,
    RoomPhasePlan,
    RoomRuntimeState,
    RoomSnapshot,
    ScribeState,
    World,
    WorldCharacter,
    WorldCharacterMemory,
    WorldCharacterRelation,
    WorldSceneMember,
    now_utc,
)
from .schemas import FacilitatorEvaluation, MemoryDistillation, ScribeUpdate
from .tools import execute_tool, list_tool_schemas, tool_definitions_for_llm, tool_result_as_text
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

# Casual ordering: how likely the autodrive chain continues after an AI reply.
# Decays geometrically with consecutive_ai_turns so chains naturally taper off
# instead of running until max_consecutive_ai_turns. Tunable; with these values
# expected chain length is ~2-3 turns.
CASUAL_CONTINUATION_BASE = 0.9
CASUAL_CONTINUATION_DECAY = 0.85

SILENCE_SENTINEL = "<silent/>"


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


# Per-room locks guarding auto-drive dispatch. A held lock means an autodrive
# task is already streaming a persona reply; further user messages skip
# scheduling rather than queueing. Users can still POST /turn manually.
_AUTODRIVE_LOCKS: dict[str, asyncio.Lock] = {}
_AUTODRIVE_TRIGGER_AUTHORS = {"user", "user_as_persona", "user_as_judge"}
_AUTODRIVE_TRIGGER_TYPES = {"speech", "question", "answer", "user_doc"}


def _autodrive_lock(room_id: str) -> asyncio.Lock:
    return _AUTODRIVE_LOCKS.setdefault(room_id, asyncio.Lock())


async def maybe_autodrive_after(room_id: str, just_appended: Message) -> None:
    """Schedule a persona reply if the just-appended message is user-driven.

    The recursion guard hinges on `author_actual`: persona replies have
    `author_actual == "ai"` and never re-trigger autodrive, even though
    `_stream_one_message` calls `after_message_appended` on its tail.
    """
    if just_appended.author_actual not in _AUTODRIVE_TRIGGER_AUTHORS:
        return
    if just_appended.message_type not in _AUTODRIVE_TRIGGER_TYPES:
        return
    lock = _autodrive_lock(room_id)
    if lock.locked():
        return
    if active_calls_for_room(room_id):
        return
    asyncio.create_task(_autodrive_runner(room_id, lock))


async def _autodrive_runner(room_id: str, lock: asyncio.Lock) -> None:
    if lock.locked():
        return
    async with lock:
        try:
            while True:
                async with SessionLocal() as session:
                    messages = await run_room_turn(session, room_id, None)
                if not messages:
                    break
                async with SessionLocal() as session:
                    if not await _should_auto_discuss(session, room_id):
                        break
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — surface to user, never swallow
            try:
                async with SessionLocal() as session:
                    await trace_record(
                        session,
                        room_id,
                        "autodrive_error",
                        f"autodrive failed: {exc!r}",
                        {"error": repr(exc)},
                    )
                    await session.commit()
            except Exception:  # noqa: BLE001
                pass
            await event_bus.publish(
                room_id,
                {"type": "system.error", "kind": "autodrive", "detail": str(exc)},
            )
    # After chain completes, check if a user message arrived during the chain
    asyncio.create_task(_maybe_handle_pending_user_turn(room_id))


async def _should_auto_discuss(session: AsyncSession, room_id: str) -> bool:
    """Return True if the engine should chain another AI turn."""
    runtime = await session.get(RoomRuntimeState, room_id)
    if runtime is None or runtime.frozen:
        return False
    phase = await get_current_phase(session, runtime)
    template = await get_phase_template(session, phase)
    if template is None or not template.auto_discuss:
        return False
    if runtime.consecutive_ai_turns >= runtime.max_consecutive_ai_turns:
        return False
    ordering = (template.ordering_rule or {}).get("type")
    phase_tags = set(template.tags or [])
    is_story = "story" in phase_tags
    if ordering == "casual" and not is_story:
        # Story phases run continuously until the user freezes or the cap
        # hits — geometric decay would otherwise tail the conversation off
        # within a few turns, defeating the "let them play out the scene"
        # design. Other casual rooms (chat) keep the gentle taper.
        p = CASUAL_CONTINUATION_BASE * (CASUAL_CONTINUATION_DECAY ** runtime.consecutive_ai_turns)
        if random.random() > p:
            return False
    room = await session.get(Room, room_id)
    if room and await check_phase_exit(session, room, runtime, emit=False):
        return False
    return True


def is_autodrive_active(room_id: str) -> bool:
    """True while an `_autodrive_runner` is iterating turns for this room.

    Surfaced to the UI so the speaker-status strip can distinguish
    "AI is taking the next turn" from "waiting for the user to nudge".
    """
    lock = _AUTODRIVE_LOCKS.get(room_id)
    return lock is not None and lock.locked()


def schedule_autodrive(room_id: str) -> bool:
    """Manually kick the autodrive chain without requiring a user message.

    Used by `POST /rooms/{id}/autodrive/resume` so the user can let the AI
    keep going by clicking a button instead of typing. No-op (returns False)
    if a chain is already running or any persona stream is in flight."""
    lock = _autodrive_lock(room_id)
    if lock.locked():
        return False
    if active_calls_for_room(room_id):
        return False
    asyncio.create_task(_autodrive_runner(room_id, lock))
    return True


async def _maybe_handle_pending_user_turn(room_id: str) -> None:
    """After an autodrive chain completes, re-trigger if a user message is pending."""
    lock = _autodrive_lock(room_id)
    if lock.locked():
        return
    async with SessionLocal() as session:
        runtime = await session.get(RoomRuntimeState, room_id)
        if runtime is None or runtime.frozen:
            return
        latest = await session.scalar(
            select(Message).where(Message.room_id == room_id).order_by(Message.created_at.desc()).limit(1)
        )
        if latest and latest.author_actual in _AUTODRIVE_TRIGGER_AUTHORS:
            asyncio.create_task(_autodrive_runner(room_id, lock))


async def get_current_phase(session: AsyncSession, runtime: RoomRuntimeState) -> RoomPhaseInstance | None:
    if not runtime.current_phase_instance_id:
        return None
    return await session.get(RoomPhaseInstance, runtime.current_phase_instance_id)


async def get_phase_template(session: AsyncSession, phase_instance: RoomPhaseInstance | None) -> PhaseTemplate | None:
    if phase_instance is None:
        return None
    return await session.get(PhaseTemplate, phase_instance.phase_template_id)


async def resolve_api_provider(session: AsyncSession, persona: PersonaInstance) -> ApiProvider | None:
    if persona.api_model_id:
        api_model = await session.get(ApiModel, persona.api_model_id)
        if api_model is not None:
            return await session.get(ApiProvider, api_model.api_provider_id)
    if not persona.api_provider_id:
        return None
    return await session.get(ApiProvider, persona.api_provider_id)


async def resolve_persona_runtime(
    session: AsyncSession, persona: PersonaInstance
) -> tuple[PersonaInstance, ApiProvider | None]:
    """Overlay resolved model/provider settings without persisting them.

    Resolution order:
      api_model_id:     persona.api_model_id || settings.default_api_model_id
      legacy fallback:  persona.backing_model/api_provider_id || app settings

    Raises ValueError if neither persona nor settings supply a model or a
    provider — the engine treats this as a "system not configured yet" error
    that surfaces clearly to the user (no env-var fallback).
    """
    settings_row = await session.get(AppSettings, 1)
    default_model_id = settings_row.default_api_model_id if settings_row else None
    default_model = (settings_row.default_backing_model or "").strip() if settings_row else ""
    default_provider_id = settings_row.default_api_provider_id if settings_row else None

    persona_has_legacy_model = bool((persona.backing_model or "").strip() or persona.api_provider_id)
    effective_api_model_id = persona.api_model_id or (None if persona_has_legacy_model else default_model_id)
    effective_model = (persona.backing_model or "").strip()
    effective_provider_id = persona.api_provider_id

    if effective_api_model_id:
        api_model = await session.get(ApiModel, effective_api_model_id)
        if api_model is None:
            raise ValueError(f"api model {effective_api_model_id} not found")
        if not api_model.enabled:
            raise ValueError(f"api model {api_model.display_name} is disabled")
        effective_model = api_model.model_name
        effective_provider_id = api_model.api_provider_id
    else:
        effective_model = effective_model or default_model
        effective_provider_id = effective_provider_id or default_provider_id

    if not effective_model:
        raise ValueError(
            "no model configured: select persona.api_model_id or AppSettings.default_api_model_id"
        )
    if not effective_provider_id:
        raise ValueError(
            "no API provider configured: select a model with an API provider"
        )

    provider = await session.get(ApiProvider, effective_provider_id)
    if provider is None:
        raise ValueError(f"api provider {effective_provider_id} not found")

    # Detach + overlay so llm_adapter sees resolved values via duck-typing.
    session.expunge(persona)
    persona.backing_model = effective_model
    persona.api_provider_id = provider.id
    persona.api_model_id = effective_api_model_id
    return persona, provider


async def get_room_discussants(session: AsyncSession, room_id: str) -> list[PersonaInstance]:
    stmt = (
        select(PersonaInstance)
        .where(and_(PersonaInstance.room_id == room_id, PersonaInstance.kind == "discussant"))
        .order_by(PersonaInstance.position, PersonaInstance.name)
    )
    discussants = list((await session.scalars(stmt)).all())
    # Filter out scene members who have exited (Story World N5). Non-scene
    # rooms are unaffected — those instances have world_character_id IS NULL.
    bound_ids = [p.world_character_id for p in discussants if p.world_character_id]
    if not bound_ids:
        return discussants
    exited = set(
        (
            await session.scalars(
                select(WorldSceneMember.world_character_id)
                .where(
                    WorldSceneMember.scene_id == room_id,
                    WorldSceneMember.world_character_id.in_(bound_ids),
                    WorldSceneMember.exited_at_message_id.is_not(None),
                )
            )
        ).all()
    )
    if not exited:
        return discussants
    return [p for p in discussants if p.world_character_id not in exited]


async def get_room_system_persona(
    session: AsyncSession, room_id: str, kind: Literal["scribe", "facilitator"]
) -> PersonaInstance:
    stmt = (
        select(PersonaInstance)
        .where(and_(PersonaInstance.room_id == room_id, PersonaInstance.kind == kind))
        .order_by(PersonaInstance.position, PersonaInstance.name)
        .limit(1)
    )
    persona = await session.scalar(stmt)
    if persona is None:
        raise ValueError(f"{kind} persona instance not found for room {room_id}")
    return persona


async def allowed_persona_ids(
    session: AsyncSession,
    room_id: str,
    phase_template: PhaseTemplate | None,
    plan: RoomPhasePlan | None,
) -> list[str]:
    """Return *instance ids* of discussants allowed in the current phase.

    Phase templates store **template ids** in `allowed_speakers.persona_ids`
    and `variable_bindings`. We resolve those to the room's instances by
    matching `instance.template_id`.
    """
    discussants = await get_room_discussants(session, room_id)
    if not phase_template:
        return [p.id for p in discussants]
    allowed = phase_template.allowed_speakers or {"type": "all"}
    if allowed["type"] == "all":
        return [p.id for p in discussants]
    if allowed["type"] == "specific":
        allowed_template_ids = set(allowed.get("persona_ids", []))
        return [p.id for p in discussants if p.template_id in allowed_template_ids]
    bindings = (plan.variable_bindings if plan else {}) or {}
    template_ids: list[str] = []
    for variable_name in allowed.get("variable_names", []):
        template_ids.extend(bindings.get(variable_name, []))
    template_id_set = set(template_ids)
    return [p.id for p in discussants if p.template_id in template_id_set]


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
    if requested_persona_id is None:
        allowed = await _auto_reply_enabled_persona_ids(session, allowed)
        if not allowed:
            return NextSpeakerResult("wait", [], "all discussants disabled auto reply")

    ordering = (template.ordering_rule if template else {"type": "mention_driven"})["type"]
    if requested_persona_id:
        if requested_persona_id not in allowed:
            return NextSpeakerResult("wait", [], "requested persona not allowed in current phase")
        return NextSpeakerResult("single", [requested_persona_id], "user picked speaker")
    if ordering == "user_picks":
        return NextSpeakerResult("wait", [], "user_picks waits for user")
    if ordering == "mention_driven":
        mentioned = await _resolve_at_mention(session, room.id, allowed)
        if mentioned is not None:
            return NextSpeakerResult("single", [mentioned], "mention_driven matched @-mention")
        # fall through to round-robin so auto-drive still moves the room forward
    if ordering == "question_paired":
        target = await _resolve_question_paired(session, room.id, allowed)
        if target is not None:
            return NextSpeakerResult("single", [target], "question_paired matched @-mention")
        # fall through to round-robin if no @-mention on the latest question
    if ordering == "parallel":
        spoken = await _spoken_counts(session, room.id, phase.id)
        remaining = [pid for pid in allowed if spoken.get(pid, 0) == 0]
        return NextSpeakerResult("parallel", remaining or allowed, "parallel phase")
    if ordering == "casual":
        mentioned = await _resolve_at_mention(session, room.id, allowed)
        if mentioned is not None:
            return NextSpeakerResult("single", [mentioned], "casual matched @-mention")
        next_id = await _pick_casual_speaker(session, room.id, phase.id, allowed)
        if next_id is None:
            return NextSpeakerResult("wait", [], "casual: no eligible speaker")
        return NextSpeakerResult("single", [next_id], "casual weighted random")

    spoken = await _spoken_counts(session, room.id, phase.id)
    total = sum(spoken.values())
    if ordering == "alternating":
        last_speaker = await _last_ai_speaker(session, room.id, phase.id)
        candidates = [pid for pid in allowed if pid != last_speaker] or allowed
        next_id = candidates[total % len(candidates)]
        return NextSpeakerResult("single", [next_id], "alternating skip last speaker")
    if ordering in {"round_robin", "question_paired", "mention_driven"}:
        next_id = allowed[total % len(allowed)]
        if ordering == "mention_driven":
            reason = "mention_driven fallback to round-robin"
        elif ordering == "question_paired":
            reason = "question_paired fallback to round-robin"
        else:
            reason = ordering
        return NextSpeakerResult("single", [next_id], reason)
    return NextSpeakerResult("wait", [], "unknown ordering")


async def _match_at_mention_in_text(
    session: AsyncSession, text: str | None, allowed_ids: list[str]
) -> str | None:
    """Match `@<persona-name>` tokens in `text` against allowed instance ids."""
    if not text or not allowed_ids or "@" not in text:
        return None
    personas = (
        await session.scalars(select(PersonaInstance).where(PersonaInstance.id.in_(allowed_ids)))
    ).all()
    for persona in personas:
        if not persona.name:
            continue
        if f"@{persona.name}" in text:
            return persona.id
    return None


async def _resolve_at_mention(
    session: AsyncSession, room_id: str, allowed_ids: list[str]
) -> str | None:
    """Scan the most recent visible user message for `@<persona-name>` tokens.

    Returns the matched persona id (must be in `allowed_ids`) or None.
    """
    if not allowed_ids:
        return None
    last_user_message = await session.scalar(
        select(Message)
        .where(
            Message.room_id == room_id,
            Message.visibility_to_models.is_(True),
            Message.author_actual.in_(["user", "user_as_persona", "user_as_judge"]),
            Message.message_type.in_(["speech", "question", "answer", "user_doc"]),
        )
        .order_by(Message.created_at.desc())
        .limit(1)
    )
    if last_user_message is None:
        return None
    return await _match_at_mention_in_text(session, last_user_message.content, allowed_ids)


async def _resolve_question_paired(
    session: AsyncSession, room_id: str, allowed_ids: list[str]
) -> str | None:
    """If the most recent visible message is a `question`, return the @-mentioned persona id.

    Falls through (returns None) if the latest visible turn is not a question — that means
    someone has already answered, and pairing should release back to round-robin.
    """
    if not allowed_ids:
        return None
    last_visible = await session.scalar(
        select(Message)
        .where(
            Message.room_id == room_id,
            Message.visibility_to_models.is_(True),
            Message.author_actual != "system",
        )
        .order_by(Message.created_at.desc())
        .limit(1)
    )
    if last_visible is None or last_visible.message_type != "question":
        return None
    return await _match_at_mention_in_text(session, last_visible.content, allowed_ids)


async def _auto_reply_enabled_persona_ids(session: AsyncSession, persona_ids: list[str]) -> list[str]:
    if not persona_ids:
        return []
    personas = (await session.scalars(select(PersonaInstance).where(PersonaInstance.id.in_(persona_ids)))).all()
    enabled = {persona.id for persona in personas if (persona.config or {}).get("auto_reply_enabled", True) is not False}
    return [persona_id for persona_id in persona_ids if persona_id in enabled]


async def _last_ai_speaker(
    session: AsyncSession, room_id: str, phase_instance_id: str
) -> str | None:
    """Author persona id of the most recent visible AI message in the current phase."""
    return await session.scalar(
        select(Message.author_persona_id)
        .where(
            Message.room_id == room_id,
            Message.phase_instance_id == phase_instance_id,
            Message.visibility_to_models.is_(True),
            Message.author_actual == "ai",
            Message.author_persona_id.is_not(None),
        )
        .order_by(Message.created_at.desc())
        .limit(1)
    )


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


async def _last_spoken_at_per_persona(
    session: AsyncSession, room_id: str, persona_ids: list[str]
) -> dict[str, datetime]:
    """Most recent message timestamp per persona across the whole room.

    Casual sampling weights by recency room-wide (not per-phase) — that's the
    "natural conversation" feel: a persona who just spoke a phase ago should
    still feel "fresh" relative to one who spoke 30s ago.
    """
    if not persona_ids:
        return {}
    stmt = (
        select(Message.author_persona_id, func.max(Message.created_at))
        .where(
            Message.room_id == room_id,
            Message.author_persona_id.in_(persona_ids),
            Message.message_type.in_(["speech", "question", "answer", "silence"]),
        )
        .group_by(Message.author_persona_id)
    )
    return {pid: ts for pid, ts in (await session.execute(stmt)).all()}


async def _last_non_silence_speaker(
    session: AsyncSession, room_id: str, persona_ids: list[str]
) -> str | None:
    """Most recent persona to actually say something (not silence)."""
    if not persona_ids:
        return None
    return await session.scalar(
        select(Message.author_persona_id)
        .where(
            Message.room_id == room_id,
            Message.author_persona_id.in_(persona_ids),
            Message.message_type.in_(["speech", "question", "answer"]),
        )
        .order_by(Message.created_at.desc())
        .limit(1)
    )


async def _pick_casual_speaker(
    session: AsyncSession,
    room_id: str,
    phase_instance_id: str,
    allowed: list[str],
) -> str | None:
    """Weighted-random pick for `casual` ordering.

    score = (now - last_spoke_at_seconds) * talkativeness * uniform(0.7, 1.3)
    Forbids the most recent non-silence speaker so nobody talks twice in a row.
    """
    if not allowed:
        return None
    last_real = await _last_non_silence_speaker(session, room_id, allowed)
    candidates = [pid for pid in allowed if pid != last_real] or allowed

    last_spoke = await _last_spoken_at_per_persona(session, room_id, candidates)
    personas = (
        await session.scalars(select(PersonaInstance).where(PersonaInstance.id.in_(candidates)))
    ).all()
    persona_by_id = {p.id: p for p in personas}

    now = datetime.now(timezone.utc)
    # Personas who haven't spoken yet get a large recency bonus (1 hour) so
    # newcomers tend to open up early without dominating.
    NEVER_SPOKE_SECONDS = 3600.0

    best_id: str | None = None
    best_score = -1.0
    for pid in candidates:
        persona = persona_by_id.get(pid)
        talkativeness = persona.talkativeness if persona is not None else 1.0
        last = last_spoke.get(pid)
        if last is None:
            recency = NEVER_SPOKE_SECONDS
        else:
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            recency = max(1.0, (now - last).total_seconds())
        jitter = random.uniform(0.7, 1.3)
        score = recency * max(0.0, talkativeness) * jitter
        if score > best_score:
            best_score = score
            best_id = pid
    return best_id


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
    # `persona_id` is a PersonaInstance.id (room-scoped); the engine never
    # consumes raw template ids past pick_next_speaker.
    persona = await session.get(PersonaInstance, persona_id)
    if persona is None:
        raise ValueError("persona instance not found")
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
    # Map peer persona ids -> display names so llm_adapter can label "who said
    # what" in the transcript. Without this every AI sees prior AI turns as
    # its own `assistant` history and they all converge to one narrator voice.
    peer_personas = (
        await session.scalars(select(PersonaInstance).where(PersonaInstance.room_id == room.id))
    ).all()
    peer_names = {p.id: p.name for p in peer_personas}
    peer_identities = {p.id: (p.identity or "") for p in peer_personas}
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
    persona, api_provider = await resolve_persona_runtime(session, persona)
    try:
        tools_enabled = bool((persona.config or {}).get("tools_enabled"))
        tools_allow_write = bool((persona.config or {}).get("tools_allow_write"))
        tool_schemas = await list_tool_schemas(session) if tools_enabled else []
        tool_definitions = (
            tool_definitions_for_llm(tool_schemas, allow_write=tools_allow_write) if tool_schemas else []
        )
        if tool_definitions:
            async def _execute_llm_tool(name: str, arguments: dict[str, Any]) -> str:
                invocation = await execute_tool(
                    session,
                    room.id,
                    name,
                    arguments,
                    parent_message_id=tmp_message_id,
                    allow_write=tools_allow_write,
                )
                await session.commit()
                return tool_result_as_text(invocation)

            completion = await asyncio.wait_for(
                llm_adapter.complete_with_tools(
                    persona,
                    context,
                    template,
                    runtime.max_message_tokens,
                    tool_definitions,
                    _execute_llm_tool,
                    scribe_state,
                    api_provider=api_provider,
                    room_background=room.background or "",
                    peer_names=peer_names,
                    peer_identities=peer_identities,
                ),
                timeout=max(CHUNK_IDLE_TIMEOUT_SECONDS, 180.0),
            )
            partial = completion.content
            if partial:
                chunk_count = 1
                call.append_chunk(partial, 0)
                await event_bus.publish(
                    room.id,
                    {
                        "type": "message.streaming",
                        "message_id": tmp_message_id,
                        "persona_id": persona.id,
                        "chunk_text": partial,
                        "chunk_index": 0,
                        "cumulative_tokens_estimate": estimate_tokens(partial),
                    },
                )
            if call.cancel_reason:
                truncated_reason = call.cancel_reason
        else:
            stream_iter = llm_adapter.stream(
                persona,
                context,
                template,
                runtime.max_message_tokens,
                scribe_state,
                api_provider=api_provider,
                room_background=room.background or "",
                peer_names=peer_names,
                peer_identities=peer_identities,
            ).__aiter__()
            try:
                while True:
                    try:
                        chunk = await asyncio.wait_for(
                            stream_iter.__anext__(), timeout=CHUNK_IDLE_TIMEOUT_SECONDS
                        )
                    except StopAsyncIteration:
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
            finally:
                aclose = getattr(stream_iter, "aclose", None)
                if aclose is not None:
                    try:
                        await aclose()
                    except Exception:
                        pass
    except asyncio.TimeoutError:
        truncated_reason = "timeout"
    except asyncio.CancelledError:
        truncated_reason = call.cancel_reason or "cancelled"
    finally:
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

    ordering = (template.ordering_rule or {}).get("type") if template else None
    is_silence = (
        ordering == "casual"
        and truncated_reason is None
        and partial.strip() == SILENCE_SENTINEL
    )

    message = Message(
        id=tmp_message_id,
        room_id=room.id,
        phase_instance_id=phase.id if phase else None,
        message_type="silence" if is_silence else "speech",
        author_persona_id=persona.id,
        author_model=persona.backing_model,
        author_actual="ai",
        content="..." if is_silence else partial,
        visibility_to_models=False if is_silence else True,
        content_chunks_count=chunk_count,
        truncated_reason=truncated_reason,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cost_usd=0,
    )
    runtime.token_counter_total += prompt_tokens + completion_tokens
    runtime.consecutive_ai_turns += 1
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
    if message.author_actual in _AUTODRIVE_TRIGGER_AUTHORS:
        runtime = await session.get(RoomRuntimeState, room_id)
        if runtime:
            runtime.consecutive_ai_turns = 0
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
    await maybe_autodrive_after(room_id, message)


async def run_scribe_update(session: AsyncSession, room_id: str, latest_message_id: str) -> None:
    # Story World scenes use a different folding pipeline (per-character episodic
    # memory, landed in PR 3+). The room-level scribe tracks discussion
    # consensus / decisions / etc. that don't make sense for a story scene, so
    # short-circuit here when this room is a scene.
    room = await session.get(Room, room_id)
    if room is not None and room.world_id is not None:
        return
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
    scribe, scribe_provider = await resolve_persona_runtime(session, scribe)
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
        api_provider=scribe_provider,
    )
    current = apply_scribe_update(current, update)
    state.current_state = current
    state.last_event_message_id = new_messages[-1].id if new_messages else state.last_event_message_id or latest_message_id
    await trace_record(session, room_id, "scribe_update", "ScribeState tool folded", {"update": update, "state": current})
    await session.flush()
    await event_bus.publish(room_id, {"type": "scribe.updated", "scribe_state": current})


SCENE_MEMORY_TOOL_DESCRIPTION = (
    "Distill what THIS character experienced in this scene. Output two streams:\n"
    "1) `new_episodes`: 0–6 short, first-person memory entries (specific event, "
    "vow they made, or sharp impression). Skip generic recap. Don't repeat "
    "anything the existing-memories list already has. Salience: 0.3 trivial, "
    "0.6 notable, 0.9 turning-point.\n"
    "2) `impressions`: 0–N per-peer relationship updates. about_character_id "
    "must be a peer that was on stage with this character (see peers_on_stage). "
    "sentiment_delta is the *change* this scene caused, clamped [-1, +1]. label "
    "names the relationship in 2-4 chars (e.g. 盟友/宿敌/暗恋). notes_append is a "
    "short fact/quote you want to remember about them — it gets appended (not "
    "replacing) the existing notes."
)


async def _scene_memory_already_written(
    session: AsyncSession, character_id: str, scene_id: str
) -> bool:
    """Idempotency: scribing for (character, scene) is one-shot. Re-sealing
    a scene won't duplicate memory rows."""
    existing = await session.scalar(
        select(WorldCharacterMemory.id)
        .where(
            WorldCharacterMemory.world_character_id == character_id,
            WorldCharacterMemory.source_scene_id == scene_id,
        )
        .limit(1)
    )
    return existing is not None


async def _slice_messages_for_character(
    session: AsyncSession,
    scene_id: str,
    member: WorldSceneMember,
) -> list[Message]:
    """Return the visible messages a character actually witnessed.

    Without an explicit entered_at_message_id the character was on stage from
    scene open; without an exited_at_message_id they're still there at seal.
    The bounds are inclusive of the participant.enter / .exit messages
    themselves so the scribe sees its own arrival/departure beat.
    """
    messages = list(
        (
            await session.scalars(
                select(Message)
                .where(
                    Message.room_id == scene_id,
                    Message.visibility_to_models.is_(True),
                )
                .order_by(Message.created_at)
            )
        ).all()
    )
    if member.entered_at_message_id is None and member.exited_at_message_id is None:
        return messages
    in_range: list[Message] = []
    started = member.entered_at_message_id is None
    for message in messages:
        if not started:
            if message.id == member.entered_at_message_id:
                started = True
            else:
                continue
        in_range.append(message)
        if member.exited_at_message_id and message.id == member.exited_at_message_id:
            break
    return in_range


async def _scribe_memory_for_character(
    session: AsyncSession,
    scene: Room,
    member: WorldSceneMember,
    character: WorldCharacter,
    peer_names: dict[str, str],
) -> int:
    """Run the LLM tool-call for a single character and persist its output.
    Returns the number of new memory rows created (0 if skipped/idempotent)."""
    if character.kind != "ai":
        return 0
    if await _scene_memory_already_written(session, character.id, scene.id):
        return 0
    witnessed = await _slice_messages_for_character(session, scene.id, member)
    if not witnessed:
        return 0
    existing = (
        await session.scalars(
            select(WorldCharacterMemory)
            .where(WorldCharacterMemory.world_character_id == character.id)
            .order_by(
                WorldCharacterMemory.salience.desc(),
                WorldCharacterMemory.scene_index_at_write.desc().nulls_last(),
            )
            .limit(20)
        )
    ).all()
    scribe = await get_room_system_persona(session, scene.id, "scribe")
    scribe, scribe_provider = await resolve_persona_runtime(session, scribe)
    peer_ids = [pid for pid in peer_names if pid != character.id]
    existing_relations = (
        await session.scalars(
            select(WorldCharacterRelation).where(
                WorldCharacterRelation.from_character_id == character.id,
                WorldCharacterRelation.to_character_id.in_(peer_ids),
            )
        )
    ).all() if peer_ids else []
    payload = {
        "scene": {
            "id": scene.id,
            "scene_index": scene.scene_index,
            "title": scene.title,
            "background": scene.background,
            "in_world_time_start": scene.in_world_time_start,
            "in_world_time_end": scene.in_world_time_end,
        },
        "character": {
            "id": character.id,
            "name": character.name,
            "identity": character.identity,
            "core_identity": character.core_identity,
            "goals_text": character.goals_text,
        },
        "peers_on_stage": [
            {"id": pid, "name": pname} for pid, pname in peer_names.items() if pid != character.id
        ],
        "existing_memories": [
            {"kind": m.kind, "content": m.content, "salience": m.salience} for m in existing
        ],
        "existing_relations": [
            {
                "about_character_id": r.to_character_id,
                "label": r.label,
                "sentiment": r.sentiment,
                "notes": r.notes,
            }
            for r in existing_relations
        ],
        "witnessed_messages": [message_to_tool_payload(m) for m in witnessed],
    }
    try:
        result = await llm_adapter.complete_tool(
            scribe,
            "scene_memory_distill",
            SCENE_MEMORY_TOOL_DESCRIPTION,
            MemoryDistillation,
            payload,
            api_provider=scribe_provider,
        )
    except Exception as exc:
        await trace_record(
            session,
            scene.id,
            "scene_memory_failed",
            "scene memory distill failed for character",
            {"character_id": character.id, "error": str(exc)},
        )
        return 0
    new_episodes = result.get("new_episodes") or []
    written = 0
    in_world_time = scene.in_world_time_start or scene.in_world_time_end or ""
    for entry in new_episodes:
        content = (entry.get("content") or "").strip()
        if not content:
            continue
        memory = WorldCharacterMemory(
            id=new_id(),
            world_character_id=character.id,
            source_scene_id=scene.id,
            scene_index_at_write=scene.scene_index,
            in_world_time_at_event=in_world_time,
            kind=entry.get("kind") or "episode",
            content=content,
            salience=float(entry.get("salience", 0.5)),
        )
        session.add(memory)
        written += 1
    impressions = result.get("impressions") or []
    relations_touched = await _apply_impressions(
        session, scene, character, impressions, peer_names
    )
    await trace_record(
        session,
        scene.id,
        "scene_memory_written",
        "scene memory rows persisted",
        {
            "character_id": character.id,
            "written": written,
            "relations_touched": relations_touched,
            "reasoning": result.get("reasoning"),
        },
    )
    return written


async def _apply_impressions(
    session: AsyncSession,
    scene: Room,
    character: WorldCharacter,
    impressions: list[dict[str, Any]],
    peer_names: dict[str, str],
) -> int:
    """Merge LLM-proposed impressions into per-pair WorldCharacterRelation rows.

    Sentiment_delta is added (clamped [-1, +1]). notes_append is appended with
    a scene marker so the running notes stay readable. Cards targeting a
    character not present on stage are dropped — the model occasionally
    references off-stage characters and we don't want stray rows."""
    if not impressions:
        return 0
    touched = 0
    for entry in impressions:
        target_id = entry.get("about_character_id")
        if not target_id or target_id == character.id:
            continue
        if target_id not in peer_names:
            # Off-stage reference — skip rather than create a stale row.
            continue
        delta = float(entry.get("sentiment_delta") or 0.0)
        new_label = entry.get("label")
        notes_append = (entry.get("notes_append") or "").strip()
        relation = await session.scalar(
            select(WorldCharacterRelation).where(
                WorldCharacterRelation.from_character_id == character.id,
                WorldCharacterRelation.to_character_id == target_id,
            )
        )
        if relation is None:
            relation = WorldCharacterRelation(
                id=new_id(),
                from_character_id=character.id,
                to_character_id=target_id,
                label=(new_label or "").strip(),
                sentiment=max(-1.0, min(1.0, delta)),
                notes="",
                last_updated_scene_id=scene.id,
            )
            session.add(relation)
        else:
            relation.sentiment = max(-1.0, min(1.0, relation.sentiment + delta))
            if new_label:
                relation.label = new_label.strip()
            relation.last_updated_scene_id = scene.id
        if notes_append:
            scene_tag = (
                f"第{scene.scene_index}幕" if scene.scene_index is not None else "本幕"
            )
            existing = (relation.notes or "").rstrip()
            new_block = f"[{scene_tag}] {notes_append}"
            relation.notes = f"{existing}\n{new_block}".lstrip("\n")
        touched += 1
    return touched


async def run_scene_memory_scribe(session: AsyncSession, scene: Room) -> dict[str, int]:
    """Scribe the scene per AI character, in parallel.

    Returns a {character_id: rows_written} dict for telemetry. Rooms that
    aren't scenes (world_id IS NULL) are no-ops.
    """
    if scene.world_id is None:
        return {}
    members = list(
        (
            await session.scalars(
                select(WorldSceneMember).where(WorldSceneMember.scene_id == scene.id)
            )
        ).all()
    )
    if not members:
        return {}
    char_ids = [m.world_character_id for m in members]
    characters = {
        c.id: c
        for c in (
            await session.scalars(
                select(WorldCharacter).where(WorldCharacter.id.in_(char_ids))
            )
        ).all()
    }
    peer_names = {c.id: c.name for c in characters.values()}
    ai_pairs = [
        (m, characters[m.world_character_id])
        for m in members
        if m.world_character_id in characters and characters[m.world_character_id].kind == "ai"
    ]
    # Run sequentially — concurrent SQLAlchemy session use isn't safe and
    # parallel LLM calls would each need their own session. v2 can spawn
    # background tasks with separate sessions if latency becomes an issue.
    results: dict[str, int] = {}
    for member, character in ai_pairs:
        results[character.id] = await _scribe_memory_for_character(
            session, scene, member, character, peer_names
        )
    await session.flush()
    return results


# --- Memory decay + cap (PR 5) ------------------------------------------

# Memories whose last_used_scene_index is older than this window decay.
# Backstory rows (kind=backstory) are sacred — the user wrote them and we
# never touch their salience automatically.
MEMORY_DECAY_GRACE_SCENES = 3
MEMORY_DECAY_FACTOR = 0.95
# Per-character hard cap. Over this we drop the lowest-salience rows. v1 is
# a hard drop (oldest-first on tie); LLM-summarisation into a single fact
# row is a v2 enhancement.
MEMORY_PER_CHARACTER_CAP = 200


async def decay_unused_memories(
    session: AsyncSession, scene: Room
) -> dict[str, int]:
    """Multiply salience of stale memories by MEMORY_DECAY_FACTOR.

    A memory is "stale" if either it has never been used (last_used_scene_index
    IS NULL) AND it was written more than MEMORY_DECAY_GRACE_SCENES ago, OR it
    has been used but not within the grace window of the current scene_index.
    Backstory rows are exempt — they're authored content, not LLM output.

    Runs at scene seal so decay is bounded (one pass per scene, deterministic).
    Returns {character_id: rows_decayed}.
    """
    if scene.world_id is None or scene.scene_index is None:
        return {}
    threshold_index = scene.scene_index - MEMORY_DECAY_GRACE_SCENES
    # Limit to characters in this world (rather than the entire DB).
    char_ids = list(
        (
            await session.scalars(
                select(WorldCharacter.id).where(WorldCharacter.world_id == scene.world_id)
            )
        ).all()
    )
    if not char_ids:
        return {}
    rows = list(
        (
            await session.scalars(
                select(WorldCharacterMemory).where(
                    WorldCharacterMemory.world_character_id.in_(char_ids),
                    WorldCharacterMemory.kind != "backstory",
                )
            )
        ).all()
    )
    decayed: dict[str, int] = {}
    for row in rows:
        # Was it written before the grace window?
        wrote_idx = row.scene_index_at_write
        if wrote_idx is not None and wrote_idx > threshold_index:
            continue
        used_idx = row.last_used_scene_index
        if used_idx is not None and used_idx > threshold_index:
            continue
        new_salience = row.salience * MEMORY_DECAY_FACTOR
        # Don't decay below 0.0 (nor below 1e-3 to avoid tiny noise rows).
        row.salience = max(0.0, new_salience)
        decayed[row.world_character_id] = decayed.get(row.world_character_id, 0) + 1
    if decayed:
        await session.flush()
    return decayed


async def enforce_memory_cap(
    session: AsyncSession, scene: Room
) -> dict[str, int]:
    """Drop the lowest-salience memories per character above MEMORY_PER_CHARACTER_CAP.

    Tie-broken by oldest scene_index_at_write (then created_at). Backstory rows
    are protected — they don't count toward the cap and are never dropped.
    Returns {character_id: rows_dropped}.

    v1 is a hard drop. The design doc envisions LLM-summarising the bottom K
    into a single `kind=fact` row to preserve semantics; that's v2 because
    summarisation drift is hard to debug and the cap mostly bounds memory
    bloat in long-running worlds rather than something users will hit fast.
    """
    if scene.world_id is None:
        return {}
    char_ids = list(
        (
            await session.scalars(
                select(WorldCharacter.id).where(WorldCharacter.world_id == scene.world_id)
            )
        ).all()
    )
    dropped: dict[str, int] = {}
    for character_id in char_ids:
        # Only count non-backstory rows toward the cap.
        non_backstory_count = await session.scalar(
            select(func.count(WorldCharacterMemory.id)).where(
                WorldCharacterMemory.world_character_id == character_id,
                WorldCharacterMemory.kind != "backstory",
            )
        )
        non_backstory_count = int(non_backstory_count or 0)
        if non_backstory_count <= MEMORY_PER_CHARACTER_CAP:
            continue
        excess = non_backstory_count - MEMORY_PER_CHARACTER_CAP
        # Drop the worst `excess` rows (lowest salience, then oldest scene).
        victims = list(
            (
                await session.scalars(
                    select(WorldCharacterMemory)
                    .where(
                        WorldCharacterMemory.world_character_id == character_id,
                        WorldCharacterMemory.kind != "backstory",
                    )
                    .order_by(
                        WorldCharacterMemory.salience.asc(),
                        WorldCharacterMemory.scene_index_at_write.asc().nulls_first(),
                        WorldCharacterMemory.created_at.asc(),
                    )
                    .limit(excess)
                )
            ).all()
        )
        for victim in victims:
            await session.delete(victim)
        dropped[character_id] = len(victims)
    if dropped:
        await session.flush()
    return dropped


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
    context_window = int(config.get("context_window_messages", 50))
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
    facilitator_provider = None
    facilitator, facilitator_provider = await resolve_persona_runtime(session, facilitator)
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
        api_provider=facilitator_provider,
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
        extra = max(0, int(runtime.phase_extra_rounds or 0))
        phase_turn_budget = max(1, len(allowed)) * (runtime.max_phase_rounds + extra)
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
    extra = max(0, int(runtime.phase_extra_rounds or 0))
    if runtime.max_phase_rounds:
        effective_limit = runtime.max_phase_rounds + extra
        if sum(counts.values()) >= max(1, len(allowed)) * effective_limit:
            matched.append({"type": "phase_round_limit", "max": effective_limit})
    for condition in template.exit_conditions or []:
        ctype = condition.get("type")
        if ctype == "user_manual":
            continue
        if ctype == "rounds":
            n = int(condition.get("n", 1)) + extra
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


async def extend_current_phase(session: AsyncSession, room_id: str) -> int:
    """Add one more round to the current phase's `rounds`/`phase_round_limit` budgets.

    Clears any pending exit suggestion so the user can keep going past the
    threshold. Returns the new `phase_extra_rounds` value for telemetry.
    """
    runtime = await session.get(RoomRuntimeState, room_id)
    if runtime is None:
        raise ValueError("runtime not found")
    runtime.phase_extra_rounds = int(runtime.phase_extra_rounds or 0) + 1
    runtime.phase_exit_suggested = False
    runtime.phase_exit_matched_conditions = []
    runtime.phase_exit_suppressed_after_message_id = None
    await trace_record(
        session,
        room_id,
        "phase_transition",
        "phase extended by one round",
        {"phase_extra_rounds": runtime.phase_extra_rounds},
    )
    await event_bus.publish(
        room_id,
        {"type": "phase.extended", "phase_extra_rounds": runtime.phase_extra_rounds},
    )
    return runtime.phase_extra_rounds


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
        runtime.consecutive_ai_turns = 0
        runtime.phase_extra_rounds = 0
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
    runtime.consecutive_ai_turns = 0
    runtime.phase_extra_rounds = 0
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
            message_type="dead_end",
            author_actual="user_as_judge",
            visibility="public",
            visibility_to_models=True,
            content=content,
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


_SEVERITY_RANK = {"info": 0, "suggest": 1, "warning": 2, "block": 3}


def filter_facilitator_signals(
    signals: list[dict[str, Any]],
    previous: list[FacilitatorSignal],
    config: dict[str, Any],
    force: bool,
) -> list[dict[str, Any]]:
    """Suppress repeats unless the candidate severity escalates past the prior peak.

    The dedupe key is `(tag, severity)`. A signal is allowed through when either
    its tag has not appeared in `previous`, or its severity rank is strictly
    higher than the highest severity previously emitted for that tag — that's
    the `info → suggest → warning → block` escalation channel. `force=True`
    (manual ask) skips suppression entirely.
    """
    enabled_tags = set(config.get("enabled_signal_tags") or [])
    filtered = [signal for signal in signals if not enabled_tags or signal.get("tag") in enabled_tags]
    if force:
        return filtered
    prev_max_rank: dict[str, int] = {}
    for item in previous:
        for signal in item.signals or []:
            tag = signal.get("tag")
            if not tag:
                continue
            rank = _SEVERITY_RANK.get(signal.get("severity") or "info", 0)
            if rank > prev_max_rank.get(tag, -1):
                prev_max_rank[tag] = rank
    result: list[dict[str, Any]] = []
    for signal in filtered:
        tag = signal.get("tag")
        if not tag:
            result.append(signal)
            continue
        candidate_rank = _SEVERITY_RANK.get(signal.get("severity") or "info", 0)
        prior = prev_max_rank.get(tag)
        if prior is None or candidate_rank > prior:
            result.append(signal)
    return result


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
        "user_masquerade_name": message.user_masquerade_name,
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
