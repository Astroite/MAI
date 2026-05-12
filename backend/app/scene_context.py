"""Read-only Scene context aggregation.

P1.1 intentionally does not feed this context into LLM runtime calls. The
builder is a preview/contract layer for future runtime injection and stage UI.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .engine import is_scene_room
from .models import (
    Message,
    PersonaInstance,
    Room,
    RoomRuntimeState,
    World,
    WorldCharacter,
    WorldCharacterMemory,
    WorldCharacterRelation,
    WorldSceneMember,
    WorldTimelineEvent,
)
from .schemas import (
    SceneContextOut,
    SceneMemoryCueOut,
    SceneRelationshipCueOut,
    SceneSpeakerContextOut,
    SceneStageCharacterOut,
    SceneStageContextOut,
    SceneTimelineEventCompactOut,
    SceneTranscriptVisibilityPreviewOut,
    SceneWorldBibleCompactOut,
)


SCENE_CONTEXT_TIMELINE_LIMIT = 8
SCENE_CONTEXT_MEMORY_LIMIT = 6
MEMORY_COLD_STORAGE_THRESHOLD = 0.05
_UNCOMMITTED_STATUSES = {"draft", "hidden", "discarded"}


class SceneContextError(ValueError):
    """Raised when a scene context cannot be built for the given inputs."""


def _is_committed_json_item(item: object) -> bool:
    if not isinstance(item, dict):
        return False
    status = str(item.get("status") or "committed").lower()
    if status in _UNCOMMITTED_STATUSES:
        return False
    if item.get("selected") is False or item.get("confirmed") is False:
        return False
    return True


def _committed_json_items(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [dict(item) for item in value if _is_committed_json_item(item)]


def _committed_json_object(value: object) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    if not _is_committed_json_item(value):
        return {}
    return dict(value)


def _world_bible_compact(world: World) -> SceneWorldBibleCompactOut:
    config = dict(world.config or {})
    raw_config = config.get("world_bible")
    raw = dict(raw_config) if isinstance(raw_config, dict) else {}
    current_arc = raw["current_arc"] if "current_arc" in raw else config.get("current_arc")
    plot_hooks = raw["plot_hooks"] if "plot_hooks" in raw else config.get("plot_hooks", [])
    return SceneWorldBibleCompactOut(
        id=world.id,
        name=world.name,
        summary=raw.get("summary") or world.synopsis or "",
        background=raw.get("background") or world.setting or "",
        current_date_label=raw.get("current_date_label") or "",
        current_location=raw.get("current_location") or "",
        current_arc=_committed_json_object(current_arc),
        rules=_committed_json_items(raw.get("rules")),
        taboos=_committed_json_items(raw.get("taboos")),
        plot_hooks=_committed_json_items(plot_hooks),
    )


async def _recent_timeline_events(
    session: AsyncSession,
    world_id: str,
    limit: int = SCENE_CONTEXT_TIMELINE_LIMIT,
) -> list[SceneTimelineEventCompactOut]:
    rows = list(
        (
            await session.scalars(
                select(WorldTimelineEvent)
                .where(
                    WorldTimelineEvent.world_id == world_id,
                    WorldTimelineEvent.status == "committed",
                )
                .order_by(
                    WorldTimelineEvent.order.desc(),
                    WorldTimelineEvent.created_at.desc(),
                )
                .limit(limit)
            )
        ).all()
    )
    rows.sort(key=lambda event: (event.order, event.created_at))
    return [
        SceneTimelineEventCompactOut(
            id=event.id,
            type=event.type,  # type: ignore[arg-type]
            title=event.title,
            summary=event.summary,
            date_label=event.date_label,
            order=event.order,
            source=event.source,  # type: ignore[arg-type]
        )
        for event in rows
    ]


async def _stage_roster(
    session: AsyncSession,
    scene: Room,
) -> tuple[list[SceneStageCharacterOut], dict[str, WorldSceneMember], dict[str, WorldCharacter]]:
    members = list(
        (
            await session.scalars(
                select(WorldSceneMember)
                .where(WorldSceneMember.scene_id == scene.id)
                .order_by(WorldSceneMember.joined_at, WorldSceneMember.world_character_id)
            )
        ).all()
    )
    if not members:
        return [], {}, {}

    character_ids = [member.world_character_id for member in members]
    characters = {
        character.id: character
        for character in (
            await session.scalars(
                select(WorldCharacter).where(WorldCharacter.id.in_(character_ids))
            )
        ).all()
    }
    personas = {
        persona.world_character_id: persona
        for persona in (
            await session.scalars(
                select(PersonaInstance).where(
                    PersonaInstance.room_id == scene.id,
                    PersonaInstance.world_character_id.in_(character_ids),
                )
            )
        ).all()
        if persona.world_character_id
    }
    stage: list[SceneStageCharacterOut] = []
    member_by_character_id: dict[str, WorldSceneMember] = {}
    for index, member in enumerate(members):
        character = characters.get(member.world_character_id)
        if character is None:
            continue
        persona = personas.get(character.id)
        is_present = member.exited_at_message_id is None
        auto_reply_enabled = True
        if persona is not None:
            auto_reply_enabled = (persona.config or {}).get("auto_reply_enabled", True) is not False
        stage.append(
            SceneStageCharacterOut(
                world_character_id=character.id,
                persona_instance_id=persona.id if persona is not None else None,
                name=character.name,
                kind=character.kind,  # type: ignore[arg-type]
                role_in_scene=member.role_in_scene,
                speak_as_user=member.speak_as_user,
                entry_order=index,
                joined_at=member.joined_at,
                entered_at_message_id=member.entered_at_message_id,
                exited_at_message_id=member.exited_at_message_id,
                is_present=is_present,
                can_speak=bool(
                    is_present
                    and character.kind == "ai"
                    and persona is not None
                    and auto_reply_enabled
                ),
                can_user_speak_as=bool(
                    is_present and character.kind == "user" and member.speak_as_user
                ),
            )
        )
        member_by_character_id[character.id] = member
    return stage, member_by_character_id, characters


async def _visible_message_count(
    session: AsyncSession,
    scene_id: str,
    member: WorldSceneMember | None,
) -> int:
    messages = list(
        (
            await session.scalars(
                select(Message)
                .where(Message.room_id == scene_id, Message.visibility_to_models.is_(True))
                .order_by(Message.created_at)
            )
        ).all()
    )
    if member is None:
        return 0
    if member.entered_at_message_id is None and member.exited_at_message_id is None:
        return len(messages)
    count = 0
    started = member.entered_at_message_id is None
    for message in messages:
        if not started:
            if message.id == member.entered_at_message_id:
                started = True
            else:
                continue
        count += 1
        if member.exited_at_message_id and message.id == member.exited_at_message_id:
            break
    return count


async def _speaker_memories(
    session: AsyncSession,
    character_id: str,
    limit: int = SCENE_CONTEXT_MEMORY_LIMIT,
) -> list[SceneMemoryCueOut]:
    rows = list(
        (
            await session.scalars(
                select(WorldCharacterMemory)
                .where(
                    WorldCharacterMemory.world_character_id == character_id,
                    WorldCharacterMemory.salience >= MEMORY_COLD_STORAGE_THRESHOLD,
                )
                .order_by(
                    WorldCharacterMemory.salience.desc(),
                    WorldCharacterMemory.scene_index_at_write.desc().nulls_last(),
                    WorldCharacterMemory.created_at.desc(),
                )
                .limit(limit)
            )
        ).all()
    )
    return [
        SceneMemoryCueOut(
            id=memory.id,
            world_character_id=memory.world_character_id,
            source_scene_id=memory.source_scene_id,
            seal_draft_id=memory.seal_draft_id,
            scene_index_at_write=memory.scene_index_at_write,
            in_world_time_at_event=memory.in_world_time_at_event,
            kind=memory.kind,  # type: ignore[arg-type]
            target_character_id=memory.target_character_id,
            content=memory.content,
            salience=memory.salience,
            last_used_scene_index=memory.last_used_scene_index,
            source="seal_committed" if memory.source_scene_id else "manual",
            created_at=memory.created_at,
        )
        for memory in rows
    ]


async def _speaker_relations(
    session: AsyncSession,
    speaker_character_id: str,
    peer_character_ids: list[str],
    characters: dict[str, WorldCharacter],
) -> list[SceneRelationshipCueOut]:
    if not peer_character_ids:
        return []
    rows = list(
        (
            await session.scalars(
                select(WorldCharacterRelation)
                .where(
                    WorldCharacterRelation.from_character_id == speaker_character_id,
                    WorldCharacterRelation.to_character_id.in_(peer_character_ids),
                )
                .order_by(WorldCharacterRelation.updated_at.desc())
            )
        ).all()
    )
    return [
        SceneRelationshipCueOut(
            id=relation.id,
            from_character_id=relation.from_character_id,
            to_character_id=relation.to_character_id,
            to_character_name=characters.get(relation.to_character_id).name
            if characters.get(relation.to_character_id)
            else "",
            label=relation.label,
            sentiment=relation.sentiment,
            notes=relation.notes,
            last_updated_scene_id=relation.last_updated_scene_id,
            last_updated_seal_draft_id=relation.last_updated_seal_draft_id,
            source="seal_committed" if relation.last_updated_scene_id else "manual",
            updated_at=relation.updated_at,
        )
        for relation in rows
    ]


async def _speaker_context(
    session: AsyncSession,
    scene: Room,
    speaker_persona_id: str,
    stage: list[SceneStageCharacterOut],
    member_by_character_id: dict[str, WorldSceneMember],
    characters: dict[str, WorldCharacter],
) -> SceneSpeakerContextOut:
    persona = await session.get(PersonaInstance, speaker_persona_id)
    if persona is None or persona.room_id != scene.id:
        raise SceneContextError("speaker persona not found in this scene")

    visibility = SceneTranscriptVisibilityPreviewOut()
    speaker = SceneSpeakerContextOut(
        persona_instance_id=persona.id,
        world_character_id=persona.world_character_id,
        name=persona.name,
        visibility=visibility,
    )
    if not persona.world_character_id:
        visibility.notes.append("speaker persona is not bound to a WorldCharacter")
        return speaker
    character = characters.get(persona.world_character_id)
    if character is None or character.world_id != scene.world_id:
        visibility.notes.append("speaker WorldCharacter is missing or belongs to a different world")
        return speaker

    member = member_by_character_id.get(character.id)
    if member is None:
        visibility.notes.append("speaker WorldCharacter is not on this scene roster")
        return speaker

    visibility.transcript_from_message_id = member.entered_at_message_id
    visibility.transcript_to_message_id = member.exited_at_message_id
    visibility.visible_message_count = await _visible_message_count(session, scene.id, member)
    if member.entered_at_message_id is None:
        visibility.notes.append("speaker is visible from scene open")
    else:
        visibility.notes.append("future runtime should start transcript at speaker entry")
    if member.exited_at_message_id is None:
        visibility.notes.append("speaker is currently present")
    else:
        visibility.notes.append("speaker has exited; future runtime should stop at exit")
    visibility.notes.append("narration is visible when it falls inside the presence interval")

    active_peer_ids = [
        item.world_character_id
        for item in stage
        if item.world_character_id != character.id and item.is_present
    ]
    speaker.memory_cues = await _speaker_memories(session, character.id)
    speaker.relationship_cues = await _speaker_relations(
        session,
        character.id,
        active_peer_ids,
        characters,
    )
    return speaker


async def build_scene_context(
    session: AsyncSession,
    scene: Room,
    speaker_persona_id: str | None = None,
) -> SceneContextOut:
    """Build the current read-only stage context for a Story World scene."""
    if not is_scene_room(scene):
        raise SceneContextError("room is not a Story World scene")
    world = await session.get(World, scene.world_id)
    if world is None:
        raise SceneContextError("scene world not found")
    runtime = await session.get(RoomRuntimeState, scene.id)
    stage, member_by_character_id, characters = await _stage_roster(session, scene)
    speaker = (
        await _speaker_context(
            session,
            scene,
            speaker_persona_id,
            stage,
            member_by_character_id,
            characters,
        )
        if speaker_persona_id
        else None
    )
    return SceneContextOut(
        room_id=scene.id,
        world=_world_bible_compact(world),
        scene=SceneStageContextOut(
            id=scene.id,
            scene_index=scene.scene_index,
            title=scene.title,
            background=scene.background,
            in_world_time_start=scene.in_world_time_start,
            in_world_time_end=scene.in_world_time_end,
            in_world_duration_hint=scene.in_world_duration_hint,
            sealed=scene.sealed_at is not None,
            frozen=bool(runtime.frozen) if runtime is not None else scene.status == "frozen",
        ),
        timeline=await _recent_timeline_events(session, world.id),
        stage_characters=stage,
        speaker=speaker,
    )
