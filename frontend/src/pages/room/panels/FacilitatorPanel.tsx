import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Activity, MessageSquarePlus, Shield } from "lucide-react";
import { api } from "../../../api";
import { StatusPill, type PillTone } from "../../../components/StatusPill";
import { useI18n } from "../../../i18n";
import { queryKeys } from "../../../queryKeys";

interface FacilitatorSignal {
  id: string;
  overall_health: string;
  pacing_note: string;
  signals: Array<{ tag: string; reasoning: string; severity: string }>;
}

const SEVERITY_TONE: Record<string, PillTone> = {
  info: "info",
  low: "info",
  notice: "info",
  warning: "warning",
  medium: "warning",
  high: "danger",
  critical: "danger",
  severe: "danger"
};

export function FacilitatorPanel({
  roomId,
  frozen,
  signals,
  compact = false
}: {
  roomId: string;
  frozen: boolean;
  signals: FacilitatorSignal[];
  compact?: boolean;
}) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const ask = useMutation({
    mutationFn: () => api.askFacilitator(roomId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.room(roomId) })
  });
  const visible = compact ? signals.slice(0, 1) : signals.slice(0, 6);

  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        {compact ? (
          null
        ) : (
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-warning/10 text-warning" aria-hidden="true">
              <Shield size={14} />
            </span>
            <span>{t("panel.facilitator.title")}</span>
            {signals.length > 0 && (
              <span className="text-xs font-normal text-muted">· {signals.length}</span>
            )}
          </div>
        )}
        <button
          className="btn h-8 px-2 text-xs"
          disabled={frozen || ask.isPending}
          onClick={() => ask.mutate()}
          title={t("panel.facilitator.askTitle")}
        >
          <MessageSquarePlus size={14} />
          {t("panel.facilitator.ask")}
        </button>
      </div>

      <div className={`${compact ? "mt-2" : "mt-3"} space-y-2`}>
        {visible.map((signal) => (
          <div
            key={signal.id}
            className="rounded-md border border-border bg-panel p-3 shadow-card"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Activity size={14} className="text-warning" aria-hidden="true" />
                <span>{signal.overall_health}</span>
              </div>
              {signal.signals[0] && (
                <StatusPill tone={SEVERITY_TONE[signal.signals[0].severity?.toLowerCase()] ?? "accent"}>
                  {signal.signals[0].tag ?? "signal"}
                </StatusPill>
              )}
            </div>
            {signal.pacing_note && (
              <p className="mt-1 text-xs text-muted">{signal.pacing_note}</p>
            )}
            {!compact && signal.signals.length > 1 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {signal.signals.slice(1).map((sig, index) => (
                  <StatusPill
                    key={`${signal.id}-extra-${index}`}
                    tone={SEVERITY_TONE[sig.severity?.toLowerCase()] ?? "neutral"}
                  >
                    {sig.tag}
                  </StatusPill>
                ))}
              </div>
            )}
            {!compact && signal.signals[0]?.reasoning && (
              <p className="mt-2 rounded-md bg-surface p-2 text-xs leading-5 text-muted">
                {signal.signals[0].reasoning}
              </p>
            )}
          </div>
        ))}
        {!signals.length && (
          <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted">
            {t("panel.facilitator.empty")}
          </div>
        )}
      </div>
    </section>
  );
}
