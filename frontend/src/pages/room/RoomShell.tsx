import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  CircleGauge,
  FileText,
  GitBranchPlus,
  Layers,
  Loader2,
  Pencil,
  Plus,
  Save,
  Scale,
  Scroll,
  Settings,
  Settings2,
  Shield,
  Snowflake,
  Unlock,
  WifiOff,
  Wrench,
  X
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
import { PhaseStepper, type PhaseStep } from "../../components/PhaseStepper";

export function RoomShell() {
  const { roomId, subId } = useParams();
  const activeRoomId = subId ?? roomId;
  const { t, display, locale } = useI18n();
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
  const phaseSteps = useMemo<PhaseStep[]>(() => {
    if (!state) return [];
    const currentPosition = state.current_phase?.plan_position ?? -1;
    return state.phase_plan.map((slot) => {
      const phase = phases.data?.find((item) => item.id === slot.phase_template_id);
      const status: PhaseStep["status"] =
        currentPosition < 0
          ? "upcoming"
          : slot.position < currentPosition
            ? "done"
            : slot.position === currentPosition
              ? "current"
              : "upcoming";
      return {
        id: `${slot.room_id}-${slot.position}`,
        label: phase?.name ?? slot.phase_template_id,
        status
      };
    });
  }, [phases.data, state]);

  const openSettings = (tab: string = "phase") => {
    const next = new URLSearchParams(params);
    next.set("settings", tab);
    setParams(next, { replace: true });
  };

  return (
    <div className="grid h-[100dvh] overflow-hidden bg-surface text-text grid-cols-[320px_minmax(0,1fr)_380px] max-2xl:grid-cols-[300px_minmax(0,1fr)_360px] max-xl:grid-cols-[280px_minmax(0,1fr)] max-lg:grid-cols-1">
      <RoomListSidebar activeRoomId={activeRoomId} />

      <section className="flex min-w-0 flex-col overflow-hidden border-r border-border/70 bg-surface max-xl:border-r-0">
        {!activeRoomId || !state ? (
          <div className="grid flex-1 place-items-center text-sm text-muted">
            {room.isLoading ? t("common.loading") : t("room.selectOrCreate")}
          </div>
        ) : (
          <>
            <header className="border-b border-border/80 bg-panel/95 px-5 py-4 shadow-card">
              <div className="flex items-center justify-between gap-4 max-md:flex-col max-md:items-stretch">
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
                  <h1 className="truncate text-xl font-semibold tracking-normal">{state.room.title}</h1>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <StatusPill tone={state.room.status === "frozen" ? "danger" : "brand"} dot>
                    {display("roomStatus", state.room.status)}
                  </StatusPill>
                  <span>{t("room.roomId", { id: shortId(state.room.id) })}</span>
                  <span className="hidden items-center gap-1 sm:inline-flex">
                    <CalendarDays size={12} />
                    {t("room.createdAt", { date: formatDateTime(state.room.created_at, locale) })}
                  </span>
                  {currentPhaseTemplate && (
                    <button
                      type="button"
                      className="text-muted underline hover:text-brand"
                      onClick={() => openSettings("phase")}
                    >
                      {t("room.phase", { name: currentPhaseTemplate.name })}
                    </button>
                  )}
                  <span>{t("room.members", { count: state.personas.filter((p) => p.kind === "discussant").length })}</span>
                  {state.room.parent_room_id && <StatusPill tone="accent">{t("room.childRoom")}</StatusPill>}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2 max-md:flex-wrap">
                <div className="mr-2 hidden min-w-[150px] flex-col gap-1 text-xs text-muted lg:flex">
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-1">
                      <CircleGauge size={13} />
                      {t("room.tokenUsage")}
                    </span>
                    <span className="font-medium text-text">{tokenPercent(state.runtime.token_counter_total, state.runtime.max_room_tokens)}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface">
                    <div
                      className="h-full rounded-full bg-brand"
                      style={{ width: `${tokenPercent(state.runtime.token_counter_total, state.runtime.max_room_tokens)}%` }}
                    />
                  </div>
                </div>
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
              </div>
            </header>
            <ConnectionBanner />
            <div className="border-b border-border/80 bg-surface px-5 py-4">
              <RoomPhaseOverview
                steps={phaseSteps}
                currentPhaseName={currentPhaseTemplate?.name}
                tokenUsed={state.runtime.token_counter_total}
                tokenMax={state.runtime.max_room_tokens}
                onEditPhase={() => openSettings("phase")}
              />
              <RoomBackgroundCard roomId={activeRoomId!} background={state.room.background ?? ""} frozen={state.runtime.frozen} />
            </div>
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

function shortId(id: string): string {
  return id.length > 8 ? id.slice(-8) : id;
}

function formatDateTime(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function tokenPercent(used: number, max: number): number {
  if (!max || max <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((used / max) * 100)));
}

function RoomPhaseOverview({
  steps,
  currentPhaseName,
  tokenUsed,
  tokenMax,
  onEditPhase
}: {
  steps: PhaseStep[];
  currentPhaseName?: string;
  tokenUsed: number;
  tokenMax: number;
  onEditPhase: () => void;
}) {
  const { t } = useI18n();
  const pct = tokenPercent(tokenUsed, tokenMax);

  return (
    <div className="panel px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="label">{t("room.phaseProgress")}</div>
          <div className="mt-1 flex min-w-0 items-center gap-2">
            <Layers size={16} className="shrink-0 text-brand" />
            <span className="truncate text-sm font-semibold">{currentPhaseName ?? t("room.stepper.empty")}</span>
          </div>
        </div>
        <button className="btn h-8 shrink-0 px-2 text-xs" type="button" onClick={onEditPhase}>
          <Settings2 size={13} />
          {t("room.openPhaseSettings")}
        </button>
      </div>

      <div className="mt-3">
        {steps.length ? (
          <PhaseStepper steps={steps} onSelect={onEditPhase} />
        ) : (
          <div className="text-xs text-muted">{t("room.stepper.empty")}</div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3 text-xs text-muted max-sm:flex-wrap">
        <div className="flex min-w-[8.5rem] items-center gap-1">
          <CircleGauge size={13} />
          <span>{t("room.tokenUsage")}</span>
        </div>
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface max-sm:order-last max-sm:basis-full">
          <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
        </div>
        <span className="shrink-0 font-medium text-text">
          {tokenMax > 0
            ? t("room.tokenBudget", { used: tokenUsed, max: tokenMax })
            : t("room.tokensShort", { count: tokenUsed })}
        </span>
      </div>
    </div>
  );
}

function RoomBackgroundCard({
  roomId,
  background,
  frozen
}: {
  roomId: string;
  background: string;
  frozen: boolean;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(background);
  const [error, setError] = useState<string | null>(null);

  // Reset draft when the saved value changes (e.g., another tab edited).
  useEffect(() => {
    setDraft(background);
  }, [background]);

  const save = useMutation({
    mutationFn: () => api.updateRoomBackground(roomId, draft.trim()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["room", roomId] });
      setEditing(false);
      setError(null);
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("api.saveFailed"))
  });

  const trimmed = background.trim();
  const isLong = trimmed.length > 140;

  if (editing) {
    return (
      <div className="mt-3 rounded-lg border border-border/90 bg-panel p-3 shadow-card">
        <div className="flex items-center gap-2 text-xs font-semibold text-muted">
          <Scroll size={13} />
          <span>{t("room.background")}</span>
        </div>
        <textarea
          name="room-background-edit"
          className="textarea mt-2 h-32 w-full text-sm"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t("dashboard.backgroundPlaceholder")}
          disabled={frozen || save.isPending}
        />
        <p className="mt-1 text-xs text-muted">{t("room.backgroundEditHelp")}</p>
        {error && <div className="mt-1 text-xs text-danger">{error}</div>}
        <div className="mt-2 flex items-center gap-2">
          <button
            className="btn btn-primary h-7 px-2 text-xs"
            type="button"
            onClick={() => save.mutate()}
            disabled={frozen || save.isPending || draft.trim() === trimmed}
          >
            <Save size={13} />
            {t("common.save")}
          </button>
          <button
            className="btn h-7 px-2 text-xs"
            type="button"
            onClick={() => {
              setDraft(background);
              setEditing(false);
              setError(null);
            }}
            disabled={save.isPending}
          >
            <X size={13} />
            {t("common.cancel")}
          </button>
        </div>
      </div>
    );
  }

  if (!trimmed) {
    return (
      <div className="mt-3 rounded-lg border border-dashed border-border bg-panel/70 p-3">
        <button
          className="flex items-center gap-2 text-xs text-muted hover:text-brand"
          type="button"
          onClick={() => setEditing(true)}
          disabled={frozen}
        >
          <Plus size={13} />
          {t("room.backgroundAdd")}
        </button>
      </div>
    );
  }

  const displayText = expanded || !isLong ? trimmed : `${trimmed.slice(0, 140)}...`;
  return (
    <div className="mt-3 rounded-lg border border-info/30 bg-info/5 p-3">
      <div className="flex items-start gap-2">
        <Scroll size={13} className="mt-1 flex-shrink-0 text-info" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-info">{t("room.backgroundPreview")}</span>
            <div className="flex items-center gap-1">
              {isLong && (
                <button
                  className="btn h-6 px-2 text-xs"
                  type="button"
                  onClick={() => setExpanded((value) => !value)}
                  title={expanded ? t("common.collapse") : t("common.expand")}
                >
                  {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
              )}
              <button
                className="btn h-6 px-2 text-xs"
                type="button"
                onClick={() => setEditing(true)}
                disabled={frozen}
                title={t("room.backgroundEdit")}
              >
                <Pencil size={12} />
              </button>
            </div>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-xs text-muted">{displayText}</p>
        </div>
      </div>
    </div>
  );
}

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
