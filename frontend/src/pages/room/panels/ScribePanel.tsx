import type { ScribeState } from "../../../types";

export function ScribePanel({ state }: { state: ScribeState }) {
  const keys: Array<[string, string]> = [
    ["decisions", "决议"],
    ["consensus", "共识"],
    ["disagreements", "分歧"],
    ["open_questions", "开放问题"],
    ["artifacts", "产物"],
    ["dead_ends", "死路"]
  ];
  return (
    <section>
      <div className="label">书记官状态</div>
      <div className="mt-3 space-y-3">
        {keys.map(([key, label]) => (
          <div key={key}>
            <div className="text-sm font-medium">{label}</div>
            <div className="mt-1 space-y-1">
              {(state[key as keyof ScribeState] ?? []).slice(-3).map((item, index) => (
                <div key={index} className="rounded-md bg-surface p-2 text-xs text-muted">
                  {String(item.content ?? item.title ?? item.message_id ?? "已记录")}
                </div>
              ))}
              {!state[key as keyof ScribeState]?.length && <div className="text-xs text-muted">暂无</div>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
