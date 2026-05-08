import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Gavel, Lock, LockOpen } from "lucide-react";
import { api } from "../../../api";
import { StatusPill } from "../../../components/StatusPill";
import type { Decision } from "../../../types";
import { useI18n } from "../../../i18n";

export function DecisionsPanel({
  roomId,
  frozen,
  decisions,
  limit,
  hideLabel = false
}: {
  roomId: string;
  frozen: boolean;
  decisions: Decision[];
  limit?: number;
  hideLabel?: boolean;
}) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [showRevoked, setShowRevoked] = useState(false);

  const toggleLock = useMutation({
    mutationFn: ({ id, lock }: { id: string; lock: boolean }) => api.lockDecision(roomId, id, lock),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["room", roomId] })
  });

  const { active, revoked } = useMemo(() => {
    const act: Decision[] = [];
    const rev: Decision[] = [];
    for (const decision of decisions) {
      if (decision.revoked_by_message_id) rev.push(decision);
      else act.push(decision);
    }
    return { active: act, revoked: rev };
  }, [decisions]);

  const visible = typeof limit === "number" ? active.slice(0, limit) : active;
  const lockedCount = active.filter((decision) => decision.is_locked).length;

  if (active.length === 0 && revoked.length === 0) {
    return (
      <section>
        {!hideLabel && <DecisionsHeader lockedCount={0} totalCount={0} />}
        <div className={hideLabel ? "text-sm text-muted" : "mt-3 text-sm text-muted"}>
          {t("panel.decisions.empty")}
        </div>
      </section>
    );
  }

  return (
    <section>
      {!hideLabel && <DecisionsHeader lockedCount={lockedCount} totalCount={active.length} />}
      <ul className={`${hideLabel ? "" : "mt-3 "}space-y-2`}>
        {visible.map((decision) => (
          <li
            key={decision.id}
            className={`rounded-md border bg-panel p-3 shadow-card ${
              decision.is_locked ? "border-danger/40" : "border-border"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 text-sm leading-5">{decision.content}</div>
              <StatusPill
                tone={decision.is_locked ? "danger" : "neutral"}
                dot
              >
                {decision.is_locked ? t("panel.decisions.locked") : t("panel.decisions.unlocked")}
              </StatusPill>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted">
              <span>#{decision.id.slice(-6)} · {formatTime(decision.created_at)}</span>
              <button
                className="btn h-7 px-2 text-xs"
                disabled={frozen || toggleLock.isPending}
                onClick={() => toggleLock.mutate({ id: decision.id, lock: !decision.is_locked })}
                title={decision.is_locked ? t("panel.decisions.unlock") : t("panel.decisions.lock")}
              >
                {decision.is_locked ? <LockOpen size={13} /> : <Lock size={13} />}
                {decision.is_locked ? t("panel.decisions.unlock") : t("panel.decisions.lock")}
              </button>
            </div>
          </li>
        ))}
        {typeof limit === "number" && active.length > limit && (
          <li className="text-[11px] text-muted">
            {t("panel.decisions.moreActive", { count: active.length - limit })}
          </li>
        )}
      </ul>

      {revoked.length > 0 && !hideLabel && (
        <div className="mt-4">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-muted hover:text-brand"
            onClick={() => setShowRevoked((value) => !value)}
          >
            {showRevoked ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {showRevoked
              ? t("panel.decisions.hideRevoked")
              : t("panel.decisions.showRevoked", { count: revoked.length })}
          </button>
          {showRevoked && (
            <ul className="mt-2 space-y-2">
              {revoked.map((decision) => (
                <li
                  key={decision.id}
                  className="rounded-md border border-dashed border-border bg-surface p-2 text-xs text-muted"
                >
                  <div className="line-through decoration-muted/60">{decision.content}</div>
                  <div className="mt-1 text-[11px]">
                    #{decision.id.slice(-6)} · {formatTime(decision.created_at)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function DecisionsHeader({ lockedCount, totalCount }: { lockedCount: number; totalCount: number }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-info/10 text-info" aria-hidden="true">
          <Gavel size={13} />
        </span>
        <span>{t("room.panel.decisions")}</span>
        <span className="text-xs font-normal text-muted">· {totalCount}</span>
      </div>
      {lockedCount > 0 && (
        <StatusPill tone="danger" dot>
          {t("panel.decisions.lockedCount", { count: lockedCount })}
        </StatusPill>
      )}
    </div>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
