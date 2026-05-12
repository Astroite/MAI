from dataclasses import dataclass
from typing import Any, Literal

from sqlalchemy.ext.asyncio import AsyncSession

from .models import ApiModel, ApiProvider, AppSettings, PersonaInstance


ModelRuntimeSource = Literal[
    "persona",
    "settings",
    "legacy_persona",
    "legacy_settings",
]


@dataclass(frozen=True)
class ResolvedModelRuntime:
    api_model_id: str | None
    model_name: str
    provider_id: str
    provider_slug: str
    api_base: str | None
    api_key: str | None
    source: ModelRuntimeSource

    def trace_payload(self) -> dict[str, str | None]:
        return {
            "source": self.source,
            "api_model_id": self.api_model_id,
            "provider_id": self.provider_id,
            "provider_slug": self.provider_slug,
            "model_name": self.model_name,
            "api_base": self.api_base,
        }


@dataclass(frozen=True)
class RuntimePersonaView:
    id: str
    name: str
    identity: str | None
    backing_model: str
    temperature: float
    config: dict[str, Any]
    system_prompt: str


async def _runtime_from_api_model(
    session: AsyncSession,
    api_model_id: str,
    source: Literal["persona", "settings"],
) -> ResolvedModelRuntime:
    api_model = await session.get(ApiModel, api_model_id)
    if api_model is None:
        raise ValueError(f"api model {api_model_id} not found")
    if not api_model.enabled:
        raise ValueError(f"api model {api_model.display_name} is disabled")
    provider = await session.get(ApiProvider, api_model.api_provider_id)
    if provider is None:
        raise ValueError(f"api provider {api_model.api_provider_id} not found")
    return ResolvedModelRuntime(
        api_model_id=api_model.id,
        model_name=api_model.model_name,
        provider_id=provider.id,
        provider_slug=provider.provider_slug,
        api_base=provider.api_base,
        api_key=provider.api_key,
        source=source,
    )


async def _runtime_from_legacy(
    session: AsyncSession,
    model_name: str,
    provider_id: str | None,
    source: Literal["legacy_persona", "legacy_settings"],
) -> ResolvedModelRuntime:
    if not model_name:
        raise ValueError(
            "no model configured: select persona.api_model_id or AppSettings.default_api_model_id"
        )
    if not provider_id:
        raise ValueError(
            "no API provider configured: select a model with an API provider"
        )
    provider = await session.get(ApiProvider, provider_id)
    if provider is None:
        raise ValueError(f"api provider {provider_id} not found")
    return ResolvedModelRuntime(
        api_model_id=None,
        model_name=model_name,
        provider_id=provider.id,
        provider_slug=provider.provider_slug,
        api_base=provider.api_base,
        api_key=provider.api_key,
        source=source,
    )


async def resolve_model_runtime(
    session: AsyncSession,
    persona: PersonaInstance | None = None,
) -> ResolvedModelRuntime:
    settings_row = await session.get(AppSettings, 1)

    if persona is not None and persona.api_model_id:
        return await _runtime_from_api_model(session, persona.api_model_id, "persona")

    if settings_row is not None and settings_row.default_api_model_id:
        return await _runtime_from_api_model(
            session,
            settings_row.default_api_model_id,
            "settings",
        )

    persona_model = (persona.backing_model or "").strip() if persona is not None else ""
    if persona_model and persona is not None:
        return await _runtime_from_legacy(
            session,
            persona_model,
            persona.api_provider_id,
            "legacy_persona",
        )

    settings_model = (settings_row.default_backing_model or "").strip() if settings_row is not None else ""
    if settings_model:
        return await _runtime_from_legacy(
            session,
            settings_model,
            settings_row.default_api_provider_id if settings_row else None,
            "legacy_settings",
        )

    raise ValueError(
        "no model configured: select persona.api_model_id or AppSettings.default_api_model_id"
    )


async def resolve_default_model_runtime(session: AsyncSession) -> ResolvedModelRuntime:
    return await resolve_model_runtime(session, None)


def runtime_persona_view(
    persona: PersonaInstance,
    runtime: ResolvedModelRuntime,
) -> RuntimePersonaView:
    return RuntimePersonaView(
        id=persona.id,
        name=persona.name,
        identity=persona.identity,
        backing_model=runtime.model_name,
        temperature=persona.temperature,
        config=dict(persona.config or {}),
        system_prompt=persona.system_prompt,
    )


def template_assistant_persona_view(runtime: ResolvedModelRuntime) -> RuntimePersonaView:
    return RuntimePersonaView(
        id="template-assistant",
        name="模板起草助手",
        identity=None,
        backing_model=runtime.model_name,
        temperature=0.2,
        config={},
        system_prompt=(
            "你是 MAI 模板起草助手。根据用户的自然语言需求，输出可直接保存的模板字段。"
            "不要编造外部事实；优先给出简洁、可执行、中文字段。"
        ),
    )
