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
  FileDown,
  FileText,
  GitBranchPlus,
  Layers,
  Loader2,
  Lock,
  Menu,
  Pencil,
  Plus,
  Save,
  Scale,
  Scroll,
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
import { useConfirm } from "../../components/ConfirmDialog";
import { toast } from "../../components/Toaster";
import { RoomListSidebar } from "./RoomListSidebar";
import { RightPanel } from "./RightPanel";
import { MessageList } from "./MessageList";
import { SpeakerStateBar } from "./SpeakerStateBar";
import { Composer } from "./Composer";
import { PhaseExitBanner } from "./PhaseExitBanner";
import { RoomSettingsDrawer } from "./RoomSettingsDrawer";
import { SealResultsDialog } from "./SealResultsDialog";
import { useI18n } from "../../i18n";
import { queryKeys } from "../../queryKeys";
import { PhaseStepper, type PhaseStep } from "../../components/PhaseStepper";
import { isSceneRoom } from "../../utils/scene";
import type { SceneSealResult } from "../../types";

export function RoomShell() {
  const { roomId, subId } = useParams();
  const activeRoomId = subId ?? roomId;
  const { t, display, locale } = useI18n();
  useRoomEvents(activeRoomId);
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const room = useQuery({
    queryKey: queryKeys.room(activeRoomId),
    queryFn: () => api.roomState(activeRoomId!),
    enabled: Boolean(activeRoomId)
  });
  const rooms = useQuery({ queryKey: queryKeys.rooms, queryFn: api.rooms });
  const phases = useQuery({ queryKey: queryKeys.phases.all, queryFn: () => api.phases() });
  const [showRoomsDrawer, setShowRoomsDrawer] = useState(false);
  const [sealResult, setSealResult] = useState<SceneSealResult | null>(null);
  const [params, setParams] = useSearchParams();
  const state = room.data;
  const sceneSealed = Boolean(state?.room.sealed_at);
  const roomReadOnly = Boolean(state?.runtime.frozen || sceneSealed);
  const hydrateStream = useUIStore((store) => store.hydrateStream);
  const finalizeStreams = useUIStore((store) => store.finalizeStreams);

  useEffect(() => {
    if (!activeRoomId) return;
    const finalMessageIds = new Set((state?.messages ?? []).map((message) => message.id));
    finalizeStreams([...finalMessageIds]);
    for (const partial of state?.in_flight_partial ?? []) {
      if (finalMessageIds.has(partial.message_id)) continue;
      hydrateStream(activeRoomId, partial.message_id, partial.persona_id, partial.content, partial.last_chunk_index);
    }
  }, [activeRoomId, finalizeStreams, hydrateStream, state?.in_flight_partial, state?.messages]);

  useEffect(() => {
    setShowRoomsDrawer(false);
  }, [activeRoomId]);

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

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: queryKeys.room(activeRoomId) });
  const nextPhase = useMutation({ mutationFn: () => api.nextPhase(activeRoomId!), onSuccess: invalidate });
  const continuePhase = useMutation({ mutationFn: () => api.continuePhase(activeRoomId!), onSuccess: invalidate });
  const extendPhase = useMutation({ mutationFn: () => api.extendPhase(activeRoomId!), onSuccess: invalidate });
  const freeze = useMutation({ mutationFn: () => api.freeze(activeRoomId!), onSuccess: invalidate });
  const unfreeze = useMutation({ mutationFn: () => api.unfreeze(activeRoomId!), onSuccess: invalidate });
  const sealScene = useMutation({
    mutationFn: () => api.sealScene(activeRoomId!),
    onSuccess: (result) => {
      invalidate();
      setSealResult(result);
      toast.success(t("room.scene.sealSuccess"));
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err))
  });

  const handleExport = async () => {
    if (!activeRoomId) return;
    try {
      const { blob, filename } = await api.exportRoom(activeRoomId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("room.export.failed"));
    }
  };

  const childRooms = useMemo(
    () => (rooms.data ?? []).filter((item) => item.parent_room_id === state?.room.id),
    [rooms.data, state?.room.id]
  );

  // Story World scene context: when this room is a scene, fetch the world
  // (for character details) and roster (for who's on stage). The composer
  // uses this to offer 旁白 / 扮演 modes with a user-character picker.
  const isScene = isSceneRoom(state?.room);
  const worldId = state?.room.world_id ?? null;
  const worldQuery = useQuery({
    queryKey: queryKeys.world(worldId),
    queryFn: () => api.world(worldId!),
    enabled: Boolean(worldId)
  });
  const sceneMembersQuery = useQuery({
    queryKey: queryKeys.sceneMembers(activeRoomId),
    queryFn: () => api.sceneMembers(activeRoomId!),
    enabled: Boolean(worldId && activeRoomId)
  });
  const storyContext = useMemo(() => {
    if (!worldId || !worldQuery.data || !sceneMembersQuery.data) return null;
    const onStageIds = new Set(
      sceneMembersQuery.data
        .filter((member) => member.exited_at_message_id === null)
        .map((member) => member.world_character_id)
    );
    const userCharacters = worldQuery.data.characters.filter(
      (character) => character.kind === "user" && onStageIds.has(character.id)
    );
    return { worldId, userCharacters };
  }, [worldId, worldQuery.data, sceneMembersQuery.data]);

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
    <div className="grid h-[100dvh] overflow-hidden bg-surface text-text grid-cols-[300px_minmax(0,1fr)_360px] max-2xl:grid-cols-[280px_minmax(0,1fr)_340px] max-xl:grid-cols-[260px_minmax(0,1fr)] max-md:grid-cols-1">
      <div className="min-h-0 overflow-hidden max-md:hidden">
        <RoomListSidebar activeRoomId={activeRoomId} />
      </div>

      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-border/70 bg-surface max-xl:border-r-0">
        {!activeRoomId || !state ? (
          <div className="grid flex-1 place-items-center text-sm text-muted">
            {room.isLoading ? t("common.loading") : t("room.selectOrCreate")}
          </div>
        ) : (
          <>
            <header className="flex-shrink-0 border-b border-border/80 bg-panel/95 px-5 py-4 shadow-card">
              <div className="flex items-center justify-between gap-4 max-md:flex-col max-md:items-stretch">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn hidden h-8 w-8 px-0 max-md:inline-flex"
                    onClick={() => setShowRoomsDrawer(true)}
                    title={t("room.allRooms")}
                    aria-label={t("room.allRooms")}
                  >
                    <Menu size={16} />
                  </button>
                  {state.room.parent_room_id && (
                    <Link
                      to={`/rooms/${state.room.parent_room_id}`}
                      className="btn h-7 px-2 text-xs"
                      title={t("room.backToParent")}
                    >
                      <ArrowLeft size={14} />
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
                  {isScene && (
                    <Link
                      to={`/worlds/${worldId}`}
                      className="inline-flex items-center gap-1 rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-xs text-accent hover:bg-accent/20"
                      title={t("room.scene.backToWorld")}
                    >
                      <BookOpen size={12} />
                      {t("room.scene.act", { n: state.room.scene_index })}
                    </Link>
                  )}
                  {state.room.sealed_at && (
                    <StatusPill tone="success" dot>
                      {t("room.scene.sealed")}
                    </StatusPill>
                  )}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2 max-md:flex-wrap">
                {/* Quick-access icons for the right-rail panels — only visible
                    when the right column is hidden by viewport. Below md only
                    the 4 primary shortcuts show, the rest fold into the
                    Settings drawer's tab list. */}
                <div className="hidden max-xl:flex max-xl:items-center max-xl:gap-1 xl:hidden">
                  {PANEL_SHORTCUTS.filter((entry) => !(isScene && entry.discussionOnly)).map((entry, index) => (
                    <button
                      key={entry.key}
                      className={`btn h-9 w-9 px-0 ${index >= 4 ? "max-md:hidden" : ""}`}
                      type="button"
                      onClick={() => openSettings(entry.key)}
                      title={t(entry.labelKey)}
                    >
                      <entry.icon size={16} />
                    </button>
                  ))}
                </div>
                {!sceneSealed &&
                  (state.runtime.frozen ? (
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
                  ))}
                {isScene && !state.room.sealed_at && (
                  <button
                    className="btn"
                    type="button"
                    onClick={async () => {
                      const ok = await confirm({
                        title: t("room.scene.sealConfirmTitle", { n: state.room.scene_index }),
                        description: t("room.scene.sealConfirmDescription"),
                        confirmLabel: t("room.scene.sealConfirmLabel"),
                        danger: true
                      });
                      if (ok) sealScene.mutate();
                    }}
                    disabled={sealScene.isPending}
                    title={t("room.scene.sealTitle")}
                  >
                    <Lock size={16} />
                    {sealScene.isPending ? t("room.scene.sealing") : t("room.scene.sealConfirmLabel")}
                  </button>
                )}
                <button
                  className="btn h-9 w-9 px-0"
                  type="button"
                  onClick={handleExport}
                  title={t("common.export")}
                >
                  <FileDown size={16} />
                </button>
              </div>
              </div>
            </header>
            <ConnectionBanner />
            <CollapsiblePhaseOverview
              roomId={activeRoomId!}
              steps={phaseSteps}
              currentPhaseName={currentPhaseTemplate?.name}
              tokenUsed={state.runtime.token_counter_total}
              tokenMax={state.runtime.max_room_tokens}
              background={state.room.background ?? ""}
              frozen={roomReadOnly}
              onEditPhase={() => openSettings("phase")}
            />
            {state.runtime.phase_exit_suggested && (
              <PhaseExitBanner
                matched={state.runtime.phase_exit_matched_conditions}
                onNext={() => nextPhase.mutate()}
                onContinue={() => continuePhase.mutate()}
                onExtend={() => extendPhase.mutate()}
                disabled={
                  roomReadOnly ||
                  nextPhase.isPending ||
                  continuePhase.isPending ||
                  extendPhase.isPending
                }
              />
            )}
            <SpeakerStateBar
              roomId={activeRoomId}
              runtime={state.runtime}
              personas={state.personas.filter((p) => p.kind === "discussant")}
              frozen={state.runtime.frozen}
              sealed={sceneSealed}
            />
            <MessageList
              roomId={activeRoomId}
              frozen={roomReadOnly}
              messages={state.messages}
              personas={state.personas}
            />
            <Composer
              roomId={activeRoomId}
              personas={state.personas.filter((p) => p.kind === "discussant")}
              frozen={roomReadOnly}
              sealed={sceneSealed}
              story={storyContext}
            />
          </>
        )}
      </section>

      <div className="min-h-0 overflow-hidden border-l border-border/70 max-xl:hidden">
        {state ? (
          <RightPanel state={state} childRooms={childRooms} />
        ) : (
          <aside className="h-full border-l border-border bg-panel" />
        )}
      </div>

      {state && <RoomSettingsDrawer state={state} childRooms={childRooms} />}
      <SealResultsDialog result={sealResult} onClose={() => setSealResult(null)} />

      {showRoomsDrawer && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="flex-1 bg-black/40" onClick={() => setShowRoomsDrawer(false)} />
          <div className="h-full w-[300px] max-w-[85vw] bg-panel shadow-soft drawer-enter">
            <RoomListSidebar activeRoomId={activeRoomId} />
          </div>
        </div>
      )}
    </div>
  );
}

const PANEL_SHORTCUTS = [
  { key: "scribe", labelKey: "room.panel.scribe", icon: BookOpen, discussionOnly: true },
  { key: "decisions", labelKey: "room.panel.decisions", icon: Scale, discussionOnly: true },
  { key: "tools", labelKey: "room.panel.tools", icon: Wrench, discussionOnly: false },
  { key: "facilitator", labelKey: "room.panel.facilitator", icon: Shield, discussionOnly: true },
  { key: "phase", labelKey: "room.panel.phase", icon: Layers, discussionOnly: false },
  { key: "subroom", labelKey: "room.panel.subroom", icon: GitBranchPlus, discussionOnly: true },
  { key: "upload", labelKey: "room.panel.upload", icon: FileText, discussionOnly: false },
  { key: "limits", labelKey: "room.panel.limits", icon: Settings2, discussionOnly: false }
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

function CollapsiblePhaseOverview(props: {
  roomId: string;
  steps: PhaseStep[];
  currentPhaseName?: string;
  tokenUsed: number;
  tokenMax: number;
  background: string;
  frozen: boolean;
  onEditPhase: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const { t } = useI18n();

  return (
    <div className="flex-shrink-0 border-b border-border/80 bg-surface">
      <div className="flex items-center justify-between px-5 pt-2 pb-1">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
          <Layers size={14} className="shrink-0 text-brand" />
          <span className="truncate font-semibold text-text">{props.currentPhaseName ?? t("room.stepper.empty")}</span>
        </div>
        <button
          type="button"
          className="btn h-6 px-1.5 text-xs"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? t("common.expand") : t("common.collapse")}
        >
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>
      {!collapsed && (
        <div className="px-5 pb-4">
          <RoomPhaseOverview {...props} />
        </div>
      )}
    </div>
  );
}

function RoomPhaseOverview({
  roomId,
  steps,
  currentPhaseName,
  tokenUsed,
  tokenMax,
  background,
  frozen,
  onEditPhase
}: {
  roomId: string;
  steps: PhaseStep[];
  currentPhaseName?: string;
  tokenUsed: number;
  tokenMax: number;
  background: string;
  frozen: boolean;
  onEditPhase: () => void;
}) {
  const { t } = useI18n();
  const pct = tokenPercent(tokenUsed, tokenMax);

  return (
    <div className="panel px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="label">{t("room.phaseProgress")}</div>
        </div>
        <button className="btn h-8 shrink-0 px-2 text-xs" type="button" onClick={onEditPhase}>
          <Settings2 size={14} />
          {t("room.openPhaseSettings")}
        </button>
      </div>

      <div className="mt-2">
        {steps.length ? (
          <PhaseStepper steps={steps} onSelect={onEditPhase} />
        ) : (
          <div className="text-xs text-muted">{t("room.stepper.empty")}</div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3 text-xs text-muted max-sm:flex-wrap">
        <div className="flex min-w-[8.5rem] items-center gap-1">
          <CircleGauge size={14} />
          <span>{t("room.tokenUsage")}</span>
        </div>
        <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-surface max-sm:order-last max-sm:basis-full">
          <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
        </div>
        <span className="shrink-0 font-medium text-text">
          {tokenMax > 0
            ? t("room.tokenBudget", { used: tokenUsed, max: tokenMax })
            : t("room.tokensShort", { count: tokenUsed })}
        </span>
      </div>

      <RoomBackgroundInline roomId={roomId} background={background} frozen={frozen} />
    </div>
  );
}

function RoomBackgroundInline({
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

  useEffect(() => {
    setDraft(background);
  }, [background]);

  const save = useMutation({
    mutationFn: () => api.updateRoomBackground(roomId, draft.trim()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.room(roomId) });
      setEditing(false);
      setError(null);
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("api.saveFailed"))
  });

  const trimmed = background.trim();
  const isLong = trimmed.length > 100;

  if (editing) {
    return (
      <div className="mt-3 rounded-md border border-border/80 bg-surface p-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-muted">
          <Scroll size={14} />
          <span>{t("room.background")}</span>
        </div>
        <textarea
          name="room-background-edit"
          className="textarea mt-2 h-32 w-full"
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
            <Save size={14} />
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
            <X size={14} />
            {t("common.cancel")}
          </button>
        </div>
      </div>
    );
  }

  if (!trimmed) {
    return (
      <div className="mt-3 border-t border-dashed border-border pt-2">
        <button
          className="flex items-center gap-1.5 text-xs text-muted hover:text-brand"
          type="button"
          onClick={() => setEditing(true)}
          disabled={frozen}
        >
          <Plus size={14} />
          {t("room.backgroundAdd")}
        </button>
      </div>
    );
  }

  const displayText = expanded || !isLong ? trimmed : `${trimmed.slice(0, 100)}...`;
  return (
    <div className="mt-3 flex items-start gap-2 rounded-md border border-info/30 bg-info/5 px-3 py-2">
      <Scroll size={14} className="mt-0.5 flex-shrink-0 text-info" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-info">{t("room.backgroundPreview")}</span>
          <div className="flex items-center gap-1">
            {isLong && (
              <button
                className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-info/10 hover:text-info"
                type="button"
                onClick={() => setExpanded((value) => !value)}
                title={expanded ? t("common.collapse") : t("common.expand")}
              >
                {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
            )}
            <button
              className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-info/10 hover:text-info"
              type="button"
              onClick={() => setEditing(true)}
              disabled={frozen}
              title={t("room.backgroundEdit")}
            >
              <Pencil size={12} />
            </button>
          </div>
        </div>
        <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted">{displayText}</p>
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
      className={`flex flex-shrink-0 items-center gap-2 border-b px-5 py-1.5 text-xs ${
        isOffline
          ? "border-danger/30 bg-danger/10 text-danger"
          : "border-warning/30 bg-warning/10 text-warning"
      }`}
    >
      {isOffline ? <WifiOff size={14} /> : <Loader2 size={14} className="animate-spin" />}
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
