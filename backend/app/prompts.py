"""Prompt composition helpers for domain-specific LLM context."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .models import (
        Room,
        World,
        WorldCharacter,
        WorldCharacterMemory,
        WorldCharacterRelation,
    )


def format_character_memory(memory: WorldCharacterMemory) -> str:
    prefix_parts: list[str] = []
    if memory.scene_index_at_write is not None:
        prefix_parts.append(f"第{memory.scene_index_at_write}幕")
    elif memory.kind == "backstory":
        prefix_parts.append("过往")
    if memory.in_world_time_at_event:
        prefix_parts.append(memory.in_world_time_at_event)
    prefix = "（" + " · ".join(prefix_parts) + "）" if prefix_parts else ""
    kind_label = {
        "episode": "经历",
        "vow": "誓言",
        "impression": "印象",
        "fact": "事实",
        "backstory": "背景",
    }.get(memory.kind, memory.kind)
    return f"- [{kind_label}]{prefix} {memory.content.strip()}"


def format_character_relation(
    peer: WorldCharacter, relation: WorldCharacterRelation
) -> str:
    """One bullet under '## 你和在场角色的关系'."""
    label = relation.label.strip() or "（未命名关系）"
    sentiment = relation.sentiment
    # Crude sentiment glyph so the model has an at-a-glance signal alongside
    # the textual notes. -1 hostile ... +1 close.
    if sentiment >= 0.5:
        marker = "❤"
    elif sentiment >= 0.1:
        marker = "+"
    elif sentiment <= -0.5:
        marker = "✕"
    elif sentiment <= -0.1:
        marker = "-"
    else:
        marker = "·"
    notes = relation.notes.strip()
    head = f"- 对「{peer.name}」: {label} [{marker} {sentiment:+.2f}]"
    if notes:
        return f"{head}\n  {notes}"
    return head


def compose_scene_persona_prompt(
    world: World,
    character: WorldCharacter,
    scene: Room,
    memories: Sequence[WorldCharacterMemory] | None = None,
    relations: Mapping[str, WorldCharacterRelation] | None = None,
    peers: Sequence[WorldCharacter] | None = None,
) -> str:
    """Bake World + character context into a scene persona system prompt.

    Editing the source World/Character later does *not* retroactively rewrite
    instances of already-created scenes. New scenes pick up fresh context.
    """
    parts: list[str] = []

    world_lines: list[str] = []
    if world.synopsis.strip():
        world_lines.append(world.synopsis.strip())
    if world.setting.strip():
        world_lines.append(f"设定：{world.setting.strip()}")
    if world.calendar_hint.strip():
        world_lines.append(f"纪年法：{world.calendar_hint.strip()}")
    if world_lines:
        parts.append(f"## 世界『{world.name}』\n" + "\n".join(world_lines))

    identity = character.identity.strip()
    char_header = f"你是「{character.name}」"
    if identity:
        char_header += f"（{identity}）"
    char_header += "。"
    char_lines = [char_header]
    # character.core_identity is intentionally not inlined here. It is emitted
    # once at the top by the PersonaInstance creation path.
    if character.brief.strip():
        char_lines.append(character.brief.strip())
    if character.skills_text.strip():
        char_lines.append(f"技能：{character.skills_text.strip()}")
    if character.goals_text.strip():
        char_lines.append(f"当前目标：{character.goals_text.strip()}")
    parts.append("## 你是谁\n" + "\n".join(char_lines))

    if memories:
        memory_lines = [format_character_memory(memory) for memory in memories]
        parts.append("## 你记得的事\n" + "\n".join(memory_lines))

    relation_map = relations or {}
    if peers and relation_map:
        relation_lines = [
            format_character_relation(peer, relation_map[peer.id])
            for peer in peers
            if peer.id != character.id and peer.id in relation_map
        ]
        if relation_lines:
            parts.append("## 你和在场角色的关系\n" + "\n".join(relation_lines))

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
