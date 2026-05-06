import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { X } from "lucide-react";
import type { Room, RoomState } from "../../types";
import { PhasePlanPanel } from "./panels/PhasePlanPanel";
import { LimitPanel } from "./panels/LimitPanel";
import { ScribePanel } from "./panels/ScribePanel";
import { FacilitatorPanel } from "./panels/FacilitatorPanel";
import { DecisionsPanel } from "./panels/DecisionsPanel";
import { UploadPanel } from "./panels/UploadPanel";
import { SubroomPanel } from "./panels/SubroomPanel";

const TABS = [
  { key: "phase", label: "阶段" },
  { key: "limits", label: "限额" },
  { key: "scribe", label: "书记" },
  { key: "facilitator", label: "主持" },
  { key: "decisions", label: "决议" },
  { key: "upload", label: "文档" },
  { key: "subroom", label: "子房间" }
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function RoomSettingsDrawer({
  state,
  childRooms
}: {
  state: RoomState;
  childRooms: Room[];
}) {
  const [params, setParams] = useSearchParams();
  const settingsParam = params.get("settings");
  const open = settingsParam !== null;
  const tab: TabKey = useMemo(() => {
    const candidate = settingsParam as TabKey | null;
    return TABS.some((entry) => entry.key === candidate) ? (candidate as TabKey) : "phase";
  }, [settingsParam]);

  const close = () => {
    const next = new URLSearchParams(params);
    next.delete("settings");
    setParams(next, { replace: true });
  };

  const setTab = (key: TabKey) => {
    const next = new URLSearchParams(params);
    next.set("settings", key);
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  // Subrooms spawn fresh PersonaInstances from templates, so cloning into a
  // child must hand over template ids — instance ids are room-scoped and
  // would not resolve in the subroom.
  const discussantIds = state.personas
    .filter((p) => p.kind === "discussant")
    .map((p) => p.template_id);

  return (
    <div className="fixed inset-0 z-30 flex">
      <div className="flex-1 bg-black/40" onClick={close} />
      <div className="flex h-full w-[480px] max-w-full flex-col border-l border-border bg-panel shadow-soft drawer-enter">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="text-sm font-semibold">房间设置</div>
          <button className="btn h-8 w-8 px-0" type="button" onClick={close} title="关闭">
            <X size={16} />
          </button>
        </div>
        <nav className="flex flex-wrap items-center gap-1 border-b border-border bg-surface px-2 py-2">
          {TABS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                tab === entry.key ? "bg-brand text-white" : "text-muted hover:bg-panel"
              }`}
              onClick={() => setTab(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-auto p-4">
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
        </div>
      </div>
    </div>
  );
}
