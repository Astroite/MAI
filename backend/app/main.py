from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pypdf import PdfReader
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .db import create_schema, get_session
from .engine import (
    DEFAULT_SCRIBE_STATE,
    after_message_appended,
    append_verdict,
    continue_current_phase,
    freeze_room,
    run_manual_facilitator_eval,
    run_room_turn,
    transition_to_next_phase,
    unfreeze_room,
)
from .event_bus import event_bus
from .ids import new_id
from .models import (
    DebateFormat,
    Decision,
    FacilitatorSignal,
    Message,
    MergeBack,
    Persona,
    PhaseTemplate,
    Recipe,
    Room,
    RoomPersona,
    RoomPhaseInstance,
    RoomPhasePlan,
    RoomRuntimeState,
    ScribeState,
    Upload,
    now_utc,
)
from .schemas import (
    AddPersonasRequest,
    DebateFormatOut,
    DecisionLockUpdate,
    DecisionOut,
    FacilitatorSignalOut,
    FromUploadRequest,
    InsertPhaseRequest,
    LimitUpdate,
    MasqueradeCreate,
    MergeBackCreate,
    MessageCreate,
    MessageOut,
    PersonaCreate,
    PersonaOut,
    PhaseTemplateCreate,
    PhaseTemplateOut,
    PhaseTransitionRequest,
    RecipeCreate,
    RecipeOut,
    RoomCreate,
    RoomOut,
    RoomPhaseInstanceOut,
    RoomPhasePlanOut,
    RoomRuntimeOut,
    RoomState,
    ScribeStateOut,
    TurnRequest,
    UploadOut,
    VerdictCreate,
)
from .seed import seed_builtins
from .trace import trace_record


settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_schema()
    async for session in get_session():
        await seed_builtins(session)
    settings.trace_payload_dir.mkdir(parents=True, exist_ok=True)
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    yield
    from .db import engine

    await engine.dispose()


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health(session: AsyncSession = Depends(get_session)) -> dict:
    await session.scalar(select(func.count(Persona.id)))
    return {"status": "ok", "database": "ok", "mock_llm": settings.mock_llm}


@app.get("/templates/personas", response_model=list[PersonaOut])
async def list_personas(kind: str | None = None, session: AsyncSession = Depends(get_session)):
    stmt = select(Persona).order_by(Persona.is_builtin.desc(), Persona.name)
    if kind:
        stmt = stmt.where(Persona.kind == kind)
    return (await session.scalars(stmt)).all()


@app.post("/templates/personas", response_model=PersonaOut)
async def create_persona(body: PersonaCreate, session: AsyncSession = Depends(get_session)):
    persona = Persona(
        id=new_id(),
        version=1,
        schema_version=1,
        status="published",
        is_builtin=False,
        **body.model_dump(),
    )
    session.add(persona)
    await session.commit()
    await session.refresh(persona)
    return persona


@app.get("/templates/phases", response_model=list[PhaseTemplateOut])
async def list_phases(session: AsyncSession = Depends(get_session)):
    return (await session.scalars(select(PhaseTemplate).order_by(PhaseTemplate.is_builtin.desc(), PhaseTemplate.name))).all()


@app.post("/templates/phases", response_model=PhaseTemplateOut)
async def create_phase(body: PhaseTemplateCreate, session: AsyncSession = Depends(get_session)):
    phase = PhaseTemplate(
        id=new_id(),
        version=1,
        schema_version=1,
        status="published",
        is_builtin=False,
        **body.model_dump(mode="json"),
    )
    session.add(phase)
    await session.commit()
    await session.refresh(phase)
    return phase


@app.get("/templates/phases/{phase_id}", response_model=PhaseTemplateOut)
async def get_phase(phase_id: str, session: AsyncSession = Depends(get_session)):
    phase = await session.get(PhaseTemplate, phase_id)
    if not phase:
        raise HTTPException(404, "phase not found")
    return phase


@app.get("/templates/phases/{phase_id}/export")
async def export_phase(phase_id: str, session: AsyncSession = Depends(get_session)):
    phase = await session.get(PhaseTemplate, phase_id)
    if not phase:
        raise HTTPException(404, "phase not found")
    payload = PhaseTemplateOut.model_validate(phase).model_dump(mode="json", exclude={"owner_user_id"})
    return JSONResponse(
        payload,
        headers={"Content-Disposition": f'attachment; filename="{phase.name}.phase.json"'},
    )


@app.get("/templates/formats", response_model=list[DebateFormatOut])
async def list_formats(session: AsyncSession = Depends(get_session)):
    return (await session.scalars(select(DebateFormat).order_by(DebateFormat.is_builtin.desc(), DebateFormat.name))).all()


@app.get("/templates/recipes", response_model=list[RecipeOut])
async def list_recipes(session: AsyncSession = Depends(get_session)):
    return (await session.scalars(select(Recipe).order_by(Recipe.is_builtin.desc(), Recipe.name))).all()


@app.post("/templates/recipes", response_model=RecipeOut)
async def create_recipe(body: RecipeCreate, session: AsyncSession = Depends(get_session)):
    recipe = Recipe(
        id=new_id(),
        version=1,
        schema_version=1,
        status="published",
        is_builtin=False,
        **body.model_dump(mode="json"),
    )
    session.add(recipe)
    await session.commit()
    await session.refresh(recipe)
    return recipe


@app.get("/templates/recipes/{recipe_id}/export")
async def export_recipe(recipe_id: str, session: AsyncSession = Depends(get_session)):
    recipe = await session.get(Recipe, recipe_id)
    if not recipe:
        raise HTTPException(404, "recipe not found")
    payload = RecipeOut.model_validate(recipe).model_dump(mode="json", exclude={"owner_user_id"})
    return JSONResponse(
        payload,
        headers={"Content-Disposition": f'attachment; filename="{recipe.name}.recipe.json"'},
    )


@app.get("/rooms", response_model=list[RoomOut])
async def list_rooms(session: AsyncSession = Depends(get_session)):
    return (await session.scalars(select(Room).order_by(Room.created_at.desc()))).all()


@app.post("/rooms", response_model=RoomState)
async def create_room(body: RoomCreate, session: AsyncSession = Depends(get_session)):
    selected_recipe = await _select_recipe(session, body.recipe_id)
    selected_format = await _select_format(session, body.format_id or (selected_recipe.format_id if selected_recipe else None))
    persona_ids = body.persona_ids or (selected_recipe.persona_ids if selected_recipe else []) or await _default_discussant_ids(session)
    system_ids = await _system_persona_ids(session)

    room = Room(
        id=new_id(),
        parent_room_id=body.parent_room_id,
        title=body.title,
        recipe_id=selected_recipe.id if selected_recipe else None,
        format_id=selected_format.id if selected_format else None,
        format_version=selected_format.version if selected_format else None,
        status="active",
    )
    session.add(room)
    await session.flush()

    settings_payload = selected_recipe.initial_settings if selected_recipe else {}
    runtime = RoomRuntimeState(
        room_id=room.id,
        max_message_tokens=settings_payload.get("max_message_tokens", 900),
        max_room_tokens=settings_payload.get("max_room_tokens", 120000),
        auto_transition=settings_payload.get("auto_transition", False),
    )
    scribe = ScribeState(room_id=room.id, current_state=DEFAULT_SCRIBE_STATE.copy())
    session.add_all([runtime, scribe])
    for persona_id in dict.fromkeys(persona_ids + system_ids):
        session.add(RoomPersona(room_id=room.id, persona_id=persona_id))

    phase_sequence = selected_format.phase_sequence if selected_format else []
    if not phase_sequence:
        open_phase = await session.scalar(select(PhaseTemplate).where(PhaseTemplate.name == "自由模式"))
        phase_sequence = [{"phase_template_id": open_phase.id, "phase_template_version": 1, "transitions": []}]
    for index, slot in enumerate(phase_sequence):
        session.add(
            RoomPhasePlan(
                room_id=room.id,
                position=index,
                phase_template_id=slot["phase_template_id"],
                phase_template_version=slot.get("phase_template_version", 1),
                source="format",
                variable_bindings={},
            )
        )
    await session.flush()
    await transition_to_next_phase(session, room.id, target_position=0)
    await trace_record(session, room.id, "state_mutation", "room created", {"format_id": room.format_id, "recipe_id": room.recipe_id})
    await session.commit()
    return await _room_state(session, room.id)


@app.get("/rooms/{room_id}/state", response_model=RoomState)
async def get_room_state(room_id: str, session: AsyncSession = Depends(get_session)):
    return await _room_state(session, room_id)


@app.post("/rooms/{room_id}/personas", response_model=RoomState)
async def add_room_personas(room_id: str, body: AddPersonasRequest, session: AsyncSession = Depends(get_session)):
    room = await session.get(Room, room_id)
    if not room:
        raise HTTPException(404, "room not found")
    existing = set(
        (
            await session.scalars(select(RoomPersona.persona_id).where(RoomPersona.room_id == room_id))
        ).all()
    )
    for persona_id in body.persona_ids:
        if persona_id not in existing:
            session.add(RoomPersona(room_id=room_id, persona_id=persona_id))
    await trace_record(session, room_id, "state_mutation", "personas added", {"persona_ids": body.persona_ids})
    await session.commit()
    return await _room_state(session, room_id)


@app.post("/rooms/{room_id}/messages", response_model=MessageOut)
async def append_user_message(room_id: str, body: MessageCreate, session: AsyncSession = Depends(get_session)):
    runtime = await _runtime_or_404(session, room_id)
    _ensure_not_frozen(runtime)
    message = Message(
        room_id=room_id,
        phase_instance_id=runtime.current_phase_instance_id,
        parent_message_id=body.parent_message_id,
        message_type=body.message_type,
        author_actual="user",
        visibility="public",
        visibility_to_models=True,
        content=body.content,
        completion_tokens=max(1, len(body.content) // 4),
        cost_usd=0,
    )
    runtime.token_counter_total += message.completion_tokens or 0
    session.add(message)
    await session.flush()
    await trace_record(session, room_id, "user_action", "user message appended", {"message_id": message.id})
    await session.commit()
    await event_bus.publish(room_id, {"type": "message.appended", "message": MessageOut.model_validate(message).model_dump(mode="json")})
    await after_message_appended(session, room_id, message)
    return message


@app.post("/rooms/{room_id}/verdicts", response_model=MessageOut)
async def create_verdict(room_id: str, body: VerdictCreate, session: AsyncSession = Depends(get_session)):
    message = await append_verdict(session, room_id, body.content, body.is_locked, body.dead_end, body.revoke_message_id)
    await session.commit()
    return message


@app.patch("/rooms/{room_id}/decisions/{decision_id}", response_model=DecisionOut)
async def update_decision_lock(
    room_id: str,
    decision_id: str,
    body: DecisionLockUpdate,
    session: AsyncSession = Depends(get_session),
):
    runtime = await _runtime_or_404(session, room_id)
    _ensure_not_frozen(runtime)
    decision = await session.get(Decision, decision_id)
    if not decision or decision.room_id != room_id:
        raise HTTPException(404, "decision not found")
    if decision.revoked_by_message_id:
        raise HTTPException(409, "decision already revoked")
    if decision.is_locked == body.is_locked:
        return decision
    audit = Message(
        room_id=room_id,
        phase_instance_id=runtime.current_phase_instance_id,
        parent_message_id=decision.scribe_event_message_id,
        message_type="meta",
        author_actual="user_as_judge",
        visibility="public",
        visibility_to_models=True,
        content=("锁定决议：" if body.is_locked else "解锁决议：") + decision.content,
    )
    session.add(audit)
    await session.flush()
    decision.is_locked = body.is_locked
    decision.locked_by_message_id = audit.id if body.is_locked else None
    await trace_record(
        session,
        room_id,
        "user_action",
        "decision lock toggled",
        {"decision_id": decision_id, "is_locked": body.is_locked, "audit_message_id": audit.id},
    )
    await session.commit()
    await session.refresh(decision)
    await event_bus.publish(
        room_id,
        {"type": "message.appended", "message": MessageOut.model_validate(audit).model_dump(mode="json")},
    )
    return decision


@app.post("/rooms/{room_id}/masquerade", response_model=MessageOut)
async def create_masquerade(room_id: str, body: MasqueradeCreate, session: AsyncSession = Depends(get_session)):
    runtime = await _runtime_or_404(session, room_id)
    _ensure_not_frozen(runtime)
    persona = await session.get(Persona, body.persona_id)
    if not persona or persona.kind != "discussant":
        raise HTTPException(400, "masquerade persona must be a discussant")
    message = Message(
        room_id=room_id,
        phase_instance_id=runtime.current_phase_instance_id,
        message_type=body.message_type,
        author_persona_id=persona.id,
        author_model=persona.backing_model,
        author_actual="user_as_persona",
        user_masquerade_persona_id=persona.id,
        visibility="public",
        visibility_to_models=True,
        content=body.content,
        completion_tokens=max(1, len(body.content) // 4),
        cost_usd=0,
    )
    runtime.token_counter_total += message.completion_tokens or 0
    session.add(message)
    await session.flush()
    await trace_record(session, room_id, "masquerade_message_submitted", "masquerade submitted", {"message_id": message.id})
    await session.commit()
    await event_bus.publish(room_id, {"type": "message.appended", "message": MessageOut.model_validate(message).model_dump(mode="json")})
    await after_message_appended(session, room_id, message)
    return message


@app.post("/rooms/{room_id}/messages/{message_id}/reveal", response_model=MessageOut)
async def reveal_masquerade(room_id: str, message_id: str, session: AsyncSession = Depends(get_session)):
    message = await session.get(Message, message_id)
    if not message or message.room_id != room_id:
        raise HTTPException(404, "message not found")
    if message.author_actual != "user_as_persona":
        raise HTTPException(400, "message is not a masquerade")
    message.user_revealed_at = now_utc()
    await trace_record(session, room_id, "masquerade_revealed", "masquerade revealed", {"message_id": message_id})
    await session.commit()
    return message


@app.post("/rooms/{room_id}/turn", response_model=list[MessageOut])
async def run_turn(room_id: str, body: TurnRequest, session: AsyncSession = Depends(get_session)):
    runtime = await _runtime_or_404(session, room_id)
    _ensure_not_frozen(runtime)
    try:
        messages = await run_room_turn(session, room_id, body.speaker_persona_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return messages


@app.post("/rooms/{room_id}/phase/next", response_model=RoomState)
async def next_phase(room_id: str, body: PhaseTransitionRequest, session: AsyncSession = Depends(get_session)):
    runtime = await _runtime_or_404(session, room_id)
    _ensure_not_frozen(runtime)
    await transition_to_next_phase(session, room_id, body.target_position)
    await session.commit()
    return await _room_state(session, room_id)


@app.post("/rooms/{room_id}/phase/continue", response_model=RoomState)
async def continue_phase(room_id: str, session: AsyncSession = Depends(get_session)):
    runtime = await _runtime_or_404(session, room_id)
    _ensure_not_frozen(runtime)
    await continue_current_phase(session, room_id)
    await session.commit()
    return await _room_state(session, room_id)


@app.post("/rooms/{room_id}/facilitator", response_model=RoomState)
async def ask_facilitator(room_id: str, session: AsyncSession = Depends(get_session)):
    runtime = await _runtime_or_404(session, room_id)
    _ensure_not_frozen(runtime)
    try:
        await run_manual_facilitator_eval(session, room_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    await session.commit()
    return await _room_state(session, room_id)


@app.post("/rooms/{room_id}/phase/insert", response_model=RoomState)
async def insert_phase(room_id: str, body: InsertPhaseRequest, session: AsyncSession = Depends(get_session)):
    runtime = await _runtime_or_404(session, room_id)
    _ensure_not_frozen(runtime)
    phase = await session.get(PhaseTemplate, body.phase_template_id)
    if not phase:
        raise HTTPException(404, "phase not found")
    current = await session.get(RoomPhaseInstance, runtime.current_phase_instance_id) if runtime.current_phase_instance_id else None
    insert_at = (body.after_position + 1) if body.after_position is not None else ((current.plan_position + 1) if current else 0)
    rows = (
        await session.scalars(
            select(RoomPhasePlan)
            .where(RoomPhasePlan.room_id == room_id, RoomPhasePlan.position >= insert_at)
            .order_by(RoomPhasePlan.position.desc())
        )
    ).all()
    for row in rows:
        row.position += 1
    await session.flush()
    session.add(
        RoomPhasePlan(
            room_id=room_id,
            position=insert_at,
            phase_template_id=phase.id,
            phase_template_version=phase.version,
            source="user_inserted",
            variable_bindings=body.variable_bindings,
        )
    )
    await trace_record(session, room_id, "phase_transition", "phase inserted", {"position": insert_at, "phase_template_id": phase.id})
    await session.commit()
    return await _room_state(session, room_id)


@app.patch("/rooms/{room_id}/limits", response_model=RoomRuntimeOut)
async def update_limits(room_id: str, body: LimitUpdate, session: AsyncSession = Depends(get_session)):
    runtime = await _runtime_or_404(session, room_id)
    if body.max_message_tokens is not None:
        runtime.max_message_tokens = body.max_message_tokens
    if body.max_room_tokens is not None:
        runtime.max_room_tokens = body.max_room_tokens
    if body.auto_transition is not None:
        runtime.auto_transition = body.auto_transition
    await trace_record(session, room_id, "user_action", "limits updated", body.model_dump(exclude_none=True))
    await session.commit()
    await session.refresh(runtime)
    return runtime


@app.post("/rooms/{room_id}/freeze", response_model=RoomState)
async def freeze(room_id: str, session: AsyncSession = Depends(get_session)):
    await freeze_room(session, room_id)
    await session.commit()
    return await _room_state(session, room_id)


@app.post("/rooms/{room_id}/unfreeze", response_model=RoomState)
async def unfreeze(room_id: str, session: AsyncSession = Depends(get_session)):
    await unfreeze_room(session, room_id)
    await session.commit()
    return await _room_state(session, room_id)


@app.get("/rooms/{room_id}/events")
async def room_events(room_id: str):
    return StreamingResponse(event_bus.subscribe(room_id), media_type="text/event-stream")


@app.post("/upload", response_model=UploadOut)
async def upload_file(room_id: str | None = None, file: UploadFile = File(...), session: AsyncSession = Depends(get_session)):
    suffix = Path(file.filename or "upload").suffix.lower()
    raw = await file.read()
    if suffix not in {".md", ".txt", ".pdf"}:
        raise HTTPException(400, "only MD, TXT, and PDF uploads are supported")
    storage_dir = settings.upload_dir / (room_id or "global")
    storage_dir.mkdir(parents=True, exist_ok=True)
    upload_id = new_id()
    storage_path = storage_dir / f"{upload_id}{suffix}"
    storage_path.write_bytes(raw)
    extracted = _extract_text(storage_path, suffix, raw)
    upload = Upload(
        id=upload_id,
        room_id=room_id,
        filename=file.filename or storage_path.name,
        content_type=file.content_type or "application/octet-stream",
        extracted_text=extracted,
        storage_path=str(storage_path),
    )
    session.add(upload)
    await session.commit()
    await session.refresh(upload)
    return upload


@app.post("/rooms/{room_id}/messages/from_upload", response_model=MessageOut)
async def message_from_upload(room_id: str, body: FromUploadRequest, session: AsyncSession = Depends(get_session)):
    runtime = await _runtime_or_404(session, room_id)
    _ensure_not_frozen(runtime)
    upload = await session.get(Upload, body.upload_id)
    if not upload:
        raise HTTPException(404, "upload not found")
    message = Message(
        room_id=room_id,
        phase_instance_id=runtime.current_phase_instance_id,
        message_type="user_doc",
        author_actual="user",
        visibility="public",
        visibility_to_models=True,
        content=f"# {upload.filename}\n\n{upload.extracted_text}",
        completion_tokens=max(1, len(upload.extracted_text) // 4),
        cost_usd=0,
    )
    session.add(message)
    await session.flush()
    await trace_record(session, room_id, "user_action", "upload appended", {"upload_id": upload.id, "message_id": message.id})
    await session.commit()
    await event_bus.publish(room_id, {"type": "message.appended", "message": MessageOut.model_validate(message).model_dump(mode="json")})
    await after_message_appended(session, room_id, message)
    return message


@app.post("/rooms/{room_id}/subrooms", response_model=RoomState)
async def create_subroom(room_id: str, body: RoomCreate, session: AsyncSession = Depends(get_session)):
    body.parent_room_id = room_id
    return await create_room(body, session)


@app.post("/rooms/{room_id}/merge_back")
async def merge_back(room_id: str, body: MergeBackCreate, session: AsyncSession = Depends(get_session)):
    sub_room = await session.get(Room, room_id)
    if not sub_room or not sub_room.parent_room_id:
        raise HTTPException(400, "room is not a sub-room")
    merge = MergeBack(
        parent_room_id=sub_room.parent_room_id,
        sub_room_id=room_id,
        conclusion=body.conclusion,
        key_reasoning=body.key_reasoning[:3],
        rejected_alternatives=body.rejected_alternatives,
        unresolved=body.unresolved,
        artifacts_ref=body.artifacts_ref,
        full_transcript_ref=f"/rooms/{room_id}/state",
    )
    session.add(merge)
    parent_runtime = await session.get(RoomRuntimeState, sub_room.parent_room_id)
    session.add(
        Message(
            room_id=sub_room.parent_room_id,
            phase_instance_id=parent_runtime.current_phase_instance_id if parent_runtime else None,
            message_type="summary",
            author_actual="system",
            visibility="public",
            visibility_to_models=True,
            content=(
                f"子讨论合并结论：{body.conclusion}\n\n"
                + "\n".join(f"- {item}" for item in body.key_reasoning[:3])
            ),
        )
    )
    await trace_record(session, sub_room.parent_room_id, "state_mutation", "sub-room merged", {"sub_room_id": room_id})
    await session.commit()
    return {"status": "ok", "merge_back_id": merge.id}


async def _select_format(session: AsyncSession, format_id: str | None) -> DebateFormat | None:
    if format_id:
        item = await session.get(DebateFormat, format_id)
        if not item:
            raise HTTPException(404, "format not found")
        return item
    return await session.scalar(select(DebateFormat).where(DebateFormat.name == "自由模式"))


async def _select_recipe(session: AsyncSession, recipe_id: str | None) -> Recipe | None:
    if not recipe_id:
        return None
    item = await session.get(Recipe, recipe_id)
    if not item:
        raise HTTPException(404, "recipe not found")
    return item


async def _default_discussant_ids(session: AsyncSession) -> list[str]:
    rows = (
        await session.scalars(
            select(Persona.id)
            .where(Persona.kind == "discussant", Persona.name.in_(["架构师", "性能批评者", "维护者", "反方律师"]))
            .order_by(Persona.name)
        )
    ).all()
    return list(rows)


async def _system_persona_ids(session: AsyncSession) -> list[str]:
    return list((await session.scalars(select(Persona.id).where(Persona.kind.in_(["scribe", "facilitator"])))).all())


async def _room_state(session: AsyncSession, room_id: str) -> RoomState:
    room = await session.get(Room, room_id)
    runtime = await session.get(RoomRuntimeState, room_id)
    if not room or not runtime:
        raise HTTPException(404, "room not found")
    personas = (
        await session.scalars(
            select(Persona)
            .join(RoomPersona, RoomPersona.persona_id == Persona.id)
            .where(RoomPersona.room_id == room_id)
            .order_by(Persona.kind, Persona.name)
        )
    ).all()
    phase_plan = (
        await session.scalars(select(RoomPhasePlan).where(RoomPhasePlan.room_id == room_id).order_by(RoomPhasePlan.position))
    ).all()
    current_phase = await session.get(RoomPhaseInstance, runtime.current_phase_instance_id) if runtime.current_phase_instance_id else None
    messages = (
        await session.scalars(select(Message).where(Message.room_id == room_id).order_by(Message.created_at))
    ).all()
    scribe_state = await session.get(ScribeState, room_id)
    if scribe_state is None:
        scribe_state = ScribeState(room_id=room_id, current_state=DEFAULT_SCRIBE_STATE.copy())
        session.add(scribe_state)
        await session.flush()
    signals = (
        await session.scalars(
            select(FacilitatorSignal).where(FacilitatorSignal.room_id == room_id).order_by(FacilitatorSignal.created_at.desc()).limit(20)
        )
    ).all()
    decisions = (
        await session.scalars(select(Decision).where(Decision.room_id == room_id).order_by(Decision.created_at))
    ).all()
    return RoomState(
        room=RoomOut.model_validate(room),
        runtime=RoomRuntimeOut.model_validate(runtime),
        personas=[PersonaOut.model_validate(p) for p in personas],
        phase_plan=[RoomPhasePlanOut.model_validate(p) for p in phase_plan],
        current_phase=RoomPhaseInstanceOut.model_validate(current_phase) if current_phase else None,
        messages=[MessageOut.model_validate(m) for m in messages],
        scribe_state=ScribeStateOut.model_validate(scribe_state),
        facilitator_signals=[FacilitatorSignalOut.model_validate(s) for s in signals],
        decisions=[DecisionOut.model_validate(d) for d in decisions],
    )


async def _runtime_or_404(session: AsyncSession, room_id: str) -> RoomRuntimeState:
    runtime = await session.get(RoomRuntimeState, room_id)
    if not runtime:
        raise HTTPException(404, "room not found")
    return runtime


def _ensure_not_frozen(runtime: RoomRuntimeState) -> None:
    if runtime.frozen:
        raise HTTPException(409, "room is frozen")


def _extract_text(path: Path, suffix: str, raw: bytes) -> str:
    if suffix == ".pdf":
        reader = PdfReader(str(path))
        return "\n\n".join(page.extract_text() or "" for page in reader.pages).strip()
    return raw.decode("utf-8", errors="replace")
