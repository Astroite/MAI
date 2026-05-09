from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base
from .ids import new_id


JSONType = JSON().with_variant(JSONB(), "postgresql")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class Persona(Base):
    """Legacy table; superseded by PersonaTemplate + PersonaInstance.

    Kept temporarily so the persona-split migration can read the old rows.
    Removed once all consumers (engine, main, seed, schemas) switch over.
    """

    __tablename__ = "personas"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(32), default="published")
    forked_from_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    forked_from_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    owner_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False)
    kind: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    backing_model: Mapped[str] = mapped_column(String(160))
    api_provider_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    system_prompt: Mapped[str] = mapped_column(Text)
    temperature: Mapped[float] = mapped_column(default=0.4)
    config: Mapped[dict] = mapped_column(JSONType, default=dict)
    tags: Mapped[list[str]] = mapped_column(JSONType, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


class PersonaTemplate(Base):
    __tablename__ = "persona_templates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(32), default="published")
    forked_from_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    forked_from_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    owner_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False)
    kind: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(120))
    identity: Mapped[str] = mapped_column(String(120), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    backing_model: Mapped[str] = mapped_column(String(160))
    api_provider_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("api_providers.id", ondelete="SET NULL"), nullable=True
    )
    api_model_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("api_models.id", ondelete="SET NULL"), nullable=True
    )
    system_prompt: Mapped[str] = mapped_column(Text)
    temperature: Mapped[float] = mapped_column(default=0.4)
    talkativeness: Mapped[float] = mapped_column(default=1.0)
    color: Mapped[str] = mapped_column(String(16), default="#3b82f6")
    icon: Mapped[str] = mapped_column(String(48), default="Sparkles")
    config: Mapped[dict] = mapped_column(JSONType, default=dict)
    tags: Mapped[list[str]] = mapped_column(JSONType, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


class PersonaInstance(Base):
    __tablename__ = "persona_instances"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    room_id: Mapped[str] = mapped_column(String(36), ForeignKey("rooms.id", ondelete="CASCADE"), index=True)
    template_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("persona_templates.id", ondelete="RESTRICT"), index=True
    )
    template_version: Mapped[int] = mapped_column(Integer, default=1)
    position: Mapped[int] = mapped_column(Integer, default=0)
    # Snapshot — copied from template at instance creation. name + kind are
    # immutable post-create (enforced by PersonaInstanceUpdate's field whitelist).
    kind: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(120))
    identity: Mapped[str] = mapped_column(String(120), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    backing_model: Mapped[str] = mapped_column(String(160))
    api_provider_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("api_providers.id", ondelete="SET NULL"), nullable=True
    )
    api_model_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("api_models.id", ondelete="SET NULL"), nullable=True
    )
    system_prompt: Mapped[str] = mapped_column(Text)
    temperature: Mapped[float] = mapped_column(default=0.4)
    talkativeness: Mapped[float] = mapped_column(default=1.0)
    color: Mapped[str] = mapped_column(String(16), default="#3b82f6")
    icon: Mapped[str] = mapped_column(String(48), default="Sparkles")
    config: Mapped[dict] = mapped_column(JSONType, default=dict)
    tags: Mapped[list[str]] = mapped_column(JSONType, default=list)
    # Story World linkage. Set when the instance was spawned from a
    # WorldCharacter so the engine can reach back to the character's record
    # (currently used for scene-roster filtering; future PRs use it for
    # episodic memory retrieval).
    world_character_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)

    __table_args__ = (
        Index("ix_persona_instances_room_template", "room_id", "template_id"),
    )


class MigrationRecord(Base):
    """Tracks which one-shot data migrations have been applied."""

    __tablename__ = "_migrations"

    name: Mapped[str] = mapped_column(String(120), primary_key=True)
    applied_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class ApiProvider(Base):
    __tablename__ = "api_providers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(120))
    provider_slug: Mapped[str] = mapped_column(String(64))
    api_key: Mapped[str] = mapped_column(Text)
    api_base: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_tested_ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    last_tested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_tested_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


class ApiModel(Base):
    __tablename__ = "api_models"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    api_provider_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("api_providers.id", ondelete="CASCADE"), index=True
    )
    display_name: Mapped[str] = mapped_column(String(120))
    model_name: Mapped[str] = mapped_column(String(240))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    context_window: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tags: Mapped[list[str]] = mapped_column(JSONType, default=list)
    last_tested_ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    last_tested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_tested_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)

    __table_args__ = (
        Index("ix_api_models_provider_model", "api_provider_id", "model_name"),
    )


class AppSettings(Base):
    """Singleton row holding user-level defaults. Only id=1 is used."""

    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    default_backing_model: Mapped[str | None] = mapped_column(String(160), nullable=True)
    default_api_provider_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("api_providers.id", ondelete="SET NULL"), nullable=True
    )
    default_api_model_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("api_models.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


class PhaseTemplate(Base):
    __tablename__ = "phase_templates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(32), default="published")
    forked_from_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    forked_from_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    owner_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    declared_variables: Mapped[list[dict]] = mapped_column(JSONType, default=list)
    allowed_speakers: Mapped[dict] = mapped_column(JSONType)
    ordering_rule: Mapped[dict] = mapped_column(JSONType)
    exit_conditions: Mapped[list[dict]] = mapped_column(JSONType, default=list)
    auto_discuss: Mapped[bool] = mapped_column(Boolean, default=False)
    role_constraints: Mapped[str] = mapped_column(Text, default="")
    prompt_template: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[list[str]] = mapped_column(JSONType, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


class DebateFormat(Base):
    __tablename__ = "debate_formats"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(32), default="published")
    forked_from_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    forked_from_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    owner_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    phase_sequence: Mapped[list[dict]] = mapped_column(JSONType, default=list)
    tags: Mapped[list[str]] = mapped_column(JSONType, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


class Recipe(Base):
    __tablename__ = "recipes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    version: Mapped[int] = mapped_column(Integer, default=1)
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(32), default="published")
    forked_from_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    forked_from_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    owner_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    persona_ids: Mapped[list[str]] = mapped_column(JSONType, default=list)
    format_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    format_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    initial_settings: Mapped[dict] = mapped_column(JSONType, default=dict)
    tags: Mapped[list[str]] = mapped_column(JSONType, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


class Room(Base):
    __tablename__ = "rooms"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    parent_room_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    owner_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    title: Mapped[str] = mapped_column(String(200))
    background: Mapped[str] = mapped_column(Text, default="")
    recipe_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    format_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    format_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="active")
    frozen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Story World scene fields. world_id + scene_index identify the room as a
    # scene within a World; both NULL means a normal discussion room.
    world_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    scene_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    in_world_time_start: Mapped[str] = mapped_column(Text, default="")
    in_world_time_end: Mapped[str] = mapped_column(Text, default="")
    in_world_duration_hint: Mapped[str] = mapped_column(Text, default="")
    sealed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class RoomPersona(Base):
    __tablename__ = "room_personas"

    room_id: Mapped[str] = mapped_column(String(36), ForeignKey("rooms.id"), primary_key=True)
    persona_id: Mapped[str] = mapped_column(String(36), ForeignKey("personas.id"), primary_key=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class RoomPhasePlan(Base):
    __tablename__ = "room_phase_plan"

    room_id: Mapped[str] = mapped_column(String(36), ForeignKey("rooms.id"), primary_key=True)
    position: Mapped[int] = mapped_column(Integer, primary_key=True)
    phase_template_id: Mapped[str] = mapped_column(String(36), ForeignKey("phase_templates.id"))
    phase_template_version: Mapped[int] = mapped_column(Integer, default=1)
    source: Mapped[str] = mapped_column(String(32), default="format")
    variable_bindings: Mapped[dict[str, list[str]]] = mapped_column(JSONType, default=dict)


class RoomPhaseInstance(Base):
    __tablename__ = "room_phase_instances"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    room_id: Mapped[str] = mapped_column(String(36), ForeignKey("rooms.id"), index=True)
    plan_position: Mapped[int] = mapped_column(Integer)
    phase_template_id: Mapped[str] = mapped_column(String(36), ForeignKey("phase_templates.id"))
    phase_template_version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(32), default="running")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    room_id: Mapped[str] = mapped_column(String(36), ForeignKey("rooms.id"), index=True)
    phase_instance_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    parent_message_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    message_type: Mapped[str] = mapped_column(String(48), default="speech")
    author_persona_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    author_model: Mapped[str | None] = mapped_column(String(160), nullable=True)
    author_actual: Mapped[str] = mapped_column(String(32), default="ai")
    user_masquerade_persona_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    user_masquerade_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    visibility: Mapped[str] = mapped_column(String(32), default="public")
    visibility_to_models: Mapped[bool] = mapped_column(Boolean, default=True)
    content: Mapped[str] = mapped_column(Text)
    content_chunks_count: Mapped[int] = mapped_column(Integer, default=1)
    truncated_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cost_usd: Mapped[float | None] = mapped_column(Numeric(12, 6), nullable=True)
    user_revealed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    __table_args__ = (Index("ix_messages_room_created", "room_id", "created_at"),)


class ScribeState(Base):
    __tablename__ = "scribe_states"

    room_id: Mapped[str] = mapped_column(String(36), ForeignKey("rooms.id"), primary_key=True)
    current_state: Mapped[dict] = mapped_column(JSONType, default=dict)
    last_event_message_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


class Decision(Base):
    __tablename__ = "decisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    room_id: Mapped[str] = mapped_column(String(36), ForeignKey("rooms.id"), index=True)
    scribe_event_message_id: Mapped[str] = mapped_column(String(36))
    content: Mapped[str] = mapped_column(Text)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False)
    locked_by_message_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    revoked_by_message_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class FacilitatorSignal(Base):
    __tablename__ = "facilitator_signals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    room_id: Mapped[str] = mapped_column(String(36), ForeignKey("rooms.id"), index=True)
    message_id: Mapped[str] = mapped_column(String(36))
    trigger_after_message_id: Mapped[str] = mapped_column(String(36))
    signals: Mapped[list[dict]] = mapped_column(JSONType, default=list)
    overall_health: Mapped[str] = mapped_column(String(48), default="productive")
    pacing_note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class MergeBack(Base):
    __tablename__ = "merge_backs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    parent_room_id: Mapped[str] = mapped_column(String(36), ForeignKey("rooms.id"), index=True)
    sub_room_id: Mapped[str] = mapped_column(String(36), ForeignKey("rooms.id"), unique=True)
    conclusion: Mapped[str] = mapped_column(Text)
    key_reasoning: Mapped[list[str]] = mapped_column(JSONType, default=list)
    rejected_alternatives: Mapped[list[dict]] = mapped_column(JSONType, default=list)
    unresolved: Mapped[list[str]] = mapped_column(JSONType, default=list)
    artifacts_ref: Mapped[dict] = mapped_column(JSONType, default=dict)
    full_transcript_ref: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class RoomSnapshot(Base):
    __tablename__ = "room_snapshots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    room_id: Mapped[str] = mapped_column(String(36), ForeignKey("rooms.id"), index=True)
    full_state: Mapped[dict] = mapped_column(JSONType)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class Upload(Base):
    __tablename__ = "uploads"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    room_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    filename: Mapped[str] = mapped_column(String(260))
    content_type: Mapped[str] = mapped_column(String(120))
    extracted_text: Mapped[str] = mapped_column(Text)
    storage_path: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class ToolServer(Base):
    __tablename__ = "tool_servers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    kind: Mapped[str] = mapped_column(String(32), default="mcp")
    transport: Mapped[str] = mapped_column(String(32), default="streamable_http")
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_write: Mapped[bool] = mapped_column(Boolean, default=False)
    manifest: Mapped[dict] = mapped_column(JSONType, default=dict)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


class ToolInvocation(Base):
    __tablename__ = "tool_invocations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    room_id: Mapped[str] = mapped_column(String(36), ForeignKey("rooms.id"), index=True)
    message_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("messages.id"), nullable=True, index=True)
    parent_message_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    server_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tool_servers.id"), nullable=True)
    tool_name: Mapped[str] = mapped_column(String(160))
    display_name: Mapped[str] = mapped_column(String(200), default="")
    status: Mapped[str] = mapped_column(String(32), default="pending")
    arguments: Mapped[dict] = mapped_column(JSONType, default=dict)
    result: Mapped[dict | list | str | None] = mapped_column(JSONType, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    __table_args__ = (Index("ix_tool_invocations_room_created", "room_id", "created_at"),)


class RoomRuntimeState(Base):
    __tablename__ = "room_runtime_state"

    room_id: Mapped[str] = mapped_column(String(36), ForeignKey("rooms.id"), primary_key=True)
    current_phase_instance_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    frozen: Mapped[bool] = mapped_column(Boolean, default=False)
    token_counter_total: Mapped[int] = mapped_column(Integer, default=0)
    cost_counter_usd: Mapped[float] = mapped_column(Numeric(12, 6), default=0)
    auto_transition: Mapped[bool] = mapped_column(Boolean, default=False)
    current_user_mode: Mapped[str] = mapped_column(String(48), default="normal")
    current_masquerade_persona_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    max_message_tokens: Mapped[int] = mapped_column(Integer, default=900)
    max_room_tokens: Mapped[int] = mapped_column(Integer, default=120000)
    max_phase_rounds: Mapped[int] = mapped_column(Integer, default=3)
    max_account_daily_tokens: Mapped[int] = mapped_column(Integer, default=250000)
    max_account_monthly_tokens: Mapped[int] = mapped_column(Integer, default=3000000)
    phase_exit_suggested: Mapped[bool] = mapped_column(Boolean, default=False)
    phase_exit_matched_conditions: Mapped[list[dict]] = mapped_column(JSONType, default=list)
    phase_exit_suppressed_after_message_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    consecutive_ai_turns: Mapped[int] = mapped_column(Integer, default=0)
    max_consecutive_ai_turns: Mapped[int] = mapped_column(Integer, default=10)
    phase_extra_rounds: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


class TraceEvent(Base):
    __tablename__ = "trace_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    room_id: Mapped[str] = mapped_column(String(36), index=True)
    event_type: Mapped[str] = mapped_column(String(80), index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, index=True)
    summary: Mapped[str] = mapped_column(Text)
    payload_ref: Mapped[str | None] = mapped_column(Text, nullable=True)


class World(Base):
    __tablename__ = "worlds"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    name: Mapped[str] = mapped_column(String(200))
    synopsis: Mapped[str] = mapped_column(Text, default="")
    setting: Mapped[str] = mapped_column(Text, default="")
    calendar_hint: Mapped[str] = mapped_column(Text, default="")
    cover_color: Mapped[str] = mapped_column(String(16), default="#3b82f6")
    cover_icon: Mapped[str] = mapped_column(String(48), default="Globe")
    status: Mapped[str] = mapped_column(String(32), default="active")
    config: Mapped[dict] = mapped_column(JSONType, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


class WorldCharacter(Base):
    """A character that lives inside a World. kind=ai binds to a PersonaTemplate
    and carries memory; kind=user is a lightweight slot driven by the human user."""

    __tablename__ = "world_characters"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    world_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("worlds.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(16))  # "ai" | "user"
    name: Mapped[str] = mapped_column(String(120))
    identity: Mapped[str] = mapped_column(String(120), default="")
    brief: Mapped[str] = mapped_column(Text, default="")
    persona_template_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("persona_templates.id", ondelete="RESTRICT"), nullable=True
    )
    persona_template_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    backing_overrides: Mapped[dict] = mapped_column(JSONType, default=dict)
    color: Mapped[str] = mapped_column(String(16), default="#3b82f6")
    icon: Mapped[str] = mapped_column(String(48), default="Sparkles")
    core_identity: Mapped[str] = mapped_column(Text, default="")
    skills_text: Mapped[str] = mapped_column(Text, default="")
    goals_text: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(32), default="active")  # active | retired
    config: Mapped[dict] = mapped_column(JSONType, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)

    __table_args__ = (
        Index("ix_world_characters_world_status", "world_id", "status"),
    )


class WorldSceneMember(Base):
    """Roster row binding a WorldCharacter into a Scene (Room with world_id).

    The presence interval is identified by entered/exited message ids:
      * entered_at_message_id IS NULL  -> on stage from scene open
      * exited_at_message_id  IS NULL  -> still on stage

    A character can only have one row per scene; v1 does not support a
    character leaving and re-entering the same scene (logged as v2).
    """

    __tablename__ = "world_scene_members"

    scene_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("rooms.id", ondelete="CASCADE"), primary_key=True
    )
    world_character_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("world_characters.id", ondelete="CASCADE"), primary_key=True
    )
    role_in_scene: Mapped[str] = mapped_column(Text, default="")
    speak_as_user: Mapped[bool] = mapped_column(Boolean, default=False)
    entered_at_message_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    exited_at_message_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    __table_args__ = (
        Index("ix_world_scene_members_character", "world_character_id"),
    )


class WorldCharacterMemory(Base):
    """Episodic memory entry for a WorldCharacter.

    Three writers feed this table:
      * scene-end memory scribe (PR 3+) writes kind in {"episode", "vow"}
        with source_scene_id pointing at the Room that produced it.
      * relationship-card scribe (PR 4) writes kind="impression" tagged at
        a specific peer (target_character_id).
      * manual user edit (PR 5) writes kind="backstory" with NULL source
        scene — backstory enters the world before any scene exists.

    Retrieval at next-scene creation pulls top-K rows ordered by
    salience * recency_decay (PR 3 v1: just salience DESC, scene_index DESC).
    """

    __tablename__ = "world_character_memories"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    world_character_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("world_characters.id", ondelete="CASCADE"), index=True
    )
    source_scene_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    scene_index_at_write: Mapped[int | None] = mapped_column(Integer, nullable=True)
    in_world_time_at_event: Mapped[str] = mapped_column(Text, default="")
    kind: Mapped[str] = mapped_column(String(32))  # episode | impression | vow | fact | backstory
    target_character_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    content: Mapped[str] = mapped_column(Text)
    salience: Mapped[float] = mapped_column(default=0.5)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    __table_args__ = (
        Index(
            "ix_world_character_memories_char_recent",
            "world_character_id",
            "scene_index_at_write",
        ),
    )
