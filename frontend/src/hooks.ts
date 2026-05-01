import { useEffect } from "react";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "./api";
import { useUIStore } from "./store";
import type { StreamingEvent } from "./types";

type EventPayload = StreamingEvent & { message?: { id: string } };

export function useRoomEvents(roomId?: string) {
  const queryClient = useQueryClient();
  const appendChunk = useUIStore((state) => state.appendChunk);
  const clearStream = useUIStore((state) => state.clearStream);

  useEffect(() => {
    if (!roomId) return;
    const controller = new AbortController();
    void fetchEventSource(`${API_BASE}/rooms/${roomId}/events`, {
      signal: controller.signal,
      onmessage(event) {
        if (!event.data) return;
        const payload = JSON.parse(event.data) as EventPayload;
        if (payload.type === "message.streaming" && payload.message_id && payload.persona_id && payload.chunk_text) {
          appendChunk(payload.message_id, payload.persona_id, payload.chunk_text);
        }
        if (payload.type === "message.appended" || payload.type === "message.cancelled") {
          const id = payload.message_id ?? payload.message?.id;
          if (id) clearStream(id);
        }
        if (
          [
            "message.appended",
            "message.cancelled",
            "scribe.updated",
            "facilitator.signal",
            "phase.exit_suggested",
            "phase.exit_continued",
            "phase.transitioned",
            "room.frozen",
            "room.unfrozen"
          ].includes(payload.type)
        ) {
          void queryClient.invalidateQueries({ queryKey: ["room", roomId] });
        }
      }
    });
    return () => controller.abort();
  }, [appendChunk, clearStream, queryClient, roomId]);
}
