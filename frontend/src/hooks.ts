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
  const setConnectionStatus = useUIStore((state) => state.setConnectionStatus);

  useEffect(() => {
    if (!roomId) {
      setConnectionStatus("connected", 0);
      return;
    }
    const controller = new AbortController();
    let retries = 0;

    const updateStatus = (status: "connected" | "reconnecting" | "offline", count = retries) =>
      setConnectionStatus(status, count);

    void fetchEventSource(`${API_BASE}/rooms/${roomId}/events`, {
      signal: controller.signal,
      // Keep the stream alive when the tab is hidden so background rooms still
      // receive updates instead of going stale until refocus.
      openWhenHidden: true,
      async onopen(response) {
        if (!response.ok) {
          // 4xx are fatal (e.g. room deleted); 5xx warrants retry.
          if (response.status >= 400 && response.status < 500) {
            updateStatus("offline");
            throw new Error(`SSE rejected with ${response.status}`);
          }
          throw new Error(`SSE got ${response.status}, retrying`);
        }
        retries = 0;
        updateStatus("connected", 0);
      },
      onmessage(event) {
        if (!event.data) return;
        const payload = JSON.parse(event.data) as EventPayload;
        if (payload.type === "message.streaming" && payload.message_id && payload.persona_id && payload.chunk_text) {
          appendChunk(roomId, payload.message_id, payload.persona_id, payload.chunk_text, payload.chunk_index);
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
            "phase.extended",
            "phase.transitioned",
            "room.frozen",
            "room.unfrozen",
            "persona.instance.updated",
            "persona.instance.removed"
          ].includes(payload.type)
        ) {
          void queryClient.invalidateQueries({ queryKey: ["room", roomId] });
        }
      },
      onerror(err) {
        // Permanent errors thrown above (4xx, deleted room) reach here as the
        // same Error; let fatal ones bubble out by re-throwing so the library
        // stops retrying.
        if (err instanceof Error && err.message.includes("rejected with 4")) {
          updateStatus("offline");
          throw err;
        }
        retries += 1;
        updateStatus("reconnecting", retries);
        // Exponential backoff capped at 30s.
        return Math.min(1000 * 2 ** Math.min(retries, 5), 30000);
      },
      onclose() {
        // The server shouldn't close a healthy stream. Treat it like an error
        // and let onerror schedule a retry.
        throw new Error("SSE closed by server");
      }
    });
    return () => {
      controller.abort();
      setConnectionStatus("connected", 0);
    };
  }, [appendChunk, clearStream, queryClient, roomId, setConnectionStatus]);
}
