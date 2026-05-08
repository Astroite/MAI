import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { BookOpen, FileText, GitBranchPlus, Layers, Scale, Settings2, Shield, Wrench } from "lucide-react";
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

const TABS = [
  { key: "phase", labelKey: "room.panel.phase", icon: Layers },
  { key: "scribe", labelKey: "room.panel.scribe", icon: BookOpen },
  { key: "facilitator", labelKey: "room.panel.facilitator", icon: Shield },
  { key: "decisions", labelKey: "room.panel.decisions", icon: Scale },
  { key: "tools", labelKey: "room.panel.tools", icon: Wrench },
  { key: "limits", labelKey: "room.panel.limits", icon: Settings2 },
  { key: "upload", labelKey: "room.panel.upload", icon: FileText },
  { key: "subroom", labelKey: "room.panel.subroom", icon: GitBranchPlus }
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function RightPanel({ state, childRooms }: { state: RoomState; childRooms: Room[] }) {
  const [params, setParams] = useSearchParams();
  const { t } = useI18n();
  const panelParam = params.get("panel");
  const tab: TabKey | null = useMemo(() => {
    const candidate = panelParam as TabKey | null;
    if (candidate && TABS.some((entry) => entry.key === candidate)) return candidate as TabKey;
    return null;
  }, [panelParam]);
  const activeTab: TabKey = tab ?? "scribe";

  const setTab = (key: TabKey) => {
    const next = new URLSearchParams(params);
    next.set("panel", key);
    setParams(next, { replace: true });
  };

  const discussantIds = state.personas
    .filter((p) => p.kind === "discussant")
    .map((p) => p.template_id);

  return (
    <aside className="flex h-full min-h-0 flex-col bg-panel">
      <MembersSidebar roomId={state.room.id} personas={state.personas} compact />
      <nav className="grid grid-cols-4 gap-1 border-b border-border/80 bg-panel px-3 py-3">
        {TABS.map((entry) => {
          const Icon = entry.icon;
          const label = t(entry.labelKey);
          return (
            <button
              key={entry.key}
              type="button"
              className={`flex min-w-0 flex-col items-center gap-1 rounded-md px-1.5 py-2 text-[11px] font-medium transition ${
                activeTab === entry.key ? "bg-brand/10 text-brand" : "text-muted hover:bg-surface hover:text-text"
              }`}
              onClick={() => setTab(entry.key)}
              title={label}
            >
              <Icon size={14} />
              <span className="max-w-full truncate">{label}</span>
            </button>
          );
        })}
      </nav>
      <div className="mai-scrollbar min-h-0 flex-1 overflow-auto bg-surface p-3">
        {activeTab === "phase" && <PhasePlanPanel state={state} />}
        {activeTab === "limits" && <LimitPanel roomId={state.room.id} runtime={state.runtime} />}
        {activeTab === "scribe" && <ScribePanel state={state.scribe_state.current_state} />}
        {activeTab === "facilitator" && (
          <FacilitatorPanel
            roomId={state.room.id}
            frozen={state.runtime.frozen}
            signals={state.facilitator_signals}
          />
        )}
        {activeTab === "decisions" && (
          <DecisionsPanel
            roomId={state.room.id}
            frozen={state.runtime.frozen}
            decisions={state.decisions ?? []}
          />
        )}
        {activeTab === "tools" && (
          <ToolPanel
            roomId={state.room.id}
            frozen={state.runtime.frozen}
            invocations={state.tool_invocations ?? []}
          />
        )}
        {activeTab === "upload" && <UploadPanel roomId={state.room.id} frozen={state.runtime.frozen} />}
        {activeTab === "subroom" && (
          <SubroomPanel
            roomId={state.room.id}
            parentRoomId={state.room.parent_room_id}
            title={state.room.title}
            formatId={state.room.format_id ?? undefined}
            personaIds={discussantIds}
            childRooms={childRooms}
          />
        )}
      </div>
    </aside>
  );
}
