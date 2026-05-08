import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  FileText,
  GitBranchPlus,
  Layers,
  Loader2,
  Scale,
  Settings,
  Settings2,
  Shield,
  Snowflake,
  Unlock,
  WifiOff,
  Wrench
} from "lucide-react";
import { api } from "../../api";
import { useRoomEvents } from "../../hooks";
import { useUIStore } from "../../store";
import { StatusPill } from "../../components/StatusPill";
import { RoomListSidebar } from "./RoomListSidebar";
import { RightPanel } from "./RightPanel";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { PhaseExitBanner } from "./PhaseExitBanner";
import { RoomSettingsDrawer } from "./RoomSettingsDrawer";
import { LanguageToggle, useI18n } from "../../i18n";

export function RoomShell() {
  const { roomId, subId } = useParams();
  const activeRoomId = subId ?? roomId;
  const { t, display } = useI18n();
  useRoomEvents(activeRoomId);
  const queryClient = useQueryClient();
  const room = useQuery({
    queryKey: ["room", activeRoomId],
    queryFn: () => api.roomState(activeRoomId!),
    enabled: Boolean(activeRoomId)
  });
  const rooms = useQuery({ queryKey: ["rooms"], queryFn: api.rooms });
  const phases = useQuery({ queryKey: ["phases"], queryFn: () => api.phases() });
  const [params, setParams] = useSearchParams();
  const state = room.data;
  const hydrateStream = useUIStore((store) => store.hydrateStream);

  useEffect(() => {
    if (!activeRoomId) return;
    for (const partial of state?.in_flight_partial ?? []) {
      hydrateStream(activeRoomId, partial.message_id, partial.persona_id, partial.content, partial.last_chunk_index);
    }
  }, [activeRoomId, hydrateStream, state?.in_flight_partial]);

  // Watchdog: SSE may keep the connection alive (heartbeats) while a backend
  // call silently dies, leaving a "typing…" bubble forever. If we haven't seen
  // a chunk for STREAM_STALE_MS, drop the bubble so the UI doesn't lie.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const STREAM_STALE_MS = 60_000;
      const now = Date.now();
      const { streaming, clearStream } = useUIStore.getState();
      for (const entry of Object.values(streaming)) {
        if (now - entry.lastChunkAt > STREAM_STALE_MS) clearStream(entry.messageId);
      }
    }, 5_000);
    return () => window.clearInterval(timer);
  }, []);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["room", activeRoomId] });
  const nextPhase = useMutation({ mutationFn: () => api.nextPhase(activeRoomId!), onSuccess: invalidate });
  const continuePhase = useMutation({ mutationFn: () => api.continuePhase(activeRoomId!), onSuccess: invalidate });
  const extendPhase = useMutation({ mutationFn: () => api.extendPhase(activeRoomId!), onSuccess: invalidate });
  const freeze = useMutation({ mutationFn: () => api.freeze(activeRoomId!), onSuccess: invalidate });
  const unfreeze = useMutation({ mutationFn: () => api.unfreeze(activeRoomId!), onSuccess: invalidate });

  const childRooms = useMemo(
    () => (rooms.data ?? []).filter((item) => item.parent_room_id === state?.room.id),
    [rooms.data, state?.room.id]
  );

  const currentPhaseTemplate = phases.data?.find(
    (phase) => phase.id === state?.current_phase?.phase_template_id
  );

  const openSettings = (tab: string = "phase") => {
    const next = new URLSearchParams(params);
    next.set("settings", tab);
    setParams(next, { replace: true });
  };

  return (
    <div className="grid h-[calc(100vh-0px)] grid-cols-[260px_minmax(0,1fr)_320px] max-xl:grid-cols-[240px_minmax(0,1fr)] max-lg:grid-cols-1">
      <RoomListSidebar activeRoomId={activeRoomId} />

      <section className="flex min-w-0 flex-col overflow-hidden bg-panel">
        {!activeRoomId || !state ? (
          <div className="grid flex-1 place-items-center text-sm text-muted">
            {room.isLoading ? t("common.loading") : t("room.selectOrCreate")}
          </div>
        ) : (
          <>
            <header className="flex items-center justify-between gap-3 border-b border-border bg-panel px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {state.room.parent_room_id && (
                    <Link
                      to={`/rooms/${state.room.parent_room_id}`}
                      className="btn h-7 px-2 text-xs"
                      title={t("room.backToParent")}
                    >
                      <ArrowLeft size={13} />
                      {t("room.parent")}
                    </Link>
                  )}
                  <h1 className="truncate text-base font-semibold">{state.room.title}</h1>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <StatusPill tone={state.room.status === "frozen" ? "danger" : "brand"}>
                    {display("roomStatus", state.room.status)}
                  </StatusPill>
                  {currentPhaseTemplate && (
                    <button
                      type="button"
                      className="text-muted underline hover:text-brand"
                      onClick={() => openSettings("phase")}
                    >
                      {t("room.phase", { name: currentPhaseTemplate.name })}
                    </button>
                  )}
                  <span>{t("room.tokens", { count: state.runtime.token_counter_total })}</span>
                  {state.room.parent_room_id && <StatusPill tone="accent">{t("room.childRoom")}</StatusPill>}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                {/* Quick-access icons for the right-rail panels — only visible
                    when the right column is hidden by viewport. */}
                <div className="hidden max-xl:flex max-xl:items-center max-xl:gap-1">
                  {PANEL_SHORTCUTS.map((entry) => (
                    <button
                      key={entry.key}
                      className="btn h-9 w-9 px-0"
                      type="button"
                      onClick={() => openSettings(entry.key)}
                      title={t(entry.labelKey)}
                    >
                      <entry.icon size={16} />
                    </button>
                  ))}
                </div>
                {state.runtime.frozen ? (
                  <button className="btn" type="button" onClick={() => unfreeze.mutate()} disabled={unfreeze.isPending}>
                    <Unlock size={16} />
                    {t("room.unfreeze")}
                  </button>
                ) : (
                  <button
                    className="btn btn-danger"
                    type="button"
                    onClick={() => freeze.mutate()}
                    disabled={freeze.isPending}
                    title={t("room.freezeTitle")}
                  >
                    <Snowflake size={16} />
                    {t("room.freeze")}
                  </button>
                )}
                <LanguageToggle compact />
                <button
                  className="btn h-9 w-9 px-0"
                  type="button"
                  onClick={() => openSettings("phase")}
                  title={t("room.settings")}
                >
                  <Settings size={16} />
                </button>
              </div>
            </header>
            <ConnectionBanner />
            {state.runtime.phase_exit_suggested && (
              <PhaseExitBanner
                matched={state.runtime.phase_exit_matched_conditions}
                onNext={() => nextPhase.mutate()}
                onContinue={() => continuePhase.mutate()}
                onExtend={() => extendPhase.mutate()}
                disabled={
                  state.runtime.frozen ||
                  nextPhase.isPending ||
                  continuePhase.isPending ||
                  extendPhase.isPending
                }
              />
            )}
            <MessageList
              roomId={activeRoomId}
              frozen={state.runtime.frozen}
              messages={state.messages}
              personas={state.personas}
            />
            <Composer
              roomId={activeRoomId}
              personas={state.personas.filter((p) => p.kind === "discussant")}
              frozen={state.runtime.frozen}
            />
          </>
        )}
      </section>

      <div className="max-xl:hidden">
        {state ? (
          <RightPanel state={state} childRooms={childRooms} />
        ) : (
          <aside className="h-full border-l border-border bg-panel" />
        )}
      </div>

      {state && <RoomSettingsDrawer state={state} childRooms={childRooms} />}
    </div>
  );
}

const PANEL_SHORTCUTS = [
  { key: "scribe", labelKey: "room.panel.scribe", icon: BookOpen },
  { key: "decisions", labelKey: "room.panel.decisions", icon: Scale },
  { key: "tools", labelKey: "room.panel.tools", icon: Wrench },
  { key: "facilitator", labelKey: "room.panel.facilitator", icon: Shield },
  { key: "phase", labelKey: "room.panel.phase", icon: Layers },
  { key: "subroom", labelKey: "room.panel.subroom", icon: GitBranchPlus },
  { key: "upload", labelKey: "room.panel.upload", icon: FileText },
  { key: "limits", labelKey: "room.panel.limits", icon: Settings2 }
] as const;

function ConnectionBanner() {
  const status = useUIStore((s) => s.connectionStatus);
  const retries = useUIStore((s) => s.connectionRetries);
  const { t } = useI18n();
  if (status === "connected") return null;
  const isOffline = status === "offline";
  return (
    <div
      className={`flex items-center gap-2 border-b px-4 py-1.5 text-xs ${
        isOffline
          ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
          : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
      }`}
    >
      {isOffline ? <WifiOff size={13} /> : <Loader2 size={13} className="animate-spin" />}
      <span>
        {isOffline
          ? t("connection.offline")
          : retries > 0
            ? t("connection.retrying", { count: retries })
            : t("connection.reconnecting")}
      </span>
    </div>
  );
}
