import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { BookOpen, FileText, GitBranchPlus, Layers, Scale, Settings2, Shield, Users } from "lucide-react";
import type { Room, RoomState } from "../../types";
import { MembersSidebar } from "./MembersSidebar";
import { PhasePlanPanel } from "./panels/PhasePlanPanel";
import { LimitPanel } from "./panels/LimitPanel";
import { ScribePanel } from "./panels/ScribePanel";
import { FacilitatorPanel } from "./panels/FacilitatorPanel";
import { DecisionsPanel } from "./panels/DecisionsPanel";
import { UploadPanel } from "./panels/UploadPanel";
import { SubroomPanel } from "./panels/SubroomPanel";
import { useI18n } from "../../i18n";

const TABS = [
  { key: "phase", labelKey: "room.panel.phase", icon: Layers },
  { key: "scribe", labelKey: "room.panel.scribe", icon: BookOpen },
  { key: "facilitator", labelKey: "room.panel.facilitator", icon: Shield },
  { key: "decisions", labelKey: "room.panel.decisions", icon: Scale },
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

  const setTab = (key: TabKey) => {
    const next = new URLSearchParams(params);
    if (tab === key) {
      next.delete("panel");
    } else {
      next.set("panel", key);
    }
    setParams(next, { replace: true });
  };

  const discussantIds = state.personas
    .filter((p) => p.kind === "discussant")
    .map((p) => p.template_id);

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-border bg-panel">
      <MembersSidebar roomId={state.room.id} personas={state.personas} compact />
      <nav className="flex flex-wrap items-center gap-0.5 border-b border-border bg-surface px-1.5 py-1.5">
        {TABS.map((entry) => {
          const Icon = entry.icon;
          const label = t(entry.labelKey);
          return (
            <button
              key={entry.key}
              type="button"
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition ${
                tab === entry.key ? "bg-brand text-white" : "text-muted hover:bg-panel"
              }`}
              onClick={() => setTab(entry.key)}
              title={label}
            >
              <Icon size={12} />
              {label}
            </button>
          );
        })}
      </nav>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {tab === "phase" && <PhasePlanPanel state={state} />}
        {tab === "limits" && <LimitPanel roomId={state.room.id} runtime={state.runtime} />}
        {tab === "scribe" && <ScribePanel state={state.scribe_state.current_state} />}
        {tab === "facilitator" && (
          <FacilitatorPanel
            roomId={state.room.id}
            frozen={state.runtime.frozen}
            signals={state.facilitator_signals}
          />
        )}
        {tab === "decisions" && (
          <DecisionsPanel
            roomId={state.room.id}
            frozen={state.runtime.frozen}
            decisions={state.decisions ?? []}
          />
        )}
        {tab === "upload" && <UploadPanel roomId={state.room.id} frozen={state.runtime.frozen} />}
        {tab === "subroom" && (
          <SubroomPanel
            roomId={state.room.id}
            parentRoomId={state.room.parent_room_id}
            title={state.room.title}
            formatId={state.room.format_id ?? undefined}
            personaIds={discussantIds}
            childRooms={childRooms}
          />
        )}
        {!tab && (
          <div className="flex h-full items-center justify-center text-xs text-muted">
            {t("room.panel.empty")}
          </div>
        )}
      </div>
    </aside>
  );
}
