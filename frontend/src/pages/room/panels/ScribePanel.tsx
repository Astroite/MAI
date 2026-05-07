import type { ScribeState } from "../../../types";
import { useI18n } from "../../../i18n";

export function ScribePanel({ state }: { state: ScribeState }) {
  const { t, display } = useI18n();
  const keys = ["decisions", "consensus", "disagreements", "open_questions", "artifacts", "dead_ends"];
  return (
    <section>
      <div className="label">{t("panel.scribe.title")}</div>
      <div className="mt-3 space-y-3">
        {keys.map((key) => (
          <div key={key}>
            <div className="text-sm font-medium">{display("scribeSection", key)}</div>
            <div className="mt-1 space-y-1">
              {(state[key as keyof ScribeState] ?? []).slice(-3).map((item, index) => (
                <div key={index} className="rounded-md bg-surface p-2 text-xs text-muted">
                  {String(item.content ?? item.title ?? item.message_id ?? t("panel.scribe.recorded"))}
                </div>
              ))}
              {!state[key as keyof ScribeState]?.length && <div className="text-xs text-muted">{t("common.empty")}</div>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
