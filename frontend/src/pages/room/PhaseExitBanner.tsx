import { Play, Plus } from "lucide-react";

export function PhaseExitBanner({
  matched,
  onNext,
  onContinue,
  onExtend,
  disabled
}: {
  matched: Array<Record<string, unknown>>;
  onNext: () => void;
  onContinue: () => void;
  onExtend: () => void;
  disabled: boolean;
}) {
  const label = matched.map((item) => String(item.type ?? "condition")).join(", ");
  return (
    <div className="border-b border-accent bg-accent/10 px-4 py-3">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 max-md:flex-col max-md:items-stretch">
        <div>
          <div className="text-sm font-semibold text-accent">当前阶段已满足退出条件</div>
          <div className="mt-0.5 text-xs text-muted">{label || "phase exit suggested"}</div>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-primary" disabled={disabled} onClick={onNext}>
            <Play size={16} />
            进入下一阶段
          </button>
          <button className="btn" disabled={disabled} onClick={onExtend} title="给当前阶段的 rounds 上限再加一轮">
            <Plus size={16} />
            再来一回合
          </button>
          <button className="btn" disabled={disabled} onClick={onContinue} title="忽略退出建议，等下一条消息再判断">
            继续讨论
          </button>
        </div>
      </div>
    </div>
  );
}
