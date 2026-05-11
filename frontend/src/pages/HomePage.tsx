import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpen,
  Lightbulb,
  Mountain,
  Play,
  Plus,
  UserPlus,
  Users,
  UsersRound,
  Wand2
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "../api";
import {
  DEFAULT_PERSONA_COLOR,
  PersonaIcon,
  resolvePersonaIcon
} from "../components/PersonaIcon";
import { StatusPill, type PillTone } from "../components/StatusPill";
import { useI18n } from "../i18n";
import { queryKeys } from "../queryKeys";
import type { Room, World, WorldCharacter, WorldDetail, WorldSummary } from "../types";

type SceneStatus = "active" | "sealed" | "frozen" | "none";

export function HomePage() {
  const { t, formatRelativeTime } = useI18n();
  const worlds = useQuery({ queryKey: queryKeys.worlds, queryFn: api.worlds });
  const rooms = useQuery({ queryKey: queryKeys.rooms, queryFn: api.rooms });

  const sortedWorlds = useMemo<WorldSummary[]>(
    () =>
      [...(worlds.data ?? [])].sort((a, b) => {
        const aT = a.last_activity_at ?? a.created_at;
        const bT = b.last_activity_at ?? b.created_at;
        return aT < bT ? 1 : -1;
      }),
    [worlds.data]
  );
  const recentWorlds = sortedWorlds.slice(0, 4);

  const sceneRooms = useMemo<Room[]>(
    () =>
      [...(rooms.data ?? [])]
        .filter((room) => Boolean(room.world_id))
        .sort((a, b) => {
          const aT = a.last_activity_at ?? a.created_at;
          const bT = b.last_activity_at ?? b.created_at;
          return aT < bT ? 1 : -1;
        }),
    [rooms.data]
  );

  const latestSceneByWorld = useMemo(() => {
    const map = new Map<string, Room>();
    for (const room of sceneRooms) {
      const wid = room.world_id;
      if (!wid) continue;
      const existing = map.get(wid);
      if (!existing) {
        map.set(wid, room);
        continue;
      }
      const a = existing.last_activity_at ?? existing.created_at;
      const b = room.last_activity_at ?? room.created_at;
      if (b > a) map.set(wid, room);
    }
    return map;
  }, [sceneRooms]);

  const currentWorld: WorldSummary | undefined = sortedWorlds[0];
  const currentScene: Room | null = currentWorld
    ? latestSceneByWorld.get(currentWorld.id) ?? null
    : null;
  const latestScene: Room | null = sceneRooms[0] ?? null;

  const currentWorldDetail = useQuery({
    queryKey: queryKeys.world(currentWorld?.id),
    queryFn: () => api.world(currentWorld!.id),
    enabled: Boolean(currentWorld?.id)
  });

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-6">
        <HeroCard
          newWorldHref="/worlds"
          newSceneHref={currentWorld ? `/worlds/${currentWorld.id}` : "/worlds"}
          resumeHref={latestScene ? `/rooms/${latestScene.id}` : null}
        />
        <RecentWorldsSection
          worlds={recentWorlds}
          latestSceneByWorld={latestSceneByWorld}
          formatRelativeTime={formatRelativeTime}
          loading={worlds.isLoading}
        />
        <QuickStartSection currentWorldId={currentWorld?.id ?? null} />
      </div>
      <DirectorPanel
        world={currentWorld ?? null}
        worldDetail={currentWorldDetail.data ?? null}
        scene={currentScene}
        latestScene={latestScene}
      />
    </div>
  );

  // Re-route i18n through the closure for compactness
  void t;
}

/* ── Hero ──────────────────────────────────────────────────────── */

function HeroCard({
  newWorldHref,
  newSceneHref,
  resumeHref
}: {
  newWorldHref: string;
  newSceneHref: string;
  resumeHref: string | null;
}) {
  const { t } = useI18n();
  return (
    <section className="relative overflow-hidden rounded-lg border border-border/80 bg-gradient-to-br from-info/10 via-brand/5 to-panel p-6 shadow-card sm:p-8">
      {/* Soft watercolor decoration */}
      <Mountain
        size={220}
        aria-hidden
        className="pointer-events-none absolute -bottom-8 -right-6 text-info/[0.10]"
        strokeWidth={1.25}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-12 right-12 h-40 w-40 rounded-full bg-brand/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-1/3 h-32 w-56 rounded-full bg-info/10 blur-3xl"
      />
      <div className="relative max-w-xl">
        <h1 className="text-2xl font-bold tracking-tight text-text sm:text-[28px]">
          {t("home.story.heroTitle")}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {t("home.story.heroSubtitle")}
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Link to={newWorldHref} className="btn btn-primary px-4">
            <Plus size={16} />
            {t("home.story.heroNewWorld")}
          </Link>
          <Link to={newSceneHref} className="btn px-4">
            <Wand2 size={16} />
            {t("home.story.heroNewScene")}
          </Link>
          {resumeHref ? (
            <Link to={resumeHref} className="btn px-4">
              <Play size={16} />
              {t("home.story.heroResume")}
            </Link>
          ) : (
            <button className="btn px-4" type="button" disabled>
              <Play size={16} />
              {t("home.story.heroResume")}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/* ── Recent Worlds ─────────────────────────────────────────────── */

function RecentWorldsSection({
  worlds,
  latestSceneByWorld,
  formatRelativeTime,
  loading
}: {
  worlds: WorldSummary[];
  latestSceneByWorld: Map<string, Room>;
  formatRelativeTime: ReturnType<typeof useI18n>["formatRelativeTime"];
  loading: boolean;
}) {
  const { t } = useI18n();

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold tracking-tight">
          {t("home.story.recentWorlds")}
        </h2>
        <Link
          to="/worlds"
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted hover:text-brand"
        >
          {t("home.viewAll")}
          <ArrowRight size={12} />
        </Link>
      </div>
      {worlds.length === 0 ? (
        <div className="panel relative overflow-hidden px-4 py-10 text-center">
          <p className="text-xs text-muted">
            {loading ? "…" : t("home.story.recentEmpty")}
          </p>
          <Link
            to="/worlds"
            className="relative mt-3 inline-flex items-center gap-1.5 rounded-md border border-border bg-panel px-3 py-1.5 text-xs font-medium text-text shadow-card transition hover:border-brand hover:text-brand"
          >
            <Plus size={12} />
            {t("home.story.recentEmptyCta")}
          </Link>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {worlds.map((world, i) => (
            <WorldCard
              key={world.id}
              world={world}
              scene={latestSceneByWorld.get(world.id) ?? null}
              formatRelativeTime={formatRelativeTime}
              delay={i * 60}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function WorldCard({
  world,
  scene,
  formatRelativeTime,
  delay
}: {
  world: WorldSummary;
  scene: Room | null;
  formatRelativeTime: ReturnType<typeof useI18n>["formatRelativeTime"];
  delay: number;
}) {
  const { t } = useI18n();
  const Icon = resolvePersonaIcon(world.cover_icon);
  const status = sceneStatus(scene);
  const last = world.last_activity_at ? formatRelativeTime(world.last_activity_at) : null;
  const continueHref = scene ? `/rooms/${scene.id}` : `/worlds/${world.id}`;
  const continueLabel = scene ? t("home.story.world.continue") : t("home.story.world.open");
  const members = scene?.members ?? [];
  const memberCount = scene?.member_count ?? members.length;

  return (
    <article
      className="animate-fade-up group relative flex flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-card transition hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-soft"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Cover */}
      <div
        aria-hidden
        className="relative h-20 w-full overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${world.cover_color}33, ${world.cover_color}11 60%, transparent)`
        }}
      >
        <span
          className="pointer-events-none absolute -right-4 -top-3 h-24 w-24 rounded-full opacity-30 blur-2xl"
          style={{ background: world.cover_color }}
        />
        <span
          className="absolute left-3 top-3 grid h-9 w-9 place-items-center rounded-md text-white shadow-card"
          style={{ background: world.cover_color }}
        >
          <Icon size={16} />
        </span>
        <div className="absolute right-2 top-2">
          <SceneStatusPill status={status} />
        </div>
      </div>
      <Link to={continueHref} className="flex flex-1 flex-col px-3 pb-3 pt-2.5">
        <h3 className="line-clamp-1 text-sm font-semibold leading-snug">{world.name}</h3>
        <p className="mt-1 line-clamp-2 min-h-[2.25rem] text-xs leading-snug text-muted">
          {world.synopsis || "—"}
        </p>
        {/* Members + scene info */}
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            {members.length > 0 ? (
              <div className="flex shrink-0 -space-x-1.5">
                {members.slice(0, 4).map((m) => (
                  <span key={m.id} className="rounded-full ring-2 ring-panel">
                    <PersonaIcon
                      icon={m.icon}
                      color={m.color}
                      size={20}
                      iconSize={10}
                      rounded="full"
                    />
                  </span>
                ))}
              </div>
            ) : (
              <span
                className="inline-flex h-5 items-center gap-1 rounded-full bg-surface px-2 text-[11px] text-muted"
                aria-hidden
              >
                <UsersRound size={11} />
                {t("home.story.world.charCount", { count: world.character_count })}
              </span>
            )}
            {members.length > 0 && memberCount > members.length && (
              <span className="text-[11px] text-muted">+{memberCount - members.length}</span>
            )}
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted">
              <BookOpen size={11} />
              {t("home.story.world.sceneCount", { count: world.scene_count })}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="line-clamp-1 min-w-0 flex-1 text-[11px] text-muted">
              {scene
                ? `${t("home.story.scene.act", { n: scene.scene_index ?? 0 })} · ${scene.title}`
                : t("home.story.world.noScene")}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-text transition group-hover:border-brand/40 group-hover:text-brand">
              {continueLabel}
              <ArrowRight size={11} />
            </span>
          </div>
          {last && <div className="text-[10.5px] text-muted/80">{last}</div>}
        </div>
      </Link>
    </article>
  );
}

/* ── Quick Start ───────────────────────────────────────────────── */

function QuickStartSection({ currentWorldId }: { currentWorldId: string | null }) {
  const { t } = useI18n();
  const cards: QuickStartItem[] = [
    {
      icon: Plus,
      titleKey: "home.story.qs.createWorld.title",
      descKey: "home.story.qs.createWorld.desc",
      to: "/worlds",
      tone: "brand"
    },
    {
      icon: Users,
      titleKey: "home.story.qs.ensemble.title",
      descKey: "home.story.qs.ensemble.desc",
      to: currentWorldId ? `/worlds/${currentWorldId}` : "/worlds",
      tone: "info"
    },
    {
      icon: BookOpen,
      titleKey: "home.story.qs.fromTemplate.title",
      descKey: "home.story.qs.fromTemplate.desc",
      to: "/templates/recipes",
      tone: "accent"
    },
    {
      icon: UserPlus,
      titleKey: "home.story.qs.createCharacter.title",
      descKey: "home.story.qs.createCharacter.desc",
      to: currentWorldId ? `/worlds/${currentWorldId}` : "/templates/personas",
      tone: "success"
    }
  ];
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold tracking-tight">
        {t("home.story.quickStart.title")}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card, i) => (
          <QuickStartCard key={card.titleKey} card={card} delay={i * 50} />
        ))}
      </div>
    </section>
  );
}

type QuickStartTone = "brand" | "info" | "accent" | "success";

interface QuickStartItem {
  icon: LucideIcon;
  titleKey: string;
  descKey: string;
  to: string;
  tone: QuickStartTone;
}

const QS_TONE: Record<QuickStartTone, string> = {
  brand: "bg-brand/10 text-brand",
  info: "bg-info/10 text-info",
  accent: "bg-accent/10 text-accent",
  success: "bg-success/10 text-success"
};

function QuickStartCard({ card, delay }: { card: QuickStartItem; delay: number }) {
  const { t } = useI18n();
  const Icon = card.icon;
  return (
    <Link
      to={card.to}
      className="animate-fade-up group flex h-full items-start gap-3 rounded-lg border border-border bg-panel px-3.5 py-3 shadow-card transition hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-soft"
      style={{ animationDelay: `${delay}ms` }}
    >
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-md transition group-hover:scale-105 ${QS_TONE[card.tone]}`}
      >
        <Icon size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-snug">{t(card.titleKey)}</div>
        <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted">{t(card.descKey)}</p>
      </div>
    </Link>
  );
}

/* ── Director Panel ────────────────────────────────────────────── */

function DirectorPanel({
  world,
  worldDetail,
  scene,
  latestScene
}: {
  world: World | null;
  worldDetail: WorldDetail | null;
  scene: Room | null;
  latestScene: Room | null;
}) {
  const { t } = useI18n();
  return (
    <aside
      aria-label={t("home.story.director.title")}
      className="space-y-4 lg:sticky lg:top-2 lg:self-start"
    >
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold tracking-tight text-muted">
          {t("home.story.director.title")}
        </h2>
        <span aria-hidden className="h-px flex-1 bg-border" />
      </div>
      <CurrentWorldSummaryCard world={world} scene={scene} />
      <CharacterStatusCard world={world} worldDetail={worldDetail} scene={scene} />
      <TodaySuggestionsCard latestScene={latestScene} hasWorld={Boolean(world)} />
    </aside>
  );
}

function CurrentWorldSummaryCard({
  world,
  scene
}: {
  world: World | null;
  scene: Room | null;
}) {
  const { t } = useI18n();
  if (!world) {
    return (
      <section className="panel space-y-2 p-3.5">
        <SectionHead title={t("home.story.director.currentWorld")} />
        <p className="text-xs text-muted">{t("home.story.director.empty")}</p>
        <Link
          to="/worlds"
          className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-border bg-panel px-2.5 py-1 text-xs font-medium text-text shadow-card transition hover:border-brand hover:text-brand"
        >
          <Plus size={12} />
          {t("home.story.heroNewWorld")}
        </Link>
      </section>
    );
  }
  const Icon = resolvePersonaIcon(world.cover_icon);
  const sceneTitle = scene
    ? `${t("home.story.scene.act", { n: scene.scene_index ?? 0 })} · ${scene.title}`
    : t("home.story.world.noScene");
  const status = sceneStatus(scene);
  const members = scene?.members ?? [];

  return (
    <section className="panel space-y-3 p-3.5">
      <SectionHead title={t("home.story.director.currentWorld")} />
      <Link to={`/worlds/${world.id}`} className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-white shadow-card"
          style={{ background: world.cover_color }}
        >
          <Icon size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="line-clamp-1 text-sm font-semibold">{world.name}</div>
          <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted">
            {world.synopsis || "—"}
          </p>
        </div>
      </Link>

      <SubField
        label={t("home.story.director.currentScene")}
        right={<SceneStatusPill status={status} />}
      >
        <div className="line-clamp-1 text-xs text-text">{sceneTitle}</div>
      </SubField>

      <SubField label={t("home.story.director.charactersInScene")}>
        {members.length === 0 ? (
          <div className="text-xs text-muted">—</div>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {members.slice(0, 6).map((m) => (
              <span
                key={m.id}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-1.5 py-0.5 text-[11px]"
              >
                <PersonaIcon
                  icon={m.icon}
                  color={m.color}
                  size={14}
                  iconSize={8}
                  rounded="full"
                />
                <span className="max-w-[90px] truncate">{m.name}</span>
              </span>
            ))}
            {members.length > 6 && (
              <span className="text-[11px] text-muted">+{members.length - 6}</span>
            )}
          </div>
        )}
      </SubField>

      <SubField label={t("home.story.director.nextSuggestion")}>
        <div className="flex items-start gap-1.5 rounded-md border border-info/30 bg-info/5 px-2 py-1.5 text-xs text-text">
          <Lightbulb size={12} className="mt-0.5 shrink-0 text-info" />
          <span>{t("home.story.director.nextSuggestionExample")}</span>
        </div>
      </SubField>
    </section>
  );
}

function CharacterStatusCard({
  world,
  worldDetail,
  scene
}: {
  world: World | null;
  worldDetail: WorldDetail | null;
  scene: Room | null;
}) {
  const { t } = useI18n();
  if (!world) return null;

  const characters = (worldDetail?.characters ?? []).filter((c) => c.status === "active");
  const presentNames = new Set((scene?.members ?? []).map((m) => m.name));

  return (
    <section className="panel space-y-2 p-3.5">
      <SectionHead title={t("home.story.director.charStatus")} />
      {characters.length === 0 ? (
        <p className="text-xs text-muted">{t("home.story.director.charStatusEmpty")}</p>
      ) : (
        <ul className="space-y-2">
          {characters.slice(0, 5).map((c) => (
            <li key={c.id}>
              <CharacterRow
                character={c}
                present={presentNames.has(c.name)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CharacterRow({
  character,
  present
}: {
  character: WorldCharacter;
  present: boolean;
}) {
  const { t } = useI18n();
  const summary = (character.brief || character.identity || "").trim();
  return (
    <div className="flex items-start gap-2.5">
      <PersonaIcon
        icon={character.icon}
        color={character.color}
        size={28}
        iconSize={14}
        rounded="full"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium">{character.name}</span>
          {present ? (
            <StatusPill tone="brand" dot>
              {t("home.story.director.charPresent")}
            </StatusPill>
          ) : (
            <StatusPill tone="neutral">
              {t("home.story.director.charOffstage")}
            </StatusPill>
          )}
        </div>
        {summary && (
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted">{summary}</p>
        )}
      </div>
    </div>
  );
}

function TodaySuggestionsCard({
  latestScene,
  hasWorld
}: {
  latestScene: Room | null;
  hasWorld: boolean;
}) {
  const { t } = useI18n();
  return (
    <section className="panel space-y-2 p-3.5">
      <SectionHead title={t("home.story.director.todayTitle")} />
      <ul className="space-y-1.5">
        <TodayLink
          to="/worlds"
          icon={Plus}
          tone="brand"
          title={t("home.story.director.today.openNew.title")}
          desc={t("home.story.director.today.openNew.desc")}
        />
        <TodayLink
          to={latestScene ? `/rooms/${latestScene.id}` : "/worlds"}
          icon={Play}
          tone="info"
          title={t("home.story.director.today.continue.title")}
          desc={t("home.story.director.today.continue.desc")}
          disabled={!latestScene}
        />
        <TodayLink
          to={hasWorld ? "/worlds" : "/worlds"}
          icon={BookOpen}
          tone="accent"
          title={t("home.story.director.today.memory.title")}
          desc={t("home.story.director.today.memory.desc")}
        />
      </ul>
    </section>
  );
}

function TodayLink({
  to,
  icon: Icon,
  tone,
  title,
  desc,
  disabled = false
}: {
  to: string;
  icon: LucideIcon;
  tone: QuickStartTone;
  title: string;
  desc: string;
  disabled?: boolean;
}) {
  const body = (
    <span className="flex w-full items-start gap-2 rounded-md border border-transparent px-2 py-1.5 transition hover:border-border hover:bg-surface">
      <span
        className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md ${QS_TONE[tone]}`}
      >
        <Icon size={13} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-text">{title}</span>
        <span className="mt-0.5 block line-clamp-2 text-[11px] leading-snug text-muted">
          {desc}
        </span>
      </span>
    </span>
  );
  if (disabled) {
    return (
      <li>
        <div className="cursor-not-allowed opacity-50">{body}</div>
      </li>
    );
  }
  return (
    <li>
      <Link to={to} className="block">
        {body}
      </Link>
    </li>
  );
}

/* ── Shared bits ───────────────────────────────────────────────── */

function SectionHead({ title }: { title: string }) {
  return <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</h3>;
}

function SubField({
  label,
  right,
  children
}: {
  label: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted/80">
          {label}
        </span>
        {right}
      </div>
      {children}
    </div>
  );
}

function sceneStatus(scene: Room | null): SceneStatus {
  if (!scene) return "none";
  if (scene.status === "frozen") return "frozen";
  if (scene.sealed_at) return "sealed";
  return "active";
}

function SceneStatusPill({ status }: { status: SceneStatus }) {
  const { t } = useI18n();
  const map: Record<SceneStatus, { tone: PillTone; label: string }> = {
    active: { tone: "brand", label: t("home.story.scene.unsealed") },
    sealed: { tone: "success", label: t("home.story.scene.sealed") },
    frozen: { tone: "danger", label: t("home.story.scene.frozen") },
    none: { tone: "neutral", label: t("home.story.scene.notStarted") }
  };
  const cfg = map[status];
  return (
    <StatusPill tone={cfg.tone} dot>
      {cfg.label}
    </StatusPill>
  );
}

// Suppress unused-import for DEFAULT_PERSONA_COLOR (kept to mirror sibling components).
void DEFAULT_PERSONA_COLOR;
