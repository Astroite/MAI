import { forwardRef, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  GitBranchPlus,
  Layers,
  Maximize2,
  Minimize2,
  Scale,
  Settings2,
  Shield,
  Wrench
} from "lucide-react";
import type { Room, RoomState } from "../../types";
import { MembersSidebar } from "./MembersSidebar";
import { PhasePlanPanel } from "./panels/PhasePlanPanel";
import { LimitPanel } from "./panels/LimitPanel";
import { ScribePanel } from "./panels/ScribePanel";
import { FacilitatorPanel } from "./panels/FacilitatorPanel";
import { DecisionsPanel } from "./panels/DecisionsPanel";
import { UploadPanel } from "./panels/UploadPanel";
import { SubroomPanel } from "./panels/SubroomPanel";
import { ToolPanel } from "./panels/ToolPanel";
import { useI18n } from "../../i18n";
import { isSceneRoom } from "../../utils/scene";

type SummaryKey = "scribe" | "decisions" | "facilitator" | "phase";
type CollapsibleKey = "tools" | "upload" | "subroom" | "limits";
type AnyKey = SummaryKey | CollapsibleKey;

export function RightPanel({ state, childRooms }: { state: RoomState; childRooms: Room[] }) {
  const [params, setParams] = useSearchParams();
  const { t } = useI18n();
  const expandedKey = params.get("panel") as AnyKey | null;
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const readOnly = state.runtime.frozen || Boolean(state.room.sealed_at);
  const isScene = isSceneRoom(state.room);

  useEffect(() => {
    if (!expandedKey) return;
    const node = sectionRefs.current[expandedKey];
    if (node) node.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [expandedKey]);

  const setExpanded = (key: AnyKey | null) => {
    const next = new URLSearchParams(params);
    if (key) next.set("panel", key);
    else next.delete("panel");
    setParams(next, { replace: true });
  };

  const discussantIds = useMemo(
    () => state.personas.filter((p) => p.kind === "discussant").map((p) => p.template_id),
    [state.personas]
  );

  const isExpanded = (key: AnyKey) => expandedKey === key;
  const registerRef = (key: AnyKey) => (node: HTMLDivElement | null) => {
    sectionRefs.current[key] = node;
  };

  return (
    <aside className="mai-scrollbar flex h-full min-h-0 flex-col overflow-y-auto bg-panel">
      <MembersSidebar roomId={state.room.id} personas={state.personas} compact />

      <div className="flex flex-col gap-3 px-3 py-3">
        {!isScene && (
          <SummarySection
            ref={registerRef("scribe")}
            tone="brand"
            icon={<BookOpen size={14} />}
            title={t("room.panel.scribe")}
            expanded={isExpanded("scribe")}
            onToggle={() => setExpanded(isExpanded("scribe") ? null : "scribe")}
            summary={<ScribePanel state={state.scribe_state.current_state} mode="summary" />}
            detail={<ScribePanel state={state.scribe_state.current_state} mode="full" />}
          />
        )}

        {!isScene && (
          <SummarySection
            ref={registerRef("decisions")}
            tone="info"
            icon={<Scale size={14} />}
            title={t("room.panel.decisions")}
            expanded={isExpanded("decisions")}
            onToggle={() => setExpanded(isExpanded("decisions") ? null : "decisions")}
            summary={
              <DecisionsPanel
                roomId={state.room.id}
                frozen={readOnly}
                decisions={state.decisions ?? []}
                limit={3}
                hideLabel
              />
            }
            detail={
              <DecisionsPanel
                roomId={state.room.id}
                frozen={readOnly}
                decisions={state.decisions ?? []}
              />
            }
          />
        )}

        {!isScene && (
          <SummarySection
            ref={registerRef("facilitator")}
            tone="warning"
            icon={<Shield size={14} />}
            title={t("room.panel.facilitator")}
            expanded={isExpanded("facilitator")}
            onToggle={() => setExpanded(isExpanded("facilitator") ? null : "facilitator")}
            summary={
              <FacilitatorPanel
                roomId={state.room.id}
                frozen={readOnly}
                signals={state.facilitator_signals}
                compact
              />
            }
            detail={
              <FacilitatorPanel
                roomId={state.room.id}
                frozen={readOnly}
                signals={state.facilitator_signals}
              />
            }
          />
        )}

        <SummarySection
          ref={registerRef("phase")}
          tone="brand"
          icon={<Layers size={14} />}
          title={t("room.panel.phase")}
          expanded={isExpanded("phase")}
          onToggle={() => setExpanded(isExpanded("phase") ? null : "phase")}
          summary={<PhasePlanPanel state={state} />}
          detail={<PhasePlanPanel state={state} />}
        />

        <CollapsibleSection
          ref={registerRef("tools")}
          icon={<Wrench size={14} />}
          title={t("room.panel.tools")}
          open={isExpanded("tools")}
          onToggle={() => setExpanded(isExpanded("tools") ? null : "tools")}
        >
          <ToolPanel
            roomId={state.room.id}
            frozen={readOnly}
            invocations={state.tool_invocations ?? []}
          />
        </CollapsibleSection>

        <CollapsibleSection
          ref={registerRef("upload")}
          icon={<FileText size={14} />}
          title={t("room.panel.upload")}
          open={isExpanded("upload")}
          onToggle={() => setExpanded(isExpanded("upload") ? null : "upload")}
        >
          <UploadPanel roomId={state.room.id} frozen={readOnly} />
        </CollapsibleSection>

        {!isScene && (
          <CollapsibleSection
            ref={registerRef("subroom")}
            icon={<GitBranchPlus size={14} />}
            title={t("room.panel.subroom")}
            open={isExpanded("subroom")}
            onToggle={() => setExpanded(isExpanded("subroom") ? null : "subroom")}
          >
            <SubroomPanel
              roomId={state.room.id}
              parentRoomId={state.room.parent_room_id}
              title={state.room.title}
              recipeId={state.room.recipe_id ?? null}
              formatId={state.room.format_id ?? undefined}
              personaIds={discussantIds}
              childRooms={childRooms}
              frozen={readOnly}
            />
          </CollapsibleSection>
        )}

        <CollapsibleSection
          ref={registerRef("limits")}
          icon={<Settings2 size={14} />}
          title={t("room.panel.limits")}
          open={isExpanded("limits")}
          onToggle={() => setExpanded(isExpanded("limits") ? null : "limits")}
        >
          <LimitPanel roomId={state.room.id} runtime={state.runtime} readOnly={readOnly} />
        </CollapsibleSection>
      </div>
    </aside>
  );
}

const TONE_DOT: Record<"brand" | "info" | "warning", string> = {
  brand: "bg-brand",
  info: "bg-info",
  warning: "bg-warning"
};

type SummarySectionProps = {
  tone: "brand" | "info" | "warning";
  icon: ReactNode;
  title: string;
  summary: ReactNode;
  detail: ReactNode;
  expanded: boolean;
  onToggle: () => void;
};

const SummarySection = forwardRef<HTMLDivElement, SummarySectionProps>(function SummarySection(
  { tone, icon, title, summary, detail, expanded, onToggle },
  ref
) {
  const { t } = useI18n();
  return (
    <div ref={ref} className="section overflow-hidden">
      <header className="flex items-center justify-between gap-2 border-b border-border bg-panel px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-text">
          <span className={`h-2 w-2 flex-shrink-0 rounded-full ${TONE_DOT[tone]}`} aria-hidden="true" />
          <span className="flex-shrink-0 text-muted">{icon}</span>
          <span className="truncate">{title}</span>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs text-muted transition hover:bg-surface hover:text-brand"
          title={expanded ? t("common.collapse") : t("common.expand")}
          aria-expanded={expanded}
        >
          {expanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          <span>{expanded ? t("common.collapse") : t("common.expand")}</span>
        </button>
      </header>
      <div className="px-3 py-2">{expanded ? detail : summary}</div>
    </div>
  );
});

type CollapsibleSectionProps = {
  icon: ReactNode;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
};

const CollapsibleSection = forwardRef<HTMLDivElement, CollapsibleSectionProps>(function CollapsibleSection(
  { icon, title, open, onToggle, children },
  ref
) {
  return (
    <div ref={ref} className="section overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-text">
          <span className="flex-shrink-0 text-muted">{icon}</span>
          <span className="truncate">{title}</span>
        </span>
        <span className="text-muted">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      {open && <div className="border-t border-border px-3 py-2">{children}</div>}
    </div>
  );
});
