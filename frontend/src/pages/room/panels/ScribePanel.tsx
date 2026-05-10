import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  FileBox,
  Gavel,
  Scale
} from "lucide-react";
import type { ScribeState } from "../../../types";
import { StatusPill, type PillTone } from "../../../components/StatusPill";
import { useI18n } from "../../../i18n";

const SUMMARY_SECTIONS = ["decisions", "consensus", "disagreements"] as const;
const COLLAPSED_LIMIT = 3;
const SECTION_LIMIT = 6;

type SectionKey = "decisions" | "consensus" | "disagreements" | "open_questions" | "artifacts" | "dead_ends";

const SECTION_META: Record<
  SectionKey,
  { tone: PillTone; icon: typeof Scale; mono?: boolean }
> = {
  decisions: { tone: "brand", icon: Gavel },
  consensus: { tone: "success", icon: CheckCircle2 },
  disagreements: { tone: "warning", icon: Scale },
  open_questions: { tone: "info", icon: CircleHelp },
  artifacts: { tone: "info", icon: FileBox },
  dead_ends: { tone: "danger", icon: AlertTriangle, mono: true }
};

export function ScribePanel({
  state,
  mode = "full"
}: {
  state: ScribeState;
  mode?: "full" | "summary";
}) {
  const { t, display } = useI18n();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (mode === "summary") {
    return (
      <section>
        <div className="space-y-3">
          {SUMMARY_SECTIONS.map((key) => (
            <ScribeSection
              key={key}
              sectionKey={key}
              items={state[key] ?? []}
              limit={COLLAPSED_LIMIT}
              expanded={false}
              onToggle={null}
            />
          ))}
        </div>
      </section>
    );
  }

  const counts: Record<SectionKey, number> = {
    decisions: state.decisions?.length ?? 0,
    consensus: state.consensus?.length ?? 0,
    disagreements: state.disagreements?.length ?? 0,
    open_questions: state.open_questions?.length ?? 0,
    artifacts: state.artifacts?.length ?? 0,
    dead_ends: state.dead_ends?.length ?? 0
  };

  const toggle = (key: string) =>
    setExpanded((current) => ({ ...current, [key]: !current[key] }));

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <CountChip tone="brand" icon={<Gavel size={12} />} label={display("scribeSection", "decisions")} count={counts.decisions} />
        <CountChip tone="success" icon={<CheckCircle2 size={12} />} label={display("scribeSection", "consensus")} count={counts.consensus} />
        <CountChip tone="warning" icon={<Scale size={12} />} label={display("scribeSection", "disagreements")} count={counts.disagreements} />
        <CountChip tone="info" icon={<CircleHelp size={12} />} label={display("scribeSection", "open_questions")} count={counts.open_questions} />
        <CountChip tone="info" icon={<FileBox size={12} />} label={display("scribeSection", "artifacts")} count={counts.artifacts} />
        {counts.dead_ends > 0 && (
          <CountChip tone="danger" icon={<AlertTriangle size={12} />} label={display("scribeSection", "dead_ends")} count={counts.dead_ends} />
        )}
      </div>

      <ScribeSection
        sectionKey="decisions"
        items={state.decisions ?? []}
        limit={SECTION_LIMIT}
        expanded={Boolean(expanded.decisions)}
        onToggle={() => toggle("decisions")}
      />

      <div className="grid gap-3 md:grid-cols-2">
        <ScribeSection
          sectionKey="consensus"
          items={state.consensus ?? []}
          limit={SECTION_LIMIT}
          expanded={Boolean(expanded.consensus)}
          onToggle={() => toggle("consensus")}
        />
        <ScribeSection
          sectionKey="disagreements"
          items={state.disagreements ?? []}
          limit={SECTION_LIMIT}
          expanded={Boolean(expanded.disagreements)}
          onToggle={() => toggle("disagreements")}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <ScribeSection
          sectionKey="open_questions"
          items={state.open_questions ?? []}
          limit={SECTION_LIMIT}
          expanded={Boolean(expanded.open_questions)}
          onToggle={() => toggle("open_questions")}
        />
        <ScribeSection
          sectionKey="artifacts"
          items={state.artifacts ?? []}
          limit={SECTION_LIMIT}
          expanded={Boolean(expanded.artifacts)}
          onToggle={() => toggle("artifacts")}
        />
      </div>

      {(state.dead_ends?.length ?? 0) > 0 && (
        <ScribeSection
          sectionKey="dead_ends"
          items={state.dead_ends ?? []}
          limit={SECTION_LIMIT}
          expanded={Boolean(expanded.dead_ends)}
          onToggle={() => toggle("dead_ends")}
        />
      )}
    </section>
  );
}

function ScribeSection({
  sectionKey,
  items,
  limit,
  expanded,
  onToggle
}: {
  sectionKey: SectionKey;
  items: Array<Record<string, unknown>>;
  limit: number;
  expanded: boolean;
  onToggle: (() => void) | null;
}) {
  const { t, display } = useI18n();
  const meta = SECTION_META[sectionKey];
  const Icon = meta.icon;
  const ordered = [...items].reverse();
  const visible = expanded ? ordered : ordered.slice(0, limit);
  const overflow = items.length - limit;

  const isInline = sectionKey === "dead_ends";

  return (
    <div className={`rounded-md border bg-panel shadow-card ${TONE_BORDER[meta.tone]}`}>
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className={`grid h-6 w-6 place-items-center rounded-md ${TONE_ICON_BG[meta.tone]}`} aria-hidden="true">
            <Icon size={14} />
          </span>
          <span>{display("scribeSection", sectionKey)}</span>
          <span className="text-xs font-normal text-muted">· {items.length}</span>
        </div>
        {onToggle && overflow > 0 && (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted transition hover:bg-surface hover:text-brand"
            onClick={onToggle}
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {expanded ? t("panel.scribe.collapse") : t("panel.scribe.showAll", { count: items.length })}
          </button>
        )}
      </header>
      <div className="p-3">
        {items.length === 0 ? (
          <div className="text-xs text-muted">{t("common.empty")}</div>
        ) : isInline ? (
          <div className="flex flex-wrap gap-2">
            {visible.map((item, index) => (
              <span
                key={`${sectionKey}-${index}`}
                className="inline-flex items-center gap-1 rounded-md border border-danger/30 bg-danger/5 px-2 py-0.5 text-xs text-danger"
              >
                <AlertTriangle size={12} aria-hidden="true" />
                <span className="max-w-[18rem] truncate">{describe(item, t)}</span>
              </span>
            ))}
          </div>
        ) : (
          <ul className="space-y-1.5">
            {visible.map((item, index) => (
              <li
                key={`${sectionKey}-${index}`}
                className="rounded-md border border-border bg-surface p-2 text-xs text-text"
              >
                <div className="whitespace-pre-wrap break-words leading-5">{describe(item, t)}</div>
                {hasReferences(item) && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {referenceIds(item)
                      .slice(0, 4)
                      .map((id) => (
                        <StatusPill key={`${sectionKey}-${index}-ref-${id}`}>
                          #{id.slice(-4)}
                        </StatusPill>
                      ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const TONE_BORDER: Record<PillTone, string> = {
  neutral: "border-border",
  brand: "border-brand/30",
  info: "border-info/30",
  success: "border-success/30",
  warning: "border-warning/40",
  danger: "border-danger/40",
  accent: "border-accent/40"
};

const TONE_ICON_BG: Record<PillTone, string> = {
  neutral: "bg-surface text-muted",
  brand: "bg-brand/10 text-brand",
  info: "bg-info/10 text-info",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
  accent: "bg-accent/10 text-accent"
};

function CountChip({
  tone,
  icon,
  label,
  count
}: {
  tone: PillTone;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <StatusPill tone={tone}>
      <span className="inline-flex items-center gap-1">
        {icon}
        <span>{label}</span>
        <span className="opacity-70">· {count}</span>
      </span>
    </StatusPill>
  );
}

function describe(item: Record<string, unknown>, t: (key: string) => string): string {
  const value = item.content ?? item.title ?? item.summary ?? item.message_id;
  if (value == null) return t("panel.scribe.recorded");
  return typeof value === "string" ? value : JSON.stringify(value);
}

function hasReferences(item: Record<string, unknown>): boolean {
  return Array.isArray(item.message_ids) && item.message_ids.length > 0;
}

function referenceIds(item: Record<string, unknown>): string[] {
  if (!Array.isArray(item.message_ids)) return [];
  return item.message_ids.filter((id): id is string => typeof id === "string");
}
