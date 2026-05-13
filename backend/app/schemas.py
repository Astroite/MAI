from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class APIModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


MessageType = Literal[
    "speech",
    "question",
    "answer",
    "narration",
    "summary",
    "verdict",
    "verdict_revoke",
    "dead_end",
    "facilitator_signal",
    "user_doc",
    "tool_invocation",
    "participant.enter",
    "participant.exit",
    "masquerade_reveal",
    "silence",
    "background_update",
    "meta",
]

UserMessageType = Literal["speech", "question", "answer", "narration"]


class VariableDeclaration(APIModel):
    name: str
    description: str
    cardinality: Literal["one", "many"]
    required: bool = True


class AllSpeakers(APIModel):
    type: Literal["all"] = "all"


class VariableSpeakers(APIModel):
    type: Literal["variables"] = "variables"
    variable_names: list[str]


class SpecificSpeakers(APIModel):
    type: Literal["specific"] = "specific"
    persona_ids: list[str]


AllowedSpeakers = Annotated[AllSpeakers | VariableSpeakers | SpecificSpeakers, Field(discriminator="type")]


class AlternatingRule(APIModel):
    type: Literal["alternating"] = "alternating"


class RoundRobinRule(APIModel):
    type: Literal["round_robin"] = "round_robin"


class MentionDrivenRule(APIModel):
    type: Literal["mention_driven"] = "mention_driven"


class QuestionPairedRule(APIModel):
    type: Literal["question_paired"] = "question_paired"


class ParallelRule(APIModel):
    type: Literal["parallel"] = "parallel"


class UserPicksRule(APIModel):
    type: Literal["user_picks"] = "user_picks"


class CasualRule(APIModel):
    """Casual chat: weighted-random next speaker by recency × talkativeness.

    Forbids the most recent speaker; @mentions still take priority via the
    same dispatch path mention_driven uses. Pairs with autodrive's casual
    continuation probability so AI replies can naturally chain into each
    other instead of waiting for the user.
    """

    type: Literal["casual"] = "casual"


OrderingRule = Annotated[
    AlternatingRule | RoundRobinRule | MentionDrivenRule | QuestionPairedRule | ParallelRule | UserPicksRule | CasualRule,
    Field(discriminator="type"),
]


class RoundsExit(APIModel):
    type: Literal["rounds"] = "rounds"
    n: int = Field(ge=1)


class AllSpokenExit(APIModel):
    type: Literal["all_spoken"] = "all_spoken"
    min_each: int = Field(ge=1)


class AllVotedExit(APIModel):
    type: Literal["all_voted"] = "all_voted"


class UserManualExit(APIModel):
    type: Literal["user_manual"] = "user_manual"


class FacilitatorSuggestsExit(APIModel):
    type: Literal["facilitator_suggests"] = "facilitator_suggests"
    trigger_if: list[str]


class TokenBudgetExit(APIModel):
    type: Literal["token_budget"] = "token_budget"
    max: int = Field(ge=1)


class PhaseRoundLimitExit(APIModel):
    """Runtime-injected hard cap on phase rounds.

    Emitted by the engine (not authored on phase templates) when
    `RoomRuntimeState.max_phase_rounds` is reached. Surfaced as a structured
    `ExitCondition` so the frontend can render it the same way it renders
    template-declared conditions instead of getting an unknown `type`.
    """

    type: Literal["phase_round_limit"] = "phase_round_limit"
    max: int = Field(ge=1)


ExitCondition = Annotated[
    RoundsExit
    | AllSpokenExit
    | AllVotedExit
    | UserManualExit
    | FacilitatorSuggestsExit
    | TokenBudgetExit
    | PhaseRoundLimitExit,
    Field(discriminator="type"),
]


class Transition(APIModel):
    condition: str = "always"
    target: str = "next"


class FormatPhaseSlot(APIModel):
    phase_template_id: str
    phase_template_version: int = 1
    transitions: list[Transition] = Field(default_factory=lambda: [Transition()])


class PersonaOut(APIModel):
    id: str
    version: int
    schema_version: int
    status: Literal["draft", "published"]
    forked_from_id: str | None = None
    forked_from_version: int | None = None
    owner_user_id: str | None = None
    is_builtin: bool
    kind: Literal["discussant", "scribe", "facilitator"]
    name: str
    description: str
    backing_model: str
    api_provider_id: str | None = None
    api_model_id: str | None = None
    system_prompt: str
    temperature: float
    talkativeness: float = 1.0
    config: dict[str, Any] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class PersonaCreate(APIModel):
    kind: Literal["discussant", "scribe", "facilitator"] = "discussant"
    name: str
    description: str = ""
    backing_model: str = ""
    api_provider_id: str | None = None
    api_model_id: str | None = None
    system_prompt: str
    temperature: float = 0.4
    talkativeness: float = 1.0
    config: dict[str, Any] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)


class PersonaUpdate(APIModel):
    kind: Literal["discussant", "scribe", "facilitator"] | None = None
    name: str | None = None
    description: str | None = None
    backing_model: str | None = None
    api_provider_id: str | None = None
    api_model_id: str | None = None
    system_prompt: str | None = None
    temperature: float | None = None
    talkativeness: float | None = None
    config: dict[str, Any] | None = None
    tags: list[str] | None = None


# ---- New persona model (template + room-scoped instance) -------------------


class PersonaTemplateOut(APIModel):
    id: str
    version: int
    schema_version: int
    status: Literal["draft", "published"]
    forked_from_id: str | None = None
    forked_from_version: int | None = None
    owner_user_id: str | None = None
    is_builtin: bool
    kind: Literal["discussant", "scribe", "facilitator"]
    name: str
    identity: str = ""
    description: str
    backing_model: str
    api_provider_id: str | None = None
    api_model_id: str | None = None
    system_prompt: str
    temperature: float
    talkativeness: float = 1.0
    color: str = "#3b82f6"
    icon: str = "Sparkles"
    config: dict[str, Any] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class PersonaTemplateCreate(APIModel):
    kind: Literal["discussant", "scribe", "facilitator"] = "discussant"
    name: str
    identity: str = ""
    description: str = ""
    backing_model: str = ""
    api_provider_id: str | None = None
    api_model_id: str | None = None
    system_prompt: str
    temperature: float = 0.4
    talkativeness: float = 1.0
    color: str = "#3b82f6"
    icon: str = "Sparkles"
    config: dict[str, Any] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)


class PersonaTemplateUpdate(APIModel):
    """Patch a user-owned template. Builtin templates reject mutation at the
    route layer with 403 — duplicate then edit the copy."""

    name: str | None = None
    identity: str | None = None
    description: str | None = None
    backing_model: str | None = None
    api_provider_id: str | None = None
    api_model_id: str | None = None
    system_prompt: str | None = None
    temperature: float | None = None
    talkativeness: float | None = None
    color: str | None = None
    icon: str | None = None
    config: dict[str, Any] | None = None
    tags: list[str] | None = None


class PersonaInstanceOut(APIModel):
    id: str
    room_id: str
    template_id: str
    template_version: int
    # PersonaInstance rows do not persist these template lifecycle fields yet.
    # Keep derived defaults here so the frontend contract stays parallel to templates.
    schema_version: int = 1
    status: Literal["draft", "published"] = "published"
    position: int
    kind: Literal["discussant", "scribe", "facilitator"]
    name: str
    identity: str = ""
    description: str
    backing_model: str
    api_provider_id: str | None = None
    api_model_id: str | None = None
    system_prompt: str
    temperature: float
    talkativeness: float = 1.0
    color: str = "#3b82f6"
    icon: str = "Sparkles"
    config: dict[str, Any] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)
    world_character_id: str | None = None
    created_at: datetime
    updated_at: datetime


class PersonaInstanceUpdate(APIModel):
    """Per-room edits. `name` and `kind` are immutable post-create — sent in
    the payload they trigger a 422 via `extra='forbid'`. `identity` IS
    mutable: per-room role nuance (e.g. "首席架构师" vs builtin "架构师")
    is a real user need."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="forbid")

    identity: str | None = None
    description: str | None = None
    backing_model: str | None = None
    api_provider_id: str | None = None
    api_model_id: str | None = None
    system_prompt: str | None = None
    temperature: float | None = None
    talkativeness: float | None = None
    color: str | None = None
    icon: str | None = None
    config: dict[str, Any] | None = None
    tags: list[str] | None = None


class AddPersonaInstancesRequest(APIModel):
    template_ids: list[str]


# ----------------------------------------------------------------------------


def _mask_api_key(key: str) -> str:
    if not key:
        return ""
    tail = key[-4:] if len(key) >= 4 else key
    return f"...{tail}"


class ApiProviderOut(APIModel):
    id: str
    name: str
    provider_slug: str
    api_key_preview: str
    has_api_key: bool
    api_base: str | None = None
    last_tested_ok: bool | None = None
    last_tested_at: datetime | None = None
    last_tested_error: str | None = None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_model(cls, provider: Any) -> "ApiProviderOut":
        return cls(
            id=provider.id,
            name=provider.name,
            provider_slug=provider.provider_slug,
            api_key_preview=_mask_api_key(provider.api_key or ""),
            has_api_key=bool(provider.api_key),
            api_base=provider.api_base,
            last_tested_ok=provider.last_tested_ok,
            last_tested_at=provider.last_tested_at,
            last_tested_error=provider.last_tested_error,
            created_at=provider.created_at,
            updated_at=provider.updated_at,
        )


class ApiProviderDetailOut(ApiProviderOut):
    api_key: str = ""

    @classmethod
    def from_model(cls, provider: Any) -> "ApiProviderDetailOut":
        return cls(
            id=provider.id,
            name=provider.name,
            provider_slug=provider.provider_slug,
            api_key_preview=_mask_api_key(provider.api_key or ""),
            has_api_key=bool(provider.api_key),
            api_base=provider.api_base,
            api_key=provider.api_key or "",
            last_tested_ok=provider.last_tested_ok,
            last_tested_at=provider.last_tested_at,
            last_tested_error=provider.last_tested_error,
            created_at=provider.created_at,
            updated_at=provider.updated_at,
        )


class ApiProviderTestResult(APIModel):
    ok: bool
    status_code: int | None = None
    error: str | None = None
    tested_at: datetime


class ApiModelOut(APIModel):
    id: str
    api_provider_id: str
    display_name: str
    model_name: str
    enabled: bool
    is_default: bool
    context_window: int | None = None
    tags: list[str] = Field(default_factory=list)
    last_tested_ok: bool | None = None
    last_tested_at: datetime | None = None
    last_tested_error: str | None = None
    created_at: datetime
    updated_at: datetime


class ApiModelCreate(APIModel):
    api_provider_id: str
    display_name: str = ""
    model_name: str
    enabled: bool = True
    is_default: bool = False
    context_window: int | None = Field(default=None, ge=1)
    tags: list[str] = Field(default_factory=list)


class ApiModelUpdate(APIModel):
    api_provider_id: str | None = None
    display_name: str | None = None
    model_name: str | None = None
    enabled: bool | None = None
    is_default: bool | None = None
    context_window: int | None = Field(default=None, ge=1)
    tags: list[str] | None = None


class AppSettingsOut(APIModel):
    default_backing_model: str | None = None
    default_api_provider_id: str | None = None
    default_api_model_id: str | None = None
    setup_complete: bool
    updated_at: datetime | None = None


class AppSettingsUpdate(APIModel):
    default_backing_model: str | None = None
    default_api_provider_id: str | None = None
    default_api_model_id: str | None = None


class ApiProviderCreate(APIModel):
    name: str
    provider_slug: str
    api_key: str = ""
    api_base: str | None = None


class ApiProviderUpdate(APIModel):
    name: str | None = None
    provider_slug: str | None = None
    api_key: str | None = None
    api_base: str | None = None


class ToolSchemaOut(APIModel):
    name: str
    display_name: str
    description: str = ""
    server_id: str | None = None
    server_name: str | None = None
    source: Literal["builtin", "mcp"] = "builtin"
    input_schema: dict[str, Any] = Field(default_factory=dict)
    read_only: bool = True
    enabled: bool = True


class ToolServerOut(APIModel):
    id: str
    name: str
    description: str
    kind: Literal["mcp"] = "mcp"
    transport: Literal["streamable_http", "sse"] = "streamable_http"
    url: str | None = None
    enabled: bool
    allow_write: bool
    manifest: dict[str, Any] = Field(default_factory=dict)
    last_synced_at: datetime | None = None
    last_error: str | None = None
    created_at: datetime
    updated_at: datetime


class ToolServerCreate(APIModel):
    name: str
    description: str = ""
    transport: Literal["streamable_http", "sse"] = "streamable_http"
    url: str
    enabled: bool = True
    allow_write: bool = False


class ToolServerUpdate(APIModel):
    name: str | None = None
    description: str | None = None
    transport: Literal["streamable_http", "sse"] | None = None
    url: str | None = None
    enabled: bool | None = None
    allow_write: bool | None = None


class ToolInvocationOut(APIModel):
    id: str
    room_id: str
    message_id: str | None = None
    parent_message_id: str | None = None
    server_id: str | None = None
    tool_name: str
    display_name: str
    status: Literal["pending", "success", "error"]
    arguments: dict[str, Any] = Field(default_factory=dict)
    result: Any = None
    error: str | None = None
    started_at: datetime
    completed_at: datetime | None = None
    created_at: datetime


class ToolExecuteRequest(APIModel):
    tool_name: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    parent_message_id: str | None = None
    allow_write: bool = False


class TemplateDraftRequest(APIModel):
    kind: Literal["persona", "phase", "recipe"]
    prompt: str


class TemplateDraftOut(APIModel):
    kind: Literal["persona", "phase", "recipe"]
    payload: dict[str, Any]
    rationale: str = ""


# Curated icon set — kept in sync with frontend/src/components/PersonaIcon.tsx.
# The LLM picks one to match the persona's archetype.
PERSONA_ICON_NAMES: tuple[str, ...] = (
    "Sparkles",
    "Brain",
    "Compass",
    "Microscope",
    "ShieldCheck",
    "Hammer",
    "Heart",
    "Eye",
    "Zap",
    "Target",
    "Lightbulb",
    "Scale",
    "Anchor",
    "Flag",
    "Rocket",
    "BookOpen",
    "Wrench",
    "Layers",
    "Users",
    "Globe",
    "FlaskConical",
    "Crown",
    "Swords",
    "Gauge",
)

PERSONA_COLOR_HEX_PATTERN = r"^#[0-9a-fA-F]{6}$"


class PersonaDraftPayload(APIModel):
    """Constrained shape the AI must return when drafting a persona.

    Keep this schema tight — every field maps directly into the persona
    template form. The LLM sees this schema (via `model_json_schema`) as the
    tool's parameters, so descriptions are read by the model.
    """

    kind: Literal["discussant", "scribe", "facilitator"] = Field(
        "discussant",
        description="人设类型。讨论者(discussant)是最常见的;书记官(scribe)与上帝副手(facilitator)为系统角色,通常不要新建。",
    )
    name: str = Field(
        ...,
        min_length=2,
        max_length=24,
        description="人物的真实姓名,2-8 字汉字或拼音,如 '陆知谦'、'Ada Lovelace'。不要带书名号或括号,不要写身份/职业。",
    )
    identity: str = Field(
        "",
        max_length=24,
        description="人物的身份/职业/角色定位,2-12 字,如 '架构师'、'精灵公主'、'刑侦专家'。如果是用户没指定的随机人物可以留空。",
    )
    description: str = Field(
        ...,
        min_length=8,
        max_length=140,
        description="一句话简介,30-80 字,描述这个人设的视角与关注点。不要写成 system prompt。",
    )
    system_prompt: str = Field(
        ...,
        min_length=30,
        max_length=600,
        description=(
            "完整的 system prompt,使用第二人称('你是…')。"
            "前半句声明角色,后半句给出关注重点和发言要求。"
            "保持简洁,80-200 字,不要用 markdown,不要包含示例对话。"
        ),
    )
    temperature: float = Field(
        0.4,
        ge=0.0,
        le=1.2,
        description="采样温度。批判型/严谨型 0.2-0.4;策略/产品型 0.4-0.6;创意/侦察型 0.6-0.8。",
    )
    talkativeness: float = Field(
        1.0,
        ge=0.0,
        le=3.0,
        description="健谈度,0=只在被点名时发言,1=默认,2-3=主动插话。",
    )
    color: str = Field(
        "#3b82f6",
        pattern=PERSONA_COLOR_HEX_PATTERN,
        description=(
            "主题色,十六进制 #rrggbb 格式。"
            "建议从 #ef4444 #f97316 #f59e0b #eab308 #84cc16 #22c55e #14b8a6 #06b6d4 #0ea5e9 #3b82f6 #6366f1 #8b5cf6 #a855f7 #ec4899 #64748b 中挑一个,与角色气质匹配。"
        ),
    )
    icon: str = Field(
        "Sparkles",
        description=(
            "图标名,必须是这些值之一: "
            + ", ".join(PERSONA_ICON_NAMES)
            + "。常见对应:架构=Layers,性能=Zap,维护=Wrench,产品=Target,UX=Heart,安全=ShieldCheck,"
            "反方=Swords,运维=Gauge,研究=Compass,记录=BookOpen,负责人=Crown。"
        ),
        json_schema_extra={"enum": list(PERSONA_ICON_NAMES)},
    )
    tags: list[str] = Field(
        default_factory=list,
        max_length=5,
        description="3-5 个英文小写短标签,如 ['technical','critic']。不要包含 'builtin'。",
    )

    @field_validator("icon")
    @classmethod
    def _icon_in_set(cls, v: str) -> str:
        if v not in PERSONA_ICON_NAMES:
            return "Sparkles"
        return v


class PersonaDraftEnvelope(APIModel):
    payload: PersonaDraftPayload
    rationale: str = Field(
        "",
        max_length=200,
        description="一句话说明为什么这样起草(可选,中文,不超过 60 字)。",
    )


class ScenarioOut(APIModel):
    id: str
    title: str
    description: str
    prompt: str
    tags: list[str] = Field(default_factory=list)
    recipe_id: str | None = None
    format_id: str | None = None


class PhaseTemplateOut(APIModel):
    id: str
    version: int
    schema_version: int
    status: Literal["draft", "published"]
    forked_from_id: str | None = None
    forked_from_version: int | None = None
    owner_user_id: str | None = None
    is_builtin: bool
    name: str
    description: str
    declared_variables: list[VariableDeclaration] = Field(default_factory=list)
    allowed_speakers: AllowedSpeakers
    ordering_rule: OrderingRule
    exit_conditions: list[ExitCondition] = Field(default_factory=list)
    auto_discuss: bool = False
    auto_discuss_mode: Literal["decay", "continuous"] = "decay"
    role_constraints: str
    prompt_template: str
    tags: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class PhaseTemplateCreate(APIModel):
    name: str
    description: str = ""
    declared_variables: list[VariableDeclaration] = Field(default_factory=list)
    allowed_speakers: AllowedSpeakers = Field(default_factory=AllSpeakers)
    ordering_rule: OrderingRule = Field(default_factory=UserPicksRule)
    exit_conditions: list[ExitCondition] = Field(default_factory=lambda: [UserManualExit()])
    auto_discuss: bool = False
    auto_discuss_mode: Literal["decay", "continuous"] = "decay"
    role_constraints: str = ""
    prompt_template: str = ""
    tags: list[str] = Field(default_factory=list)


class PhaseTemplateUpdate(APIModel):
    name: str | None = None
    description: str | None = None
    declared_variables: list[VariableDeclaration] | None = None
    allowed_speakers: AllowedSpeakers | None = None
    ordering_rule: OrderingRule | None = None
    exit_conditions: list[ExitCondition] | None = None
    auto_discuss: bool | None = None
    auto_discuss_mode: Literal["decay", "continuous"] | None = None
    role_constraints: str | None = None
    prompt_template: str | None = None
    tags: list[str] | None = None


class DebateFormatOut(APIModel):
    id: str
    version: int
    schema_version: int
    status: Literal["draft", "published"]
    forked_from_id: str | None = None
    forked_from_version: int | None = None
    owner_user_id: str | None = None
    is_builtin: bool
    name: str
    description: str
    phase_sequence: list[FormatPhaseSlot] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class DebateFormatCreate(APIModel):
    name: str
    description: str = ""
    phase_sequence: list[FormatPhaseSlot] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


class DebateFormatUpdate(APIModel):
    name: str | None = None
    description: str | None = None
    phase_sequence: list[FormatPhaseSlot] | None = None
    tags: list[str] | None = None


class RecipeOut(APIModel):
    id: str
    version: int
    schema_version: int
    status: Literal["draft", "published"]
    forked_from_id: str | None = None
    forked_from_version: int | None = None
    owner_user_id: str | None = None
    is_builtin: bool
    name: str
    description: str
    persona_ids: list[str] = Field(default_factory=list)
    format_id: str | None = None
    format_version: int | None = None
    initial_settings: dict[str, Any] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class RecipeCreate(APIModel):
    name: str
    description: str = ""
    persona_ids: list[str] = Field(default_factory=list)
    format_id: str | None = None
    format_version: int | None = None
    initial_settings: dict[str, Any] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)


class RecipeUpdate(APIModel):
    name: str | None = None
    description: str | None = None
    persona_ids: list[str] | None = None
    format_id: str | None = None
    format_version: int | None = None
    initial_settings: dict[str, Any] | None = None
    tags: list[str] | None = None


class RoomOut(APIModel):
    id: str
    parent_room_id: str | None = None
    owner_user_id: str | None = None
    title: str
    background: str = ""
    recipe_id: str | None = None
    format_id: str | None = None
    format_version: int | None = None
    status: Literal["active", "frozen", "archived"]
    frozen_at: datetime | None = None
    # Story World scene fields. Non-null world_id marks the room as a scene.
    world_id: str | None = None
    scene_index: int | None = None
    in_world_time_start: str = ""
    in_world_time_end: str = ""
    in_world_duration_hint: str = ""
    sealed_at: datetime | None = None
    created_at: datetime


class RoomMemberPreview(APIModel):
    """Minimal persona info for rendering avatars in the room-card list."""

    id: str
    name: str
    identity: str = ""
    color: str = "#3b82f6"
    icon: str = "Sparkles"


class RoomSummaryOut(RoomOut):
    """Room list response — adds member previews and activity counters so the
    sidebar can render rich cards without N+1 calls to /state."""

    member_count: int = 0
    members: list[RoomMemberPreview] = Field(default_factory=list)
    message_count: int = 0
    last_activity_at: datetime | None = None


class SceneMemoryScribeResult(APIModel):
    character_id: str
    character_name: str
    status: Literal["success", "skipped", "failed"]
    episodes_count: int = 0
    impressions_count: int = 0
    vows_count: int = 0
    error: str | None = None


class SceneSealOut(APIModel):
    scene: RoomOut
    scribe_results: list[SceneMemoryScribeResult] = Field(default_factory=list)


class SceneSealDraftOut(APIModel):
    id: str
    world_id: str
    scene_id: str
    status: Literal["generating", "ready", "failed", "committed", "discarded"]
    scene_summary: str = ""
    title_suggestion: str = ""
    date_label: str = ""
    location: str = ""
    timeline_events: list[dict[str, Any]] = Field(default_factory=list)
    memory_updates: list[dict[str, Any]] = Field(default_factory=list)
    relationship_updates: list[dict[str, Any]] = Field(default_factory=list)
    plot_hook_updates: list[dict[str, Any]] = Field(default_factory=list)
    world_bible_suggestions: list[dict[str, Any]] = Field(default_factory=list)
    next_scene_suggestions: list[dict[str, Any]] = Field(default_factory=list)
    warnings: list[dict[str, Any]] = Field(default_factory=list)
    error: str = ""
    llm_run_id: str | None = None
    retry_of_draft_id: str | None = None
    committed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    scene: RoomOut | None = None


class SceneSealDraftUpdate(APIModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="forbid")

    scene_summary: str | None = None
    title_suggestion: str | None = None
    date_label: str | None = None
    location: str | None = None
    timeline_events: list[dict[str, Any]] | None = None
    memory_updates: list[dict[str, Any]] | None = None
    relationship_updates: list[dict[str, Any]] | None = None
    plot_hook_updates: list[dict[str, Any]] | None = None
    world_bible_suggestions: list[dict[str, Any]] | None = None
    next_scene_suggestions: list[dict[str, Any]] | None = None
    warnings: list[dict[str, Any]] | None = None
    status: Literal["ready", "discarded"] | None = None


class RoomRuntimeOut(APIModel):
    room_id: str
    current_phase_instance_id: str | None = None
    frozen: bool
    token_counter_total: int
    cost_counter_usd: float
    auto_transition: bool
    current_user_mode: str
    current_masquerade_persona_id: str | None = None
    max_message_tokens: int
    max_room_tokens: int
    max_phase_rounds: int
    max_account_daily_tokens: int
    max_account_monthly_tokens: int
    phase_exit_suggested: bool = False
    phase_exit_matched_conditions: list[dict[str, Any]] = Field(default_factory=list)
    phase_exit_suppressed_after_message_id: str | None = None
    consecutive_ai_turns: int = 0
    max_consecutive_ai_turns: int = 10
    phase_extra_rounds: int = 0
    # True while the autodrive task loop is actively scheduling turns.
    # Surfaced to the UI so the speaker-status strip can distinguish
    # "AI is taking next turn" from "waiting for user".
    autodrive_active: bool = False
    # Persona ids of any LLM call currently in flight for this room. Includes
    # calls that have started but not yet produced their first chunk, which
    # `in_flight_partial` (text-bearing only) cannot represent.
    current_speakers: list[str] = Field(default_factory=list)
    updated_at: datetime


class RoomCreate(APIModel):
    title: str
    background: str = ""
    recipe_id: str | None = None
    format_id: str | None = None
    persona_ids: list[str] = Field(default_factory=list)
    parent_room_id: str | None = None


class RoomBackgroundUpdate(APIModel):
    background: str


class AddPersonasRequest(APIModel):
    persona_ids: list[str]


class RoomPhasePlanOut(APIModel):
    room_id: str
    position: int
    phase_template_id: str
    phase_template_version: int
    source: str
    variable_bindings: dict[str, list[str]] = Field(default_factory=dict)


class RoomPhaseInstanceOut(APIModel):
    id: str
    room_id: str
    plan_position: int
    phase_template_id: str
    phase_template_version: int
    status: Literal["running", "completed", "skipped"]
    started_at: datetime
    completed_at: datetime | None = None


class MessageOut(APIModel):
    id: str
    room_id: str
    phase_instance_id: str | None = None
    parent_message_id: str | None = None
    message_type: str
    author_persona_id: str | None = None
    author_model: str | None = None
    author_actual: Literal["ai", "user", "user_as_judge", "user_as_persona", "system"]
    user_masquerade_persona_id: str | None = None
    user_masquerade_name: str | None = None
    visibility: str
    visibility_to_models: bool
    content: str
    content_chunks_count: int
    truncated_reason: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    cost_usd: float | None = None
    user_revealed_at: datetime | None = None
    tool_invocation: ToolInvocationOut | None = None
    created_at: datetime


class MessageCreate(APIModel):
    content: str
    message_type: UserMessageType = "speech"
    parent_message_id: str | None = None
    # Story World only: when set, the user is speaking AS this WorldCharacter
    # (which must be kind=user and on the scene's roster with
    # speak_as_user=True). The message is recorded as user_as_persona with
    # the character's name as the masquerade label.
    as_character_id: str | None = None


class VerdictCreate(APIModel):
    content: str
    is_locked: bool = False
    dead_end: bool = False
    revoke_message_id: str | None = None


class MasqueradeCreate(APIModel):
    persona_id: str | None = None
    display_name: str | None = None
    content: str
    message_type: UserMessageType = "speech"


class TurnRequest(APIModel):
    speaker_persona_id: str | None = None
    director_instruction: str | None = None


class PhaseTransitionRequest(APIModel):
    target_position: int | None = None


class InsertPhaseRequest(APIModel):
    phase_template_id: str
    after_position: int | None = None
    variable_bindings: dict[str, list[str]] = Field(default_factory=dict)


class LimitUpdate(APIModel):
    max_message_tokens: int | None = Field(default=None, ge=1)
    max_room_tokens: int | None = Field(default=None, ge=1)
    max_phase_rounds: int | None = Field(default=None, ge=1)
    max_account_daily_tokens: int | None = Field(default=None, ge=1)
    max_account_monthly_tokens: int | None = Field(default=None, ge=1)
    max_consecutive_ai_turns: int | None = Field(default=None, ge=1)
    auto_transition: bool | None = None


class ScribeStateValue(APIModel):
    consensus: list[dict[str, Any]] = Field(default_factory=list)
    disagreements: list[dict[str, Any]] = Field(default_factory=list)
    open_questions: list[dict[str, Any]] = Field(default_factory=list)
    decisions: list[dict[str, Any]] = Field(default_factory=list)
    artifacts: list[dict[str, Any]] = Field(default_factory=list)
    dead_ends: list[dict[str, Any]] = Field(default_factory=list)


class ScribeUpdate(APIModel):
    consensus_added: list[dict[str, Any]] = Field(default_factory=list)
    consensus_removed: list[str] = Field(default_factory=list)
    disagreements_added: list[dict[str, Any]] = Field(default_factory=list)
    disagreements_resolved: list[str] = Field(default_factory=list)
    open_questions_added: list[dict[str, Any]] = Field(default_factory=list)
    open_questions_answered: list[str] = Field(default_factory=list)
    decisions_added: list[dict[str, Any]] = Field(default_factory=list)
    artifacts_added: list[dict[str, Any]] = Field(default_factory=list)
    dead_ends_added: list[dict[str, Any]] = Field(default_factory=list)
    reasoning: str = ""


class FacilitatorSignalItem(APIModel):
    tag: str
    severity: Literal["info", "suggest", "warning", "block"] = "info"
    reasoning: str
    evidence_message_ids: list[str] = Field(default_factory=list)


class FacilitatorEvaluation(APIModel):
    signals: list[FacilitatorSignalItem] = Field(default_factory=list)
    overall_health: Literal["productive", "circling", "blocked", "exhausted"] = "productive"
    pacing_note: str = ""


class ScribeStateOut(APIModel):
    room_id: str
    current_state: ScribeStateValue
    last_event_message_id: str | None = None
    updated_at: datetime


class DecisionOut(APIModel):
    id: str
    room_id: str
    scribe_event_message_id: str
    content: str
    is_locked: bool
    locked_by_message_id: str | None = None
    revoked_by_message_id: str | None = None
    created_at: datetime


class DecisionLockUpdate(APIModel):
    is_locked: bool


class FacilitatorSignalOut(APIModel):
    id: str
    room_id: str
    message_id: str
    trigger_after_message_id: str
    signals: list[dict[str, Any]]
    overall_health: str
    pacing_note: str
    created_at: datetime


class UploadOut(APIModel):
    id: str
    room_id: str | None = None
    filename: str
    content_type: str
    extracted_text: str
    storage_path: str
    created_at: datetime


class FromUploadRequest(APIModel):
    upload_id: str


class MergeBackCreate(APIModel):
    conclusion: str
    key_reasoning: list[str] = Field(default_factory=list, max_length=3)
    rejected_alternatives: list[dict[str, Any]] = Field(default_factory=list)
    unresolved: list[str] = Field(default_factory=list)
    artifacts_ref: dict[str, Any] = Field(default_factory=dict)


class InFlightPartialOut(APIModel):
    message_id: str
    persona_id: str
    content: str
    last_chunk_index: int
    cumulative_tokens_estimate: int


class RoomState(APIModel):
    room: RoomOut
    runtime: RoomRuntimeOut
    personas: list[PersonaInstanceOut]
    phase_plan: list[RoomPhasePlanOut]
    current_phase: RoomPhaseInstanceOut | None
    messages: list[MessageOut]
    scribe_state: ScribeStateOut
    facilitator_signals: list[FacilitatorSignalOut]
    decisions: list[DecisionOut] = Field(default_factory=list)
    tool_invocations: list[ToolInvocationOut] = Field(default_factory=list)
    in_flight_partial: list[InFlightPartialOut] = Field(default_factory=list)


# --- Story World ---------------------------------------------------------

WORLD_CHARACTER_KINDS = ("ai", "user")
WORLD_STATUSES = ("active", "archived")
WORLD_CHARACTER_STATUSES = ("active", "retired")


class WorldCharacterOut(APIModel):
    id: str
    world_id: str
    kind: Literal["ai", "user"]
    name: str
    identity: str = ""
    brief: str = ""
    persona_template_id: str | None = None
    persona_template_version: int | None = None
    backing_overrides: dict[str, Any] = Field(default_factory=dict)
    color: str = "#3b82f6"
    icon: str = "Sparkles"
    core_identity: str = ""
    skills_text: str = ""
    goals_text: str = ""
    status: Literal["active", "retired"] = "active"
    config: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class WorldCharacterCreate(APIModel):
    kind: Literal["ai", "user"] = "ai"
    name: str = Field(min_length=1, max_length=120)
    identity: str = Field(default="", max_length=120)
    brief: str = ""
    persona_template_id: str | None = None
    backing_overrides: dict[str, Any] = Field(default_factory=dict)
    color: str = Field("#3b82f6", pattern=PERSONA_COLOR_HEX_PATTERN)
    icon: str = "Sparkles"
    core_identity: str = ""
    skills_text: str = ""
    goals_text: str = ""
    config: dict[str, Any] = Field(default_factory=dict)

    @field_validator("icon")
    @classmethod
    def _icon_in_set(cls, v: str) -> str:
        if v not in PERSONA_ICON_NAMES:
            return "Sparkles"
        return v


class WorldCharacterUpdate(APIModel):
    """Patch a character. `kind` is immutable post-create; sending it triggers
    422 via extra='forbid'. PersonaTemplate binding can be re-pointed for
    ai characters but cleared only by setting it to null explicitly."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=120)
    identity: str | None = Field(default=None, max_length=120)
    brief: str | None = None
    persona_template_id: str | None = None
    backing_overrides: dict[str, Any] | None = None
    color: str | None = Field(default=None, pattern=PERSONA_COLOR_HEX_PATTERN)
    icon: str | None = None
    core_identity: str | None = None
    skills_text: str | None = None
    goals_text: str | None = None
    status: Literal["active", "retired"] | None = None
    config: dict[str, Any] | None = None

    @field_validator("icon")
    @classmethod
    def _icon_in_set(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if v not in PERSONA_ICON_NAMES:
            return "Sparkles"
        return v


class WorldOut(APIModel):
    id: str
    owner_user_id: str | None = None
    name: str
    synopsis: str = ""
    setting: str = ""
    calendar_hint: str = ""
    cover_color: str = "#3b82f6"
    cover_icon: str = "Globe"
    status: Literal["active", "archived"] = "active"
    config: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class WorldDetailOut(WorldOut):
    characters: list[WorldCharacterOut] = Field(default_factory=list)


class WorldSummaryOut(WorldOut):
    character_count: int = 0
    scene_count: int = 0
    last_activity_at: datetime | None = None


class WorldCreate(APIModel):
    name: str = Field(min_length=1, max_length=200)
    synopsis: str = ""
    setting: str = ""
    calendar_hint: str = ""
    cover_color: str = Field("#3b82f6", pattern=PERSONA_COLOR_HEX_PATTERN)
    cover_icon: str = "Globe"
    config: dict[str, Any] = Field(default_factory=dict)


class WorldUpdate(APIModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    synopsis: str | None = None
    setting: str | None = None
    calendar_hint: str | None = None
    cover_color: str | None = Field(default=None, pattern=PERSONA_COLOR_HEX_PATTERN)
    cover_icon: str | None = None
    status: Literal["active", "archived"] | None = None
    config: dict[str, Any] | None = None


TimelineEventType = Literal[
    "history",
    "scene",
    "memory",
    "relationship",
    "plot_hook",
    "arc_update",
    "location_update",
    "faction_update",
]
TimelineEventSource = Literal[
    "user",
    "ai_suggested",
    "seal_draft",
    "seal_committed",
    "migration",
]
TimelineEventStatus = Literal["draft", "committed", "hidden"]


class WorldBibleOut(APIModel):
    summary: str = ""
    genre: str = ""
    tone: str = ""
    era: str = ""
    current_date_label: str = ""
    current_location: str = ""
    background: str = ""
    history: list[dict[str, Any]] = Field(default_factory=list)
    locations: list[dict[str, Any]] = Field(default_factory=list)
    factions: list[dict[str, Any]] = Field(default_factory=list)
    rules: list[dict[str, Any]] = Field(default_factory=list)
    taboos: list[dict[str, Any]] = Field(default_factory=list)
    current_arc: dict[str, Any] | None = None
    plot_hooks: list[dict[str, Any]] = Field(default_factory=list)


class WorldBibleUpdate(APIModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="forbid")

    summary: str | None = None
    genre: str | None = None
    tone: str | None = None
    era: str | None = None
    current_date_label: str | None = None
    current_location: str | None = None
    background: str | None = None
    history: list[dict[str, Any]] | None = None
    locations: list[dict[str, Any]] | None = None
    factions: list[dict[str, Any]] | None = None
    rules: list[dict[str, Any]] | None = None
    taboos: list[dict[str, Any]] | None = None
    current_arc: dict[str, Any] | None = None
    plot_hooks: list[dict[str, Any]] | None = None


class WorldTimelineEventOut(APIModel):
    id: str
    world_id: str
    type: TimelineEventType = "history"
    title: str
    summary: str = ""
    date_label: str = ""
    order: int = 0
    source: TimelineEventSource = "user"
    status: TimelineEventStatus = "committed"
    scene_id: str | None = None
    seal_draft_id: str | None = None
    related_character_ids: list[str] = Field(default_factory=list)
    related_location_ids: list[str] = Field(default_factory=list)
    related_faction_ids: list[str] = Field(default_factory=list)
    related_memory_ids: list[str] = Field(default_factory=list)
    related_relationship_ids: list[str] = Field(default_factory=list)
    related_hook_ids: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class WorldTimelineEventCreate(APIModel):
    type: TimelineEventType = "history"
    title: str = Field(min_length=1, max_length=200)
    summary: str = ""
    date_label: str = ""
    order: int | None = None
    source: TimelineEventSource = "user"
    status: TimelineEventStatus = "committed"
    scene_id: str | None = None
    related_character_ids: list[str] = Field(default_factory=list)
    related_location_ids: list[str] = Field(default_factory=list)
    related_faction_ids: list[str] = Field(default_factory=list)
    related_memory_ids: list[str] = Field(default_factory=list)
    related_relationship_ids: list[str] = Field(default_factory=list)
    related_hook_ids: list[str] = Field(default_factory=list)


class WorldTimelineEventUpdate(APIModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="forbid")

    type: TimelineEventType | None = None
    title: str | None = Field(default=None, min_length=1, max_length=200)
    summary: str | None = None
    date_label: str | None = None
    order: int | None = None
    source: TimelineEventSource | None = None
    status: TimelineEventStatus | None = None
    scene_id: str | None = None
    related_character_ids: list[str] | None = None
    related_location_ids: list[str] | None = None
    related_faction_ids: list[str] | None = None
    related_memory_ids: list[str] | None = None
    related_relationship_ids: list[str] | None = None
    related_hook_ids: list[str] | None = None


# --- Scene (a Room within a World) --------------------------------------


class WorldSceneMemberOut(APIModel):
    scene_id: str
    world_character_id: str
    role_in_scene: str = ""
    speak_as_user: bool = False
    entered_at_message_id: str | None = None
    exited_at_message_id: str | None = None
    joined_at: datetime


class SceneRosterEntry(APIModel):
    """One entry in the scene-create roster: which World character to seat,
    plus optional per-scene role hint and (for `kind=user` characters) whether
    the human user controls them in this scene."""

    world_character_id: str
    role_in_scene: str = ""
    speak_as_user: bool = False


class SceneCreate(APIModel):
    title: str = Field(min_length=1, max_length=200)
    background: str = ""
    members: list[SceneRosterEntry] = Field(default_factory=list)
    in_world_time_start: str = ""
    in_world_time_end: str = ""
    in_world_duration_hint: str = ""
    # Format/recipe overrides — defaults to story_format if omitted.
    format_id: str | None = None
    recipe_id: str | None = None


class SceneTimelineEntry(APIModel):
    """Compact scene representation for the World timeline view."""

    id: str
    scene_index: int
    title: str
    status: Literal["active", "frozen", "archived"]
    sealed_at: datetime | None = None
    in_world_time_start: str = ""
    in_world_time_end: str = ""
    in_world_duration_hint: str = ""
    member_count: int = 0
    message_count: int = 0
    created_at: datetime


class SceneEnterRequest(APIModel):
    world_character_id: str
    role_in_scene: str = ""
    speak_as_user: bool = False
    description: str = Field(
        default="",
        max_length=500,
        description="可选的入场系统消息文本。留空时使用默认 '<角色名> 进入了场景。'",
    )


class SceneExitRequest(APIModel):
    world_character_id: str
    description: str = Field(
        default="",
        max_length=500,
        description="可选的离场系统消息文本。留空时使用默认 '<角色名> 离开了场景。'",
    )


# --- Character episodic memory ------------------------------------------

WORLD_MEMORY_KINDS = ("episode", "impression", "vow", "fact", "backstory")


class WorldCharacterMemoryOut(APIModel):
    id: str
    world_character_id: str
    source_scene_id: str | None = None
    seal_draft_id: str | None = None
    scene_index_at_write: int | None = None
    in_world_time_at_event: str = ""
    kind: Literal["episode", "impression", "vow", "fact", "backstory"]
    target_character_id: str | None = None
    content: str
    salience: float = 0.5
    last_used_scene_index: int | None = None
    created_at: datetime


class WorldCharacterMemoryCreate(APIModel):
    """Manual write — used by the user as 'director' to seed backstory or
    correct the LLM's output. The scene-end memory scribe writes its own
    rows directly via the engine helper, not this schema."""

    kind: Literal["episode", "impression", "vow", "fact", "backstory"] = "backstory"
    content: str = Field(min_length=1, max_length=2000)
    salience: float = Field(default=0.5, ge=0.0, le=1.0)
    in_world_time_at_event: str = ""
    target_character_id: str | None = None


class WorldCharacterMemoryUpdate(APIModel):
    """Partial edit — director's manual touch-up. Source scene linkage and
    creation timestamp are intentionally read-only (they're audit trail).
    Setting `kind` is allowed for the rare case where the user wants to
    reclassify a row (e.g. promote an episode to a vow)."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="forbid")

    kind: Literal["episode", "impression", "vow", "fact", "backstory"] | None = None
    content: str | None = Field(default=None, min_length=1, max_length=2000)
    salience: float | None = Field(default=None, ge=0.0, le=1.0)
    in_world_time_at_event: str | None = None
    target_character_id: str | None = None


# --- Memory distillation tool schema (LLM output at scene seal) ---------


class MemoryEntryDraft(APIModel):
    """One row the LLM proposes adding for a character at scene seal."""

    kind: Literal["episode", "vow"] = "episode"
    content: str = Field(min_length=1, max_length=600)
    salience: float = Field(default=0.5, ge=0.0, le=1.0)


class MemoryDistillation(APIModel):
    """Tool-call output for run_scene_memory_scribe.

    Episodes/vows go into world_character_memories. Impressions become updates
    on the per-pair WorldCharacterRelation card (PR 4); the engine merges
    sentiment_delta into the existing card and appends notes_append. Each
    impression must target a peer who was on stage with this character.
    """

    new_episodes: list[MemoryEntryDraft] = Field(default_factory=list)
    impressions: list["RelationImpression"] = Field(default_factory=list)
    reasoning: str = Field(default="", max_length=400)


class RelationImpression(APIModel):
    """One relationship-card update the LLM proposes during scene seal."""

    about_character_id: str
    sentiment_delta: float = Field(default=0.0, ge=-1.0, le=1.0)
    label: str | None = Field(default=None, max_length=64)
    notes_append: str = Field(default="", max_length=400)


# --- Relationship card CRUD ---------------------------------------------


class WorldCharacterRelationOut(APIModel):
    id: str
    from_character_id: str
    to_character_id: str
    label: str = ""
    sentiment: float = 0.0
    notes: str = ""
    last_updated_scene_id: str | None = None
    last_updated_seal_draft_id: str | None = None
    created_at: datetime
    updated_at: datetime


class WorldCharacterRelationUpsert(APIModel):
    """Create-or-replace a relation card (manual director path).

    The LLM scribe doesn't go through this — it modifies cards directly via
    the engine helper so it can apply incremental sentiment_delta and notes
    accumulation. The manual route always replaces the row's user-editable
    fields wholesale.
    """

    label: str = Field(default="", max_length=64)
    sentiment: float = Field(default=0.0, ge=-1.0, le=1.0)
    notes: str = Field(default="", max_length=2000)


class WorldCharacterRelationUpdate(APIModel):
    """Partial edit on an existing relation card. Use when you want to nudge
    one field (e.g. just sentiment) without touching the others."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="forbid")

    label: str | None = Field(default=None, max_length=64)
    sentiment: float | None = Field(default=None, ge=-1.0, le=1.0)
    notes: str | None = Field(default=None, max_length=2000)


class WorldMemoryOverviewOut(APIModel):
    id: str
    character_id: str
    character_name: str
    character_identity: str = ""
    character_color: str = "#3b82f6"
    character_icon: str = "Sparkles"
    kind: Literal["episode", "impression", "vow", "fact", "backstory"]
    content: str
    source_scene_id: str | None = None
    seal_draft_id: str | None = None
    scene_index_at_write: int | None = None
    in_world_time_at_event: str = ""
    salience: float = 0.5
    source: Literal["manual", "seal_committed", "migration"] = "manual"
    status: Literal["committed"] = "committed"
    locked: bool = False
    created_at: datetime


class WorldRelationshipEdgeOut(APIModel):
    id: str
    from_character_id: str
    from_character_name: str
    from_character_color: str = "#3b82f6"
    from_character_icon: str = "Sparkles"
    to_character_id: str
    to_character_name: str
    to_character_color: str = "#3b82f6"
    to_character_icon: str = "Sparkles"
    label: str = ""
    sentiment: float = 0.0
    notes: str = ""
    last_updated_scene_id: str | None = None
    last_updated_seal_draft_id: str | None = None
    source: Literal["manual", "seal_committed", "migration"] = "manual"
    status: Literal["committed"] = "committed"
    updated_at: datetime


class WorldStateOut(APIModel):
    world: WorldDetailOut
    bible: WorldBibleOut
    scenes: list[SceneTimelineEntry] = Field(default_factory=list)
    timeline_events: list[WorldTimelineEventOut] = Field(default_factory=list)
    memories: list[WorldMemoryOverviewOut] = Field(default_factory=list)
    relationships: list[WorldRelationshipEdgeOut] = Field(default_factory=list)
    recent_scene: SceneTimelineEntry | None = None
    open_scene: SceneTimelineEntry | None = None
    unresolved_hooks_count: int = 0
    recent_relationship_changes_count: int = 0


class SceneWorldBibleCompactOut(APIModel):
    id: str
    name: str
    summary: str = ""
    background: str = ""
    current_date_label: str = ""
    current_location: str = ""
    current_arc: dict[str, Any] = Field(default_factory=dict)
    rules: list[dict[str, Any]] = Field(default_factory=list)
    taboos: list[dict[str, Any]] = Field(default_factory=list)
    plot_hooks: list[dict[str, Any]] = Field(default_factory=list)


class SceneStageContextOut(APIModel):
    id: str
    scene_index: int | None = None
    title: str
    background: str = ""
    in_world_time_start: str = ""
    in_world_time_end: str = ""
    in_world_duration_hint: str = ""
    sealed: bool = False
    frozen: bool = False


class SceneTimelineEventCompactOut(APIModel):
    id: str
    type: TimelineEventType = "history"
    title: str
    summary: str = ""
    date_label: str = ""
    order: int = 0
    source: TimelineEventSource = "user"


class SceneStageCharacterOut(APIModel):
    world_character_id: str
    persona_instance_id: str | None = None
    name: str
    kind: Literal["ai", "user"]
    role_in_scene: str = ""
    speak_as_user: bool = False
    entry_order: int = 0
    joined_at: datetime
    entered_at_message_id: str | None = None
    exited_at_message_id: str | None = None
    is_present: bool = True
    can_speak: bool = False
    can_user_speak_as: bool = False


class SceneMemoryCueOut(APIModel):
    id: str
    world_character_id: str
    source_scene_id: str | None = None
    seal_draft_id: str | None = None
    scene_index_at_write: int | None = None
    in_world_time_at_event: str = ""
    kind: Literal["episode", "impression", "vow", "fact", "backstory"]
    target_character_id: str | None = None
    content: str
    salience: float = 0.5
    last_used_scene_index: int | None = None
    source: Literal["manual", "seal_committed"] = "manual"
    created_at: datetime


class SceneRelationshipCueOut(APIModel):
    id: str
    from_character_id: str
    to_character_id: str
    to_character_name: str = ""
    label: str = ""
    sentiment: float = 0.0
    notes: str = ""
    last_updated_scene_id: str | None = None
    last_updated_seal_draft_id: str | None = None
    source: Literal["manual", "seal_committed"] = "manual"
    updated_at: datetime


class SceneTranscriptVisibilityPreviewOut(APIModel):
    transcript_from_message_id: str | None = None
    transcript_to_message_id: str | None = None
    visible_message_count: int = 0
    notes: list[str] = Field(default_factory=list)


class SceneSpeakerContextOut(APIModel):
    persona_instance_id: str
    world_character_id: str | None = None
    name: str = ""
    memory_cues: list[SceneMemoryCueOut] = Field(default_factory=list)
    relationship_cues: list[SceneRelationshipCueOut] = Field(default_factory=list)
    visibility: SceneTranscriptVisibilityPreviewOut = Field(
        default_factory=SceneTranscriptVisibilityPreviewOut
    )


class SceneContextOut(APIModel):
    room_id: str
    world: SceneWorldBibleCompactOut
    scene: SceneStageContextOut
    timeline: list[SceneTimelineEventCompactOut] = Field(default_factory=list)
    stage_characters: list[SceneStageCharacterOut] = Field(default_factory=list)
    speaker: SceneSpeakerContextOut | None = None


# Resolve the forward reference in MemoryDistillation.
MemoryDistillation.model_rebuild()
