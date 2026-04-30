import json
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .ids import new_id
from .models import TraceEvent


async def trace_record(
    session: AsyncSession,
    room_id: str,
    event_type: str,
    summary: str,
    payload: dict[str, Any] | None = None,
) -> TraceEvent:
    settings = get_settings()
    payload_ref: str | None = None
    event_id = new_id()
    if payload is not None:
        try:
            base = Path(settings.trace_payload_dir) / room_id
            base.mkdir(parents=True, exist_ok=True)
            path = base / f"{event_id}.json"
            path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
            payload_ref = str(path)
        except OSError:
            payload_ref = None

    event = TraceEvent(
        id=event_id,
        room_id=room_id,
        event_type=event_type,
        summary=summary,
        payload_ref=payload_ref,
    )
    session.add(event)
    await session.flush()
    return event

