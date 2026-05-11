import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pause, Play, Snowflake, Sparkles, Square } from "lucide-react";
import { api } from "../../api";
import type { PersonaInstance, Runtime } from "../../types";
import { PersonaIcon, DEFAULT_PERSONA_COLOR } from "../../components/PersonaIcon";
import { StatusPill } from "../../components/StatusPill";
import { useI18n } from "../../i18n";
import { queryKeys } from "../../queryKeys";
import { toast } from "../../components/Toaster";

/**
 * Live status strip above the message list — answers "what is the room doing
 * right now?" at a glance:
 *
 *   - frozen     : red snowflake, "已冻结"
 *   - streaming  : the speaker's persona icon + name + "正在说话…"
 *   - thinking   : the speaker's persona icon + name + "思考中…" (LLM call
 *                  started but no chunk yet — covered by current_speakers)
 *   - autodrive  : sparkles + "AI 接力中" + chain counter (no specific
 *                  speaker — between turns, lock held)
 *   - idle       : muted dot + "等待中" + a "▶ 让 AI 继续" button so the
 *                  user can nudge without typing
 *
 * The Pause action is graceful: it lets the active persona finish, then
 * freezes the room so autodrive cannot schedule the next speaker.
 */
export function SpeakerStateBar({
  roomId,
  runtime,
  personas,
  frozen
}: {
  roomId: string;
  runtime: Runtime;
  personas: PersonaInstance[];
  frozen: boolean;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const personaById = useMemo(
    () => new Map(personas.map((p) => [p.id, p])),
    [personas]
  );

  const speakerIds: string[] = runtime.current_speakers ?? [];
  const speakers = speakerIds
    .map((id: string) => personaById.get(id))
    .filter((p: PersonaInstance | undefined): p is PersonaInstance => Boolean(p));
  const consecutive = runtime.consecutive_ai_turns ?? 0;
  const cap = runtime.max_consecutive_ai_turns ?? 0;

  const resume = useMutation({
    mutationFn: () => api.resumeAutodrive(roomId),
    onSuccess: (res) => {
      if (res.status === "skipped") {
        toast.message(t(resumeSkipReasonKey(res.reason)));
        void queryClient.invalidateQueries({ queryKey: queryKeys.room(roomId) });
      }
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : t("speaker.resumeFailed"))
  });
  const pause = useMutation({
    mutationFn: () => api.pause(roomId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.room(roomId) })
  });
  const unfreeze = useMutation({
    mutationFn: () => api.unfreeze(roomId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.room(roomId) })
  });

  // Resolve the displayed state once so styling and labels stay aligned.
  const state: "frozen" | "speaking" | "scheduling" | "idle" = frozen
    ? "frozen"
    : speakers.length > 0
      ? "speaking"
      : runtime.autodrive_active
        ? "scheduling"
        : "idle";

  // Choose tone via a CSS variable on the strip — keeps the layout stable
  // across states while the accent color tracks the current speaker.
  const accent = speakers[0]?.color || DEFAULT_PERSONA_COLOR;
  const stripStyle =
    state === "speaking"
      ? { borderColor: accent + '66', background: accent + '0a' }
      : undefined;

  return (
    <div
      className={`flex flex-shrink-0 items-center justify-between gap-3 border-y px-5 py-2 text-xs ${
        state === "frozen"
          ? "border-danger/30 bg-danger/5"
          : state === "scheduling"
            ? "border-brand/30 bg-brand/5"
            : state === "idle"
              ? "border-border bg-surface"
              : "border-border"
      }`}
      style={stripStyle}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {/* Left: state pill + speaker preview */}
        <StateIndicator state={state} />
        <SpeakerPreview state={state} speakers={speakers} t={t} />
      </div>

      <div className="flex flex-shrink-0 items-center gap-2">
        {/* Chain counter shown whenever we're driving (not frozen, not idle). */}
        {state !== "frozen" && cap > 0 && (
          <span className="hidden text-muted sm:inline" title={t("speaker.chainHint")}>
            {t("speaker.chain", { used: consecutive, max: cap })}
          </span>
        )}
        {state === "idle" && (
          <button
            className="btn btn-primary h-7 px-2"
            type="button"
            onClick={() => resume.mutate()}
            disabled={resume.isPending}
            title={t("speaker.resumeTitle")}
          >
            <Play size={12} />
            {t("speaker.resume")}
          </button>
        )}
        {(state === "speaking" || state === "scheduling") && (
          <button
            className="btn h-7 px-2"
            type="button"
            onClick={() => pause.mutate()}
            disabled={pause.isPending}
            title={t("speaker.pauseTitle")}
          >
            <Pause size={12} />
            {t("speaker.pause")}
          </button>
        )}
        {state === "frozen" && (
          <button
            className="btn h-7 px-2"
            type="button"
            onClick={() => unfreeze.mutate()}
            disabled={unfreeze.isPending}
          >
            <Square size={12} />
            {t("speaker.unfreeze")}
          </button>
        )}
      </div>
    </div>
  );
}

function resumeSkipReasonKey(reason?: string | null) {
  switch (reason) {
    case "locked":
      return "speaker.resumeSkipped.locked";
    case "frozen":
      return "speaker.resumeSkipped.frozen";
    case "in_flight":
      return "speaker.resumeSkipped.inFlight";
    case "no_available_speaker":
      return "speaker.resumeSkipped.noSpeaker";
    case "phase_not_auto":
      return "speaker.resumeSkipped.phaseNotAuto";
    case "exit_condition_met":
      return "speaker.resumeSkipped.exitCondition";
    case "token_budget_exceeded":
      return "speaker.resumeSkipped.tokenBudget";
    default:
      return "speaker.resumeSkipped.default";
  }
}

function StateIndicator({ state }: { state: "frozen" | "speaking" | "scheduling" | "idle" }) {
  const { t } = useI18n();
  if (state === "frozen") {
    return (
      <StatusPill tone="danger" dot>
        <Snowflake size={12} className="-ml-0.5" />
        {t("speaker.state.frozen")}
      </StatusPill>
    );
  }
  if (state === "speaking") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-semibold uppercase">
        <span
          className="h-1.5 w-1.5 rounded-full bg-current"
          style={{ animation: "pulse-ring 1.4s ease-out infinite" }}
        />
        {t("speaker.state.speaking")}
      </span>
    );
  }
  if (state === "scheduling") {
    return (
      <StatusPill tone="brand" dot>
        <Loader2 size={12} className="animate-spin" />
        {t("speaker.state.scheduling")}
      </StatusPill>
    );
  }
  return (
    <StatusPill tone="neutral" dot>
      <Sparkles size={12} className="-ml-0.5" />
      {t("speaker.state.idle")}
    </StatusPill>
  );
}

function SpeakerPreview({
  state,
  speakers,
  t
}: {
  state: "frozen" | "speaking" | "scheduling" | "idle";
  speakers: PersonaInstance[];
  t: ReturnType<typeof useI18n>["t"];
}) {
  if (state === "frozen") {
    return <span className="truncate text-muted">{t("speaker.frozenHint")}</span>;
  }
  if (state === "idle") {
    return <span className="truncate text-muted">{t("speaker.idleHint")}</span>;
  }
  if (state === "scheduling") {
    return <span className="truncate text-muted">{t("speaker.schedulingHint")}</span>;
  }
  // speaking — show the active persona(s) with their icon
  if (speakers.length === 0) return null;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex -space-x-1.5">
        {speakers.slice(0, 3).map((p) => (
          <PersonaIcon key={p.id} icon={p.icon} color={p.color} size={22} iconSize={11} rounded="full" />
        ))}
      </div>
      <span className="truncate text-text">
        {speakers.length === 1
          ? t("speaker.speakingNamed", { name: speakers[0].name })
          : t("speaker.speakingMulti", { count: speakers.length })}
      </span>
    </div>
  );
}
