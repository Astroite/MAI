import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Lock, LockOpen } from "lucide-react";
import { api } from "../../../api";
import { StatusPill } from "../../../components/StatusPill";
import type { Decision } from "../../../types";

export function DecisionsPanel({
  roomId,
  frozen,
  decisions
}: {
  roomId: string;
  frozen: boolean;
  decisions: Decision[];
}) {
  const queryClient = useQueryClient();
  const toggleLock = useMutation({
    mutationFn: ({ id, lock }: { id: string; lock: boolean }) => api.lockDecision(roomId, id, lock),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["room", roomId] })
  });
  const active = decisions.filter((decision) => !decision.revoked_by_message_id);
  if (!active.length) {
    return (
      <section>
        <div className="label">决议</div>
        <div className="mt-3 text-sm text-muted">暂无裁决</div>
      </section>
    );
  }
  return (
    <section>
      <div className="label">决议</div>
      <ul className="mt-3 space-y-2">
        {active.map((decision) => (
          <li key={decision.id} className="rounded-md border border-border p-2">
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm">{decision.content}</div>
              <StatusPill tone={decision.is_locked ? "danger" : "neutral"}>
                {decision.is_locked ? "已锁" : "未锁"}
              </StatusPill>
            </div>
            <div className="mt-2 flex justify-end">
              <button
                className="btn h-7 px-2 text-xs"
                disabled={frozen || toggleLock.isPending}
                onClick={() => toggleLock.mutate({ id: decision.id, lock: !decision.is_locked })}
                title={decision.is_locked ? "解锁该决议" : "锁定该决议"}
              >
                {decision.is_locked ? <LockOpen size={13} /> : <Lock size={13} />}
                {decision.is_locked ? "解锁" : "锁定"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
