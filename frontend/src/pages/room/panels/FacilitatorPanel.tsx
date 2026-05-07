import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageSquarePlus } from "lucide-react";
import { api } from "../../../api";
import { StatusPill } from "../../../components/StatusPill";
import { useI18n } from "../../../i18n";

interface FacilitatorSignal {
  id: string;
  overall_health: string;
  pacing_note: string;
  signals: Array<{ tag: string; reasoning: string; severity: string }>;
}

export function FacilitatorPanel({
  roomId,
  frozen,
  signals
}: {
  roomId: string;
  frozen: boolean;
  signals: FacilitatorSignal[];
}) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const ask = useMutation({
    mutationFn: () => api.askFacilitator(roomId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["room", roomId] })
  });
  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        <div className="label">{t("panel.facilitator.title")}</div>
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
      <div className="mt-3 space-y-2">
        {signals.slice(0, 4).map((signal) => (
          <div key={signal.id} className="rounded-md border border-border p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">{signal.overall_health}</div>
              <StatusPill tone="accent">{signal.signals[0]?.tag ?? "signal"}</StatusPill>
            </div>
            <div className="mt-1 text-xs text-muted">{signal.pacing_note}</div>
          </div>
        ))}
        {!signals.length && <div className="text-sm text-muted">{t("panel.facilitator.empty")}</div>}
      </div>
    </section>
  );
}
