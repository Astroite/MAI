import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, useNavigate } from "react-router-dom";
import { MessagesSquare, Plus, Settings, Workflow } from "lucide-react";
import { api } from "../../api";
import { StatusPill } from "../../components/StatusPill";
import type { Room } from "../../types";

export function RoomListSidebar({ activeRoomId }: { activeRoomId?: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const rooms = useQuery({ queryKey: ["rooms"], queryFn: api.rooms });
  const formats = useQuery({ queryKey: ["formats"], queryFn: api.formats });
  const recipes = useQuery({ queryKey: ["recipes"], queryFn: api.recipes });
  const personas = useQuery({
    queryKey: ["persona-templates", "discussant"],
    queryFn: () => api.personaTemplates("discussant")
  });
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("新讨论");

  const defaultRecipeId = useMemo(
    () => recipes.data?.find((item) => item.name === "方案评审默认配方")?.id,
    [recipes.data]
  );
  const fallbackPersonaIds = useMemo(() => {
    const names = new Set(["架构师", "性能批评者", "维护者", "反方律师"]);
    return personas.data?.filter((p) => names.has(p.name)).map((p) => p.id) ?? [];
  }, [personas.data]);
  const fallbackFormatId = formats.data?.find((item) => item.name === "方案评审")?.id;

  const create = useMutation({
    mutationFn: () =>
      api.createRoom({
        title: title.trim() || "新讨论",
        recipe_id: defaultRecipeId,
        format_id: defaultRecipeId ? undefined : fallbackFormatId,
        persona_ids: defaultRecipeId ? [] : fallbackPersonaIds
      }),
    onSuccess: (state) => {
      void queryClient.invalidateQueries({ queryKey: ["rooms"] });
      setCreating(false);
      setTitle("新讨论");
      navigate(`/rooms/${state.room.id}`);
    }
  });

  // Top-level rooms (not subrooms) sorted by created_at desc.
  const topLevel = useMemo(
    () =>
      [...(rooms.data ?? [])]
        .filter((room) => !room.parent_room_id)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    [rooms.data]
  );
  const childrenByParent = useMemo(() => {
    const map = new Map<string, Room[]>();
    for (const room of rooms.data ?? []) {
      if (!room.parent_room_id) continue;
      const list = map.get(room.parent_room_id) ?? [];
      list.push(room);
      map.set(room.parent_room_id, list);
    }
    return map;
  }, [rooms.data]);

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-border bg-panel">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-3">
        <div className="flex items-center gap-2 font-semibold">
          <MessagesSquare size={16} />
          <span>讨论</span>
        </div>
        <button
          type="button"
          className="btn h-8 w-8 px-0"
          title="新建房间"
          onClick={() => setCreating((value) => !value)}
        >
          <Plus size={16} />
        </button>
      </div>
      {creating && (
        <div className="border-b border-border bg-surface p-3 space-y-2">
          <input
            name="new-room-title"
            className="input w-full"
            value={title}
            autoFocus
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !create.isPending) create.mutate();
              if (event.key === "Escape") setCreating(false);
            }}
            placeholder="房间标题"
          />
          <div className="flex gap-2">
            <button className="btn btn-primary flex-1" disabled={create.isPending} onClick={() => create.mutate()}>
              创建
            </button>
            <button className="btn flex-1" onClick={() => setCreating(false)}>
              取消
            </button>
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {topLevel.length === 0 && (
          <div className="px-2 py-6 text-center text-sm text-muted">
            还没有房间。点 <Plus size={12} className="inline" /> 创建一个。
          </div>
        )}
        {topLevel.map((room) => (
          <RoomEntry key={room.id} room={room} active={room.id === activeRoomId} />
        ))}
        {topLevel.flatMap((room) => {
          const children = childrenByParent.get(room.id) ?? [];
          return children.map((child) => (
            <RoomEntry
              key={child.id}
              room={child}
              active={child.id === activeRoomId}
              indent
              parentId={room.id}
            />
          ));
        })}
      </div>
      <nav className="flex items-center gap-1 border-t border-border bg-surface px-2 py-2">
        <NavLink to="/templates/personas" className="btn h-8 flex-1 px-2 text-xs">
          <Workflow size={14} />
          模板
        </NavLink>
        <NavLink to="/settings" className="btn h-8 flex-1 px-2 text-xs">
          <Settings size={14} />
          设置
        </NavLink>
      </nav>
    </aside>
  );
}

function RoomEntry({
  room,
  active,
  indent = false,
  parentId
}: {
  room: Room;
  active: boolean;
  indent?: boolean;
  parentId?: string;
}) {
  const to = parentId ? `/rooms/${parentId}/sub/${room.id}` : `/rooms/${room.id}`;
  return (
    <NavLink
      to={to}
      className={`flex items-center gap-2 rounded-md px-2 py-2 text-sm transition ${
        active ? "bg-brand/10 text-brand" : "text-text hover:bg-surface"
      } ${indent ? "ml-4" : ""}`}
    >
      <div className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md bg-surface text-xs">
        {indent ? "↳" : room.title.slice(0, 2)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{room.title}</div>
        <div className="mt-0.5 text-xs text-muted">{room.status}</div>
      </div>
      {room.status === "frozen" && <StatusPill tone="danger">冻</StatusPill>}
    </NavLink>
  );
}
