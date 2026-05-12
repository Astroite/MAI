import { useEffect } from "react";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { API_BASE } from "./api";
import { toast } from "./components/Toaster";
import { useI18n } from "./i18n";
import { queryKeys } from "./queryKeys";
import { useUIStore } from "./store";
import type { Message, RoomState, StreamingEvent } from "./types";

export function useUnsavedChangesWarning(when: boolean) {
  useEffect(() => {
    if (!when) return;
    const handler = (event: BeforeUnloadEvent) => {
      // Modern browsers ignore custom strings; setting returnValue is the
      // cross-browser way to trigger the native confirm dialog.
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [when]);
}

type EventPayload = StreamingEvent & { message?: Message };

export function upsertRoomMessage(state: RoomState | undefined, message: Message): RoomState | undefined {
  if (!state) return state;
  const index = state.messages.findIndex((item) => item.id === message.id);
  const messages =
    index >= 0
      ? state.messages.map((item, itemIndex) => (itemIndex === index ? message : item))
      : [...state.messages, message];
  return { ...state, messages };
}

export function handleRoomDeletedEvent({
  roomId,
  queryClient,
  clearRoomStreams,
  navigateHome
}: {
  roomId: string;
  queryClient: Pick<QueryClient, "getQueryData" | "removeQueries" | "invalidateQueries">;
  clearRoomStreams: (roomId: string) => void;
  navigateHome: () => void;
}) {
  const worldId = queryClient.getQueryData<RoomState>(queryKeys.room(roomId))?.room.world_id ?? null;
  queryClient.removeQueries({ queryKey: queryKeys.room(roomId), exact: true });
  queryClient.removeQueries({ queryKey: queryKeys.sceneMembers(roomId), exact: true });
  void queryClient.invalidateQueries({ queryKey: queryKeys.rooms });
  if (worldId) void queryClient.invalidateQueries({ queryKey: queryKeys.worldTimeline(worldId) });
  clearRoomStreams(roomId);
  navigateHome();
}

function invalidateCurrentRoomDependents({
  roomId,
  queryClient,
  includeRooms = false,
  includeSceneMembers = false,
  includeWorldTimeline = false
}: {
  roomId: string;
  queryClient: Pick<QueryClient, "getQueryData" | "invalidateQueries">;
  includeRooms?: boolean;
  includeSceneMembers?: boolean;
  includeWorldTimeline?: boolean;
}) {
  if (includeRooms) void queryClient.invalidateQueries({ queryKey: queryKeys.rooms });
  if (includeSceneMembers) void queryClient.invalidateQueries({ queryKey: queryKeys.sceneMembers(roomId) });
  if (includeWorldTimeline) {
    const worldId = queryClient.getQueryData<RoomState>(queryKeys.room(roomId))?.room.world_id ?? null;
    if (worldId) void queryClient.invalidateQueries({ queryKey: queryKeys.worldTimeline(worldId) });
  }
}

export function useRoomEvents(roomId?: string) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const appendChunk = useUIStore((state) => state.appendChunk);
  const finalizeStream = useUIStore((state) => state.finalizeStream);
  const clearRoomStreams = useUIStore((state) => state.clearRoomStreams);
  const setConnectionStatus = useUIStore((state) => state.setConnectionStatus);
  const { t } = useI18n();

  useEffect(() => {
    if (!roomId) {
      setConnectionStatus("connected", 0);
      return;
    }
    const controller = new AbortController();
    let retries = 0;
    // Coalesce rapid bursts of invalidating events (autodrive chains can fire
    // 10 message.appended in a few seconds; without debouncing each one
    // triggers a separate /state fetch and floods the backend).
    let invalidateTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleInvalidate = () => {
      if (invalidateTimer != null) return;
      invalidateTimer = setTimeout(() => {
        invalidateTimer = null;
        void queryClient.invalidateQueries({ queryKey: queryKeys.room(roomId) });
      }, 250);
    };

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
        if (payload.type === "room.deleted") {
          if (invalidateTimer != null) {
            clearTimeout(invalidateTimer);
            invalidateTimer = null;
          }
          handleRoomDeletedEvent({
            roomId,
            queryClient,
            clearRoomStreams,
            navigateHome: () => navigate("/", { replace: true })
          });
          controller.abort();
          return;
        }
        if (payload.type === "message.streaming" && payload.message_id && payload.persona_id && payload.chunk_text) {
          appendChunk(roomId, payload.message_id, payload.persona_id, payload.chunk_text, payload.chunk_index);
        }
        if (payload.type === "message.appended" && payload.message) {
          queryClient.setQueryData<RoomState>(queryKeys.room(roomId), (current) =>
            upsertRoomMessage(current, payload.message!)
          );
          if (payload.message.message_type === "participant.enter" || payload.message.message_type === "participant.exit") {
            invalidateCurrentRoomDependents({
              roomId,
              queryClient,
              includeRooms: true,
              includeSceneMembers: true,
              includeWorldTimeline: true
            });
          }
        }
        if (payload.type === "message.appended" || payload.type === "message.cancelled") {
          const id = payload.message_id ?? payload.message?.id;
          if (id) finalizeStream(id);
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
            "persona.instance.removed",
            "scene.sealed"
          ].includes(payload.type)
        ) {
          scheduleInvalidate();
        }
        if (payload.type === "room.frozen" || payload.type === "room.unfrozen") {
          invalidateCurrentRoomDependents({
            roomId,
            queryClient,
            includeRooms: true,
            includeWorldTimeline: true
          });
        }
        if (payload.type === "persona.instance.updated" || payload.type === "persona.instance.removed") {
          invalidateCurrentRoomDependents({ roomId, queryClient, includeRooms: true });
        }
        if (payload.type === "scene.sealed") {
          invalidateCurrentRoomDependents({
            roomId,
            queryClient,
            includeRooms: true,
            includeSceneMembers: true,
            includeWorldTimeline: true
          });
        }
        if (payload.type === "system.error") {
          // Always log so devs can inspect regardless of toast verbosity.
          // eslint-disable-next-line no-console
          console.error("[MAI system.error]", payload);
          const showDetail = useUIStore.getState().showApiErrorDetail;
          const who = payload.persona_name ? `「${payload.persona_name}」 ` : "";
          const title = `${who}${t("error.aiCallFailed")}`;
          if (showDetail) {
            const head = `${payload.error_class ?? "Error"}: ${payload.detail ?? ""}`.trim();
            const tail = payload.traceback
              ? payload.traceback.split("\n").slice(-6).join("\n")
              : "";
            const description = [head, tail].filter(Boolean).join("\n\n");
            toast.error(title, { description, duration: 12000 });
          } else {
            toast.error(title, {
              description: t("error.enableDebugHint"),
              duration: 6000
            });
          }
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
      if (invalidateTimer != null) clearTimeout(invalidateTimer);
      setConnectionStatus("connected", 0);
    };
  }, [appendChunk, clearRoomStreams, finalizeStream, navigate, queryClient, roomId, setConnectionStatus, t]);
}
