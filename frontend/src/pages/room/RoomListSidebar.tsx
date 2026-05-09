import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, useNavigate } from "react-router-dom";
import { CornerDownRight, MessageCircle, Plus, Search, Snowflake, Trash2, Users } from "lucide-react";
import { api } from "../../api";
import { StatusPill } from "../../components/StatusPill";
import { useConfirm } from "../../components/ConfirmDialog";
import { toast } from "../../components/Toaster";
import type { Room } from "../../types";
import { useI18n } from "../../i18n";
import { PersonaIcon, DEFAULT_PERSONA_COLOR } from "../../components/PersonaIcon";

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
  const { t, display, formatRelativeTime } = useI18n();
  const to = parentId ? `/rooms/${parentId}/sub/${room.id}` : `/rooms/${room.id}`;
  const isFrozen = room.status === "frozen";
  const members = room.members ?? [];
  const memberCount = room.member_count ?? members.length;
  const messageCount = room.message_count ?? 0;
  // The card's accent color tracks the first member's persona color so each
  // room reads visually distinct in the rail.
  const accent = members[0]?.color || DEFAULT_PERSONA_COLOR;
  const lastActivity = room.last_activity_at ?? room.created_at;
  const lastActivityRel = lastActivity ? formatRelativeTime(lastActivity) : null;

  return (
    <div className={`group relative ${indent ? "ml-4" : ""}`}>
      <NavLink
        to={to}
        className={`relative block overflow-hidden rounded-lg border bg-panel shadow-card transition hover:shadow-soft ${
          active ? "border-current ring-1" : "border-border hover:border-brand/60"
        }`}
        style={
          active
            ? ({ borderColor: accent, ["--tw-ring-color" as string]: accent, color: accent } as React.CSSProperties)
            : undefined
        }
      >
        {/* Left accent strip = persona color (or muted when frozen). */}
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-1"
          style={{ backgroundColor: isFrozen ? "rgb(244 63 94 / 0.6)" : accent }}
        />

        <div className="px-3 py-2.5 pl-4 text-text">
          {/* Title row */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              {indent && <CornerDownRight size={12} className="shrink-0 text-muted" />}
              <h3 className="truncate text-sm font-semibold leading-5">{room.title}</h3>
            </div>
            {isFrozen && (
              <StatusPill tone="danger">
                <Snowflake size={10} className="-ml-0.5" />
                {display("roomStatus", room.status)}
              </StatusPill>
            )}
          </div>

          {/* Member avatars row */}
          {members.length > 0 ? (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex -space-x-2">
                {members.slice(0, 4).map((member) => (
                  <span
                    key={member.id}
                    className="rounded-full ring-2 ring-panel"
                    title={member.name}
                  >
                    <PersonaIcon
                      icon={member.icon}
                      color={member.color}
                      size={22}
                      iconSize={11}
                      rounded="full"
                    />
                  </span>
                ))}
                {memberCount > 4 && (
                  <span
                    className="grid h-[22px] w-[22px] place-items-center rounded-full bg-surface text-[10px] font-semibold text-muted ring-2 ring-panel"
                    title={t("room.membersTitle", { count: memberCount })}
                  >
                    +{memberCount - 4}
                  </span>
                )}
              </div>
              <span className="text-[11px] text-muted">{t("room.memberCount", { count: memberCount })}</span>
            </div>
          ) : (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
              <Users size={11} />
              {t("room.noMembers")}
            </div>
          )}

          {/* Footer: message count + last activity */}
          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1">
              <MessageCircle size={11} />
              {t("room.messageCount", { count: messageCount })}
            </span>
            {lastActivityRel && <span className="truncate">{lastActivityRel}</span>}
          </div>
        </div>
      </NavLink>

      <button
        type="button"
        className="absolute right-1.5 top-1.5 rounded p-1 text-muted opacity-0 transition group-hover:opacity-100 hover:bg-rose-500/10 hover:text-rose-500"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onDelete();
        }}
        title={t("common.delete")}
        aria-label={`${t("common.delete")} ${room.title}`}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}
