import asyncio
import json
from collections import defaultdict
from collections.abc import AsyncIterator
from contextlib import suppress
from typing import Any


class EventBus:
    def __init__(self) -> None:
        self._queues: dict[str, set[asyncio.Queue[dict[str, Any]]]] = defaultdict(set)

    async def publish(self, room_id: str, event: dict[str, Any]) -> None:
        event.setdefault("room_id", room_id)
        queues = list(self._queues.get(room_id, set()))
        for queue in queues:
            with suppress(asyncio.QueueFull):
                queue.put_nowait(event)

    async def subscribe(self, room_id: str) -> AsyncIterator[str]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=200)
        self._queues[room_id].add(queue)
        try:
            yield self._format({"type": "connected", "room_id": room_id})
            while True:
                event = await queue.get()
                yield self._format(event)
        finally:
            self._queues[room_id].discard(queue)
            if not self._queues[room_id]:
                self._queues.pop(room_id, None)

    @staticmethod
    def _format(event: dict[str, Any]) -> str:
        event_type = event.get("type", "message")
        payload = json.dumps(event, ensure_ascii=False, default=str)
        return f"event: {event_type}\ndata: {payload}\n\n"


event_bus = EventBus()

