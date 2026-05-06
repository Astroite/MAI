from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class APIModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


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


OrderingRule = Annotated[
    AlternatingRule | RoundRobinRule | MentionDrivenRule | QuestionPairedRule | ParallelRule | UserPicksRule,
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


ExitCondition = Annotated[
    RoundsExit | AllSpokenExit | AllVotedExit | UserManualExit | FacilitatorSuggestsExit | TokenBudgetExit,
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
    system_prompt: str
    temperature: float
    config: dict[str, Any] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class PersonaCreate(APIModel):
    kind: Literal["discussant", "scribe", "facilitator"] = "discussant"
    name: str
    description: str = ""
    backing_model: str = "openai/gpt-4o-mini"
    api_provider_id: str | None = None
    system_prompt: str
    temperature: float = 0.4
    config: dict[str, Any] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)


class PersonaUpdate(APIModel):
    kind: Literal["discussant", "scribe", "facilitator"] | None = None
    name: str | None = None
    description: str | None = None
    backing_model: str | None = None
    api_provider_id: str | None = None
    system_prompt: str | None = None
    temperature: float | None = None
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
    description: str
    backing_model: str
    api_provider_id: str | None = None
    system_prompt: str
    temperature: float
    config: dict[str, Any] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class PersonaTemplateCreate(APIModel):
    kind: Literal["discussant", "scribe", "facilitator"] = "discussant"
    name: str
    description: str = ""
    backing_model: str = "openai/gpt-4o-mini"
    api_provider_id: str | None = None
    system_prompt: str
    temperature: float = 0.4
    config: dict[str, Any] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)


class PersonaTemplateUpdate(APIModel):
    """Patch a user-owned template. Builtin templates reject mutation at the
    route layer with 403 — duplicate then edit the copy."""

    name: str | None = None
    description: str | None = None
    backing_model: str | None = None
    api_provider_id: str | None = None
    system_prompt: str | None = None
    temperature: float | None = None
    config: dict[str, Any] | None = None
    tags: list[str] | None = None


class PersonaInstanceOut(APIModel):
    id: str
    room_id: str
    template_id: str
    template_version: int
    position: int
    kind: Literal["discussant", "scribe", "facilitator"]
    name: str
    description: str
    backing_model: str
    api_provider_id: str | None = None
    system_prompt: str
    temperature: float
    config: dict[str, Any] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class PersonaInstanceUpdate(APIModel):
    """Per-room edits. `name` and `kind` are immutable post-create — sent in
    the payload they trigger a 422 via `extra='forbid'`."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="forbid")

    description: str | None = None
    backing_model: str | None = None
    api_provider_id: str | None = None
    system_prompt: str | None = None
    temperature: float | None = None
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


class AppSettingsOut(APIModel):
    default_backing_model: str | None = None
    default_api_provider_id: str | None = None
    setup_complete: bool
    updated_at: datetime | None = None


class AppSettingsUpdate(APIModel):
    default_backing_model: str | None = None
    default_api_provider_id: str | None = None


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
    role_constraints: str = ""
    prompt_template: str = ""
    tags: list[str] = Field(default_factory=list)


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


class RoomOut(APIModel):
    id: str
    parent_room_id: str | None = None
    owner_user_id: str | None = None
    title: str
    recipe_id: str | None = None
    format_id: str | None = None
    format_version: int | None = None
    status: Literal["active", "frozen", "archived"]
    frozen_at: datetime | None = None
    created_at: datetime


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
    updated_at: datetime


class RoomCreate(APIModel):
    title: str
    recipe_id: str | None = None
    format_id: str | None = None
    persona_ids: list[str] = Field(default_factory=list)
    parent_room_id: str | None = None


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
    created_at: datetime


class MessageCreate(APIModel):
    content: str
    message_type: str = "speech"
    parent_message_id: str | None = None


class VerdictCreate(APIModel):
    content: str
    is_locked: bool = False
    dead_end: bool = False
    revoke_message_id: str | None = None


class MasqueradeCreate(APIModel):
    persona_id: str | None = None
    display_name: str | None = None
    content: str
    message_type: str = "speech"


class TurnRequest(APIModel):
    speaker_persona_id: str | None = None


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
    in_flight_partial: list[InFlightPartialOut] = Field(default_factory=list)
