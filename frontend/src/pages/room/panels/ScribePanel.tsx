import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ScribeState } from "../../../types";
import { useI18n } from "../../../i18n";

const SECTIONS = ["decisions", "consensus", "disagreements", "open_questions", "artifacts", "dead_ends"] as const;
const COLLAPSED_LIMIT = 3;

export function ScribePanel({ state }: { state: ScribeState }) {
  const { t, display } = useI18n();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  return (
    <section>
      <div className="label">{t("panel.scribe.title")}</div>
      <div className="mt-3 space-y-3">
        {SECTIONS.map((key) => {
          const items = state[key as keyof ScribeState] ?? [];
          const isExpanded = expanded[key];
          // Show the latest items first, since users care about the most
          // recent additions.
          const ordered = [...items].reverse();
          const visible = isExpanded ? ordered : ordered.slice(0, COLLAPSED_LIMIT);
          const overflow = items.length - COLLAPSED_LIMIT;
          return (
            <div key={key}>
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">{display("scribeSection", key)}</div>
                {overflow > 0 && (
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
