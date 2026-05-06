import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../api";
import type { Runtime } from "../../../types";

export function LimitPanel({ roomId, runtime }: { roomId: string; runtime: Runtime }) {
  const queryClient = useQueryClient();
  const [maxMessageTokens, setMaxMessageTokens] = useState(runtime.max_message_tokens);
  const [maxRoomTokens, setMaxRoomTokens] = useState(runtime.max_room_tokens);
  const [maxPhaseRounds, setMaxPhaseRounds] = useState(runtime.max_phase_rounds);
  const [maxAccountDailyTokens, setMaxAccountDailyTokens] = useState(runtime.max_account_daily_tokens);
  const [maxAccountMonthlyTokens, setMaxAccountMonthlyTokens] = useState(runtime.max_account_monthly_tokens);
  const [autoTransition, setAutoTransition] = useState(runtime.auto_transition);
  const [maxConsecutiveAiTurns, setMaxConsecutiveAiTurns] = useState(runtime.max_consecutive_ai_turns ?? 10);
  useEffect(() => {
    setMaxMessageTokens(runtime.max_message_tokens);
    setMaxRoomTokens(runtime.max_room_tokens);
    setMaxPhaseRounds(runtime.max_phase_rounds);
    setMaxAccountDailyTokens(runtime.max_account_daily_tokens);
    setMaxAccountMonthlyTokens(runtime.max_account_monthly_tokens);
    setAutoTransition(runtime.auto_transition);
    setMaxConsecutiveAiTurns(runtime.max_consecutive_ai_turns ?? 10);
  }, [runtime]);
  const update = useMutation({
    mutationFn: () =>
      api.updateLimits(roomId, {
        max_message_tokens: maxMessageTokens,
        max_room_tokens: maxRoomTokens,
        max_phase_rounds: maxPhaseRounds,
        max_account_daily_tokens: maxAccountDailyTokens,
        max_account_monthly_tokens: maxAccountMonthlyTokens,
        max_consecutive_ai_turns: maxConsecutiveAiTurns,
        auto_transition: autoTransition
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["room", roomId] })
  });
  return (
    <section>
      <div className="label">Limit 与阶段切换</div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-xs text-muted">单条 tokens</span>
          <input
            className="input mt-1 w-full"
            name="max-message-tokens"
            type="number"
            min={1}
            value={maxMessageTokens}
            onChange={(event) => setMaxMessageTokens(Number(event.target.value))}
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted">房间 tokens</span>
          <input
            className="input mt-1 w-full"
            name="max-room-tokens"
            type="number"
            min={1}
            value={maxRoomTokens}
            onChange={(event) => setMaxRoomTokens(Number(event.target.value))}
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted">Phase 最大轮次</span>
          <input
            className="input mt-1 w-full"
            name="max-phase-rounds"
            type="number"
            min={1}
            value={maxPhaseRounds}
            onChange={(event) => setMaxPhaseRounds(Number(event.target.value))}
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted">账号日 tokens</span>
          <input
            className="input mt-1 w-full"
            name="max-account-daily-tokens"
            type="number"
            min={1}
            value={maxAccountDailyTokens}
            onChange={(event) => setMaxAccountDailyTokens(Number(event.target.value))}
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted">账号月 tokens</span>
          <input
            className="input mt-1 w-full"
            name="max-account-monthly-tokens"
            type="number"
            min={1}
            value={maxAccountMonthlyTokens}
            onChange={(event) => setMaxAccountMonthlyTokens(Number(event.target.value))}
          />
        </label>
      </div>
      <label className="mt-3 block">
        <span className="text-xs text-muted">AI 连续发言上限</span>
        <input
          className="input mt-1 w-full"
          name="max-consecutive-ai-turns"
          type="number"
          min={1}
          value={maxConsecutiveAiTurns}
          onChange={(event) => setMaxConsecutiveAiTurns(Number(event.target.value))}
        />
      </label>
      <div className="mt-3 rounded-md border border-border p-3 text-xs text-muted">
        当前房间用量：{runtime.token_counter_total} / {runtime.max_room_tokens} tokens
        {runtime.consecutive_ai_turns != null && (
          <span className="ml-3">AI 连续轮次：{runtime.consecutive_ai_turns} / {runtime.max_consecutive_ai_turns}</span>
        )}
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          name="auto-transition"
          type="checkbox"
          checked={autoTransition}
          onChange={(event) => setAutoTransition(event.target.checked)}
        />
        自动进入下一阶段
      </label>
      <button className="btn mt-3 w-full" onClick={() => update.mutate()} disabled={update.isPending}>
        保存
      </button>
    </section>
  );
}
