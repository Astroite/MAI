import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ScribeState } from "../../../types";
import { useI18n } from "../../../i18n";

const SECTIONS = ["decisions", "consensus", "disagreements", "open_questions", "artifacts", "dead_ends"] as const;
const SUMMARY_SECTIONS = ["decisions", "consensus", "disagreements"] as const;
const COLLAPSED_LIMIT = 3;

export function ScribePanel({
  state,
  mode = "full"
}: {
  state: ScribeState;
  mode?: "full" | "summary";
}) {
  const { t, display } = useI18n();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const sections = mode === "summary" ? SUMMARY_SECTIONS : SECTIONS;

  return (
    <section>
      {mode === "full" && <div className="label">{t("panel.scribe.title")}</div>}
      <div className={`${mode === "full" ? "mt-3 " : ""}space-y-3`}>
        {sections.map((key) => {
          const items = state[key as keyof ScribeState] ?? [];
          const isExpanded = expanded[key];
          // Show the latest items first, since users care about the most
          // recent additions.
          const ordered = [...items].reverse();
          const visible =
            mode === "summary" ? ordered.slice(0, COLLAPSED_LIMIT) : isExpanded ? ordered : ordered.slice(0, COLLAPSED_LIMIT);
          const overflow = items.length - COLLAPSED_LIMIT;
          return (
            <div key={key}>
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">{display("scribeSection", key)}</div>
                {mode === "full" && overflow > 0 && (
                  <button
                    type="button"
                    className="flex items-center gap-1 text-xs text-muted hover:text-brand"
                    onClick={() => setExpanded((current) => ({ ...current, [key]: !isExpanded }))}
                  >
                    {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    {isExpanded
                      ? t("panel.scribe.collapse")
                      : t("panel.scribe.showAll", { count: items.length })}
                  </button>
                )}
              </div>
              <div className="mt-1 space-y-1">
                {visible.map((item, index) => (
                  <div key={index} className="rounded-md bg-surface p-2 text-xs text-muted">
                    {String(item.content ?? item.title ?? item.message_id ?? t("panel.scribe.recorded"))}
                  </div>
                ))}
                {!items.length && <div className="text-xs text-muted">{t("common.empty")}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
