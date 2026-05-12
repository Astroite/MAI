"""Read-only Scene context aggregation.

The builder is a shared contract layer for Scene Context API preview, runtime
prompt injection, and upcoming stage UI.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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


def _is_scene_room(room: Room) -> bool:
    return room.world_id is not None


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
        visibility.notes.append("runtime transcript starts at speaker entry")
    if member.exited_at_message_id is None:
        visibility.notes.append("speaker is currently present")
    else:
        visibility.notes.append("speaker has exited; runtime transcript stops at exit")
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
    if not _is_scene_room(scene):
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


def _shorten(value: object, limit: int = 360) -> str:
    text = str(value or "").strip()
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "..."


def _item_label(item: dict[str, Any]) -> str:
    for key in ("title", "name", "label", "summary", "content"):
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return str(item)


def _json_item_lines(items: list[dict[str, Any]], *, limit: int = 5) -> list[str]:
    lines: list[str] = []
    for item in items[:limit]:
        label = _shorten(_item_label(item), 160)
        status = item.get("status")
        suffix = f" ({status})" if isinstance(status, str) and status.strip() else ""
        lines.append(f"- {label}{suffix}")
    return lines


def _arc_line(arc: dict[str, Any]) -> str:
    if not arc:
        return ""
    parts: list[str] = []
    for key in ("title", "summary", "current_conflict", "current_goal", "status"):
        value = arc.get(key)
        if isinstance(value, str) and value.strip():
            parts.append(value.strip())
    return " / ".join(parts) or _shorten(arc)


def compose_scene_runtime_context_prompt(context: SceneContextOut) -> str:
    """Render a compact Scene runtime context block for one speaker.

    The builder already enforces the private-data boundary; this renderer only
    consumes the compact context it receives and keeps the output bounded.
    """
    lines: list[str] = ["[World State]"]
    world = context.world
    lines.append(f"World: {world.name}")
    if world.summary:
        lines.append(f"Summary: {_shorten(world.summary)}")
    if world.background:
        lines.append(f"Background: {_shorten(world.background)}")
    if world.current_date_label:
        lines.append(f"Current date: {_shorten(world.current_date_label, 120)}")
    if world.current_location:
        lines.append(f"Current location: {_shorten(world.current_location, 120)}")
    arc = _arc_line(world.current_arc)
    if arc:
        lines.append(f"Current arc: {_shorten(arc)}")
    if world.rules:
        lines.append("Rules:")
        lines.extend(_json_item_lines(world.rules, limit=4))
    if world.taboos:
        lines.append("Taboos:")
        lines.extend(_json_item_lines(world.taboos, limit=4))
    if world.plot_hooks:
        lines.append("Plot hooks:")
        lines.extend(_json_item_lines(world.plot_hooks, limit=5))
    if context.timeline:
        lines.append("Recent committed timeline:")
        for event in context.timeline[-8:]:
            date = f"{event.date_label} " if event.date_label else ""
            summary = f": {_shorten(event.summary, 220)}" if event.summary else ""
            lines.append(f"- {date}{event.title} [{event.type}/{event.source}]{summary}")

    scene = context.scene
    lines.extend(["", "[Stage State]"])
    scene_bits = [f"Scene {scene.scene_index}" if scene.scene_index is not None else "Scene", scene.title]
    lines.append(" - ".join(bit for bit in scene_bits if bit))
    if scene.in_world_time_start:
        time_line = scene.in_world_time_start
        if scene.in_world_time_end:
            time_line += f" -> {scene.in_world_time_end}"
        lines.append(f"Scene time: {_shorten(time_line, 160)}")
    if scene.in_world_duration_hint:
        lines.append(f"Duration hint: {_shorten(scene.in_world_duration_hint, 120)}")
    if scene.background:
        lines.append(f"Scene background: {_shorten(scene.background)}")
    present = [item for item in context.stage_characters if item.is_present]
    if present:
        lines.append("Active stage characters:")
        for character in present[:12]:
            role = f" - {character.role_in_scene}" if character.role_in_scene else ""
            control = " user-playable" if character.can_user_speak_as else ""
            lines.append(f"- {character.name} ({character.kind}){role}{control}")

    lines.extend(["", "[Your Private Context]"])
    speaker = context.speaker
    if speaker is None:
        lines.append("No speaker-specific private context was requested.")
    else:
        lines.append(f"You are: {speaker.name}")
        if speaker.memory_cues:
            lines.append("Your memories:")
            for memory in speaker.memory_cues[:6]:
                prefix = f"Scene {memory.scene_index_at_write}: " if memory.scene_index_at_write is not None else ""
                lines.append(f"- [{memory.kind}] {prefix}{_shorten(memory.content, 260)}")
        else:
            lines.append("Your memories: none selected.")
        if speaker.relationship_cues:
            lines.append("Your outgoing relationships to active peers:")
            for relation in speaker.relationship_cues[:8]:
                label = relation.label or "unlabeled"
                notes = f" - {_shorten(relation.notes, 220)}" if relation.notes else ""
                lines.append(
                    f"- To {relation.to_character_name or relation.to_character_id}: "
                    f"{label} ({relation.sentiment:+.2f}){notes}"
                )
        else:
            lines.append("Your outgoing relationships to active peers: none selected.")
        if speaker.visibility.notes:
            lines.append(
                "Visibility preview: "
                + "; ".join(_shorten(note, 120) for note in speaker.visibility.notes[:3])
            )

    lines.extend(
        [
            "",
            "[Behavior Contract]",
            "- 只扮演自己。",
            "- 不代替其他角色说话或行动。",
            "- 不做全知旁白。",
            "- 只依据可见上下文。",
            "- 不知道的信息就表现为不知道。",
            "- 未被点名时可以简短观察或沉默。",
        ]
    )
    return "\n".join(line for line in lines if line is not None).strip()
