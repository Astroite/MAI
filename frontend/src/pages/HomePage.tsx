import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Globe,
  Hash,
  MessageCircle,
  MessagesSquare,
  Plus,
  Snowflake,
  Sparkles,
  Users,
  UsersRound
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "../api";
import { PersonaIcon, DEFAULT_PERSONA_COLOR } from "../components/PersonaIcon";
import { StatusPill } from "../components/StatusPill";
import { useI18n } from "../i18n";
import type { Room, WorldSummary } from "../types";

export function HomePage() {
  const { t, display, formatRelativeTime } = useI18n();
  const rooms = useQuery({ queryKey: ["rooms"], queryFn: api.rooms });
  const worlds = useQuery({ queryKey: ["worlds"], queryFn: api.worlds });

  const discussionRooms = useMemo(
    () =>
      [...(rooms.data ?? [])]
        .filter((room) => !room.parent_room_id && !room.world_id)
        .sort((a, b) => {
          const aT = a.last_activity_at ?? a.created_at;
          const bT = b.last_activity_at ?? b.created_at;
          return aT < bT ? 1 : -1;
        }),
    [rooms.data]
  );
  const sceneRooms = useMemo(
    () => (rooms.data ?? []).filter((room) => room.world_id),
    [rooms.data]
  );
  const sortedWorlds = useMemo(
    () =>
      [...(worlds.data ?? [])].sort((a, b) => {
        const aT = a.last_activity_at ?? a.created_at;
        const bT = b.last_activity_at ?? b.created_at;
        return aT < bT ? 1 : -1;
      }),
    [worlds.data]
  );

  // Total messages = discussion rooms + scene rooms (count_message is exposed
  // on RoomSummaryOut whether the room has a world_id or not).
  const totalMessages = useMemo(
    () =>
      (rooms.data ?? []).reduce((acc, room) => acc + (room.message_count ?? 0), 0),
    [rooms.data]
  );
  const totalCharacters = useMemo(
    () =>
      (worlds.data ?? []).reduce((acc, world) => acc + world.character_count, 0),
    [worlds.data]
  );

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("home.title")}</h1>
        <p className="text-sm text-muted">{t("home.subtitle")}</p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={MessagesSquare}
          label={t("home.stats.discussions")}
          value={discussionRooms.length}
          to="/dashboard"
          tone="brand"
        />
        <StatCard
          icon={Globe}
          label={t("home.stats.worlds")}
          value={sortedWorlds.length}
          subValue={t("home.stats.scenesCount", { count: sceneRooms.length })}
          to="/worlds"
          tone="info"
        />
        <StatCard
          icon={UsersRound}
          label={t("home.stats.characters")}
          value={totalCharacters}
          to="/templates/personas"
          tone="success"
        />
        <StatCard
          icon={Hash}
          label={t("home.stats.messages")}
          value={totalMessages}
          tone="warning"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <RecentSection
          title={t("home.recent.discussions")}
          icon={MessagesSquare}
          allHref="/dashboard"
          createHref="/dashboard/new"
          createLabel={t("dashboard.newRoom")}
          emptyHint={t("home.empty.discussions")}
        >
          {discussionRooms.slice(0, 4).map((room) => (
            <RoomMiniCard
              key={room.id}
              room={room}
              t={t}
              display={display}
              formatRelativeTime={formatRelativeTime}
            />
          ))}
          {discussionRooms.length === 0 && null}
        </RecentSection>

        <RecentSection
          title={t("home.recent.worlds")}
          icon={Globe}
          allHref="/worlds"
          createHref="/worlds"
          createLabel={t("home.recent.newWorld")}
          emptyHint={t("home.empty.worlds")}
        >
          {sortedWorlds.slice(0, 4).map((world) => (
            <WorldMiniCard key={world.id} world={world} formatRelativeTime={formatRelativeTime} />
          ))}
        </RecentSection>
      </section>
    </div>
  );
}

type Tone = "brand" | "info" | "success" | "warning";
const TONE_BG: Record<Tone, string> = {
  brand: "bg-brand/10 text-brand",
  info: "bg-info/10 text-info",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning"
};

function StatCard({
  icon: Icon,
  label,
  value,
  subValue,
  to,
  tone
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  subValue?: string;
  to?: string;
  tone: Tone;
}) {
  const body = (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-panel p-4 shadow-card transition hover:border-brand/40">
      <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg ${TONE_BG[tone]}`}>
        <Icon size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-2xl font-semibold leading-tight tabular-nums">{value}</div>
        <div className="truncate text-xs text-muted">{label}</div>
        {subValue && <div className="truncate text-xs text-muted">{subValue}</div>}
      </div>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

function RecentSection({
  title,
  icon: Icon,
  allHref,
  createHref,
  createLabel,
  emptyHint,
  children
}: {
  title: string;
  icon: LucideIcon;
  allHref: string;
  createHref: string;
  createLabel: string;
  emptyHint: string;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const childArray = Array.isArray(children) ? children.filter(Boolean) : [children].filter(Boolean);
  const isEmpty = childArray.length === 0;

  return (
    <section className="panel space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Icon size={16} className="text-muted" />
          {title}
        </h2>
        <div className="flex items-center gap-1">
          <Link
            to={createHref}
            className="btn h-7 px-2 text-xs"
            title={createLabel}
            aria-label={createLabel}
          >
            <Plus size={12} />
          </Link>
          <Link
            to={allHref}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted hover:text-text"
          >
            {t("home.viewAll")}
            <ArrowRight size={12} />
          </Link>
        </div>
      </div>
      {isEmpty ? (
        <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-xs text-muted">
          {emptyHint}
        </div>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </section>
  );
}

function RoomMiniCard({
  room,
  t,
  display,
  formatRelativeTime
}: {
  room: Room;
  t: ReturnType<typeof useI18n>["t"];
  display: ReturnType<typeof useI18n>["display"];
  formatRelativeTime: ReturnType<typeof useI18n>["formatRelativeTime"];
}) {
  const isFrozen = room.status === "frozen";
  const members = room.members ?? [];
  const memberCount = room.member_count ?? members.length;
  const messageCount = room.message_count ?? 0;
  const accent = members[0]?.color || DEFAULT_PERSONA_COLOR;
  const lastActivity = room.last_activity_at ?? room.created_at;

  return (
    <Link
      to={`/rooms/${room.id}`}
      className="relative flex items-center gap-3 overflow-hidden rounded-md border border-border bg-surface px-3 py-2 transition hover:border-brand/50 hover:bg-panel"
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: isFrozen ? "rgb(228 82 92 / 0.7)" : accent }}
      />
      <div className="ml-1 min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{room.title}</span>
          {isFrozen && (
            <StatusPill tone="danger">
              <Snowflake size={12} className="-ml-0.5" />
              {display("roomStatus", room.status)}
            </StatusPill>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-3 text-xs text-muted">
          {members.length > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Users size={12} />
              {t("room.memberCount", { count: memberCount })}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Users size={12} />
              {t("room.noMembers")}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <MessageCircle size={12} />
            {t("room.messageCount", { count: messageCount })}
          </span>
          <span className="ml-auto truncate">{formatRelativeTime(lastActivity)}</span>
        </div>
      </div>
      {members.length > 0 && (
        <div className="flex shrink-0 -space-x-1.5">
          {members.slice(0, 3).map((member) => (
            <span key={member.id} className="rounded-full ring-2 ring-panel">
              <PersonaIcon
                icon={member.icon}
                color={member.color}
                size={20}
                iconSize={10}
                rounded="full"
              />
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}

function WorldMiniCard({
  world,
  formatRelativeTime
}: {
  world: WorldSummary;
  formatRelativeTime: ReturnType<typeof useI18n>["formatRelativeTime"];
}) {
  const last = world.last_activity_at ? formatRelativeTime(world.last_activity_at) : "—";

  return (
    <Link
      to={`/worlds/${world.id}`}
      className="relative flex items-center gap-3 overflow-hidden rounded-md border border-border bg-surface px-3 py-2 transition hover:border-brand/50 hover:bg-panel"
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: world.cover_color }}
      />
      <span
        aria-hidden
        className="ml-1 grid h-8 w-8 shrink-0 place-items-center rounded text-white"
        style={{ background: world.cover_color }}
      >
        <Sparkles size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{world.name}</div>
        <div className="mt-0.5 flex items-center gap-3 text-xs text-muted">
          <span>角色 {world.character_count}</span>
          <span>场景 {world.scene_count}</span>
          <span className="ml-auto truncate">{last}</span>
        </div>
      </div>
    </Link>
  );
}
