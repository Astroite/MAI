import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, useNavigate } from "react-router-dom";
import { Plus, Search, Settings, Trash2, Workflow } from "lucide-react";
import { api } from "../../api";
import { StatusPill } from "../../components/StatusPill";
import { useConfirm } from "../../components/ConfirmDialog";
import { toast } from "../../components/Toaster";
import type { Room } from "../../types";
import { useI18n } from "../../i18n";

export function RoomListSidebar({ activeRoomId }: { activeRoomId?: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { t } = useI18n();
  const confirm = useConfirm();
  const rooms = useQuery({ queryKey: ["rooms"], queryFn: api.rooms });
  const formats = useQuery({ queryKey: ["formats"], queryFn: () => api.formats() });
  const recipes = useQuery({ queryKey: ["recipes"], queryFn: () => api.recipes() });
  const personas = useQuery({
    queryKey: ["persona-templates", "discussant"],
    queryFn: () => api.personaTemplates("discussant")
  });
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState(() => t("room.newDiscussion"));
  const [query, setQuery] = useState("");

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
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("api.deleteFailed"))
  });

  const handleDelete = async (room: Room) => {
    if (await confirm({
      title: t("room.deleteConfirm", { title: room.title }),
      danger: true,
      confirmLabel: t("common.delete")
    })) {
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
  const normalizedQuery = query.trim().toLowerCase();
  const visibleTopLevel = useMemo(
    () =>
      topLevel.filter((room) => {
        if (!normalizedQuery) return true;
        const children = childrenByParent.get(room.id) ?? [];
        return matchesRoom(room, normalizedQuery) || children.some((child) => matchesRoom(child, normalizedQuery));
      }),
    [childrenByParent, normalizedQuery, topLevel]
  );

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-border/80 bg-panel">
      <div className="space-y-3 border-b border-border/80 px-4 py-4">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-brand text-sm font-bold text-white shadow-card">M</div>
          <div>
            <div className="text-lg font-semibold leading-6">MAI</div>
            <div className="text-xs text-muted">{t("dashboard.title")}</div>
          </div>
        </div>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            name="room-search"
            className="input w-full pl-8"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("room.searchRooms")}
          />
        </div>
        <button
          type="button"
          className="btn btn-primary h-9 w-full justify-between px-3"
          title={t("dashboard.newRoom")}
          onClick={() => setCreating((value) => !value)}
        >
          <span>{t("dashboard.newRoom")}</span>
          <Plus size={16} />
        </button>
      </div>
      {creating && (
        <div className="space-y-2 border-b border-border/80 bg-surface p-3">
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
      <div className="mai-scrollbar min-h-0 flex-1 overflow-auto p-3">
        <div className="mb-2 flex items-center justify-between px-1 text-xs font-semibold text-muted">
          <span>{t("room.allRooms")}</span>
          <span>{visibleTopLevel.length}</span>
        </div>
        {visibleTopLevel.length === 0 && (
          <div className="px-2 py-6 text-center text-sm text-muted">
            {t("dashboard.emptyRooms")} <Plus size={12} className="inline" /> {t("common.create")}
          </div>
        )}
        {visibleTopLevel.map((room) => {
          const children = childrenByParent.get(room.id) ?? [];
          const visibleChildren =
            normalizedQuery && !matchesRoom(room, normalizedQuery)
              ? children.filter((child) => matchesRoom(child, normalizedQuery))
              : children;
          return (
            <div key={room.id} className="mb-2">
              <RoomEntry room={room} active={room.id === activeRoomId} onDelete={() => handleDelete(room)} />
              {visibleChildren.map((child) => (
                <RoomEntry
                  key={child.id}
                  room={child}
                  active={child.id === activeRoomId}
                  indent
                  parentId={room.id}
                  onDelete={() => handleDelete(child)}
                />
              ))}
            </div>
          );
        })}
      </div>
      <nav className="flex items-center gap-1 border-t border-border/80 bg-surface px-3 py-3">
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

function matchesRoom(room: Room, query: string): boolean {
  return room.title.toLowerCase().includes(query) || room.status.toLowerCase().includes(query);
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
    <div className={`group relative ${indent ? "ml-5 border-l border-border/80 pl-2" : ""}`}>
      <NavLink
        to={to}
        className={`flex items-center gap-2 rounded-lg border px-2 py-2 pr-9 text-sm shadow-card transition ${
          active ? "border-brand/60 bg-brand/10 text-brand" : "border-transparent text-text hover:border-border hover:bg-surface"
        }`}
      >
        <div className={`grid h-8 w-8 flex-shrink-0 place-items-center rounded-md text-xs font-semibold ${
          active ? "bg-brand text-white" : "bg-surface text-muted"
        }`}>
          {indent ? "↳" : room.title.slice(0, 2)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{room.title}</div>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
            <span className={`h-1.5 w-1.5 rounded-full ${room.status === "frozen" ? "bg-danger" : "bg-success"}`} />
            {display("roomStatus", room.status)}
          </div>
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
