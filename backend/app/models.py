from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base
from .ids import new_id


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class Persona(Base):
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
    system_prompt: Mapped[str] = mapped_column(Text)
    temperature: Mapped[float] = mapped_column(default=0.4)
    config: Mapped[dict] = mapped_column(JSONB, default=dict)
    tags: Mapped[list[str]] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)

    __table_args__ = (Index("ix_personas_tags", "tags", postgresql_using="gin"),)


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
    declared_variables: Mapped[list[dict]] = mapped_column(JSONB, default=list)
    allowed_speakers: Mapped[dict] = mapped_column(JSONB)
    ordering_rule: Mapped[dict] = mapped_column(JSONB)
    exit_conditions: Mapped[list[dict]] = mapped_column(JSONB, default=list)
    role_constraints: Mapped[str] = mapped_column(Text, default="")
    prompt_template: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[list[str]] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)

    __table_args__ = (Index("ix_phase_templates_tags", "tags", postgresql_using="gin"),)


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
    phase_sequence: Mapped[list[dict]] = mapped_column(JSONB, default=list)
    tags: Mapped[list[str]] = mapped_column(JSONB, default=list)
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
    persona_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)
    format_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    format_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    initial_settings: Mapped[dict] = mapped_column(JSONB, default=dict)
    tags: Mapped[list[str]] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


class Room(Base):
    __tablename__ = "rooms"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    parent_room_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    owner_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    title: Mapped[str] = mapped_column(String(200))
    recipe_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    format_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    format_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="active")
    frozen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
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
    variable_bindings: Mapped[dict[str, list[str]]] = mapped_column(JSONB, default=dict)


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
    current_state: Mapped[dict] = mapped_column(JSONB, default=dict)
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
    signals: Mapped[list[dict]] = mapped_column(JSONB, default=list)
    overall_health: Mapped[str] = mapped_column(String(48), default="productive")
    pacing_note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class MergeBack(Base):
    __tablename__ = "merge_backs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    parent_room_id: Mapped[str] = mapped_column(String(36), ForeignKey("rooms.id"), index=True)
    sub_room_id: Mapped[str] = mapped_column(String(36), ForeignKey("rooms.id"), unique=True)
    conclusion: Mapped[str] = mapped_column(Text)
    key_reasoning: Mapped[list[str]] = mapped_column(JSONB, default=list)
    rejected_alternatives: Mapped[list[dict]] = mapped_column(JSONB, default=list)
    unresolved: Mapped[list[str]] = mapped_column(JSONB, default=list)
    artifacts_ref: Mapped[dict] = mapped_column(JSONB, default=dict)
    full_transcript_ref: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class RoomSnapshot(Base):
    __tablename__ = "room_snapshots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    room_id: Mapped[str] = mapped_column(String(36), ForeignKey("rooms.id"), index=True)
    full_state: Mapped[dict] = mapped_column(JSONB)
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
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


class TraceEvent(Base):
    __tablename__ = "trace_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    room_id: Mapped[str] = mapped_column(String(36), index=True)
    event_type: Mapped[str] = mapped_column(String(80), index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, index=True)
    summary: Mapped[str] = mapped_column(Text)
    payload_ref: Mapped[str | None] = mapped_column(Text, nullable=True)

