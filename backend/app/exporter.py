from __future__ import annotations

import re
from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import (
    Message,
    PersonaInstance,
    PhaseTemplate,
    Room,
    RoomPhaseInstance,
)


EXPORT_MESSAGE_TYPES = (
    "speech",
    "question",
    "answer",
    "user_doc",
    "verdict",
    "verdict_revoke",
    "dead_end",
)

_META_TYPES = {"verdict", "verdict_revoke", "dead_end"}

_FILENAME_STRIP = re.compile(r"[\\/:*?\"<>|\s]+")


def _safe_filename_stem(name: str) -> str:
    cleaned = _FILENAME_STRIP.sub("-", name).strip("-")
    return cleaned or "room"


def _format_ts(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def _author_label(message: Message, personas: dict[str, str]) -> str:
    if message.user_masquerade_name:
        return f"「{message.user_masquerade_name}」(我扮演)"
    if message.author_actual == "user":
        return "我"
    if message.author_persona_id and message.author_persona_id in personas:
        return personas[message.author_persona_id]
    return "系统"


def _render_message(message: Message, author: str) -> str:
    ts = _format_ts(message.created_at)
    header_icon = ""
    if message.message_type == "user_doc":
        header_icon = "📎 上传文档 · "
    elif message.message_type == "question":
        header_icon = "❓ "
    elif message.message_type == "answer":
        header_icon = "↩ "
    header = f"**{header_icon}{ts} · {author}**"
    body = (message.content or "").rstrip()
    if not body:
        return header
    return f"{header}\n\n{body}"


async def render_room_markdown(
    session: AsyncSession, room: Room
) -> tuple[str, str]:
    personas_rows = (
        await session.scalars(
            select(PersonaInstance).where(PersonaInstance.room_id == room.id)
        )
    ).all()
    personas = {p.id: p.name for p in personas_rows}

    phase_rows = (
        await session.scalars(
            select(RoomPhaseInstance)
            .where(RoomPhaseInstance.room_id == room.id)
            .order_by(RoomPhaseInstance.started_at)
        )
    ).all()
    template_ids = {p.phase_template_id for p in phase_rows if p.phase_template_id}
    templates: dict[str, str] = {}
    if template_ids:
        template_rows = (
            await session.scalars(
                select(PhaseTemplate).where(PhaseTemplate.id.in_(template_ids))
            )
        ).all()
        templates = {t.id: t.name for t in template_rows}
    phase_name_by_instance = {
        p.id: templates.get(p.phase_template_id, "未命名阶段") for p in phase_rows
    }

    messages = (
        await session.scalars(
            select(Message)
            .where(
                and_(
                    Message.room_id == room.id,
                    Message.message_type.in_(EXPORT_MESSAGE_TYPES),
                    Message.visibility == "public",
                )
            )
            .order_by(Message.created_at)
        )
    ).all()

    timeline: list[Message] = []
    meta_by_type: dict[str, list[Message]] = defaultdict(list)
    for msg in messages:
        if msg.message_type in _META_TYPES:
            meta_by_type[msg.message_type].append(msg)
        else:
            timeline.append(msg)

    grouped: list[tuple[str | None, list[Message]]] = []
    for msg in timeline:
        phase_id = msg.phase_instance_id
        if not grouped or grouped[-1][0] != phase_id:
            grouped.append((phase_id, [msg]))
        else:
            grouped[-1][1].append(msg)

    lines: list[str] = []
    lines.append(f"# {room.title}")
    lines.append("")
    exported_at = _format_ts(datetime.now(timezone.utc))
    lines.append(f"> 导出时间: {exported_at} · 消息数: {len(messages)}")
    lines.append("")
    lines.append("---")
    lines.append("")

    if not grouped and not meta_by_type:
        lines.append("_（暂无讨论内容）_")
        lines.append("")
    else:
        phase_index = 0
        seen_phase_ids: dict[str, int] = {}
        for phase_id, items in grouped:
            if phase_id is None:
                heading = "## 无阶段"
            else:
                if phase_id in seen_phase_ids:
                    heading_number = seen_phase_ids[phase_id]
                else:
                    phase_index += 1
                    seen_phase_ids[phase_id] = phase_index
                    heading_number = phase_index
                name = phase_name_by_instance.get(phase_id, "未命名阶段")
                heading = f"## 阶段 {heading_number} · {name}"
            lines.append(heading)
            lines.append("")
            for msg in items:
                lines.append(_render_message(msg, _author_label(msg, personas)))
                lines.append("")

    meta_sections = (
        ("verdict", "## ⚖ 裁决"),
        ("verdict_revoke", "## ⚖ 裁决撤销"),
        ("dead_end", "## ⚠ 死路标记"),
    )
    has_meta = any(meta_by_type.get(key) for key, _ in meta_sections)
    if has_meta:
        lines.append("---")
        lines.append("")
    for key, title in meta_sections:
        items = meta_by_type.get(key) or []
        if not items:
            continue
        lines.append(title)
        lines.append("")
        for msg in items:
            lines.append(_render_message(msg, _author_label(msg, personas)))
            lines.append("")

    markdown = "\n".join(lines).rstrip() + "\n"

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    filename = f"{_safe_filename_stem(room.title)}-{stamp}.md"
    return markdown, filename
