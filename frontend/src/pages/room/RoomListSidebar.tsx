import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, useNavigate } from "react-router-dom";
import { MessagesSquare, Plus, Settings, Trash2, Workflow } from "lucide-react";
import { api } from "../../api";
import { StatusPill } from "../../components/StatusPill";
import type { Room } from "../../types";
import { useI18n } from "../../i18n";

export function RoomListSidebar({ activeRoomId }: { activeRoomId?: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { t } = useI18n();
  const rooms = useQuery({ queryKey: ["rooms"], queryFn: api.rooms });
  const formats = useQuery({ queryKey: ["formats"], queryFn: () => api.formats() });
  const recipes = useQuery({ queryKey: ["recipes"], queryFn: () => api.recipes() });
  const personas = useQuery({
    queryKey: ["persona-templates", "discussant"],
    queryFn: () => api.personaTemplates("discussant")
  });
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState(() => t("room.newDiscussion"));

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
        title: title.trim() || t("room.newDiscussion"),
        recipe_id: defaultRecipeId,
        format_id: defaultRecipeId ? undefined : fallbackFormatId,
        persona_ids: defaultRecipeId ? [] : fallbackPersonaIds
      }),
    onSuccess: (state) => {
      void queryClient.invalidateQueries({ queryKey: ["rooms"] });
      setCreating(false);
      setTitle(t("room.newDiscussion"));
      navigate(`/rooms/${state.room.id}`);
    }
  });

  const remove = useMutation({
    mutationFn: (roomId: string) => api.deleteRoom(roomId),
    onSuccess: (_data, roomId) => {
      void queryClient.invalidateQueries({ queryKey: ["rooms"] });
      // If we just deleted the room we're viewing, kick back to the list.
      if (roomId === activeRoomId) navigate("/");
    }
  });

  const handleDelete = (room: Room) => {
    if (window.confirm(t("room.deleteConfirm", { title: room.title }))) {
      remove.mutate(room.id);
    }
  };

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
          <span>{t("dashboard.title")}</span>
        </div>
        <button
          type="button"
          className="btn h-8 w-8 px-0"
          title={t("dashboard.newRoom")}
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
            placeholder={t("dashboard.roomTitle")}
          />
          <div className="flex gap-2">
            <button className="btn btn-primary flex-1" disabled={create.isPending} onClick={() => create.mutate()}>
              {t("common.create")}
            </button>
            <button className="btn flex-1" onClick={() => setCreating(false)}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {topLevel.length === 0 && (
          <div className="px-2 py-6 text-center text-sm text-muted">
            {t("dashboard.emptyRooms")} <Plus size={12} className="inline" /> {t("common.create")}
          </div>
        )}
        {topLevel.map((room) => (
          <RoomEntry key={room.id} room={room} active={room.id === activeRoomId} onDelete={() => handleDelete(room)} />
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
              onDelete={() => handleDelete(child)}
            />
          ));
        })}
      </div>
      <nav className="flex items-center gap-1 border-t border-border bg-surface px-2 py-2">
        <NavLink to="/templates/personas" className="btn h-8 flex-1 px-2 text-xs">
          <Workflow size={14} />
          {t("nav.templates")}
        </NavLink>
        <NavLink to="/settings" className="btn h-8 flex-1 px-2 text-xs">
          <Settings size={14} />
          {t("nav.settings")}
        </NavLink>
      </nav>
    </aside>
  );
}

function RoomEntry({
  room,
  active,
  indent = false,
  parentId,
  onDelete
}: {
  room: Room;
  active: boolean;
  indent?: boolean;
  parentId?: string;
  onDelete: () => void;
}) {
  const { t, display } = useI18n();
  const to = parentId ? `/rooms/${parentId}/sub/${room.id}` : `/rooms/${room.id}`;
  return (
    <div className={`group relative ${indent ? "ml-4" : ""}`}>
      <NavLink
        to={to}
        className={`flex items-center gap-2 rounded-md px-2 py-2 pr-9 text-sm transition ${
          active ? "bg-brand/10 text-brand" : "text-text hover:bg-surface"
        }`}
      >
        <div className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md bg-surface text-xs">
          {indent ? "↳" : room.title.slice(0, 2)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{room.title}</div>
          <div className="mt-0.5 text-xs text-muted">{display("roomStatus", room.status)}</div>
        </div>
        {room.status === "frozen" && <StatusPill tone="danger">{display("roomStatus", room.status)}</StatusPill>}
      </NavLink>
      <button
        type="button"
        className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted opacity-0 transition group-hover:opacity-100 hover:bg-rose-500/10 hover:text-rose-500"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onDelete();
        }}
        title={t("common.delete")}
        aria-label={`${t("common.delete")} ${room.title}`}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
