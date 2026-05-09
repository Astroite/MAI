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
            serialized = json.dumps(payload, ensure_ascii=False, indent=2, default=str)
        except (TypeError, ValueError):
            serialized = None
        # Skip the sidecar for trivially-small payloads — the trace_events
        # row still records what happened, and "I picked persona X" / "stream
        # started" style payloads are redundant once you have the messages
        # table + active calls dict. Bigger payloads (LLM completions,
        # scribe results, tool call dumps) are exactly what you want on disk
        # and keep flowing through.
        threshold = max(0, int(settings.trace_payload_min_bytes))
        if serialized is not None and len(serialized.encode("utf-8")) >= threshold:
            try:
                base = Path(settings.trace_payload_dir) / room_id
                base.mkdir(parents=True, exist_ok=True)
                path = base / f"{event_id}.json"
                path.write_text(serialized, encoding="utf-8")
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

