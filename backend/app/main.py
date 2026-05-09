import asyncio
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from contextlib import asynccontextmanager
from types import SimpleNamespace

logger = logging.getLogger(__name__)

import httpx
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pypdf import PdfReader
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import get_settings
from .db import create_schema, get_session
from .engine import (
    DEFAULT_SCRIBE_STATE,
    active_calls_for_room,
    after_message_appended,
    append_verdict,
    continue_current_phase,
    estimate_tokens,
    extend_current_phase,
    freeze_room,
    is_autodrive_active,
    run_manual_facilitator_eval,
    run_room_turn,
    schedule_autodrive,
    transition_to_next_phase,
    unfreeze_room,
)
from .event_bus import event_bus
from .exporter import build_content_disposition, render_room_markdown
from .ids import builtin_id, new_id
from .models import (
    ApiProvider,
    ApiModel,
    AppSettings,
    DebateFormat,
    Decision,
    FacilitatorSignal,
    Message,
    MergeBack,
    PersonaInstance,
    PersonaTemplate,
    PhaseTemplate,
    Recipe,
    Room,
    RoomPhaseInstance,
    RoomPhasePlan,
    RoomRuntimeState,
    ScribeState,
    ToolInvocation,
    ToolServer,
    Upload,
    World,
    WorldCharacter,
    WorldSceneMember,
)
from .schemas import (
    AddPersonaInstancesRequest,
    ApiModelCreate,
    ApiModelOut,
    ApiModelUpdate,
    ApiProviderCreate,
    ApiProviderDetailOut,
    ApiProviderOut,
    ApiProviderTestResult,
    ApiProviderUpdate,
    AppSettingsOut,
    AppSettingsUpdate,
    DebateFormatCreate,
    DebateFormatOut,
    DebateFormatUpdate,
    DecisionLockUpdate,
    DecisionOut,
    FacilitatorSignalOut,
    FromUploadRequest,
    InFlightPartialOut,
    InsertPhaseRequest,
    LimitUpdate,
    MasqueradeCreate,
    MergeBackCreate,
    MessageCreate,
    MessageOut,
    PersonaInstanceOut,
    PersonaInstanceUpdate,
    PersonaTemplateCreate,
    PersonaTemplateOut,
    PersonaTemplateUpdate,
    PhaseTemplateCreate,
    PhaseTemplateOut,
    PhaseTemplateUpdate,
    PhaseTransitionRequest,
    RecipeCreate,
    RecipeOut,
    RecipeUpdate,
    RoomBackgroundUpdate,
    RoomCreate,
    RoomMemberPreview,
    RoomOut,
    RoomSummaryOut,
    RoomPhaseInstanceOut,
    RoomPhasePlanOut,
    RoomRuntimeOut,
    RoomState,
    ScenarioOut,
    ScribeStateOut,
    PersonaDraftEnvelope,
    TemplateDraftOut,
    TemplateDraftRequest,
    ToolExecuteRequest,
    ToolInvocationOut,
    ToolSchemaOut,
    ToolServerCreate,
    ToolServerOut,
    ToolServerUpdate,
    TurnRequest,
    UploadOut,
    VerdictCreate,
    SceneCreate,
    SceneEnterRequest,
    SceneExitRequest,
    SceneRosterEntry,
    SceneTimelineEntry,
    WorldCharacterCreate,
    WorldCharacterOut,
    WorldCharacterUpdate,
    WorldCreate,
    WorldDetailOut,
    WorldOut,
    WorldSceneMemberOut,
    WorldSummaryOut,
    WorldUpdate,
)
from .llm import llm_adapter
from .seed import seed_builtins
from .tools import execute_tool, list_tool_schemas, sync_mcp_server
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


app = FastAPI(title=settings.app_name, version="0.5.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def _strip_api_prefix(request, call_next):
    """Let the frontend keep using `/api/*` in single-process / packaged mode.

    Backend routes are declared at root; in dev Vite's proxy already strips
    `/api`, so requests arrive without it. In packaged mode there is no
    proxy, so we strip it here. Tests hit root paths directly and bypass
    this entirely.
    """
    path = request.scope.get("path", "")
    if path.startswith("/api/") or path == "/api":
        new_path = path[len("/api"):] or "/"
        request.scope["path"] = new_path
        if "raw_path" in request.scope and request.scope["raw_path"] is not None:
            request.scope["raw_path"] = new_path.encode()
    return await call_next(request)


@app.get("/health")
async def health(session: AsyncSession = Depends(get_session)) -> dict:
    await session.scalar(select(func.count(PersonaTemplate.id)))
    settings_row = await _get_or_create_app_settings(session)
    provider_count = await session.scalar(select(func.count(ApiProvider.id))) or 0
    model_count = await session.scalar(select(func.count(ApiModel.id))) or 0
    has_default_model = bool(
        settings_row.default_api_model_id
        or (settings_row.default_backing_model and settings_row.default_api_provider_id)
    )
    setup_steps = {
        "providers": provider_count > 0,
        "models": model_count > 0,
        "default_model": has_default_model,
    }
    setup_complete = all(setup_steps.values())
    return {
        "status": "ok",
        "database": "ok",
        "setup_complete": setup_complete,
        "setup_steps": setup_steps,
    }


async def _get_or_create_app_settings(session: AsyncSession) -> AppSettings:
    row = await session.get(AppSettings, 1)
    if row is None:
        row = AppSettings(id=1)
        session.add(row)
        await session.commit()
        await session.refresh(row)
    return row


def _template_copy_name(source) -> str:
    return source.name if source.is_builtin else f"{source.name} 副本"


def _apply_template_changes(row, changes: dict) -> None:
    if not changes:
        return
    row.version += 1
    for key, value in changes.items():
        setattr(row, key, value)


def _model_display_name(model_name: str) -> str:
    return model_name.split("/")[-1] or model_name


async def _api_model_or_404(session: AsyncSession, model_id: str) -> ApiModel:
    api_model = await session.get(ApiModel, model_id)
    if not api_model:
        raise HTTPException(404, "api model not found")
    return api_model


async def _sync_api_model_snapshot(session: AsyncSession, payload: dict) -> dict:
    """Keep legacy model/provider columns in sync when api_model_id is used."""
    model_id = payload.get("api_model_id")
    if not model_id:
        return payload
    api_model = await _api_model_or_404(session, model_id)
    if not api_model.enabled:
        raise HTTPException(400, "api model is disabled")
    payload = dict(payload)
    payload["backing_model"] = api_model.model_name
    payload["api_provider_id"] = api_model.api_provider_id
    return payload


async def _ensure_api_model_for_legacy(
    session: AsyncSession,
    provider_id: str | None,
    model_name: str | None,
    *,
    is_default: bool = False,
) -> ApiModel | None:
    model_name = (model_name or "").strip()
    if not provider_id or not model_name:
        return None
    provider = await session.get(ApiProvider, provider_id)
    if not provider:
        raise HTTPException(404, "api provider not found")
    api_model = await session.scalar(
        select(ApiModel).where(
            ApiModel.api_provider_id == provider_id,
            ApiModel.model_name == model_name,
        )
    )
    if api_model is None:
        api_model = ApiModel(
            id=new_id(),
            api_provider_id=provider_id,
            display_name=_model_display_name(model_name),
            model_name=model_name,
            enabled=True,
            is_default=is_default,
            tags=[],
        )
        session.add(api_model)
        await session.flush()
    elif is_default and not api_model.is_default:
        api_model.is_default = True
        await session.flush()
    return api_model


async def _set_single_default_api_model(session: AsyncSession, api_model: ApiModel) -> None:
    await session.execute(
        update(ApiModel)
        .where(ApiModel.api_provider_id == api_model.api_provider_id, ApiModel.id != api_model.id)
        .values(is_default=False)
    )
    api_model.is_default = True


@app.get("/settings", response_model=AppSettingsOut)
async def get_app_settings(session: AsyncSession = Depends(get_session)):
    row = await _get_or_create_app_settings(session)
    return AppSettingsOut(
        default_backing_model=row.default_backing_model,
        default_api_provider_id=row.default_api_provider_id,
        default_api_model_id=row.default_api_model_id,
        setup_complete=bool(row.default_api_model_id or (row.default_backing_model and row.default_api_provider_id)),
        updated_at=row.updated_at,
    )


@app.patch("/settings", response_model=AppSettingsOut)
async def update_app_settings(body: AppSettingsUpdate, session: AsyncSession = Depends(get_session)):
    row = await _get_or_create_app_settings(session)
    changes = body.model_dump(mode="json", exclude_unset=True)
    if "default_api_model_id" in changes and changes["default_api_model_id"]:
        api_model = await _api_model_or_404(session, changes["default_api_model_id"])
        changes["default_api_provider_id"] = api_model.api_provider_id
        changes["default_backing_model"] = api_model.model_name
    elif "default_api_model_id" in changes and not changes["default_api_model_id"]:
        changes["default_api_provider_id"] = None
        changes["default_backing_model"] = None
    if "default_api_provider_id" in changes and changes["default_api_provider_id"]:
        provider = await session.get(ApiProvider, changes["default_api_provider_id"])
        if not provider:
            raise HTTPException(404, "api provider not found")
    if "default_api_model_id" not in changes:
        api_model = await _ensure_api_model_for_legacy(
            session,
            changes.get("default_api_provider_id", row.default_api_provider_id),
            changes.get("default_backing_model", row.default_backing_model),
            is_default=True,
        )
        if api_model is not None:
            changes["default_api_model_id"] = api_model.id
    for key, value in changes.items():
        setattr(row, key, value or None)
    await session.commit()
    await session.refresh(row)
    return AppSettingsOut(
        default_backing_model=row.default_backing_model,
        default_api_provider_id=row.default_api_provider_id,
        default_api_model_id=row.default_api_model_id,
        setup_complete=bool(row.default_api_model_id or (row.default_backing_model and row.default_api_provider_id)),
        updated_at=row.updated_at,
    )


@app.get("/tools", response_model=list[ToolSchemaOut])
async def list_tools(session: AsyncSession = Depends(get_session)):
    return await list_tool_schemas(session)


@app.get("/tools/mcp-servers", response_model=list[ToolServerOut])
async def list_mcp_servers(session: AsyncSession = Depends(get_session)):
    return (await session.scalars(select(ToolServer).order_by(ToolServer.created_at.desc()))).all()


@app.post("/tools/mcp-servers", response_model=ToolServerOut)
async def create_mcp_server(body: ToolServerCreate, session: AsyncSession = Depends(get_session)):
    server = ToolServer(
        id=new_id(),
        name=body.name.strip(),
        description=body.description,
        transport=body.transport,
        url=body.url.strip(),
        enabled=body.enabled,
        allow_write=body.allow_write,
        manifest={"tools": []},
    )
    if not server.name:
        raise HTTPException(400, "server name is required")
    if not server.url:
        raise HTTPException(400, "server URL is required")
    session.add(server)
    await session.commit()
    await session.refresh(server)
    return server


@app.patch("/tools/mcp-servers/{server_id}", response_model=ToolServerOut)
async def update_mcp_server(server_id: str, body: ToolServerUpdate, session: AsyncSession = Depends(get_session)):
    server = await session.get(ToolServer, server_id)
    if not server:
        raise HTTPException(404, "MCP server not found")
    changes = body.model_dump(mode="json", exclude_unset=True)
    for key, value in changes.items():
        if isinstance(value, str):
            value = value.strip()
        setattr(server, key, value)
    await session.commit()
    await session.refresh(server)
    return server


@app.delete("/tools/mcp-servers/{server_id}")
async def delete_mcp_server(server_id: str, session: AsyncSession = Depends(get_session)):
    server = await session.get(ToolServer, server_id)
    if not server:
        raise HTTPException(404, "MCP server not found")
    await session.execute(update(ToolInvocation).where(ToolInvocation.server_id == server_id).values(server_id=None))
    await session.delete(server)
    await session.commit()
    return {"status": "deleted"}


@app.post("/tools/mcp-servers/{server_id}/sync", response_model=ToolServerOut)
async def sync_mcp_server_route(server_id: str, session: AsyncSession = Depends(get_session)):
    server = await session.get(ToolServer, server_id)
    if not server:
        raise HTTPException(404, "MCP server not found")
    try:
        await sync_mcp_server(session, server)
    except Exception as exc:  # noqa: BLE001 — persist last_error and surface it
        await session.commit()
        raise HTTPException(400, str(exc)) from exc
    await session.commit()
    await session.refresh(server)
    return server


@app.post("/rooms/{room_id}/tools/execute", response_model=ToolInvocationOut)
async def execute_room_tool(room_id: str, body: ToolExecuteRequest, session: AsyncSession = Depends(get_session)):
    runtime = await _runtime_or_404(session, room_id)
    _ensure_not_frozen(runtime)
    try:
        invocation = await execute_tool(
            session,
            room_id,
            body.tool_name,
            body.arguments,
            parent_message_id=body.parent_message_id,
            allow_write=body.allow_write,
        )
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    await session.commit()
    await session.refresh(invocation)
    return invocation


@app.get("/scenarios", response_model=list[ScenarioOut])
async def list_scenarios(session: AsyncSession = Depends(get_session)):
    return await _scenario_catalog(session)


@app.post("/assistants/template-draft", response_model=TemplateDraftOut)
async def draft_template(body: TemplateDraftRequest, session: AsyncSession = Depends(get_session)):
    """Generate a template payload from natural language.

    Persona drafts go through a tightly constrained tool schema
    (`PersonaDraftEnvelope`) so the LLM cannot return free-form text — every
    field maps directly onto the persona form. Phase/recipe drafts still use
    the loose `dict` shape (those forms are richer and harder to constrain).

    Errors are NOT swallowed: a 502 surfaces back to the frontend so users
    see the real reason instead of a silent fallback that looks like the
    button did nothing.
    """
    llm_persona, provider = await _template_assistant_runtime(session)
    if llm_persona is None:
        # No assistant model is configured at all — fall back deterministically
        # so a brand-new install still gets *something* in the form. The
        # frontend can tell this is a fallback because rationale says so.
        return _fallback_template_draft(body.kind, body.prompt)

    if body.kind == "persona":
        return await _draft_persona_template(llm_persona, provider, body.prompt)

    fallback = _fallback_template_draft(body.kind, body.prompt)
    try:
        draft = await llm_adapter.complete_tool(
            llm_persona,
            "draft_template",
            "Draft a MAI template payload from the user's natural language request.",
            TemplateDraftOut,
            {
                "kind": body.kind,
                "prompt": body.prompt,
                "fallback_shape": fallback.model_dump(mode="json"),
                "constraints": [
                    "Return kind exactly as requested.",
                    "The payload must be directly usable by the matching MAI template form.",
                    "Keep generated Chinese text concise and actionable.",
                ],
            },
            max_tokens=1800,
            api_provider=provider,
        )
        return TemplateDraftOut.model_validate(draft).model_copy(update={"kind": body.kind})
    except Exception as exc:
        logger.exception("template draft failed for kind=%s", body.kind)
        raise HTTPException(status_code=502, detail=f"AI 起草失败: {exc}") from exc


async def _draft_persona_template(llm_persona, provider, prompt: str) -> TemplateDraftOut:
    """Constrained persona drafting — the LLM fills `PersonaDraftEnvelope`.

    The tool schema is narrow enough that pydantic validation rejects most
    junk (out-of-range temperature, bogus icon name, color without #) and the
    frontend can plug the result straight into the form.
    """
    persona_with_prompt = SimpleNamespace(
        backing_model=llm_persona.backing_model,
        temperature=llm_persona.temperature,
        config=llm_persona.config,
        system_prompt=(
            "你是 MAI 的人设起草助手。根据用户的自然语言需求,产出一份可直接保存的【人设模板】。\n"
            "硬性要求:\n"
            "1. 严格按 tool 的 JSON Schema 返回字段,不要额外字段也不要遗漏 name/description/system_prompt。\n"
            "2. system_prompt 用第二人称('你是…'),先一句声明角色,再列出关注点和发言要求,80-200 字,不要 markdown,不要示例对话。\n"
            "3. description 是一句话简介(30-80 字),不要复述 system_prompt。\n"
            "4. name 必须是 2-8 个汉字的人物或角色称谓,如'架构师'、'反方律师','安全审计者'。\n"
            "5. 根据角色气质从给定调色板里挑 color(批判=红/橙,严谨=蓝,创意=紫/粉,运维=青)。\n"
            "6. icon 必须从枚举里挑一个最贴合的,严禁自造名字。\n"
            "7. temperature: 严谨/批判型 0.2-0.4,平衡型 0.4-0.6,发散型 0.6-0.8。\n"
            "8. 只产出讨论者(discussant)人设,除非用户明确要求 scribe/facilitator。\n"
        ),
    )
    try:
        draft = await llm_adapter.complete_tool(
            persona_with_prompt,
            "draft_persona_template",
            "Produce a MAI persona template payload that the user can save into a discussion room.",
            PersonaDraftEnvelope,
            {
                "user_request": prompt,
                "instructions": [
                    "Return the envelope tool exactly once.",
                    "All free-text fields should be Chinese unless the user wrote in another language.",
                    "Pick color and icon that match the persona's archetype.",
                ],
            },
            max_tokens=1200,
            api_provider=provider,
        )
    except Exception as exc:
        logger.exception("persona draft failed")
        raise HTTPException(status_code=502, detail=f"AI 起草失败: {exc}") from exc

    # Validation happens once inside complete_tool; we re-validate here so a
    # second-pass schema mismatch (e.g. from later schema tightening) is
    # surfaced clearly rather than crashing as a generic 500.
    try:
        envelope = PersonaDraftEnvelope.model_validate(draft)
    except Exception as exc:
        logger.warning("persona draft validation failed; raw=%r", draft)
        raise HTTPException(status_code=502, detail=f"AI 起草输出不合规: {exc}") from exc
    return TemplateDraftOut(
        kind="persona",
        payload=envelope.payload.model_dump(mode="json"),
        rationale=envelope.rationale,
    )


@app.get("/templates/personas", response_model=list[PersonaTemplateOut])
async def list_persona_templates(
    kind: str | None = None,
    builtin: bool | None = None,
    session: AsyncSession = Depends(get_session),
):
    stmt = select(PersonaTemplate).order_by(PersonaTemplate.is_builtin.desc(), PersonaTemplate.name)
    if kind:
        stmt = stmt.where(PersonaTemplate.kind == kind)
    if builtin is not None:
        stmt = stmt.where(PersonaTemplate.is_builtin == builtin)
    return (await session.scalars(stmt)).all()


@app.post("/templates/personas", response_model=PersonaTemplateOut)
async def create_persona_template(body: PersonaTemplateCreate, session: AsyncSession = Depends(get_session)):
    payload = await _sync_api_model_snapshot(session, body.model_dump(mode="json"))
    if not payload.get("api_model_id"):
        api_model = await _ensure_api_model_for_legacy(
            session, payload.get("api_provider_id"), payload.get("backing_model")
        )
        if api_model is not None:
            payload["api_model_id"] = api_model.id
    template = PersonaTemplate(
        id=new_id(),
        version=1,
        schema_version=1,
        status="published",
        is_builtin=False,
        **payload,
    )
    session.add(template)
    await session.commit()
    await session.refresh(template)
    return template


@app.patch("/templates/personas/{template_id}", response_model=PersonaTemplateOut)
async def update_persona_template(
    template_id: str, body: PersonaTemplateUpdate, session: AsyncSession = Depends(get_session)
):
    template = await session.get(PersonaTemplate, template_id)
    if not template:
        raise HTTPException(404, "persona template not found")
    if template.is_builtin:
        raise HTTPException(403, "builtin templates are read-only; duplicate to customize")
    changes = body.model_dump(mode="json", exclude_unset=True)
    if not changes:
        return template
    changes = await _sync_api_model_snapshot(session, changes)
    if "api_model_id" not in changes:
        api_model = await _ensure_api_model_for_legacy(
            session,
            changes.get("api_provider_id", template.api_provider_id),
            changes.get("backing_model", template.backing_model),
        )
        if api_model is not None:
            changes["api_model_id"] = api_model.id
    _apply_template_changes(template, changes)
    await session.commit()
    await session.refresh(template)
    return template


@app.post("/templates/personas/{template_id}/duplicate", response_model=PersonaTemplateOut)
async def duplicate_persona_template(template_id: str, session: AsyncSession = Depends(get_session)):
    source = await session.get(PersonaTemplate, template_id)
    if not source:
        raise HTTPException(404, "persona template not found")
    copy = PersonaTemplate(
        id=new_id(),
        version=1,
        schema_version=source.schema_version,
        status="published",
        forked_from_id=source.id,
        forked_from_version=source.version,
        is_builtin=False,
        kind=source.kind,
        name=_template_copy_name(source),
        identity=source.identity,
        description=source.description,
        backing_model=source.backing_model,
        api_provider_id=source.api_provider_id,
        api_model_id=source.api_model_id,
        system_prompt=source.system_prompt,
        temperature=source.temperature,
        talkativeness=source.talkativeness,
        color=source.color,
        icon=source.icon,
        config=dict(source.config or {}),
        tags=list(source.tags or []),
    )
    session.add(copy)
    await session.commit()
    await session.refresh(copy)
    return copy


@app.delete("/templates/personas/{template_id}")
async def delete_persona_template(template_id: str, session: AsyncSession = Depends(get_session)):
    template = await session.get(PersonaTemplate, template_id)
    if not template:
        raise HTTPException(404, "persona template not found")
    if template.is_builtin:
        raise HTTPException(403, "builtin templates are read-only")
    usage_count = await session.scalar(
        select(func.count(PersonaInstance.id)).where(PersonaInstance.template_id == template_id)
    )
    if usage_count:
        raise HTTPException(409, "persona template is used by one or more rooms")
    await session.delete(template)
    await session.commit()
    return {"status": "deleted"}


@app.get("/templates/api-providers", response_model=list[ApiProviderOut])
async def list_api_providers(session: AsyncSession = Depends(get_session)):
    rows = (await session.scalars(select(ApiProvider).order_by(ApiProvider.created_at))).all()
    return [ApiProviderOut.from_model(row) for row in rows]


@app.post("/templates/api-providers", response_model=ApiProviderDetailOut)
async def create_api_provider(body: ApiProviderCreate, session: AsyncSession = Depends(get_session)):
    provider = ApiProvider(
        id=new_id(),
        name=body.name,
        provider_slug=body.provider_slug.strip(),
        api_key=body.api_key,
        api_base=body.api_base or None,
    )
    session.add(provider)
    await session.commit()
    await session.refresh(provider)
    return ApiProviderDetailOut.from_model(provider)


@app.get("/templates/api-providers/{provider_id}", response_model=ApiProviderDetailOut)
async def get_api_provider(provider_id: str, session: AsyncSession = Depends(get_session)):
    provider = await session.get(ApiProvider, provider_id)
    if not provider:
        raise HTTPException(404, "api provider not found")
    return ApiProviderDetailOut.from_model(provider)


@app.patch("/templates/api-providers/{provider_id}", response_model=ApiProviderDetailOut)
async def update_api_provider(
    provider_id: str, body: ApiProviderUpdate, session: AsyncSession = Depends(get_session)
):
    provider = await session.get(ApiProvider, provider_id)
    if not provider:
        raise HTTPException(404, "api provider not found")
    changes = body.model_dump(mode="json", exclude_unset=True)
    creds_touched = any(key in changes for key in ("api_key", "api_base"))
    for key, value in changes.items():
        if key == "provider_slug" and isinstance(value, str):
            value = value.strip()
        setattr(provider, key, value)
    if creds_touched:
        # Stale green dot would lie about new key/base; force a re-test.
        provider.last_tested_ok = None
        provider.last_tested_at = None
        provider.last_tested_error = None
    await session.commit()
    await session.refresh(provider)
    return ApiProviderDetailOut.from_model(provider)


@app.delete("/templates/api-providers/{provider_id}")
async def delete_api_provider(provider_id: str, session: AsyncSession = Depends(get_session)):
    provider = await session.get(ApiProvider, provider_id)
    if not provider:
        raise HTTPException(404, "api provider not found")
    model_ids = (
        await session.scalars(select(ApiModel.id).where(ApiModel.api_provider_id == provider_id))
    ).all()
    await session.execute(
        update(PersonaTemplate)
        .where(PersonaTemplate.api_provider_id == provider_id)
        .values(api_provider_id=None, api_model_id=None, backing_model="")
    )
    await session.execute(
        update(PersonaInstance)
        .where(PersonaInstance.api_provider_id == provider_id)
        .values(api_provider_id=None, api_model_id=None, backing_model="")
    )
    if model_ids:
        await session.execute(
            update(PersonaTemplate).where(PersonaTemplate.api_model_id.in_(model_ids)).values(api_model_id=None)
        )
        await session.execute(
            update(PersonaInstance).where(PersonaInstance.api_model_id.in_(model_ids)).values(api_model_id=None)
        )
        await session.execute(
            update(AppSettings).where(AppSettings.default_api_model_id.in_(model_ids)).values(default_api_model_id=None)
        )
        await session.execute(delete(ApiModel).where(ApiModel.id.in_(model_ids)))
    await session.execute(
        update(AppSettings)
        .where(AppSettings.default_api_provider_id == provider_id)
        .values(default_api_provider_id=None, default_api_model_id=None, default_backing_model=None)
    )
    await session.delete(provider)
    await session.commit()
    return {"status": "deleted"}


@app.post("/templates/api-providers/{provider_id}/test", response_model=ApiProviderTestResult)
async def test_api_provider(
    provider_id: str,
    model: str | None = None,
    session: AsyncSession = Depends(get_session),
):
    """Test an API provider. Two modes:

    - Without `?model=`: cheap GET `{base}/models` ping. Validates that the
      key + base URL reach a server that exposes the OpenAI-compat surface,
      no token spend.
    - With `?model=`: real `litellm.acompletion(max_tokens=1)`. Validates the
      full path including litellm's provider routing, so a green dot here
      truly means "ready to use". Costs ~1 token.

    Persists the result on the ApiProvider row so the UI can show a status
    dot.
    """
    provider = await session.get(ApiProvider, provider_id)
    if not provider:
        raise HTTPException(404, "api provider not found")
    tested_at = datetime.now(timezone.utc)
    ok = False
    status_code: int | None = None
    error: str | None = None

    if model:
        from litellm import acompletion

        try:
            response = await acompletion(
                model=model,
                messages=[{"role": "user", "content": "ping"}],
                max_tokens=1,
                api_key=provider.api_key,
                api_base=provider.api_base or None,
            )
            # Any well-formed completion counts as success.
            if response and getattr(response, "choices", None):
                ok = True
            else:
                error = "litellm 返回空响应"
        except Exception as exc:  # noqa: BLE001 — surface to user
            error = _summarize_litellm_error(exc)
    else:
        base = (provider.api_base or "https://api.openai.com/v1").rstrip("/")
        url = f"{base}/models"
        headers = {"Authorization": f"Bearer {provider.api_key}"}
        try:
            async with httpx.AsyncClient(timeout=10.0) as http:
                response = await http.get(url, headers=headers)
            status_code = response.status_code
            if response.status_code == 200:
                ok = True
            elif response.status_code in (401, 403):
                error = "鉴权失败：API Key 无效或权限不足"
            elif response.status_code == 404:
                error = "地址不通：请检查 API Base 是否正确（应包含 /v1）"
            else:
                error = f"HTTP {response.status_code}: {response.text[:200]}"
        except httpx.ConnectError as exc:
            error = f"无法连接：{exc}"
        except httpx.TimeoutException:
            error = "请求超时（10s）"
        except Exception as exc:  # noqa: BLE001 — surface message
            error = f"请求失败：{type(exc).__name__}: {exc}"

    provider.last_tested_ok = ok
    provider.last_tested_at = tested_at
    provider.last_tested_error = None if ok else error
    await session.commit()
    return ApiProviderTestResult(ok=ok, status_code=status_code, error=error, tested_at=tested_at)


@app.get("/templates/api-models", response_model=list[ApiModelOut])
async def list_api_models(
    provider_id: str | None = None,
    enabled: bool | None = None,
    session: AsyncSession = Depends(get_session),
):
    stmt = select(ApiModel).order_by(ApiModel.api_provider_id, ApiModel.is_default.desc(), ApiModel.display_name)
    if provider_id:
        stmt = stmt.where(ApiModel.api_provider_id == provider_id)
    if enabled is not None:
        stmt = stmt.where(ApiModel.enabled == enabled)
    return (await session.scalars(stmt)).all()


@app.post("/templates/api-models", response_model=ApiModelOut)
async def create_api_model(body: ApiModelCreate, session: AsyncSession = Depends(get_session)):
    provider = await session.get(ApiProvider, body.api_provider_id)
    if not provider:
        raise HTTPException(404, "api provider not found")
    model_name = body.model_name.strip()
    if not model_name:
        raise HTTPException(400, "model name is required")
    api_model = ApiModel(
        id=new_id(),
        api_provider_id=body.api_provider_id,
        display_name=body.display_name.strip() or _model_display_name(model_name),
        model_name=model_name,
        enabled=body.enabled,
        is_default=body.is_default,
        context_window=body.context_window,
        tags=body.tags,
    )
    session.add(api_model)
    await session.flush()
    if api_model.is_default:
        await _set_single_default_api_model(session, api_model)
    await session.commit()
    await session.refresh(api_model)
    return api_model


@app.patch("/templates/api-models/{model_id}", response_model=ApiModelOut)
async def update_api_model(model_id: str, body: ApiModelUpdate, session: AsyncSession = Depends(get_session)):
    api_model = await _api_model_or_404(session, model_id)
    changes = body.model_dump(mode="json", exclude_unset=True)
    if "api_provider_id" in changes and changes["api_provider_id"]:
        provider = await session.get(ApiProvider, changes["api_provider_id"])
        if not provider:
            raise HTTPException(404, "api provider not found")
    if "model_name" in changes and changes["model_name"] is not None:
        changes["model_name"] = changes["model_name"].strip()
        if not changes["model_name"]:
            raise HTTPException(400, "model name is required")
    if "display_name" in changes and changes["display_name"] is not None:
        changes["display_name"] = changes["display_name"].strip()
    for key, value in changes.items():
        setattr(api_model, key, value)
    if not api_model.display_name:
        api_model.display_name = _model_display_name(api_model.model_name)
    if api_model.is_default:
        await _set_single_default_api_model(session, api_model)
    await session.execute(
        update(PersonaTemplate)
        .where(PersonaTemplate.api_model_id == model_id)
        .values(backing_model=api_model.model_name, api_provider_id=api_model.api_provider_id)
    )
    await session.execute(
        update(PersonaInstance)
        .where(PersonaInstance.api_model_id == model_id)
        .values(backing_model=api_model.model_name, api_provider_id=api_model.api_provider_id)
    )
    await session.execute(
        update(AppSettings)
        .where(AppSettings.default_api_model_id == model_id)
        .values(default_backing_model=api_model.model_name, default_api_provider_id=api_model.api_provider_id)
    )
    await session.commit()
    await session.refresh(api_model)
    return api_model


@app.delete("/templates/api-models/{model_id}")
async def delete_api_model(model_id: str, session: AsyncSession = Depends(get_session)):
    api_model = await _api_model_or_404(session, model_id)
    await session.execute(
        update(PersonaTemplate)
        .where(PersonaTemplate.api_model_id == model_id)
        .values(api_model_id=None, api_provider_id=None, backing_model="")
    )
    await session.execute(
        update(PersonaInstance)
        .where(PersonaInstance.api_model_id == model_id)
        .values(api_model_id=None, api_provider_id=None, backing_model="")
    )
    await session.execute(
        update(AppSettings)
        .where(AppSettings.default_api_model_id == model_id)
        .values(default_api_model_id=None, default_api_provider_id=None, default_backing_model=None)
    )
    await session.delete(api_model)
    await session.commit()
    return {"status": "deleted"}


@app.post("/templates/api-models/{model_id}/test", response_model=ApiProviderTestResult)
async def test_api_model(model_id: str, session: AsyncSession = Depends(get_session)):
    api_model = await _api_model_or_404(session, model_id)
    provider = await session.get(ApiProvider, api_model.api_provider_id)
    if not provider:
        raise HTTPException(404, "api provider not found")
    tested_at = datetime.now(timezone.utc)
    ok = False
    error: str | None = None
    from litellm import acompletion

    try:
        response = await acompletion(
            model=api_model.model_name,
            messages=[{"role": "user", "content": "ping"}],
            max_tokens=1,
            api_key=provider.api_key,
            api_base=provider.api_base or None,
        )
        if response and getattr(response, "choices", None):
            ok = True
        else:
            error = "litellm 返回空响应"
    except Exception as exc:  # noqa: BLE001 — surface to user
        error = _summarize_litellm_error(exc)

    api_model.last_tested_ok = ok
    api_model.last_tested_at = tested_at
    api_model.last_tested_error = None if ok else error
    await session.commit()
    return ApiProviderTestResult(ok=ok, status_code=None, error=error, tested_at=tested_at)


def _summarize_litellm_error(exc: Exception) -> str:
    """litellm appends a verbose 'Provider List: https://docs...' footer plus
    sometimes a request_id. Strip both so the UI gets the actionable line."""
    text = str(exc).strip()
    # Drop the verbose footers litellm appends to routing failures.
    for marker in ("Provider List:", "\nLearn more", " Learn more:", "Pass model as E.g."):
        idx = text.find(marker)
        if idx != -1:
            text = text[:idx].rstrip()
    # Drop request_id parens
    import re as _re

    text = _re.sub(r"\s*\(request_id:[^)]*\)", "", text)
    text = text[:300].strip()
    return text or f"{type(exc).__name__}"


@app.get("/templates/phases", response_model=list[PhaseTemplateOut])
async def list_phases(builtin: bool | None = None, session: AsyncSession = Depends(get_session)):
    stmt = select(PhaseTemplate).order_by(PhaseTemplate.is_builtin.desc(), PhaseTemplate.name)
    if builtin is not None:
        stmt = stmt.where(PhaseTemplate.is_builtin == builtin)
    return (await session.scalars(stmt)).all()


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


@app.patch("/templates/phases/{phase_id}", response_model=PhaseTemplateOut)
async def update_phase(
    phase_id: str, body: PhaseTemplateUpdate, session: AsyncSession = Depends(get_session)
):
    phase = await session.get(PhaseTemplate, phase_id)
    if not phase:
        raise HTTPException(404, "phase not found")
    if phase.is_builtin:
        raise HTTPException(403, "builtin templates are read-only; duplicate to customize")
    changes = body.model_dump(mode="json", exclude_unset=True)
    if not changes:
        return phase
    _apply_template_changes(phase, changes)
    await session.commit()
    await session.refresh(phase)
    return phase


@app.post("/templates/phases/{phase_id}/duplicate", response_model=PhaseTemplateOut)
async def duplicate_phase(phase_id: str, session: AsyncSession = Depends(get_session)):
    source = await session.get(PhaseTemplate, phase_id)
    if not source:
        raise HTTPException(404, "phase not found")
    copy = PhaseTemplate(
        id=new_id(),
        version=1,
        schema_version=source.schema_version,
        status="published",
        forked_from_id=source.id,
        forked_from_version=source.version,
        is_builtin=False,
        name=_template_copy_name(source),
        description=source.description,
        declared_variables=list(source.declared_variables or []),
        allowed_speakers=dict(source.allowed_speakers or {"type": "all"}),
        ordering_rule=dict(source.ordering_rule or {"type": "user_picks"}),
        exit_conditions=list(source.exit_conditions or []),
        auto_discuss=source.auto_discuss,
        role_constraints=source.role_constraints,
        prompt_template=source.prompt_template,
        tags=list(source.tags or []),
    )
    session.add(copy)
    await session.commit()
    await session.refresh(copy)
    return copy


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


@app.delete("/templates/phases/{phase_id}")
async def delete_phase(phase_id: str, session: AsyncSession = Depends(get_session)):
    phase = await session.get(PhaseTemplate, phase_id)
    if not phase:
        raise HTTPException(404, "phase not found")
    if phase.is_builtin:
        raise HTTPException(403, "builtin templates are read-only")
    plan_refs = await session.scalar(
        select(func.count(RoomPhasePlan.room_id)).where(RoomPhasePlan.phase_template_id == phase_id)
    )
    instance_refs = await session.scalar(
        select(func.count(RoomPhaseInstance.id)).where(RoomPhaseInstance.phase_template_id == phase_id)
    )
    if plan_refs or instance_refs:
        raise HTTPException(409, "phase is used by one or more rooms")
    formats = (await session.scalars(select(DebateFormat))).all()
    format_refs = [
        debate_format.name
        for debate_format in formats
        if any(slot.get("phase_template_id") == phase_id for slot in (debate_format.phase_sequence or []))
    ]
    if format_refs:
        raise HTTPException(409, f"phase is used by formats: {', '.join(format_refs[:3])}")
    await session.delete(phase)
    await session.commit()
    return {"status": "deleted"}


@app.get("/templates/formats", response_model=list[DebateFormatOut])
async def list_formats(builtin: bool | None = None, session: AsyncSession = Depends(get_session)):
    stmt = select(DebateFormat).order_by(DebateFormat.is_builtin.desc(), DebateFormat.name)
    if builtin is not None:
        stmt = stmt.where(DebateFormat.is_builtin == builtin)
    return (await session.scalars(stmt)).all()


@app.post("/templates/formats", response_model=DebateFormatOut)
async def create_format(body: DebateFormatCreate, session: AsyncSession = Depends(get_session)):
    debate_format = DebateFormat(
        id=new_id(),
        version=1,
        schema_version=1,
        status="published",
        is_builtin=False,
        **body.model_dump(mode="json"),
    )
    session.add(debate_format)
    await session.commit()
    await session.refresh(debate_format)
    return debate_format


@app.patch("/templates/formats/{format_id}", response_model=DebateFormatOut)
async def update_format(format_id: str, body: DebateFormatUpdate, session: AsyncSession = Depends(get_session)):
    debate_format = await session.get(DebateFormat, format_id)
    if not debate_format:
        raise HTTPException(404, "format not found")
    if debate_format.is_builtin:
        raise HTTPException(403, "builtin templates are read-only; duplicate to customize")
    changes = body.model_dump(mode="json", exclude_unset=True)
    if not changes:
        return debate_format
    _apply_template_changes(debate_format, changes)
    await session.commit()
    await session.refresh(debate_format)
    return debate_format


@app.post("/templates/formats/{format_id}/duplicate", response_model=DebateFormatOut)
async def duplicate_format(format_id: str, session: AsyncSession = Depends(get_session)):
    source = await session.get(DebateFormat, format_id)
    if not source:
        raise HTTPException(404, "format not found")
    copy = DebateFormat(
        id=new_id(),
        version=1,
        schema_version=source.schema_version,
        status="published",
        forked_from_id=source.id,
        forked_from_version=source.version,
        is_builtin=False,
        name=_template_copy_name(source),
        description=source.description,
        phase_sequence=list(source.phase_sequence or []),
        tags=list(source.tags or []),
    )
    session.add(copy)
    await session.commit()
    await session.refresh(copy)
    return copy


@app.delete("/templates/formats/{format_id}")
async def delete_format(format_id: str, session: AsyncSession = Depends(get_session)):
    debate_format = await session.get(DebateFormat, format_id)
    if not debate_format:
        raise HTTPException(404, "format not found")
    if debate_format.is_builtin:
        raise HTTPException(403, "builtin templates are read-only")
    recipe_refs = await session.scalar(select(func.count(Recipe.id)).where(Recipe.format_id == format_id))
    room_refs = await session.scalar(select(func.count(Room.id)).where(Room.format_id == format_id))
    if recipe_refs or room_refs:
        raise HTTPException(409, "format is used by one or more recipes or rooms")
    await session.delete(debate_format)
    await session.commit()
    return {"status": "deleted"}


@app.get("/templates/recipes", response_model=list[RecipeOut])
async def list_recipes(builtin: bool | None = None, session: AsyncSession = Depends(get_session)):
    stmt = select(Recipe).order_by(Recipe.is_builtin.desc(), Recipe.name)
    if builtin is not None:
        stmt = stmt.where(Recipe.is_builtin == builtin)
    return (await session.scalars(stmt)).all()


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


@app.patch("/templates/recipes/{recipe_id}", response_model=RecipeOut)
async def update_recipe(recipe_id: str, body: RecipeUpdate, session: AsyncSession = Depends(get_session)):
    recipe = await session.get(Recipe, recipe_id)
    if not recipe:
        raise HTTPException(404, "recipe not found")
    if recipe.is_builtin:
        raise HTTPException(403, "builtin templates are read-only; duplicate to customize")
    changes = body.model_dump(mode="json", exclude_unset=True)
    if not changes:
        return recipe
    _apply_template_changes(recipe, changes)
    await session.commit()
    await session.refresh(recipe)
    return recipe


@app.post("/templates/recipes/{recipe_id}/duplicate", response_model=RecipeOut)
async def duplicate_recipe(recipe_id: str, session: AsyncSession = Depends(get_session)):
    source = await session.get(Recipe, recipe_id)
    if not source:
        raise HTTPException(404, "recipe not found")
    copy = Recipe(
        id=new_id(),
        version=1,
        schema_version=source.schema_version,
        status="published",
        forked_from_id=source.id,
        forked_from_version=source.version,
        is_builtin=False,
        name=_template_copy_name(source),
        description=source.description,
        persona_ids=list(source.persona_ids or []),
        format_id=source.format_id,
        format_version=source.format_version,
        initial_settings=dict(source.initial_settings or {}),
        tags=list(source.tags or []),
    )
    session.add(copy)
    await session.commit()
    await session.refresh(copy)
    return copy


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


@app.delete("/templates/recipes/{recipe_id}")
async def delete_recipe(recipe_id: str, session: AsyncSession = Depends(get_session)):
    recipe = await session.get(Recipe, recipe_id)
    if not recipe:
        raise HTTPException(404, "recipe not found")
    if recipe.is_builtin:
        raise HTTPException(403, "builtin templates are read-only")
    room_refs = await session.scalar(select(func.count(Room.id)).where(Room.recipe_id == recipe_id))
    if room_refs:
        raise HTTPException(409, "recipe is used by one or more rooms")
    await session.delete(recipe)
    await session.commit()
    return {"status": "deleted"}


@app.get("/rooms", response_model=list[RoomSummaryOut])
async def list_rooms(session: AsyncSession = Depends(get_session)):
    """Room list with member previews + activity counters baked in.

    All aggregates are computed in-process from a small number of bulk
    queries (one for rooms, one for personas, two for message stats) so the
    sidebar can render rich cards without N+1 hits per room.
    """
    rooms = (await session.scalars(select(Room).order_by(Room.created_at.desc()))).all()
    if not rooms:
        return []
    room_ids = [room.id for room in rooms]

    persona_rows = (
        await session.scalars(
            select(PersonaInstance)
            .where(
                PersonaInstance.room_id.in_(room_ids),
                PersonaInstance.kind == "discussant",
            )
            .order_by(PersonaInstance.position, PersonaInstance.name)
        )
    ).all()
    members_by_room: dict[str, list[RoomMemberPreview]] = {}
    counts_by_room: dict[str, int] = {}
    for p in persona_rows:
        bucket = members_by_room.setdefault(p.room_id, [])
        # Cap previews at 6 to keep the wire response small; counts are exact.
        if len(bucket) < 6:
            bucket.append(
                RoomMemberPreview(
                    id=p.id,
                    name=p.name,
                    identity=p.identity or "",
                    color=p.color or "#3b82f6",
                    icon=p.icon or "Sparkles",
                )
            )
        counts_by_room[p.room_id] = counts_by_room.get(p.room_id, 0) + 1

    # Visible-to-user message counts + freshness timestamp per room.
    msg_count_rows = (
        await session.execute(
            select(Message.room_id, func.count(Message.id), func.max(Message.created_at))
            .where(
                Message.room_id.in_(room_ids),
                Message.visibility == "public",
            )
            .group_by(Message.room_id)
        )
    ).all()
    msg_count_by_room: dict[str, int] = {row[0]: int(row[1] or 0) for row in msg_count_rows}
    last_activity_by_room: dict[str, datetime] = {row[0]: row[2] for row in msg_count_rows if row[2] is not None}

    summaries: list[RoomSummaryOut] = []
    for room in rooms:
        base = RoomOut.model_validate(room).model_dump()
        summaries.append(
            RoomSummaryOut(
                **base,
                member_count=counts_by_room.get(room.id, 0),
                members=members_by_room.get(room.id, []),
                message_count=msg_count_by_room.get(room.id, 0),
                last_activity_at=last_activity_by_room.get(room.id),
            )
        )
    return summaries


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
        background=body.background or "",
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
        max_phase_rounds=settings_payload.get("max_phase_rounds", 3),
        max_account_daily_tokens=settings_payload.get("max_account_daily_tokens", 250000),
        max_account_monthly_tokens=settings_payload.get("max_account_monthly_tokens", 3000000),
        max_consecutive_ai_turns=settings_payload.get("max_consecutive_ai_turns", 10),
        auto_transition=settings_payload.get("auto_transition", False),
    )
    scribe = ScribeState(room_id=room.id, current_state=DEFAULT_SCRIBE_STATE.copy())
    session.add_all([runtime, scribe])
    await _create_persona_instances(session, room.id, list(dict.fromkeys(persona_ids + system_ids)))

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


@app.patch("/rooms/{room_id}/background", response_model=RoomOut)
async def update_room_background(
    room_id: str, body: RoomBackgroundUpdate, session: AsyncSession = Depends(get_session)
):
    """Update the room's persistent background and append a visible system
    message recording the change. The new background is what appears in every
    persona's system prompt from this point on; the appended message preserves
    history and lets AIs notice (and react to) the shift in setting.
    """
    room = await session.get(Room, room_id)
    if not room:
        raise HTTPException(404, "room not found")
    new_value = (body.background or "").strip()
    if new_value == (room.background or ""):
        return RoomOut.model_validate(room)
    room.background = new_value
    runtime = await session.get(RoomRuntimeState, room_id)
    message = Message(
        room_id=room.id,
        phase_instance_id=runtime.current_phase_instance_id if runtime else None,
        message_type="background_update",
        author_actual="system",
        visibility="public",
        visibility_to_models=True,
        content=new_value,
    )
    session.add(message)
    await session.flush()
    await trace_record(session, room.id, "state_mutation", "room background updated", {"message_id": message.id})
    await session.commit()
    await event_bus.publish(
        room.id,
        {"type": "message.appended", "message": MessageOut.model_validate(message).model_dump(mode="json")},
    )
    return RoomOut.model_validate(room)


@app.get("/rooms/{room_id}/state", response_model=RoomState)
async def get_room_state(room_id: str, session: AsyncSession = Depends(get_session)):
    return await _room_state(session, room_id)


@app.post("/rooms/{room_id}/personas", response_model=RoomState)
async def add_room_personas(
    room_id: str, body: AddPersonaInstancesRequest, session: AsyncSession = Depends(get_session)
):
    room = await session.get(Room, room_id)
    if not room:
        raise HTTPException(404, "room not found")
    existing_template_ids = set(
        (
            await session.scalars(
                select(PersonaInstance.template_id).where(PersonaInstance.room_id == room_id)
            )
        ).all()
    )
    new_template_ids = [tid for tid in body.template_ids if tid not in existing_template_ids]
    await _create_persona_instances(session, room_id, new_template_ids)
    await trace_record(
        session,
        room_id,
        "state_mutation",
        "persona instances added",
        {"template_ids": new_template_ids, "skipped_existing": sorted(existing_template_ids & set(body.template_ids))},
    )
    await session.commit()
    return await _room_state(session, room_id)


@app.patch("/rooms/{room_id}/persona-instances/{instance_id}", response_model=PersonaInstanceOut)
async def update_persona_instance(
    room_id: str,
    instance_id: str,
    body: PersonaInstanceUpdate,
    session: AsyncSession = Depends(get_session),
):
    instance = await session.get(PersonaInstance, instance_id)
    if not instance or instance.room_id != room_id:
        raise HTTPException(404, "persona instance not found")
    changes = body.model_dump(mode="json", exclude_unset=True)
    changes = await _sync_api_model_snapshot(session, changes)
    if "api_model_id" not in changes:
        api_model = await _ensure_api_model_for_legacy(
            session,
            changes.get("api_provider_id", instance.api_provider_id),
            changes.get("backing_model", instance.backing_model),
        )
        if api_model is not None:
            changes["api_model_id"] = api_model.id
    for key, value in changes.items():
        setattr(instance, key, value)
    await trace_record(
        session,
        room_id,
        "state_mutation",
        "persona instance updated",
        {"instance_id": instance_id, "changes": list(changes.keys())},
    )
    await session.commit()
    await session.refresh(instance)
    out = PersonaInstanceOut.model_validate(instance)
    await event_bus.publish(
        room_id,
        {"type": "persona.instance.updated", "instance_id": instance_id, "instance": out.model_dump(mode="json")},
    )
    return out


@app.delete("/rooms/{room_id}/persona-instances/{instance_id}")
async def delete_persona_instance(
    room_id: str, instance_id: str, session: AsyncSession = Depends(get_session)
):
    instance = await session.get(PersonaInstance, instance_id)
    if not instance or instance.room_id != room_id:
        raise HTTPException(404, "persona instance not found")
    await session.delete(instance)
    await trace_record(
        session, room_id, "state_mutation", "persona instance removed", {"instance_id": instance_id}
    )
    await session.commit()
    await event_bus.publish(room_id, {"type": "persona.instance.removed", "instance_id": instance_id})
    return {"status": "deleted"}


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
        completion_tokens=estimate_tokens(body.content),
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
    # body.persona_id is a TEMPLATE id; resolve to the room's instance.
    instance: PersonaInstance | None = None
    if body.persona_id:
        instance = await session.scalar(
            select(PersonaInstance).where(
                PersonaInstance.room_id == room_id,
                PersonaInstance.template_id == body.persona_id,
            )
        )
        if not instance or instance.kind != "discussant":
            raise HTTPException(400, "masquerade persona must be a discussant present in this room")
    display_name = (body.display_name or "").strip()
    if not display_name:
        display_name = instance.name if instance else "群友"
    message = Message(
        room_id=room_id,
        phase_instance_id=runtime.current_phase_instance_id,
        message_type=body.message_type,
        author_persona_id=instance.id if instance else None,
        author_model=instance.backing_model if instance else None,
        author_actual="user_as_persona",
        user_masquerade_persona_id=instance.id if instance else None,
        user_masquerade_name=display_name,
        visibility="public",
        visibility_to_models=True,
        content=body.content,
        completion_tokens=estimate_tokens(body.content),
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
    existing_reveal = await session.scalar(
        select(Message)
        .where(
            Message.room_id == room_id,
            Message.message_type == "masquerade_reveal",
            Message.parent_message_id == message_id,
        )
        .order_by(Message.created_at)
    )
    revealed_at = existing_reveal.created_at if existing_reveal else None
    reveal_event: dict | None = None
    if existing_reveal is None:
        reveal = Message(
            room_id=room_id,
            phase_instance_id=message.phase_instance_id,
            parent_message_id=message_id,
            message_type="masquerade_reveal",
            author_actual="user",
            visibility="observer_only",
            visibility_to_models=False,
            content=f"揭示伪装消息：{message_id}",
        )
        session.add(reveal)
        await session.flush()
        revealed_at = reveal.created_at
        await trace_record(session, room_id, "masquerade_revealed", "masquerade revealed", {"message_id": message_id, "reveal_message_id": reveal.id})
        reveal_event = MessageOut.model_validate(reveal).model_dump(mode="json")
    await session.commit()
    if reveal_event:
        await event_bus.publish(room_id, {"type": "message.appended", "message": reveal_event})
    response = MessageOut.model_validate(message)
    response.user_revealed_at = revealed_at
    return response


@app.post("/rooms/{room_id}/turn", response_model=list[MessageOut])
async def run_turn(room_id: str, body: TurnRequest, session: AsyncSession = Depends(get_session)):
    runtime = await _runtime_or_404(session, room_id)
    _ensure_not_frozen(runtime)
    try:
        messages = await run_room_turn(session, room_id, body.speaker_persona_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return messages


@app.post("/rooms/{room_id}/autodrive/resume")
async def resume_autodrive(room_id: str, session: AsyncSession = Depends(get_session)):
    """Manually kick the autodrive chain.

    Lets the user "let the AI keep talking" without typing anything. No-op if
    the chain is already running or any persona stream is in flight.
    """
    runtime = await _runtime_or_404(session, room_id)
    _ensure_not_frozen(runtime)
    started = schedule_autodrive(room_id)
    return {"status": "started" if started else "skipped", "active": is_autodrive_active(room_id)}


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


@app.post("/rooms/{room_id}/phase/extend", response_model=RoomState)
async def extend_phase(room_id: str, session: AsyncSession = Depends(get_session)):
    """Add one round to the current phase's `rounds` / `phase_round_limit` budgets."""
    runtime = await _runtime_or_404(session, room_id)
    _ensure_not_frozen(runtime)
    await extend_current_phase(session, room_id)
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
    if body.max_phase_rounds is not None:
        runtime.max_phase_rounds = body.max_phase_rounds
    if body.max_account_daily_tokens is not None:
        runtime.max_account_daily_tokens = body.max_account_daily_tokens
    if body.max_account_monthly_tokens is not None:
        runtime.max_account_monthly_tokens = body.max_account_monthly_tokens
    if body.max_consecutive_ai_turns is not None:
        runtime.max_consecutive_ai_turns = body.max_consecutive_ai_turns
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


@app.delete("/rooms/{room_id}")
async def delete_room(room_id: str, session: AsyncSession = Depends(get_session)):
    """Hard-delete a room and all of its dependents. Cancels any in-flight
    streams first so background tasks don't write to a vanished row."""
    room = await session.get(Room, room_id)
    if not room:
        raise HTTPException(404, "room not found")
    # Cancel any in-flight LLM streams AND wait for them to actually unwind
    # before issuing DELETEs. `task.cancel()` only schedules a CancelledError
    # at the next await point — the task may still be holding a DB session
    # (and a SQLite write lock) when this function continues. Without the
    # await below, DELETE races the still-running task and trips
    # `database is locked`.
    in_flight = active_calls_for_room(room_id)
    for active_call in in_flight:
        active_call.cancel("room_deleted")
    if in_flight:
        await asyncio.gather(
            *(call.task for call in in_flight), return_exceptions=True
        )
    # Order matters: clear children before parents to satisfy FKs even when
    # ON DELETE CASCADE isn't declared.
    from .models import (
        Decision as _Decision,
        FacilitatorSignal as _FacilitatorSignal,
        MergeBack as _MergeBack,
        RoomPhaseInstance as _RoomPhaseInstance,
        RoomPhasePlan as _RoomPhasePlan,
        RoomSnapshot as _RoomSnapshot,
        ScribeState as _ScribeState,
        TraceEvent as _TraceEvent,
    )
    await session.execute(delete(ToolInvocation).where(ToolInvocation.room_id == room_id))
    await session.execute(delete(Message).where(Message.room_id == room_id))
    await session.execute(delete(_Decision).where(_Decision.room_id == room_id))
    await session.execute(delete(_FacilitatorSignal).where(_FacilitatorSignal.room_id == room_id))
    await session.execute(delete(_RoomPhaseInstance).where(_RoomPhaseInstance.room_id == room_id))
    await session.execute(delete(_RoomPhasePlan).where(_RoomPhasePlan.room_id == room_id))
    await session.execute(delete(_ScribeState).where(_ScribeState.room_id == room_id))
    await session.execute(delete(RoomRuntimeState).where(RoomRuntimeState.room_id == room_id))
    await session.execute(delete(PersonaInstance).where(PersonaInstance.room_id == room_id))
    await session.execute(delete(_RoomSnapshot).where(_RoomSnapshot.room_id == room_id))
    await session.execute(delete(_TraceEvent).where(_TraceEvent.room_id == room_id))
    # MergeBack rows reference room as parent or sub-room; drop any pointing here.
    await session.execute(
        delete(_MergeBack).where(
            (_MergeBack.parent_room_id == room_id) | (_MergeBack.sub_room_id == room_id)
        )
    )
    # Uploads are tied loosely (nullable room_id) — keep the file row, null out
    # the link so the upload library survives.
    await session.execute(update(Upload).where(Upload.room_id == room_id).values(room_id=None))
    # Subrooms reference parent via parent_room_id (no FK). Without this, deleting
    # a parent leaves orphan children whose non-null parent_room_id makes the
    # sidebar filter hide them — they vanish from the list.
    await session.execute(update(Room).where(Room.parent_room_id == room_id).values(parent_room_id=None))
    await session.delete(room)
    await session.commit()
    await event_bus.publish(room_id, {"type": "room.deleted"})
    return {"status": "deleted", "room_id": room_id}


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
    # Allow global uploads (room_id is None) to be claimed by the first room
    # that references them. Already-bound uploads stay locked to their room.
    if upload.room_id is not None and upload.room_id != room_id:
        raise HTTPException(403, "upload already belongs to a different room")
    if upload.room_id is None:
        upload.room_id = room_id
    message = Message(
        room_id=room_id,
        phase_instance_id=runtime.current_phase_instance_id,
        message_type="user_doc",
        author_actual="user",
        visibility="public",
        visibility_to_models=True,
        content=f"# {upload.filename}\n\n{upload.extracted_text}",
        completion_tokens=estimate_tokens(upload.extracted_text),
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


@app.get("/rooms/{room_id}/export")
async def export_room(
    room_id: str,
    format: str = "md",
    session: AsyncSession = Depends(get_session),
) -> Response:
    if format != "md":
        raise HTTPException(400, "unsupported export format")
    room = await session.get(Room, room_id)
    if room is None:
        raise HTTPException(404, "room not found")
    markdown, filename = await render_room_markdown(session, room)
    return Response(
        content=markdown,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": build_content_disposition(filename)},
    )


# --- Story World ---------------------------------------------------------


async def _get_world_or_404(session: AsyncSession, world_id: str) -> World:
    world = await session.get(World, world_id)
    if world is None:
        raise HTTPException(404, "world not found")
    return world


async def _get_character_or_404(
    session: AsyncSession, world_id: str, character_id: str
) -> WorldCharacter:
    character = await session.get(WorldCharacter, character_id)
    if character is None or character.world_id != world_id:
        raise HTTPException(404, "character not found")
    return character


async def _validate_persona_template_for_character(
    session: AsyncSession, kind: str, persona_template_id: str | None
) -> tuple[str | None, int | None]:
    """For ai characters, persona_template_id is required and must resolve to
    an existing template. Returns (template_id, template_version) snapshot."""
    if kind == "ai":
        if not persona_template_id:
            raise HTTPException(422, "ai characters require persona_template_id")
        template = await session.get(PersonaTemplate, persona_template_id)
        if template is None:
            raise HTTPException(422, "persona_template_id does not exist")
        return template.id, template.version
    # user characters never bind to a template
    return None, None


@app.get("/worlds", response_model=list[WorldSummaryOut])
async def list_worlds(session: AsyncSession = Depends(get_session)):
    worlds = (await session.scalars(select(World).order_by(World.created_at.desc()))).all()
    if not worlds:
        return []
    world_ids = [w.id for w in worlds]
    counts = dict(
        (
            await session.execute(
                select(WorldCharacter.world_id, func.count(WorldCharacter.id))
                .where(WorldCharacter.world_id.in_(world_ids))
                .where(WorldCharacter.status == "active")
                .group_by(WorldCharacter.world_id)
            )
        ).all()
    )
    scene_counts = dict(
        (
            await session.execute(
                select(Room.world_id, func.count(Room.id))
                .where(Room.world_id.in_(world_ids))
                .group_by(Room.world_id)
            )
        ).all()
    )
    # last_activity_at is the latest of (scene.created_at, latest message.created_at)
    # across all scenes in the world. Compute via JOIN so 0-message scenes still
    # contribute their created_at.
    activity_rows = (
        await session.execute(
            select(Room.world_id, func.max(Message.created_at))
            .join(Message, Message.room_id == Room.id, isouter=True)
            .where(Room.world_id.in_(world_ids))
            .group_by(Room.world_id)
        )
    ).all()
    last_activity = {wid: ts for wid, ts in activity_rows}
    out: list[WorldSummaryOut] = []
    for world in worlds:
        summary = WorldSummaryOut.model_validate(world)
        summary.character_count = int(counts.get(world.id, 0))
        summary.scene_count = int(scene_counts.get(world.id, 0))
        summary.last_activity_at = last_activity.get(world.id)
        out.append(summary)
    return out


@app.post("/worlds", response_model=WorldDetailOut)
async def create_world(body: WorldCreate, session: AsyncSession = Depends(get_session)):
    world = World(
        id=new_id(),
        name=body.name,
        synopsis=body.synopsis,
        setting=body.setting,
        calendar_hint=body.calendar_hint,
        cover_color=body.cover_color,
        cover_icon=body.cover_icon,
        config=dict(body.config or {}),
    )
    session.add(world)
    await session.commit()
    await session.refresh(world)
    detail = WorldDetailOut.model_validate(world)
    detail.characters = []
    return detail


@app.get("/worlds/{world_id}", response_model=WorldDetailOut)
async def get_world(world_id: str, session: AsyncSession = Depends(get_session)):
    world = await _get_world_or_404(session, world_id)
    characters = (
        await session.scalars(
            select(WorldCharacter)
            .where(WorldCharacter.world_id == world_id)
            .order_by(WorldCharacter.created_at)
        )
    ).all()
    detail = WorldDetailOut.model_validate(world)
    detail.characters = [WorldCharacterOut.model_validate(c) for c in characters]
    return detail


@app.patch("/worlds/{world_id}", response_model=WorldDetailOut)
async def update_world(
    world_id: str, body: WorldUpdate, session: AsyncSession = Depends(get_session)
):
    world = await _get_world_or_404(session, world_id)
    changes = body.model_dump(mode="json", exclude_unset=True)
    for field, value in changes.items():
        setattr(world, field, value)
    await session.commit()
    await session.refresh(world)
    characters = (
        await session.scalars(
            select(WorldCharacter)
            .where(WorldCharacter.world_id == world_id)
            .order_by(WorldCharacter.created_at)
        )
    ).all()
    detail = WorldDetailOut.model_validate(world)
    detail.characters = [WorldCharacterOut.model_validate(c) for c in characters]
    return detail


@app.delete("/worlds/{world_id}")
async def delete_world(world_id: str, session: AsyncSession = Depends(get_session)):
    world = await _get_world_or_404(session, world_id)
    # Characters cascade via FK ON DELETE CASCADE. Scenes (Room.world_id) come
    # in PR 2; their cascade is added when that column is introduced.
    await session.delete(world)
    await session.commit()
    return {"status": "deleted"}


@app.post("/worlds/{world_id}/characters", response_model=WorldCharacterOut)
async def create_world_character(
    world_id: str,
    body: WorldCharacterCreate,
    session: AsyncSession = Depends(get_session),
):
    await _get_world_or_404(session, world_id)
    template_id, template_version = await _validate_persona_template_for_character(
        session, body.kind, body.persona_template_id
    )
    character = WorldCharacter(
        id=new_id(),
        world_id=world_id,
        kind=body.kind,
        name=body.name,
        identity=body.identity,
        brief=body.brief,
        persona_template_id=template_id,
        persona_template_version=template_version,
        backing_overrides=dict(body.backing_overrides or {}),
        color=body.color,
        icon=body.icon,
        core_identity=body.core_identity,
        skills_text=body.skills_text,
        goals_text=body.goals_text,
        config=dict(body.config or {}),
    )
    session.add(character)
    await session.commit()
    await session.refresh(character)
    return character


@app.get("/worlds/{world_id}/characters/{character_id}", response_model=WorldCharacterOut)
async def get_world_character(
    world_id: str, character_id: str, session: AsyncSession = Depends(get_session)
):
    return await _get_character_or_404(session, world_id, character_id)


@app.patch("/worlds/{world_id}/characters/{character_id}", response_model=WorldCharacterOut)
async def update_world_character(
    world_id: str,
    character_id: str,
    body: WorldCharacterUpdate,
    session: AsyncSession = Depends(get_session),
):
    character = await _get_character_or_404(session, world_id, character_id)
    changes = body.model_dump(mode="json", exclude_unset=True)
    if "persona_template_id" in changes:
        new_template_id = changes["persona_template_id"]
        if character.kind == "user":
            if new_template_id is not None:
                raise HTTPException(422, "user characters cannot bind to a persona template")
        elif new_template_id is None:
            raise HTTPException(422, "ai characters require persona_template_id")
        else:
            template = await session.get(PersonaTemplate, new_template_id)
            if template is None:
                raise HTTPException(422, "persona_template_id does not exist")
            changes["persona_template_version"] = template.version
    for field, value in changes.items():
        setattr(character, field, value)
    await session.commit()
    await session.refresh(character)
    return character


@app.delete("/worlds/{world_id}/characters/{character_id}", response_model=WorldCharacterOut)
async def delete_world_character(
    world_id: str, character_id: str, session: AsyncSession = Depends(get_session)
):
    """Soft delete: status -> retired so existing scenes/memories keep their references."""
    character = await _get_character_or_404(session, world_id, character_id)
    character.status = "retired"
    await session.commit()
    await session.refresh(character)
    return character


# --- Scenes (Rooms within a World) --------------------------------------


def _compose_scene_persona_prompt(
    world: World, character: WorldCharacter, scene: Room
) -> str:
    """Bake World + character context into the persona's system_prompt at
    PersonaInstance creation time.

    Editing the source World/Character later does *not* retroactively rewrite
    instances of already-created scenes (per design doc R2). New scenes pick
    up fresh context.
    """
    parts: list[str] = []
    # World block
    world_lines: list[str] = []
    if world.synopsis.strip():
        world_lines.append(world.synopsis.strip())
    if world.setting.strip():
        world_lines.append(f"设定：{world.setting.strip()}")
    if world.calendar_hint.strip():
        world_lines.append(f"纪年法：{world.calendar_hint.strip()}")
    if world_lines:
        parts.append(f"## 世界『{world.name}』\n" + "\n".join(world_lines))
    # Character block
    identity = character.identity.strip()
    char_header = f"你是「{character.name}」"
    if identity:
        char_header += f"（{identity}）"
    char_header += "。"
    char_lines = [char_header]
    if character.core_identity.strip():
        char_lines.append(character.core_identity.strip())
    if character.brief.strip():
        char_lines.append(character.brief.strip())
    if character.skills_text.strip():
        char_lines.append(f"技能：{character.skills_text.strip()}")
    if character.goals_text.strip():
        char_lines.append(f"当前目标：{character.goals_text.strip()}")
    parts.append("## 你是谁\n" + "\n".join(char_lines))
    # Scene block (time + background hints)
    scene_lines: list[str] = []
    if scene.in_world_time_start.strip():
        scene_lines.append(f"时间：{scene.in_world_time_start.strip()}")
    if scene.in_world_duration_hint.strip():
        scene_lines.append(f"时长：{scene.in_world_duration_hint.strip()}")
    if scene.background.strip():
        scene_lines.append(scene.background.strip())
    if scene_lines:
        parts.append(f"## 这一幕（第 {scene.scene_index} 幕）\n" + "\n".join(scene_lines))
    return "\n\n".join(parts)


async def _create_scene_persona_instance(
    session: AsyncSession,
    scene: Room,
    world: World,
    character: WorldCharacter,
    next_position: int,
) -> PersonaInstance:
    """Snapshot a WorldCharacter (kind=ai) into a PersonaInstance for the scene.
    Mirrors `_create_persona_instances` but pulls from the bound PersonaTemplate
    plus World/character context."""
    if character.kind != "ai":
        raise HTTPException(422, f"character {character.id} is not an ai character")
    if not character.persona_template_id:
        raise HTTPException(422, f"character {character.id} has no persona_template_id")
    template = await session.get(PersonaTemplate, character.persona_template_id)
    if template is None:
        raise HTTPException(422, f"persona template {character.persona_template_id} not found")
    composed_prompt = _compose_scene_persona_prompt(world, character, scene)
    full_prompt = template.system_prompt
    if composed_prompt:
        full_prompt = f"{template.system_prompt}\n\n{composed_prompt}"
    instance = PersonaInstance(
        id=new_id(),
        room_id=scene.id,
        template_id=template.id,
        template_version=template.version,
        position=next_position,
        kind=template.kind,
        # Use the WorldCharacter's name/identity (not the template's), so the
        # scene shows the character as the World named them.
        name=character.name,
        identity=character.identity,
        description=character.brief or template.description,
        backing_model=template.backing_model,
        api_provider_id=template.api_provider_id,
        api_model_id=template.api_model_id,
        system_prompt=full_prompt,
        temperature=template.temperature,
        talkativeness=template.talkativeness,
        color=character.color,
        icon=character.icon,
        config=dict(template.config or {}),
        tags=list(template.tags or []),
        world_character_id=character.id,
    )
    session.add(instance)
    return instance


async def _next_scene_index(session: AsyncSession, world_id: str) -> int:
    current_max = await session.scalar(
        select(func.max(Room.scene_index)).where(Room.world_id == world_id)
    )
    return int(current_max or 0) + 1


async def _resolve_story_format(session: AsyncSession) -> DebateFormat | None:
    fmt = await session.get(
        DebateFormat, builtin_id("format", "story_format")
    )
    if fmt is not None:
        return fmt
    # Fallback: any format tagged 'story', else None and let create_room pick default.
    return await session.scalar(
        select(DebateFormat).where(DebateFormat.name == "故事模式")
    )


@app.post("/worlds/{world_id}/scenes", response_model=RoomState)
async def create_scene(
    world_id: str, body: SceneCreate, session: AsyncSession = Depends(get_session)
):
    world = await _get_world_or_404(session, world_id)
    # Resolve format: caller-provided OR story_format default.
    selected_format = (
        await _select_format(session, body.format_id) if body.format_id else None
    )
    if selected_format is None:
        selected_format = await _resolve_story_format(session)
    if selected_format is None:
        raise HTTPException(500, "story_format builtin missing — re-run init_db")

    selected_recipe = await _select_recipe(session, body.recipe_id)
    settings_payload = selected_recipe.initial_settings if selected_recipe else {}

    # Validate roster: all character ids must belong to this World, no dupes,
    # no retired characters.
    seen_ids: set[str] = set()
    resolved_members: list[tuple[SceneRosterEntry, WorldCharacter]] = []
    for entry in body.members:
        if entry.world_character_id in seen_ids:
            raise HTTPException(422, f"duplicate roster entry: {entry.world_character_id}")
        seen_ids.add(entry.world_character_id)
        character = await session.get(WorldCharacter, entry.world_character_id)
        if character is None or character.world_id != world_id:
            raise HTTPException(422, f"character {entry.world_character_id} not in this world")
        if character.status != "active":
            raise HTTPException(422, f"character {character.id} is retired")
        resolved_members.append((entry, character))

    scene_index = await _next_scene_index(session, world_id)
    scene = Room(
        id=new_id(),
        title=body.title,
        background=body.background,
        format_id=selected_format.id,
        format_version=selected_format.version,
        status="active",
        world_id=world_id,
        scene_index=scene_index,
        in_world_time_start=body.in_world_time_start,
        in_world_time_end=body.in_world_time_end,
        in_world_duration_hint=body.in_world_duration_hint,
    )
    session.add(scene)
    await session.flush()

    runtime = RoomRuntimeState(
        room_id=scene.id,
        max_message_tokens=settings_payload.get("max_message_tokens", 900),
        max_room_tokens=settings_payload.get("max_room_tokens", 120000),
        max_phase_rounds=settings_payload.get("max_phase_rounds", 3),
        max_account_daily_tokens=settings_payload.get("max_account_daily_tokens", 250000),
        max_account_monthly_tokens=settings_payload.get("max_account_monthly_tokens", 3000000),
        max_consecutive_ai_turns=settings_payload.get("max_consecutive_ai_turns", 10),
        auto_transition=settings_payload.get("auto_transition", False),
    )
    scribe = ScribeState(room_id=scene.id, current_state=DEFAULT_SCRIBE_STATE.copy())
    session.add_all([runtime, scribe])

    # Always include the system scribe + facilitator personas — they don't
    # bind to a WorldCharacter but the engine still expects their slots.
    await _create_persona_instances(session, scene.id, await _system_persona_ids(session))

    # AI characters get PersonaInstance with World+character-baked prompt.
    next_position = (
        await session.scalar(
            select(func.coalesce(func.max(PersonaInstance.position), -1) + 1).where(
                PersonaInstance.room_id == scene.id
            )
        )
    ) or 0
    for entry, character in resolved_members:
        if character.kind == "ai":
            await _create_scene_persona_instance(
                session, scene, world, character, int(next_position)
            )
            next_position = int(next_position) + 1
        # Roster row for both kinds — entered_at_message_id NULL = on stage from open.
        session.add(
            WorldSceneMember(
                scene_id=scene.id,
                world_character_id=character.id,
                role_in_scene=entry.role_in_scene,
                speak_as_user=entry.speak_as_user,
            )
        )

    # Phase plan from format.
    for index, slot in enumerate(selected_format.phase_sequence or []):
        session.add(
            RoomPhasePlan(
                room_id=scene.id,
                position=index,
                phase_template_id=slot["phase_template_id"],
                phase_template_version=slot.get("phase_template_version", 1),
                source="format",
                variable_bindings={},
            )
        )
    await session.flush()
    await transition_to_next_phase(session, scene.id, target_position=0)
    await trace_record(
        session,
        scene.id,
        "state_mutation",
        "scene created",
        {"world_id": world_id, "scene_index": scene_index, "member_count": len(resolved_members)},
    )
    await session.commit()
    return await _room_state(session, scene.id)


@app.get("/worlds/{world_id}/timeline", response_model=list[SceneTimelineEntry])
async def get_world_timeline(world_id: str, session: AsyncSession = Depends(get_session)):
    await _get_world_or_404(session, world_id)
    scenes = (
        await session.scalars(
            select(Room)
            .where(Room.world_id == world_id, Room.scene_index.is_not(None))
            .order_by(Room.scene_index)
        )
    ).all()
    if not scenes:
        return []
    scene_ids = [scene.id for scene in scenes]
    member_counts = dict(
        (
            await session.execute(
                select(WorldSceneMember.scene_id, func.count(WorldSceneMember.world_character_id))
                .where(WorldSceneMember.scene_id.in_(scene_ids))
                .group_by(WorldSceneMember.scene_id)
            )
        ).all()
    )
    message_counts = dict(
        (
            await session.execute(
                select(Message.room_id, func.count(Message.id))
                .where(Message.room_id.in_(scene_ids))
                .group_by(Message.room_id)
            )
        ).all()
    )
    out: list[SceneTimelineEntry] = []
    for scene in scenes:
        out.append(
            SceneTimelineEntry(
                id=scene.id,
                scene_index=scene.scene_index or 0,
                title=scene.title,
                status=scene.status,  # type: ignore[arg-type]
                sealed_at=scene.sealed_at,
                in_world_time_start=scene.in_world_time_start,
                in_world_time_end=scene.in_world_time_end,
                in_world_duration_hint=scene.in_world_duration_hint,
                member_count=int(member_counts.get(scene.id, 0)),
                message_count=int(message_counts.get(scene.id, 0)),
                created_at=scene.created_at,
            )
        )
    return out


async def _scene_or_404(session: AsyncSession, room_id: str) -> Room:
    """Resolve a Room and reject if it isn't a scene (no world_id)."""
    room = await session.get(Room, room_id)
    if room is None:
        raise HTTPException(404, "room not found")
    if not room.world_id:
        raise HTTPException(409, "room is not a scene of any world")
    return room


@app.post("/rooms/{room_id}/scene/enter", response_model=WorldSceneMemberOut)
async def scene_enter(
    room_id: str, body: SceneEnterRequest, session: AsyncSession = Depends(get_session)
):
    """Add a character to the scene mid-stream. Appends a participant.enter
    system message (visible to models) and binds the character into the roster."""
    scene = await _scene_or_404(session, room_id)
    runtime = await _runtime_or_404(session, room_id)
    _ensure_not_frozen(runtime)
    if scene.sealed_at is not None:
        raise HTTPException(409, "scene is sealed")
    character = await session.get(WorldCharacter, body.world_character_id)
    if character is None or character.world_id != scene.world_id:
        raise HTTPException(422, "character not in this world")
    if character.status != "active":
        raise HTTPException(422, "character is retired")
    existing = await session.get(
        WorldSceneMember, {"scene_id": scene.id, "world_character_id": character.id}
    )
    if existing is not None:
        raise HTTPException(409, "character already on the scene roster")
    world = await _get_world_or_404(session, scene.world_id)
    description = body.description.strip() or f"{character.name} 进入了场景。"
    message = Message(
        room_id=scene.id,
        phase_instance_id=runtime.current_phase_instance_id,
        message_type="participant.enter",
        author_actual="system",
        visibility="public",
        visibility_to_models=True,
        content=description,
        completion_tokens=estimate_tokens(description),
        cost_usd=0,
    )
    session.add(message)
    await session.flush()

    if character.kind == "ai":
        next_position = (
            await session.scalar(
                select(func.coalesce(func.max(PersonaInstance.position), -1) + 1).where(
                    PersonaInstance.room_id == scene.id
                )
            )
        ) or 0
        await _create_scene_persona_instance(
            session, scene, world, character, int(next_position)
        )
    member = WorldSceneMember(
        scene_id=scene.id,
        world_character_id=character.id,
        role_in_scene=body.role_in_scene,
        speak_as_user=body.speak_as_user,
        entered_at_message_id=message.id,
    )
    session.add(member)
    await trace_record(
        session,
        scene.id,
        "state_mutation",
        "scene member entered",
        {"character_id": character.id, "message_id": message.id},
    )
    await session.commit()
    await session.refresh(member)
    await event_bus.publish(
        scene.id,
        {"type": "message.appended", "message": MessageOut.model_validate(message).model_dump(mode="json")},
    )
    return member


@app.post("/rooms/{room_id}/scene/exit", response_model=WorldSceneMemberOut)
async def scene_exit(
    room_id: str, body: SceneExitRequest, session: AsyncSession = Depends(get_session)
):
    """Mark a character as having left the scene. Appends a participant.exit
    message; future routing skips them."""
    scene = await _scene_or_404(session, room_id)
    runtime = await _runtime_or_404(session, room_id)
    _ensure_not_frozen(runtime)
    if scene.sealed_at is not None:
        raise HTTPException(409, "scene is sealed")
    member = await session.get(
        WorldSceneMember, {"scene_id": scene.id, "world_character_id": body.world_character_id}
    )
    if member is None:
        raise HTTPException(404, "character not on this scene's roster")
    if member.exited_at_message_id is not None:
        raise HTTPException(409, "character has already exited this scene")
    character = await session.get(WorldCharacter, body.world_character_id)
    description = body.description.strip() or (
        f"{character.name} 离开了场景。" if character else "角色离开了场景。"
    )
    message = Message(
        room_id=scene.id,
        phase_instance_id=runtime.current_phase_instance_id,
        message_type="participant.exit",
        author_actual="system",
        visibility="public",
        visibility_to_models=True,
        content=description,
        completion_tokens=estimate_tokens(description),
        cost_usd=0,
    )
    session.add(message)
    await session.flush()
    member.exited_at_message_id = message.id
    await trace_record(
        session,
        scene.id,
        "state_mutation",
        "scene member exited",
        {"character_id": body.world_character_id, "message_id": message.id},
    )
    await session.commit()
    await session.refresh(member)
    await event_bus.publish(
        scene.id,
        {"type": "message.appended", "message": MessageOut.model_validate(message).model_dump(mode="json")},
    )
    return member


@app.post("/rooms/{room_id}/seal", response_model=RoomOut)
async def seal_scene(room_id: str, session: AsyncSession = Depends(get_session)):
    """Mark a scene as sealed.

    PR 2 just sets the timestamp — no memory pipeline yet (that's PR 3+).
    Sealed scenes reject further enter/exit and message posts (the existing
    freeze guard handles message posts; enter/exit checks sealed_at).
    """
    scene = await _scene_or_404(session, room_id)
    if scene.sealed_at is not None:
        return scene
    scene.sealed_at = datetime.now(timezone.utc)
    await trace_record(session, scene.id, "state_mutation", "scene sealed", {})
    await session.commit()
    await session.refresh(scene)
    return scene


@app.get("/rooms/{room_id}/scene/members", response_model=list[WorldSceneMemberOut])
async def list_scene_members(room_id: str, session: AsyncSession = Depends(get_session)):
    """Returns the full roster (active + exited) ordered by joined_at."""
    scene = await _scene_or_404(session, room_id)
    rows = (
        await session.scalars(
            select(WorldSceneMember)
            .where(WorldSceneMember.scene_id == scene.id)
            .order_by(WorldSceneMember.joined_at)
        )
    ).all()
    return rows


async def _scenario_catalog(session: AsyncSession) -> list[ScenarioOut]:
    recipes = {
        row.name: row.id
        for row in (
            await session.scalars(select(Recipe).where(Recipe.name.in_(["方案评审默认配方", "开放圆桌默认配方"])))
        ).all()
    }
    formats = {
        row.name: row.id
        for row in (
            await session.scalars(select(DebateFormat).where(DebateFormat.name.in_(["方案评审", "头脑风暴", "苏格拉底诘问", "自由模式"])))
        ).all()
    }
    return [
        ScenarioOut(
            id="architecture-review",
            title="技术方案评审",
            description="让架构、性能、维护和反方角色围绕一个方案做立论、质询、答辩和打分。",
            prompt="请评审这个技术方案：\n\n背景：\n目标：\n方案概要：\n关键约束：\n我最担心的问题：",
            tags=["review", "technical"],
            recipe_id=recipes.get("方案评审默认配方"),
            format_id=formats.get("方案评审"),
        ),
        ScenarioOut(
            id="product-roundtable",
            title="产品决策圆桌",
            description="从产品价值、用户体验、风险和落地成本四个视角比较备选方案。",
            prompt="请帮我比较这些产品方案并给出推荐：\n\n用户目标：\n备选方案：\n当前数据或反馈：\n时间/资源约束：",
            tags=["product", "decision"],
            recipe_id=recipes.get("开放圆桌默认配方"),
            format_id=formats.get("自由模式"),
        ),
        ScenarioOut(
            id="brainstorm-options",
            title="发散头脑风暴",
            description="并行产出差异化想法，先扩展空间，再由用户收敛。",
            prompt="请围绕这个目标发散 10 个方向不同的方案，暂时不要批评：\n\n目标：\n受众：\n限制：",
            tags=["brainstorm"],
            format_id=formats.get("头脑风暴"),
        ),
        ScenarioOut(
            id="socratic-risk-check",
            title="假设压力测试",
            description="用连续追问暴露一个判断、商业假设或技术选择里的薄弱点。",
            prompt="请用苏格拉底式诘问压力测试这个判断：\n\n我的判断：\n我相信它的原因：\n需要验证的结果：",
            tags=["risk", "socratic"],
            format_id=formats.get("苏格拉底诘问"),
        ),
    ]


async def _template_assistant_runtime(session: AsyncSession):
    row = await _get_or_create_app_settings(session)
    model_name = ""
    provider = None
    if row.default_api_model_id:
        api_model = await session.get(ApiModel, row.default_api_model_id)
        if api_model and api_model.enabled:
            model_name = api_model.model_name
            provider = await session.get(ApiProvider, api_model.api_provider_id)
    if not model_name and row.default_backing_model and row.default_api_provider_id:
        model_name = row.default_backing_model
        provider = await session.get(ApiProvider, row.default_api_provider_id)
    if not model_name:
        return None, None
    return (
        SimpleNamespace(
            backing_model=model_name,
            temperature=0.2,
            config={},
            system_prompt=(
                "你是 MAI 模板起草助手。根据用户的自然语言需求，输出可直接保存的模板字段。"
                "不要编造外部事实；优先给出简洁、可执行、中文字段。"
            ),
        ),
        provider,
    )


def _fallback_template_draft(kind: str, prompt: str) -> TemplateDraftOut:
    text = (prompt or "").strip()
    title = text.splitlines()[0][:28].strip(" ：:，,。") if text else ""
    if not title:
        title = {"persona": "新智能体", "phase": "新讨论阶段", "recipe": "新讨论配方"}[kind]
    if kind == "persona":
        return TemplateDraftOut(
            kind="persona",
            payload={
                "kind": "discussant",
                "name": title,
                "identity": "",
                "description": text[:160],
                "system_prompt": f"你是{title}。请围绕用户目标给出具体、可执行、基于证据的观点。",
                "temperature": 0.4,
                "config": {},
                "tags": ["assistant-draft"],
            },
            rationale="基于输入生成了可编辑的角色草稿。",
        )
    if kind == "phase":
        return TemplateDraftOut(
            kind="phase",
            payload={
                "name": title,
                "description": text[:160],
                "declared_variables": [],
                "allowed_speakers": {"type": "all"},
                "ordering_rule": {"type": "mention_driven"},
                "exit_conditions": [{"type": "user_manual"}],
                "auto_discuss": True,
                "role_constraints": "聚焦当前目标，避免重复已经达成的共识。",
                "prompt_template": text or "请基于当前上下文给出下一步有效发言。",
                "tags": ["assistant-draft"],
            },
            rationale="基于输入生成了可编辑的阶段草稿。",
        )
    return TemplateDraftOut(
        kind="recipe",
        payload={
            "name": title,
            "description": text[:160],
            "persona_ids": [],
            "initial_settings": {"max_phase_rounds": 3, "auto_transition": False},
            "tags": ["assistant-draft"],
        },
        rationale="基于输入生成了可编辑的配方草稿。",
    )


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
    # Key on deterministic built-in ids so future name/identity changes
    # don't silently break the default discussant set.
    default_keys = ("architect", "performance_critic", "maintainer", "devils_advocate")
    candidate_ids = [builtin_id("persona", key) for key in default_keys]
    rows = (
        await session.scalars(
            select(PersonaTemplate.id)
            .where(
                PersonaTemplate.kind == "discussant",
                PersonaTemplate.id.in_(candidate_ids),
            )
            .order_by(PersonaTemplate.name)
        )
    ).all()
    return list(rows)


async def _system_persona_ids(session: AsyncSession) -> list[str]:
    return list(
        (
            await session.scalars(
                select(PersonaTemplate.id).where(
                    PersonaTemplate.kind.in_(["scribe", "facilitator"])
                )
            )
        ).all()
    )


async def _create_persona_instances(
    session: AsyncSession, room_id: str, template_ids: list[str]
) -> list[PersonaInstance]:
    """Snapshot each template into a fresh PersonaInstance scoped to the room.

    Skips template ids that don't resolve. Position is assigned per-room based
    on existing count so repeat calls keep ordering stable.
    """
    if not template_ids:
        return []
    next_position = (
        await session.scalar(
            select(func.coalesce(func.max(PersonaInstance.position), -1) + 1).where(
                PersonaInstance.room_id == room_id
            )
        )
    ) or 0
    created: list[PersonaInstance] = []
    for template_id in template_ids:
        template = await session.get(PersonaTemplate, template_id)
        if template is None:
            continue
        instance = PersonaInstance(
            id=new_id(),
            room_id=room_id,
            template_id=template.id,
            template_version=template.version,
            position=int(next_position),
            kind=template.kind,
            name=template.name,
            identity=template.identity,
            description=template.description,
            backing_model=template.backing_model,
            api_provider_id=template.api_provider_id,
            api_model_id=template.api_model_id,
            system_prompt=template.system_prompt,
            temperature=template.temperature,
            talkativeness=template.talkativeness,
            color=template.color,
            icon=template.icon,
            config=dict(template.config or {}),
            tags=list(template.tags or []),
        )
        session.add(instance)
        created.append(instance)
        next_position = int(next_position) + 1
    if created:
        await session.flush()
    return created


async def _room_state(session: AsyncSession, room_id: str) -> RoomState:
    room = await session.get(Room, room_id)
    runtime = await session.get(RoomRuntimeState, room_id)
    if not room or not runtime:
        raise HTTPException(404, "room not found")
    personas = (
        await session.scalars(
            select(PersonaInstance)
            .where(PersonaInstance.room_id == room_id)
            .order_by(PersonaInstance.kind, PersonaInstance.position, PersonaInstance.name)
        )
    ).all()
    phase_plan = (
        await session.scalars(select(RoomPhasePlan).where(RoomPhasePlan.room_id == room_id).order_by(RoomPhasePlan.position))
    ).all()
    current_phase = await session.get(RoomPhaseInstance, runtime.current_phase_instance_id) if runtime.current_phase_instance_id else None
    messages = (
        await session.scalars(select(Message).where(Message.room_id == room_id).order_by(Message.created_at))
    ).all()
    tool_invocations = (
        await session.scalars(
            select(ToolInvocation).where(ToolInvocation.room_id == room_id).order_by(ToolInvocation.created_at)
        )
    ).all()
    tool_by_message_id = {
        item.message_id: ToolInvocationOut.model_validate(item)
        for item in tool_invocations
        if item.message_id
    }
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
    in_flight_partial = []
    for active_call in active_calls_for_room(room_id):
        if not active_call.partial_text:
            continue
        in_flight_partial.append(
            InFlightPartialOut(
                message_id=active_call.message_id,
                persona_id=active_call.persona_id,
                content=active_call.partial_text,
                last_chunk_index=active_call.last_chunk_index,
                cumulative_tokens_estimate=estimate_tokens(active_call.partial_text),
            )
        )
    revealed_at_by_message_id = {
        message.parent_message_id: message.created_at
        for message in messages
        if message.message_type == "masquerade_reveal" and message.parent_message_id
    }
    message_outputs = []
    for message in messages:
        output = MessageOut.model_validate(message)
        if message.author_actual == "user_as_persona" and message.id in revealed_at_by_message_id:
            output.user_revealed_at = revealed_at_by_message_id[message.id]
        if message.id in tool_by_message_id:
            output.tool_invocation = tool_by_message_id[message.id]
        message_outputs.append(output)
    runtime_out = RoomRuntimeOut.model_validate(runtime)
    runtime_out.autodrive_active = is_autodrive_active(room_id)
    runtime_out.current_speakers = [call.persona_id for call in active_calls_for_room(room_id)]
    return RoomState(
        room=RoomOut.model_validate(room),
        runtime=runtime_out,
        personas=[PersonaInstanceOut.model_validate(p) for p in personas],
        phase_plan=[RoomPhasePlanOut.model_validate(p) for p in phase_plan],
        current_phase=RoomPhaseInstanceOut.model_validate(current_phase) if current_phase else None,
        messages=message_outputs,
        scribe_state=ScribeStateOut.model_validate(scribe_state),
        facilitator_signals=[FacilitatorSignalOut.model_validate(s) for s in signals],
        decisions=[DecisionOut.model_validate(d) for d in decisions],
        in_flight_partial=in_flight_partial,
        tool_invocations=[ToolInvocationOut.model_validate(item) for item in tool_invocations],
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


def _resolve_frontend_dist() -> Path | None:
    override = os.environ.get("MAI_FRONTEND_DIST")
    if override:
        path = Path(override)
        return path if path.exists() else None
    here = Path(__file__).resolve().parent  # backend/app
    pyinstaller_base = Path(getattr(sys, "_MEIPASS", "")) if getattr(sys, "frozen", False) else None
    candidates = [
        pyinstaller_base / "frontend-dist" if pyinstaller_base else None,
        here.parent.parent / "frontend" / "dist",  # repo dev layout
        here.parent / "frontend_dist",             # bundled next to backend/
        here / "frontend_dist",                    # bundled inside app/ (PyInstaller)
    ]
    for candidate in candidates:
        if candidate and candidate.is_dir() and (candidate / "index.html").is_file():
            return candidate
    return None


class SPAStaticFiles(StaticFiles):
    """StaticFiles with SPA fallback: any 404 is served as index.html."""

    async def get_response(self, path: str, scope):  # type: ignore[override]
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404:
                return await super().get_response("index.html", scope)
            raise


_frontend_dist = _resolve_frontend_dist()
if _frontend_dist is not None:
    app.mount("/", SPAStaticFiles(directory=_frontend_dist, html=True), name="frontend")
