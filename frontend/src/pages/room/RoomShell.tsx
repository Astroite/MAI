import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Settings, Snowflake, Unlock } from "lucide-react";
import { api } from "../../api";
import { useRoomEvents } from "../../hooks";
import { useUIStore } from "../../store";
import { StatusPill } from "../../components/StatusPill";
import { RoomListSidebar } from "./RoomListSidebar";
import { RightPanel } from "./RightPanel";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { PhaseExitBanner } from "./PhaseExitBanner";
import { RoomSettingsDrawer } from "./RoomSettingsDrawer";

export function RoomShell() {
  const { roomId, subId } = useParams();
  const activeRoomId = subId ?? roomId;
  useRoomEvents(activeRoomId);
  const queryClient = useQueryClient();
  const room = useQuery({
    queryKey: ["room", activeRoomId],
    queryFn: () => api.roomState(activeRoomId!),
    enabled: Boolean(activeRoomId)
  });
  const rooms = useQuery({ queryKey: ["rooms"], queryFn: api.rooms });
  const phases = useQuery({ queryKey: ["phases"], queryFn: api.phases });
  const [params, setParams] = useSearchParams();
  const state = room.data;
  const hydrateStream = useUIStore((store) => store.hydrateStream);

  useEffect(() => {
    if (!activeRoomId) return;
    for (const partial of state?.in_flight_partial ?? []) {
      hydrateStream(activeRoomId, partial.message_id, partial.persona_id, partial.content, partial.last_chunk_index);
    }
  }, [activeRoomId, hydrateStream, state?.in_flight_partial]);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["room", activeRoomId] });
  const nextPhase = useMutation({ mutationFn: () => api.nextPhase(activeRoomId!), onSuccess: invalidate });
  const continuePhase = useMutation({ mutationFn: () => api.continuePhase(activeRoomId!), onSuccess: invalidate });
  const extendPhase = useMutation({ mutationFn: () => api.extendPhase(activeRoomId!), onSuccess: invalidate });
  const freeze = useMutation({ mutationFn: () => api.freeze(activeRoomId!), onSuccess: invalidate });
  const unfreeze = useMutation({ mutationFn: () => api.unfreeze(activeRoomId!), onSuccess: invalidate });

  const childRooms = useMemo(
    () => (rooms.data ?? []).filter((item) => item.parent_room_id === state?.room.id),
    [rooms.data, state?.room.id]
  );

  const currentPhaseTemplate = phases.data?.find(
    (phase) => phase.id === state?.current_phase?.phase_template_id
  );

  const openSettings = (tab: string = "phase") => {
    const next = new URLSearchParams(params);
    next.set("settings", tab);
    setParams(next, { replace: true });
  };

  return (
    <div className="grid h-[calc(100vh-0px)] grid-cols-[260px_minmax(0,1fr)_320px] max-xl:grid-cols-[240px_minmax(0,1fr)] max-lg:grid-cols-1">
      <RoomListSidebar activeRoomId={activeRoomId} />

      <section className="flex min-w-0 flex-col overflow-hidden bg-panel">
        {!activeRoomId || !state ? (
          <div className="grid flex-1 place-items-center text-sm text-muted">
            {room.isLoading ? "加载中..." : "在左侧选择或新建一个讨论房间"}
          </div>
        ) : (
          <>
            <header className="flex items-center justify-between gap-3 border-b border-border bg-panel px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {state.room.parent_room_id && (
                    <Link
                      to={`/rooms/${state.room.parent_room_id}`}
                      className="btn h-7 px-2 text-xs"
                      title="返回父讨论"
                    >
                      <ArrowLeft size={13} />
                      父
                    </Link>
                  )}
                  <h1 className="truncate text-base font-semibold">{state.room.title}</h1>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <StatusPill tone={state.room.status === "frozen" ? "danger" : "brand"}>
                    {state.room.status}
                  </StatusPill>
                  {currentPhaseTemplate && (
                    <button
                      type="button"
                      className="text-muted underline hover:text-brand"
                      onClick={() => openSettings("phase")}
                    >
                      Phase: {currentPhaseTemplate.name}
                    </button>
                  )}
                  <span>≈{state.runtime.token_counter_total} tokens</span>
                  {state.room.parent_room_id && <StatusPill tone="accent">子讨论</StatusPill>}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                {state.runtime.frozen ? (
                  <button className="btn" type="button" onClick={() => unfreeze.mutate()} disabled={unfreeze.isPending}>
                    <Unlock size={16} />
                    解冻
                  </button>
                ) : (
                  <button
                    className="btn btn-danger"
                    type="button"
                    onClick={() => freeze.mutate()}
                    disabled={freeze.isPending}
                    title="立即停止当前发言"
                  >
                    <Snowflake size={16} />
                    冻结
                  </button>
                )}
                <button
                  className="btn h-9 w-9 px-0"
                  type="button"
                  onClick={() => openSettings("phase")}
                  title="房间设置"
                >
                  <Settings size={16} />
                </button>
              </div>
            </header>
            {state.runtime.phase_exit_suggested && (
              <PhaseExitBanner
                matched={state.runtime.phase_exit_matched_conditions}
                onNext={() => nextPhase.mutate()}
                onContinue={() => continuePhase.mutate()}
                onExtend={() => extendPhase.mutate()}
                disabled={
                  state.runtime.frozen ||
                  nextPhase.isPending ||
                  continuePhase.isPending ||
                  extendPhase.isPending
                }
              />
            )}
            <MessageList
              roomId={activeRoomId}
              frozen={state.runtime.frozen}
              messages={state.messages}
              personas={state.personas}
            />
            <Composer
              roomId={activeRoomId}
              personas={state.personas.filter((p) => p.kind === "discussant")}
              frozen={state.runtime.frozen}
            />
          </>
        )}
      </section>

      <div className="max-xl:hidden">
        {state ? (
          <RightPanel state={state} childRooms={childRooms} />
        ) : (
          <aside className="h-full border-l border-border bg-panel" />
        )}
      </div>

      {state && <RoomSettingsDrawer state={state} childRooms={childRooms} />}
    </div>
  );
}
