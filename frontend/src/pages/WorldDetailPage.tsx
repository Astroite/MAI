import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CalendarDays,
  ChevronRight,
  CircleDot,
  Clock3,
  Eye,
  Flag,
  Heart,
  Layers,
  Lock,
  MapPin,
  Pencil,
  Plus,
  ScrollText,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  X
} from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { api } from "../api";
import { PersonaIcon } from "../components/PersonaIcon";
import { PersonaTemplatePicker } from "../components/PersonaTemplatePicker";
import { useConfirm } from "../components/ConfirmDialog";
import { toast } from "../components/Toaster";
import { SceneInspectorDialog } from "./world/SceneInspectorDialog";
import type {
  PersonaTemplate,
  SceneTimelineEntry,
  TimelineEventType,
  WorldCharacter,
  WorldCharacterKind,
  SceneRosterEntry,
  WorldMemoryOverview,
  WorldRelationshipEdge,
  WorldState,
  WorldTimelineEvent
} from "../types";
import { COVER_PALETTE } from "../constants/colors";
import { queryKeys } from "../queryKeys";
import { useI18n } from "../i18n";

type WorldTab = "overview" | "timeline" | "bible" | "characters" | "relationships" | "memories" | "scenes";
type TimelineFilter = "all" | TimelineEventType;

export function WorldDetailPage() {
  const { worldId = "" } = useParams();
  const { t } = useI18n();
  const world = useQuery({
    queryKey: queryKeys.world(worldId),
    queryFn: () => api.world(worldId),
    enabled: Boolean(worldId)
  });
  const timeline = useQuery({
    queryKey: queryKeys.worldTimeline(worldId),
    queryFn: () => api.worldTimeline(worldId),
    enabled: Boolean(worldId)
  });
  const worldState = useQuery({
    queryKey: queryKeys.worldState(worldId),
    queryFn: () => api.worldState(worldId),
    enabled: Boolean(worldId)
  });
  const aiTemplates = useQuery({
    // Story-world characters bind to user-authored persona templates. Built-in
    // templates (架构师, 性能批评者 …) are written for discussion rooms and
    // their identities don't make sense as story characters — the user should
    // duplicate-then-edit a built-in if they want to derive from one.
    queryKey: queryKeys.personaTemplates.discussantUser,
    queryFn: () => api.personaTemplates("discussant", false)
  });

  const [addingCharacter, setAddingCharacter] = useState(false);
  const [batchPickerOpen, setBatchPickerOpen] = useState(false);
  const [creatingScene, setCreatingScene] = useState(false);
  const [inspectingScene, setInspectingScene] = useState<SceneTimelineEntry | null>(null);
  const [activeTab, setActiveTab] = useState<WorldTab>("overview");

  const inspectorMembers = useQuery({
    queryKey: queryKeys.sceneMembers(inspectingScene?.id),
    queryFn: () => api.sceneMembers(inspectingScene!.id),
    enabled: Boolean(inspectingScene)
  });

  // "World has activity" = any sealed scene OR any timeline entry with messages.
  // Used to decide whether character edits should show a stronger warning
  // (since the LLM has already produced memories under the old archetype).
  const worldHasActivity = useMemo(
    () =>
      (timeline.data ?? []).some(
        (scene) => scene.sealed_at !== null || (scene.message_count ?? 0) > 0
      ),
    [timeline.data]
  );

  const queryClient = useQueryClient();
  const batchAdd = useMutation({
    mutationFn: async (templates: PersonaTemplate[]) => {
      // Sequential rather than Promise.all: a 5-character batch hitting
      // SQLite at the same time can race against the WAL writer; the cost
      // of going one-by-one is trivial for a UI flow this size.
      const created: WorldCharacter[] = [];
      for (const tpl of templates) {
        const character = await api.createWorldCharacter(worldId, {
          kind: "ai",
          name: tpl.name,
          identity: tpl.identity,
          brief: tpl.description,
          // Snapshot the template's system_prompt into core_identity so the
          // character carries its own (editable) prompt — same convention as
          // the inline AddCharacterForm path.
          core_identity: tpl.system_prompt,
          persona_template_id: tpl.id,
          color: tpl.color,
          icon: tpl.icon
        });
        created.push(character);
      }
      return created;
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.world(worldId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.worldState(worldId) });
      toast.success(t("worldDetail.batchAdded", { count: created.length }));
      setBatchPickerOpen(false);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err))
  });

  if (world.isLoading || !world.data) {
    return (
      <div className="px-6 py-10 text-center text-sm text-muted">
        {world.isError ? t("worldDetail.loadError") : t("common.loading")}
      </div>
    );
  }

  const stateData = worldState.data;
  const data = stateData?.world ?? world.data;
  const characters = data.characters;
  const activeCharacters = characters.filter((c) => c.status === "active");
  const scenes = stateData?.scenes ?? timeline.data ?? [];
  const bible =
    stateData?.bible ??
    ({
      summary: data.synopsis,
      genre: "",
      tone: "",
      era: "",
      current_date_label: "",
      current_location: "",
      background: data.setting,
      history: [],
      locations: [],
      factions: [],
      rules: [],
      taboos: [],
      current_arc: null,
      plot_hooks: []
    } satisfies NonNullable<WorldState["bible"]>);
  const recentScene = stateData?.recent_scene ?? (scenes.length > 0 ? scenes[scenes.length - 1] : null);
  const openScene =
    stateData?.open_scene ??
    [...scenes].reverse().find((scene) => scene.sealed_at === null && scene.status !== "archived") ??
    null;
  const currentArc = isRecord(bible.current_arc) ? bible.current_arc : null;
  const currentArcTitle = textValue(currentArc?.title) || t("worldDetail.noCurrentArc");
  const currentConflict = textValue(currentArc?.current_conflict) || textValue(currentArc?.currentConflict);
  const currentGoal = textValue(currentArc?.current_goal) || textValue(currentArc?.currentGoal);
  const currentTime = bible.current_date_label || data.calendar_hint || t("worldDetail.timeUnset");
  const currentLocation = bible.current_location || t("worldDetail.locationUnset");

  return (
    <div className="space-y-4">
      <div>
        <Link to="/worlds" className="inline-flex items-center gap-1 text-xs text-muted hover:text-text">
          <ArrowLeft size={12} />
          {t("worldDetail.backToWorlds")}
        </Link>
      </div>

      <header className="panel overflow-hidden">
        <div className="flex flex-wrap items-start gap-4 p-4">
          <span
            aria-hidden
            className="grid h-14 w-14 flex-shrink-0 place-items-center rounded-lg text-white shadow-card"
            style={{ background: data.cover_color }}
          >
            <Sparkles size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold">{data.name}</h1>
              {openScene ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs text-warning">
                  <CircleDot size={11} />
                  {t("worldDetail.openSceneBadge", { n: openScene.scene_index })}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-xs text-success">
                  <Lock size={11} />
                  {t("worldDetail.noOpenSceneBadge")}
                </span>
              )}
            </div>
            <p className="mt-1 max-w-3xl text-sm text-text">
              {bible.summary || data.synopsis || t("worldDetail.noSynopsisState")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-1">
                <CalendarDays size={12} />
                {currentTime}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-1">
                <Flag size={12} />
                {currentArcTitle}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-1">
                <MapPin size={12} />
                {currentLocation}
              </span>
            </div>
          </div>
          <div className="flex flex-shrink-0 flex-wrap gap-2">
            {openScene ? (
              <Link className="btn btn-primary" to={`/rooms/${openScene.id}`}>
                <ChevronRight size={16} />
                {t("worldDetail.continueScene")}
              </Link>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setActiveTab("scenes");
                  setCreatingScene(true);
                }}
                disabled={activeCharacters.length === 0}
                title={activeCharacters.length === 0 ? t("worldDetail.needCharacterTitle") : ""}
              >
                <Plus size={16} />
                {t("worldDetail.startNextScene")}
              </button>
            )}
            <button type="button" className="btn" onClick={() => setActiveTab("bible")}>
              <Pencil size={16} />
              {t("worldDetail.editWorldState")}
            </button>
          </div>
        </div>

        <div className="grid border-t border-border bg-surface/70 sm:grid-cols-2 lg:grid-cols-4">
          <WorldStatusCard
            icon={<Clock3 size={15} />}
            label={t("worldDetail.statusRecentScene")}
            value={recentScene ? t("worldDetail.sceneAct", { n: recentScene.scene_index }) : t("worldDetail.noScenesShort")}
            detail={recentScene?.title ?? t("worldDetail.noRecentSceneDetail")}
          />
          <WorldStatusCard
            icon={<Flag size={15} />}
            label={t("worldDetail.statusMainConflict")}
            value={currentConflict || t("worldDetail.mainConflictUnset")}
            detail={currentGoal || t("worldDetail.mainGoalUnset")}
          />
          <WorldStatusCard
            icon={<BookOpen size={15} />}
            label={t("worldDetail.statusHooks")}
            value={t("worldDetail.hookCount", { count: stateData?.unresolved_hooks_count ?? 0 })}
            detail={t("worldDetail.recentRelationChanges", {
              count: stateData?.recent_relationship_changes_count ?? 0
            })}
          />
          <WorldStatusCard
            icon={<Users size={15} />}
            label={t("worldDetail.statusActiveCharacters")}
            value={t("worldDetail.characterCountValue", { count: activeCharacters.length })}
            detail={activeCharacters.slice(0, 3).map((c) => c.name).join(" / ") || t("worldDetail.noCharactersShort")}
          />
        </div>
      </header>

      <WorldTabNav
        activeTab={activeTab}
        onChange={setActiveTab}
        scenesCount={scenes.length}
        charactersCount={activeCharacters.length}
        memoriesCount={stateData?.memories.length ?? 0}
        relationshipsCount={stateData?.relationships.length ?? 0}
        eventsCount={stateData?.timeline_events.length ?? 0}
      />

      <section className="panel p-4">
        {activeTab === "overview" && (
          <OverviewTab
            bible={bible}
            recentScene={recentScene}
            openScene={openScene}
            activeCharacters={activeCharacters}
            memories={stateData?.memories ?? []}
            relationships={stateData?.relationships ?? []}
            onOpenScene={(scene) => setInspectingScene(scene)}
            onGoToTab={setActiveTab}
          />
        )}
        {activeTab === "timeline" && (
          <TimelineTab
            worldId={worldId}
            scenes={scenes}
            events={stateData?.timeline_events ?? []}
            characters={characters}
            bible={bible}
            onInspectScene={(scene) => setInspectingScene(scene)}
          />
        )}
        {activeTab === "bible" && <WorldBibleTab worldId={worldId} bible={bible} />}
        {activeTab === "characters" && (
          <CharactersTab
            worldId={worldId}
            characters={characters}
            activeCharacters={activeCharacters}
            templates={aiTemplates.data ?? []}
            worldHasActivity={worldHasActivity}
            addingCharacter={addingCharacter}
            setAddingCharacter={setAddingCharacter}
            batchPickerOpen={batchPickerOpen}
            setBatchPickerOpen={setBatchPickerOpen}
            batchAddPending={batchAdd.isPending}
            onBatchPick={(picked) => batchAdd.mutate(picked)}
          />
        )}
        {activeTab === "relationships" && (
          <RelationshipsTab relationships={stateData?.relationships ?? []} scenes={scenes} />
        )}
        {activeTab === "memories" && (
          <MemoriesTab memories={stateData?.memories ?? []} scenes={scenes} />
        )}
        {activeTab === "scenes" && (
          <ScenesTab
            worldId={worldId}
            scenes={scenes}
            activeCharacters={activeCharacters}
            creatingScene={creatingScene}
            setCreatingScene={setCreatingScene}
            onInspectScene={(scene) => setInspectingScene(scene)}
          />
        )}
      </section>

      <SceneInspectorDialog
        open={inspectingScene !== null}
        onOpenChange={(open) => {
          if (!open) setInspectingScene(null);
        }}
        worldId={worldId}
        scene={inspectingScene}
        rosterCharacters={
          inspectingScene && inspectorMembers.data
            ? characters.filter((c) =>
                inspectorMembers.data!.some((m) => m.world_character_id === c.id)
              )
            : []
        }
      />
    </div>
  );
}

function WorldStatusCard({
  icon,
  label,
  value,
  detail
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="min-w-0 border-t border-border px-4 py-3 first:border-t-0 sm:border-l sm:border-t-0 sm:first:border-l-0">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 truncate text-sm font-semibold text-text">{value}</div>
      <div className="mt-0.5 truncate text-xs text-muted">{detail}</div>
    </div>
  );
}

function WorldTabNav({
  activeTab,
  onChange,
  scenesCount,
  charactersCount,
  memoriesCount,
  relationshipsCount,
  eventsCount
}: {
  activeTab: WorldTab;
  onChange: (tab: WorldTab) => void;
  scenesCount: number;
  charactersCount: number;
  memoriesCount: number;
  relationshipsCount: number;
  eventsCount: number;
}) {
  const { t } = useI18n();
  const tabs: Array<{ id: WorldTab; label: string; count?: number }> = [
    { id: "overview", label: t("worldDetail.tab.overview") },
    { id: "timeline", label: t("worldDetail.tab.timeline"), count: scenesCount + eventsCount },
    { id: "bible", label: t("worldDetail.tab.bible") },
    { id: "characters", label: t("worldDetail.tab.characters"), count: charactersCount },
    { id: "relationships", label: t("worldDetail.tab.relationships"), count: relationshipsCount },
    { id: "memories", label: t("worldDetail.tab.memories"), count: memoriesCount },
    { id: "scenes", label: t("worldDetail.tab.scenes"), count: scenesCount }
  ];
  return (
    <nav className="mai-scrollbar flex gap-1 overflow-x-auto rounded-lg border border-border bg-panel p-1 shadow-card">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`h-8 flex-shrink-0 rounded-md px-3 text-xs font-medium transition ${
            activeTab === tab.id
              ? "bg-brand text-white"
              : "text-muted hover:bg-surface hover:text-text"
          }`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {typeof tab.count === "number" && <span className="ml-1 opacity-80">{tab.count}</span>}
        </button>
      ))}
    </nav>
  );
}

function OverviewTab({
  bible,
  recentScene,
  openScene,
  activeCharacters,
  memories,
  relationships,
  onOpenScene,
  onGoToTab
}: {
  bible: WorldState["bible"];
  recentScene: SceneTimelineEntry | null;
  openScene: SceneTimelineEntry | null;
  activeCharacters: WorldCharacter[];
  memories: WorldMemoryOverview[];
  relationships: WorldRelationshipEdge[];
  onOpenScene: (scene: SceneTimelineEntry) => void;
  onGoToTab: (tab: WorldTab) => void;
}) {
  const { t } = useI18n();
  const currentArc = isRecord(bible.current_arc) ? bible.current_arc : null;
  const latestMemories = memories.slice(0, 4);
  const latestRelations = relationships.slice(0, 3);
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
      <div className="space-y-4">
        <section className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Flag size={16} className="text-muted" />
              {t("worldDetail.overviewMainline")}
            </h2>
            <button type="button" className="btn btn-sm" onClick={() => onGoToTab("bible")}>
              <Pencil size={13} />
              {t("common.edit")}
            </button>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <StateField label={t("worldDetail.arcTitle")} value={textValue(currentArc?.title) || t("worldDetail.noCurrentArc")} />
            <StateField label={t("worldDetail.arcStatus")} value={textValue(currentArc?.status) || t("worldDetail.arcStatusUnset")} />
            <StateField label={t("worldDetail.currentConflict")} value={textValue(currentArc?.current_conflict) || textValue(currentArc?.currentConflict) || t("worldDetail.mainConflictUnset")} />
            <StateField label={t("worldDetail.currentGoalLabel")} value={textValue(currentArc?.current_goal) || textValue(currentArc?.currentGoal) || t("worldDetail.mainGoalUnset")} />
          </div>
        </section>

        <section className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Clock3 size={16} className="text-muted" />
              {t("worldDetail.overviewRecentScene")}
            </h2>
            <button type="button" className="btn btn-sm" onClick={() => onGoToTab("scenes")}>
              <ChevronRight size={13} />
              {t("worldDetail.viewScenes")}
            </button>
          </div>
          {recentScene ? (
            <div className="mt-3 rounded-md bg-surface p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted">
                  {t("worldDetail.sceneAct", { n: recentScene.scene_index })}
                </span>
                {recentScene.sealed_at ? (
                  <span className="inline-flex items-center gap-1 text-xs text-success">
                    <Lock size={12} />
                    {t("worldDetail.sceneSealed")}
                  </span>
                ) : (
                  <span className="text-xs text-warning">{t("worldDetail.sceneOpen")}</span>
                )}
              </div>
              <div className="mt-1 text-sm font-semibold">{recentScene.title}</div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                {recentScene.in_world_time_start && <span>{recentScene.in_world_time_start}</span>}
                <span>{t("worldDetail.sceneCharacters", { count: recentScene.member_count })}</span>
                <span>{t("worldDetail.sceneMessages", { count: recentScene.message_count })}</span>
              </div>
              <div className="mt-3 flex gap-2">
                <Link className="btn btn-sm" to={`/rooms/${recentScene.id}`}>
                  <ChevronRight size={13} />
                  {openScene?.id === recentScene.id ? t("worldDetail.continueScene") : t("worldDetail.openScene")}
                </Link>
                {recentScene.sealed_at && (
                  <button type="button" className="btn btn-sm" onClick={() => onOpenScene(recentScene)}>
                    <Eye size={13} />
                    {t("worldDetail.sceneOutput")}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <EmptyState text={t("worldDetail.noScenes")} />
          )}
        </section>
      </div>

      <aside className="space-y-4">
        <section className="rounded-md border border-border p-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Users size={16} className="text-muted" />
            {t("worldDetail.activeCharacters")}
          </h2>
          <ul className="mt-3 space-y-2">
            {activeCharacters.length === 0 && <li><EmptyState text={t("worldDetail.noCharacters")} /></li>}
            {activeCharacters.slice(0, 5).map((character) => (
              <li key={character.id} className="flex items-center gap-2 rounded-md bg-surface px-2 py-1.5">
                <PersonaIcon icon={character.icon} color={character.color} size={24} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{character.name}</div>
                  <div className="truncate text-xs text-muted">
                    {character.goals_text || character.identity || character.brief || t("worldDetail.characterStateUnknown")}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-md border border-border p-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <ScrollText size={16} className="text-muted" />
            {t("worldDetail.recentMemories")}
          </h2>
          <ul className="mt-3 space-y-2">
            {latestMemories.length === 0 && <li><EmptyState text={t("worldDetail.noMemories")}/></li>}
            {latestMemories.map((memory) => (
              <li key={memory.id} className="rounded-md bg-surface px-2 py-1.5 text-xs">
                <div className="font-medium text-text">{memory.character_name}</div>
                <div className="mt-0.5 line-clamp-2 text-muted">{memory.content}</div>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-md border border-border p-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Heart size={16} className="text-muted" />
            {t("worldDetail.recentRelationships")}
          </h2>
          <ul className="mt-3 space-y-2">
            {latestRelations.length === 0 && <li><EmptyState text={t("worldDetail.noRelationships")}/></li>}
            {latestRelations.map((relation) => (
              <li key={relation.id} className="rounded-md bg-surface px-2 py-1.5 text-xs">
                <div className="font-medium text-text">
                  {relation.from_character_name} {"->"} {relation.to_character_name}
                </div>
                <div className="mt-0.5 text-muted">
                  {relation.label || t("worldDetail.relationshipUnnamed")} {relation.sentiment >= 0 ? "+" : ""}
                  {relation.sentiment.toFixed(2)}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  );
}

function StateField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 whitespace-pre-wrap text-sm text-text">{value}</div>
    </div>
  );
}

function TimelineTab({
  worldId,
  scenes,
  events,
  characters,
  bible,
  onInspectScene
}: {
  worldId: string;
  scenes: SceneTimelineEntry[];
  events: WorldTimelineEvent[];
  characters: WorldCharacter[];
  bible: WorldState["bible"];
  onInspectScene: (scene: SceneTimelineEntry) => void;
}) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [dateLabel, setDateLabel] = useState("");
  const create = useMutation({
    mutationFn: () =>
      api.createWorldTimelineEvent(worldId, {
        type: "history",
        title: title.trim(),
        summary: summary.trim(),
        date_label: dateLabel.trim(),
        source: "user",
        status: "committed"
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.worldState(worldId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.worldTimelineEvents(worldId) });
      setTitle("");
      setSummary("");
      setDateLabel("");
      setAdding(false);
      toast.success(t("worldDetail.timelineEventCreated"));
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err))
  });
  const canSubmit = title.trim().length > 0;
  const historyEvents = events.filter((event) => event.type === "history");
  const stateEvents = events.filter((event) => event.type !== "history");
  const showEvents = filter === "all" || filter !== "scene";
  const showScenes = filter === "all" || filter === "scene";
  const filteredHistory = filter === "all" ? historyEvents : historyEvents.filter((event) => event.type === filter);
  const filteredStateEvents = filter === "all" ? stateEvents : stateEvents.filter((event) => event.type === filter);
  const currentArc = isRecord(bible.current_arc) ? bible.current_arc : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {TIMELINE_FILTERS.map((item) => (
            <button
              key={item}
              type="button"
              className={`h-8 rounded-md px-3 text-xs font-medium ${
                filter === item ? "bg-brand text-white" : "border border-border text-muted hover:bg-surface"
              }`}
              onClick={() => setFilter(item)}
            >
              {item === "all" ? t("worldDetail.timelineFilter.all") : t(`worldDetail.timelineType.${item}`)}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-sm" onClick={() => setAdding((value) => !value)}>
          <Plus size={13} />
          {adding ? t("common.collapse") : t("worldDetail.addHistoryEvent")}
        </button>
      </div>

      {adding && (
        <form
          className="space-y-2 rounded-md border border-dashed border-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) create.mutate();
          }}
        >
          <div className="grid gap-2 md:grid-cols-[180px_minmax(0,1fr)]">
            <input
              className="input"
              placeholder={t("worldDetail.timelineDatePlaceholder")}
              value={dateLabel}
              onChange={(event) => setDateLabel(event.target.value)}
            />
            <input
              className="input"
              placeholder={t("worldDetail.timelineTitlePlaceholder")}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </div>
          <textarea
            className="textarea w-full"
            rows={2}
            placeholder={t("worldDetail.timelineSummaryPlaceholder")}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-sm" onClick={() => setAdding(false)}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={!canSubmit || create.isPending}>
              {create.isPending ? t("worldDetail.saving") : t("common.save")}
            </button>
          </div>
        </form>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        {showEvents && (
          <TimelineSection title={t("worldDetail.timelineHistory")} icon={<BookOpen size={15} />}>
            {filteredHistory.length === 0 ? (
              <EmptyState text={t("worldDetail.noHistoryEvents")} />
            ) : (
              filteredHistory.map((event) => (
                <TimelineEventCard key={event.id} event={event} characters={characters} />
              ))
            )}
          </TimelineSection>
        )}
        {showScenes && (
          <TimelineSection title={t("worldDetail.timelineScenes")} icon={<Clock3 size={15} />}>
            {scenes.length === 0 ? (
              <EmptyState text={t("worldDetail.noScenes")} />
            ) : (
              <SceneList scenes={scenes} onInspectScene={onInspectScene} compact />
            )}
          </TimelineSection>
        )}
        {showEvents && (
          <TimelineSection title={t("worldDetail.timelineMainline")} icon={<Flag size={15} />}>
            <div className="rounded-md bg-surface px-3 py-2 text-sm">
              <div className="font-medium text-text">
                {textValue(currentArc?.title) || t("worldDetail.noCurrentArc")}
              </div>
              <div className="mt-1 whitespace-pre-wrap text-xs text-muted">
                {textValue(currentArc?.summary) || t("worldDetail.noArcSummary")}
              </div>
            </div>
            {filteredStateEvents.map((event) => (
              <TimelineEventCard key={event.id} event={event} characters={characters} />
            ))}
            {filteredStateEvents.length === 0 && <EmptyState text={t("worldDetail.noStateEvents")} />}
          </TimelineSection>
        )}
      </div>
    </div>
  );
}

const TIMELINE_FILTERS: TimelineFilter[] = [
  "all",
  "history",
  "scene",
  "memory",
  "relationship",
  "plot_hook",
  "arc_update"
];

function TimelineSection({
  title,
  icon,
  children
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2 rounded-md border border-border p-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
        {icon}
        {title}
      </h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function TimelineEventCard({
  event,
  characters
}: {
  event: WorldTimelineEvent;
  characters: WorldCharacter[];
}) {
  const { t } = useI18n();
  const related = event.related_character_ids
    .map((id) => characters.find((character) => character.id === id))
    .filter(Boolean) as WorldCharacter[];
  return (
    <article className="rounded-md border border-border bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted">{event.date_label || t("worldDetail.dateUnset")}</span>
        <span className="rounded-full border border-border bg-panel px-2 py-0.5 text-xs text-muted">
          {t(`worldDetail.timelineType.${event.type}`)}
        </span>
        <span className={`text-xs ${event.status === "committed" ? "text-success" : "text-warning"}`}>
          {t(`worldDetail.stateStatus.${event.status}`)}
        </span>
      </div>
      <div className="mt-1 text-sm font-semibold">{event.title}</div>
      {event.summary && <div className="mt-1 whitespace-pre-wrap text-xs text-muted">{event.summary}</div>}
      {related.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {related.map((character) => (
            <span key={character.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-panel px-1.5 py-0.5 text-xs text-muted">
              <PersonaIcon icon={character.icon} color={character.color} size={14} />
              {character.name}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

function WorldBibleTab({ worldId, bible }: { worldId: string; bible: WorldState["bible"] }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const currentArc = isRecord(bible.current_arc) ? bible.current_arc : {};
  const [summary, setSummary] = useState(bible.summary);
  const [background, setBackground] = useState(bible.background);
  const [currentDate, setCurrentDate] = useState(bible.current_date_label);
  const [currentLocation, setCurrentLocation] = useState(bible.current_location);
  const [arcTitle, setArcTitle] = useState(textValue(currentArc.title));
  const [arcSummary, setArcSummary] = useState(textValue(currentArc.summary));
  const [arcConflict, setArcConflict] = useState(textValue(currentArc.current_conflict) || textValue(currentArc.currentConflict));
  const [arcGoal, setArcGoal] = useState(textValue(currentArc.current_goal) || textValue(currentArc.currentGoal));
  const [arcStatus, setArcStatus] = useState(textValue(currentArc.status) || "setup");

  useEffect(() => {
    const nextArc = isRecord(bible.current_arc) ? bible.current_arc : {};
    setSummary(bible.summary);
    setBackground(bible.background);
    setCurrentDate(bible.current_date_label);
    setCurrentLocation(bible.current_location);
    setArcTitle(textValue(nextArc.title));
    setArcSummary(textValue(nextArc.summary));
    setArcConflict(textValue(nextArc.current_conflict) || textValue(nextArc.currentConflict));
    setArcGoal(textValue(nextArc.current_goal) || textValue(nextArc.currentGoal));
    setArcStatus(textValue(nextArc.status) || "setup");
  }, [bible]);

  const update = useMutation({
    mutationFn: () =>
      api.updateWorldBible(worldId, {
        summary: summary.trim(),
        background: background.trim(),
        current_date_label: currentDate.trim(),
        current_location: currentLocation.trim(),
        current_arc: {
          ...currentArc,
          title: arcTitle.trim(),
          summary: arcSummary.trim(),
          current_conflict: arcConflict.trim(),
          current_goal: arcGoal.trim(),
          status: arcStatus,
          updated_at: new Date().toISOString()
        }
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.world(worldId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.worlds });
      void queryClient.invalidateQueries({ queryKey: queryKeys.worldState(worldId) });
      toast.success(t("worldDetail.bibleSaved"));
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err))
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate();
      }}
    >
      <section className="grid gap-3 lg:grid-cols-2">
        <LabeledField label={t("worldDetail.bibleSummary")}>
          <textarea className="textarea w-full" rows={3} value={summary} onChange={(event) => setSummary(event.target.value)} />
        </LabeledField>
        <div className="grid gap-3 sm:grid-cols-2">
          <LabeledField label={t("worldDetail.currentDate")}>
            <input className="input w-full" value={currentDate} onChange={(event) => setCurrentDate(event.target.value)} />
          </LabeledField>
          <LabeledField label={t("worldDetail.currentLocation")}>
            <input className="input w-full" value={currentLocation} onChange={(event) => setCurrentLocation(event.target.value)} />
          </LabeledField>
        </div>
      </section>

      <LabeledField label={t("worldDetail.bibleBackground")}>
        <textarea className="textarea w-full" rows={5} value={background} onChange={(event) => setBackground(event.target.value)} />
      </LabeledField>

      <section className="rounded-md border border-border p-3">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Flag size={16} className="text-muted" />
          {t("worldDetail.bibleCurrentArc")}
        </h2>
        <div className="grid gap-3 lg:grid-cols-2">
          <LabeledField label={t("worldDetail.arcTitle")}>
            <input className="input w-full" value={arcTitle} onChange={(event) => setArcTitle(event.target.value)} />
          </LabeledField>
          <LabeledField label={t("worldDetail.arcStatus")}>
            <select className="input w-full" value={arcStatus} onChange={(event) => setArcStatus(event.target.value)}>
              {["setup", "developing", "climax", "resolved", "paused"].map((status) => (
                <option key={status} value={status}>{t(`worldDetail.arcStatus.${status}`)}</option>
              ))}
            </select>
          </LabeledField>
          <LabeledField label={t("worldDetail.currentConflict")}>
            <input className="input w-full" value={arcConflict} onChange={(event) => setArcConflict(event.target.value)} />
          </LabeledField>
          <LabeledField label={t("worldDetail.currentGoalLabel")}>
            <input className="input w-full" value={arcGoal} onChange={(event) => setArcGoal(event.target.value)} />
          </LabeledField>
        </div>
        <LabeledField label={t("worldDetail.arcSummary")}>
          <textarea className="textarea mt-3 w-full" rows={3} value={arcSummary} onChange={(event) => setArcSummary(event.target.value)} />
        </LabeledField>
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        <BibleListBlock title={t("worldDetail.bibleLocations")} items={bible.locations} empty={t("worldDetail.bibleLocationsEmpty")} />
        <BibleListBlock title={t("worldDetail.bibleFactions")} items={bible.factions} empty={t("worldDetail.bibleFactionsEmpty")} />
        <BibleListBlock title={t("worldDetail.bibleRules")} items={[...bible.rules, ...bible.taboos]} empty={t("worldDetail.bibleRulesEmpty")} />
      </section>

      <div className="flex justify-end">
        <button type="submit" className="btn btn-primary" disabled={update.isPending}>
          {update.isPending ? t("worldDetail.saving") : t("common.save")}
        </button>
      </div>
    </form>
  );
}

function BibleListBlock({
  title,
  items,
  empty
}: {
  title: string;
  items: Array<Record<string, unknown>>;
  empty: string;
}) {
  return (
    <section className="rounded-md border border-border p-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-2 space-y-2">
        {items.length === 0 && <li><EmptyState text={empty} /></li>}
        {items.slice(0, 8).map((item, index) => (
          <li key={textValue(item.id) || index} className="rounded-md bg-surface px-2 py-1.5 text-xs">
            <div className="font-medium text-text">{textValue(item.name) || textValue(item.title) || `#${index + 1}`}</div>
            <div className="mt-0.5 line-clamp-2 text-muted">{textValue(item.description) || textValue(item.content) || textValue(item.status)}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CharactersTab({
  worldId,
  characters,
  activeCharacters,
  templates,
  worldHasActivity,
  addingCharacter,
  setAddingCharacter,
  batchPickerOpen,
  setBatchPickerOpen,
  batchAddPending,
  onBatchPick
}: {
  worldId: string;
  characters: WorldCharacter[];
  activeCharacters: WorldCharacter[];
  templates: PersonaTemplate[];
  worldHasActivity: boolean;
  addingCharacter: boolean;
  setAddingCharacter: (value: boolean | ((value: boolean) => boolean)) => void;
  batchPickerOpen: boolean;
  setBatchPickerOpen: (value: boolean) => void;
  batchAddPending: boolean;
  onBatchPick: (templates: PersonaTemplate[]) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Users size={16} className="text-muted" />
          {t("worldDetail.charactersTitle", { count: activeCharacters.length })}
        </h2>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="btn h-8 px-3 text-xs"
            onClick={() => setBatchPickerOpen(true)}
            disabled={batchAddPending}
            title={t("worldDetail.batchAddTitle")}
          >
            <Layers size={14} />
            {t("worldDetail.batchAdd")}
          </button>
          <button
            type="button"
            className="btn h-8 px-3 text-xs"
            onClick={() => setAddingCharacter((value) => !value)}
          >
            <UserPlus size={14} />
            {addingCharacter ? t("common.collapse") : t("worldDetail.addCharacter")}
          </button>
        </div>
      </div>
      {addingCharacter && (
        <AddCharacterForm worldId={worldId} templates={templates} onDone={() => setAddingCharacter(false)} />
      )}
      <ul className="divide-y divide-border">
        {characters.length === 0 && (
          <li className="py-4 text-center text-xs text-muted">{t("worldDetail.noCharacters")}</li>
        )}
        {characters.map((character) => (
          <CharacterRow
            key={character.id}
            worldId={worldId}
            character={character}
            worldHasActivity={worldHasActivity}
          />
        ))}
      </ul>
      <PersonaTemplatePicker
        mode="multi"
        open={batchPickerOpen}
        onOpenChange={setBatchPickerOpen}
        templates={templates}
        title={t("worldDetail.batchPickerTitle")}
        description={t("worldDetail.batchPickerDescription")}
        onPickMany={onBatchPick}
      />
    </div>
  );
}

function RelationshipsTab({
  relationships,
  scenes
}: {
  relationships: WorldRelationshipEdge[];
  scenes: SceneTimelineEntry[];
}) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<"all" | "strong" | "recent">("all");
  const [selectedId, setSelectedId] = useState<string | null>(relationships[0]?.id ?? null);
  useEffect(() => {
    if (relationships.length > 0 && !relationships.some((relation) => relation.id === selectedId)) {
      setSelectedId(relationships[0].id);
    }
  }, [relationships, selectedId]);
  const recentSceneId = scenes[scenes.length - 1]?.id ?? null;
  const visible = relationships.filter((relation) => {
    if (filter === "strong") return Math.abs(relation.sentiment) >= 0.5;
    if (filter === "recent") return relation.last_updated_scene_id === recentSceneId;
    return true;
  });
  const selected = relationships.find((relation) => relation.id === selectedId) ?? visible[0] ?? null;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(280px,0.75fr)_minmax(0,1.25fr)]">
      <section className="space-y-3 rounded-md border border-border p-3">
        <div className="flex flex-wrap gap-1.5">
          {(["all", "strong", "recent"] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={`h-8 rounded-md px-3 text-xs font-medium ${
                filter === item ? "bg-brand text-white" : "border border-border text-muted hover:bg-surface"
              }`}
              onClick={() => setFilter(item)}
            >
              {t(`worldDetail.relationshipFilter.${item}`)}
            </button>
          ))}
        </div>
        <ul className="space-y-2">
          {visible.length === 0 && <li><EmptyState text={t("worldDetail.noRelationships")} /></li>}
          {visible.map((relation) => (
            <li key={relation.id}>
              <button
                type="button"
                className={`w-full rounded-md border px-3 py-2 text-left transition ${
                  selected?.id === relation.id ? "border-brand bg-brand/5" : "border-border bg-surface hover:border-brand/40"
                }`}
                onClick={() => setSelectedId(relation.id)}
              >
                <div className="flex items-center gap-2">
                  <PersonaIcon icon={relation.from_character_icon} color={relation.from_character_color} size={22} />
                  <span className="truncate text-sm font-medium">{relation.from_character_name}</span>
                  <span className="text-xs text-muted">{"->"}</span>
                  <PersonaIcon icon={relation.to_character_icon} color={relation.to_character_color} size={22} />
                  <span className="truncate text-sm font-medium">{relation.to_character_name}</span>
                </div>
                <div className="mt-1 text-xs text-muted">
                  {relation.label || t("worldDetail.relationshipUnnamed")} {relation.sentiment >= 0 ? "+" : ""}
                  {relation.sentiment.toFixed(2)}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-md border border-border p-3">
        {selected ? (
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <PersonaIcon icon={selected.from_character_icon} color={selected.from_character_color} size={30} />
              <span className="text-sm font-semibold">{selected.from_character_name}</span>
              <ChevronRight size={14} className="text-muted" />
              <PersonaIcon icon={selected.to_character_icon} color={selected.to_character_color} size={30} />
              <span className="text-sm font-semibold">{selected.to_character_name}</span>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <StateField label={t("worldDetail.relationshipLabel")} value={selected.label || t("worldDetail.relationshipUnnamed")} />
              <StateField label={t("worldDetail.relationshipSentiment")} value={`${selected.sentiment >= 0 ? "+" : ""}${selected.sentiment.toFixed(2)}`} />
              <StateField label={t("worldDetail.relationshipSource")} value={selected.last_updated_scene_id ? t("worldDetail.sourceSealCommitted") : t("worldDetail.sourceManual")} />
            </div>
            <div className="mt-3 rounded-md bg-surface p-3 text-sm">
              <div className="text-xs text-muted">{t("worldDetail.relationshipNotes")}</div>
              <div className="mt-1 whitespace-pre-wrap text-text">{selected.notes || t("worldDetail.relationshipNoNotes")}</div>
            </div>
          </div>
        ) : (
          <EmptyState text={t("worldDetail.noRelationships")} />
        )}
      </section>
    </div>
  );
}

function MemoriesTab({
  memories,
  scenes
}: {
  memories: WorldMemoryOverview[];
  scenes: SceneTimelineEntry[];
}) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<"all" | "core" | "episode" | "seal">("all");
  const visible = memories.filter((memory) => {
    if (filter === "core") return memory.kind === "backstory" || memory.kind === "fact";
    if (filter === "episode") return memory.kind === "episode" || memory.kind === "vow";
    if (filter === "seal") return memory.source_scene_id !== null;
    return true;
  });
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {(["all", "core", "episode", "seal"] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={`h-8 rounded-md px-3 text-xs font-medium ${
              filter === item ? "bg-brand text-white" : "border border-border text-muted hover:bg-surface"
            }`}
            onClick={() => setFilter(item)}
          >
            {t(`worldDetail.memoryFilter.${item}`)}
          </button>
        ))}
      </div>
      <ul className="grid gap-2 lg:grid-cols-2">
        {visible.length === 0 && <li><EmptyState text={t("worldDetail.noMemories")} /></li>}
        {visible.map((memory) => {
          const scene = memory.source_scene_id ? sceneById.get(memory.source_scene_id) : null;
          return (
            <li key={memory.id} className="rounded-md border border-border bg-surface px-3 py-2">
              <div className="flex items-center gap-2">
                <PersonaIcon icon={memory.character_icon} color={memory.character_color} size={24} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{memory.character_name}</div>
                  <div className="text-xs text-muted">
                    {t(`sceneInspector.memoryKind.${memory.kind}`)} · {t(`worldDetail.source.${memory.source}`)}
                    {scene && ` · ${t("worldDetail.sceneAct", { n: scene.scene_index })}`}
                  </div>
                </div>
                <span className="ml-auto rounded-full border border-border bg-panel px-2 py-0.5 text-xs text-muted">
                  {memory.salience.toFixed(2)}
                </span>
              </div>
              <div className="mt-2 whitespace-pre-wrap text-sm text-text">{memory.content}</div>
              {memory.in_world_time_at_event && (
                <div className="mt-1 text-xs text-muted">{memory.in_world_time_at_event}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ScenesTab({
  worldId,
  scenes,
  activeCharacters,
  creatingScene,
  setCreatingScene,
  onInspectScene
}: {
  worldId: string;
  scenes: SceneTimelineEntry[];
  activeCharacters: WorldCharacter[];
  creatingScene: boolean;
  setCreatingScene: (value: boolean | ((value: boolean) => boolean)) => void;
  onInspectScene: (scene: SceneTimelineEntry) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ChevronRight size={16} className="text-muted" />
          {t("worldDetail.timelineTitle", { count: scenes.length })}
        </h2>
        <button
          type="button"
          className="btn h-8 px-3 text-xs"
          onClick={() => setCreatingScene((value) => !value)}
          disabled={activeCharacters.length === 0}
          title={activeCharacters.length === 0 ? t("worldDetail.needCharacterTitle") : ""}
        >
          <Plus size={14} />
          {creatingScene ? t("common.collapse") : t("worldDetail.newScene")}
        </button>
      </div>
      {creatingScene && (
        <CreateSceneForm worldId={worldId} characters={activeCharacters} onDone={() => setCreatingScene(false)} />
      )}
      <SceneList scenes={scenes} onInspectScene={onInspectScene} />
    </div>
  );
}

function SceneList({
  scenes,
  onInspectScene,
  compact = false
}: {
  scenes: SceneTimelineEntry[];
  onInspectScene: (scene: SceneTimelineEntry) => void;
  compact?: boolean;
}) {
  const { t } = useI18n();
  return (
    <ul className="space-y-2">
      {scenes.length === 0 && (
        <li className="py-4 text-center text-xs text-muted">{t("worldDetail.noScenes")}</li>
      )}
      {scenes.map((scene) => (
        <li key={scene.id} className="rounded-md border border-border transition hover:border-brand/40">
          <div className="flex items-stretch">
            <Link
              to={`/rooms/${scene.id}`}
              className={`flex min-w-0 flex-1 items-center justify-between gap-2 hover:bg-surface ${compact ? "p-2" : "p-3"}`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted">
                    {t("worldDetail.sceneAct", { n: scene.scene_index })}
                  </span>
                  {scene.sealed_at ? (
                    <span className="inline-flex items-center gap-1 text-xs text-success">
                      <Lock size={12} />
                      {t("worldDetail.sceneSealed")}
                    </span>
                  ) : (
                    <span className="text-xs text-warning">{t("worldDetail.sceneOpen")}</span>
                  )}
                  {scene.status === "frozen" && (
                    <span className="text-xs text-danger">{t("worldDetail.sceneFrozen")}</span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-sm font-medium">{scene.title}</div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                  {scene.in_world_time_start && <span>{scene.in_world_time_start}</span>}
                  <span>{t("worldDetail.sceneCharacters", { count: scene.member_count })}</span>
                  <span>{t("worldDetail.sceneMessages", { count: scene.message_count })}</span>
                </div>
              </div>
              <ChevronRight size={16} className="text-muted" />
            </Link>
            {scene.sealed_at && (
              <button
                type="button"
                className="flex items-center gap-1 border-l border-border px-3 text-xs text-muted hover:bg-surface hover:text-text"
                onClick={() => onInspectScene(scene)}
                title={t("worldDetail.sceneOutputTitle")}
              >
                <Eye size={14} />
                {!compact && t("worldDetail.sceneOutput")}
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-md bg-surface px-3 py-2 text-xs text-muted">{text}</div>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function CharacterRow({
  worldId,
  character,
  worldHasActivity
}: {
  worldId: string;
  character: WorldCharacter;
  worldHasActivity: boolean;
}) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const remove = useMutation({
    mutationFn: () => api.deleteWorldCharacter(worldId, character.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.world(worldId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.worldState(worldId) });
      toast.message(t("worldDetail.characterRetiredToast", { name: character.name }));
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err))
  });
  const dim = character.status !== "active";
  return (
    <li className={`flex items-center gap-3 py-2 ${dim ? "opacity-50" : ""}`}>
      <PersonaIcon icon={character.icon} color={character.color} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{character.name}</span>
          {character.identity && (
            <span className="text-xs text-muted">（{character.identity}）</span>
          )}
          <span
            className={`text-xs uppercase tracking-wide ${
              character.kind === "user" ? "text-accent" : "text-muted"
            }`}
          >
            {character.kind === "user" ? t("worldDetail.kindUser") : t("worldDetail.kindAi")}
          </span>
          {dim && <span className="text-xs text-muted">{t("worldDetail.characterRetired")}</span>}
        </div>
        {character.brief && (
          <div className="truncate text-xs text-muted">{character.brief}</div>
        )}
      </div>
      {character.status === "active" && (
        <>
          <button
            type="button"
            className="btn h-9 w-9 px-0 text-muted hover:text-brand"
            title={t("worldDetail.characterEditTitle")}
            onClick={() => setEditing(true)}
          >
            <Pencil size={16} />
          </button>
          <button
            type="button"
            className="btn h-9 w-9 px-0 text-muted hover:text-danger"
            title={t("worldDetail.characterRetireTitle")}
            onClick={async () => {
              const ok = await confirm({
                title: t("worldDetail.retireConfirmTitle", { name: character.name }),
                description: t("worldDetail.retireConfirmDescription"),
                confirmLabel: t("worldDetail.retireConfirmLabel"),
                danger: true
              });
              if (ok) remove.mutate();
            }}
            disabled={remove.isPending}
          >
            <Trash2 size={16} />
          </button>
        </>
      )}
      <EditCharacterDialog
        worldId={worldId}
        character={character}
        open={editing}
        onOpenChange={setEditing}
        worldHasActivity={worldHasActivity}
      />
    </li>
  );
}

function AddCharacterForm({
  worldId,
  templates,
  onDone
}: {
  worldId: string;
  templates: PersonaTemplate[];
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [kind, setKind] = useState<WorldCharacterKind>("ai");
  const [name, setName] = useState("");
  const [identity, setIdentity] = useState("");
  const [brief, setBrief] = useState("");
  const [coreIdentity, setCoreIdentity] = useState("");
  const [skillsText, setSkillsText] = useState("");
  const [goalsText, setGoalsText] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [color, setColor] = useState(COVER_PALETTE[9]); // 3b82f6
  const [icon, setIcon] = useState<string>("Sparkles");
  const [pickerOpen, setPickerOpen] = useState(false);
  // Track whether the user has hand-edited each field. Picking a template
  // auto-fills only the fields that haven't been touched (or that were
  // last filled BY a previous template selection). This stops switching
  // templates from clobbering deliberate character names like "苏离".
  const userEdited = useRef({
    name: false,
    identity: false,
    brief: false,
    coreIdentity: false
  });

  const selectedTemplate = templateId
    ? templates.find((tpl) => tpl.id === templateId) ?? null
    : null;

  const applyTemplate = (template: PersonaTemplate) => {
    setTemplateId(template.id);
    if (!userEdited.current.name) setName(template.name);
    if (!userEdited.current.identity) setIdentity(template.identity);
    if (!userEdited.current.brief) setBrief(template.description);
    // The template's system_prompt is what actually drives the LLM. Snapshot
    // it into core_identity so the user can see it, edit it, and so the
    // engine relies on a single canonical field per character.
    if (!userEdited.current.coreIdentity) setCoreIdentity(template.system_prompt);
    setColor(template.color || color);
    setIcon(template.icon || icon);
    setPickerOpen(false);
  };

  const create = useMutation({
    mutationFn: () =>
      api.createWorldCharacter(worldId, {
        kind,
        name: name.trim(),
        identity: identity.trim(),
        brief: brief.trim(),
        persona_template_id: kind === "ai" ? templateId : null,
        core_identity: coreIdentity.trim(),
        skills_text: skillsText.trim(),
        goals_text: goalsText.trim(),
        color,
        icon
    }),
    onSuccess: (character) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.world(worldId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.worldState(worldId) });
      toast.success(t("worldDetail.characterAdded", { name: character.name }));
      setName("");
      setIdentity("");
      setBrief("");
      setCoreIdentity("");
      setSkillsText("");
      setGoalsText("");
      setTemplateId(null);
      userEdited.current = { name: false, identity: false, brief: false, coreIdentity: false };
      onDone();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err))
  });
  const canSubmit =
    name.trim().length > 0 && (kind === "user" || templateId !== null);
  return (
    <form
      className="space-y-5 rounded-md border border-dashed border-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        create.mutate();
      }}
    >
      <FormSection label={t("worldDetail.characterType")}>
        <div className="flex gap-1.5 text-xs">
          <button
            type="button"
            className={`rounded px-3 py-1.5 ${
              kind === "ai" ? "bg-brand/10 text-brand" : "border border-border text-muted hover:bg-surface"
            }`}
            onClick={() => setKind("ai")}
          >
            {t("worldDetail.aiCharacter")}
          </button>
          <button
            type="button"
            className={`rounded px-3 py-1.5 ${
              kind === "user" ? "bg-accent/10 text-accent" : "border border-border text-muted hover:bg-surface"
            }`}
            onClick={() => setKind("user")}
          >
            {t("worldDetail.userCharacter")}
          </button>
        </div>
      </FormSection>

      {kind === "ai" && (
        <FormSection
          label={t("worldDetail.personaTemplate")}
          hint={t("worldDetail.personaTemplateHint")}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-left transition hover:border-brand/40"
            onClick={() => setPickerOpen(true)}
          >
            {selectedTemplate ? (
              <>
                <PersonaIcon
                  icon={selectedTemplate.icon}
                  color={selectedTemplate.color}
                  size={32}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{selectedTemplate.name}</div>
                  {selectedTemplate.identity && (
                    <div className="truncate text-xs text-muted">{selectedTemplate.identity}</div>
                  )}
                </div>
                <span className="text-xs text-muted">{t("worldDetail.changeTemplate")}</span>
              </>
            ) : (
              <>
                <span className="grid h-8 w-8 place-items-center rounded-full bg-panel text-muted">
                  ?
                </span>
                <span className="text-sm text-muted">{t("worldDetail.pickTemplate")}</span>
              </>
            )}
          </button>
          <PersonaTemplatePicker
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            templates={templates}
            selectedId={templateId}
            onPick={applyTemplate}
          />
        </FormSection>
      )}

      <FormSection label={t("worldDetail.basics")}>
        <div className="space-y-2.5">
          <LabeledField label={t("worldDetail.characterName")} required>
            <input
              className="input w-full"
              placeholder={t("worldDetail.characterNamePlaceholder")}
              value={name}
              onChange={(event) => {
                userEdited.current.name = true;
                setName(event.target.value);
              }}
              maxLength={120}
              required
            />
          </LabeledField>
          <LabeledField label={t("worldDetail.identity")}>
            <input
              className="input w-full"
              placeholder={t("worldDetail.identityPlaceholder")}
              value={identity}
              onChange={(event) => {
                userEdited.current.identity = true;
                setIdentity(event.target.value);
              }}
              maxLength={120}
            />
          </LabeledField>
          <LabeledField label={t("worldDetail.brief")} hint={t("worldDetail.briefHint")}>
            <input
              className="input w-full"
              placeholder={t("worldDetail.briefPlaceholder")}
              value={brief}
              onChange={(event) => {
                userEdited.current.brief = true;
                setBrief(event.target.value);
              }}
            />
          </LabeledField>
        </div>
      </FormSection>

      {kind === "ai" && (
        <FormSection
          label={t("worldDetail.coreProfile")}
          hint={t("worldDetail.coreProfileHint")}
        >
          <div className="space-y-2.5">
            <LabeledField
              label={t("worldDetail.coreIdentity")}
              hint={t("worldDetail.coreIdentityHint")}
            >
              <textarea
                className="textarea w-full"
                rows={5}
                placeholder={t("worldDetail.coreIdentityPlaceholder")}
                value={coreIdentity}
                onChange={(event) => {
                  userEdited.current.coreIdentity = true;
                  setCoreIdentity(event.target.value);
                }}
              />
            </LabeledField>
            <LabeledField label={t("worldDetail.skills")}>
              <input
                className="input w-full"
                placeholder={t("worldDetail.skillsPlaceholder")}
                value={skillsText}
                onChange={(event) => setSkillsText(event.target.value)}
              />
            </LabeledField>
            <LabeledField label={t("worldDetail.currentGoal")}>
              <input
                className="input w-full"
                placeholder={t("worldDetail.currentGoalPlaceholder")}
                value={goalsText}
                onChange={(event) => setGoalsText(event.target.value)}
              />
            </LabeledField>
          </div>
        </FormSection>
      )}

      <FormSection label={t("worldDetail.appearanceColor")}>
        <div className="flex flex-wrap gap-1.5">
          {COVER_PALETTE.map((value) => (
            <button
              key={value}
              type="button"
              className={`h-7 w-7 rounded-full border-2 transition ${
                color === value ? "border-text scale-110" : "border-border hover:scale-105"
              }`}
              style={{ background: value }}
              onClick={() => setColor(value)}
              aria-label={value}
            />
          ))}
        </div>
      </FormSection>

      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <button type="button" className="btn" onClick={onDone}>
          {t("common.cancel")}
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!canSubmit || create.isPending}
        >
          {create.isPending ? t("worldDetail.adding") : t("worldDetail.addCharacter")}
        </button>
      </div>
    </form>
  );
}

function FormSection({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <header>
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </header>
      {children}
    </section>
  );
}

function LabeledField({
  label,
  hint,
  required,
  children
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="text-xs text-muted">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

function EditCharacterDialog({
  worldId,
  character,
  open,
  onOpenChange,
  worldHasActivity
}: {
  worldId: string;
  character: WorldCharacter;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worldHasActivity: boolean;
}) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [name, setName] = useState(character.name);
  const [identity, setIdentity] = useState(character.identity);
  const [brief, setBrief] = useState(character.brief);
  const [coreIdentity, setCoreIdentity] = useState(character.core_identity);
  const [skillsText, setSkillsText] = useState(character.skills_text);
  const [goalsText, setGoalsText] = useState(character.goals_text);
  const [color, setColor] = useState(character.color);

  // Reset local state when dialog opens for a different character.
  useEffect(() => {
    if (open) {
      setName(character.name);
      setIdentity(character.identity);
      setBrief(character.brief);
      setCoreIdentity(character.core_identity);
      setSkillsText(character.skills_text);
      setGoalsText(character.goals_text);
      setColor(character.color);
    }
  }, [open, character]);

  const update = useMutation({
    mutationFn: () =>
      api.updateWorldCharacter(worldId, character.id, {
        name: name.trim(),
        identity: identity.trim(),
        brief: brief.trim(),
        core_identity: coreIdentity.trim(),
        skills_text: skillsText.trim(),
        goals_text: goalsText.trim(),
        color
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.world(worldId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.worldState(worldId) });
      toast.success(t("worldDetail.characterUpdated", { name: name.trim() || character.name }));
      onOpenChange(false);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err))
  });

  const isAi = character.kind === "ai";
  const canSubmit = name.trim().length > 0;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex h-[85vh] w-[92vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-panel shadow-soft">
          <div className="flex items-start justify-between gap-2 border-b border-border px-5 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <PersonaIcon icon={character.icon} color={color} size={36} />
              <div className="min-w-0">
                <Dialog.Title className="truncate text-base font-semibold text-text">
                  {t("worldDetail.editCharacterProfile")}
                </Dialog.Title>
                <Dialog.Description className="truncate text-xs text-muted">
                  {character.name}
                  {character.identity && `（${character.identity}）`}
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded text-muted hover:bg-surface hover:text-text"
                aria-label={t("common.close")}
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          <form
            className="mai-scrollbar flex-1 space-y-5 overflow-auto px-5 py-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!canSubmit) return;
              update.mutate();
            }}
          >
            {/* Risk banner — always shown when editing, stronger copy when the
                world already has sealed scenes or scene messages. */}
            <div
              className={`flex gap-2 rounded-md border px-3 py-2 text-xs ${
                worldHasActivity
                  ? "border-warning/40 bg-warning/10 text-warning"
                  : "border-border bg-surface text-muted"
              }`}
            >
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="font-medium">
                  {worldHasActivity ? t("worldDetail.editRiskActiveTitle") : t("worldDetail.editRiskSafeTitle")}
                </div>
                <div className="mt-0.5 leading-relaxed">
                  {t("worldDetail.editRiskDescription")}
                </div>
              </div>
            </div>

            <FormSection label={t("worldDetail.basics")}>
              <div className="space-y-2.5">
                <LabeledField label={t("worldDetail.characterName")} required>
                  <input
                    className="input w-full"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={120}
                    required
                  />
                </LabeledField>
                <LabeledField label={t("worldDetail.identity")}>
                  <input
                    className="input w-full"
                    value={identity}
                    onChange={(event) => setIdentity(event.target.value)}
                    maxLength={120}
                  />
                </LabeledField>
                <LabeledField label={t("worldDetail.brief")} hint={t("worldDetail.briefHint")}>
                  <input
                    className="input w-full"
                    value={brief}
                    onChange={(event) => setBrief(event.target.value)}
                  />
                </LabeledField>
              </div>
            </FormSection>

            {isAi && (
              <FormSection
                label={t("worldDetail.coreProfile")}
                hint={t("worldDetail.coreProfileEditHint")}
              >
                <div className="space-y-2.5">
                  <LabeledField label={t("worldDetail.coreIdentity")}>
                    <textarea
                      className="textarea w-full"
                      rows={4}
                      value={coreIdentity}
                      onChange={(event) => setCoreIdentity(event.target.value)}
                    />
                  </LabeledField>
                  <LabeledField label={t("worldDetail.skills")}>
                    <input
                      className="input w-full"
                      value={skillsText}
                      onChange={(event) => setSkillsText(event.target.value)}
                    />
                  </LabeledField>
                  <LabeledField label={t("worldDetail.currentGoal")}>
                    <input
                      className="input w-full"
                      value={goalsText}
                      onChange={(event) => setGoalsText(event.target.value)}
                    />
                  </LabeledField>
                </div>
              </FormSection>
            )}

            <FormSection label={t("worldDetail.appearanceColor")}>
              <div className="flex flex-wrap gap-1.5">
                {COVER_PALETTE.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`h-7 w-7 rounded-full border-2 transition ${
                      color === value ? "border-text scale-110" : "border-border hover:scale-105"
                    }`}
                    style={{ background: value }}
                    onClick={() => setColor(value)}
                    aria-label={value}
                  />
                ))}
              </div>
            </FormSection>
          </form>

          <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
            <Dialog.Close asChild>
              <button type="button" className="btn">
                {t("common.cancel")}
              </button>
            </Dialog.Close>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canSubmit || update.isPending}
              onClick={() => update.mutate()}
            >
              {update.isPending ? t("worldDetail.saving") : t("common.save")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CreateSceneForm({
  worldId,
  characters,
  onDone
}: {
  worldId: string;
  characters: WorldCharacter[];
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [background, setBackground] = useState("");
  const [timeStart, setTimeStart] = useState("");
  const [duration, setDuration] = useState("");
  const initialSelected = useMemo(
    () => new Set(characters.map((c) => c.id)),
    [characters]
  );
  const [selected, setSelected] = useState<Set<string>>(initialSelected);
  const create = useMutation({
    mutationFn: () => {
      const members: SceneRosterEntry[] = characters
        .filter((character) => selected.has(character.id))
        .map((character) => ({ world_character_id: character.id }));
      return api.createScene(worldId, {
        title: title.trim(),
        background: background.trim(),
        in_world_time_start: timeStart.trim(),
        in_world_duration_hint: duration.trim(),
        members
      });
    },
    onSuccess: (state) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.world(worldId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.worldTimeline(worldId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.worldState(worldId) });
      // Story-world scenes intentionally don't yank the user into the
      // discussion-room shell — the timeline is the source of truth and the
      // user can pick when to drop into the scene from the new card.
      toast.success(t("worldDetail.sceneCreated", { n: state.room.scene_index }));
      onDone();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err))
  });
  const canSubmit = title.trim().length > 0 && selected.size > 0;
  return (
    <form
      className="space-y-3 rounded-md border border-dashed border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        create.mutate();
      }}
    >
      <input
        className="input w-full"
        placeholder={t("worldDetail.sceneTitlePlaceholder")}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        required
      />
      <textarea
        className="textarea w-full"
        rows={2}
        placeholder={t("worldDetail.sceneBackgroundPlaceholder")}
        value={background}
        onChange={(event) => setBackground(event.target.value)}
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          className="input"
          placeholder={t("worldDetail.sceneTimePlaceholder")}
          value={timeStart}
          onChange={(event) => setTimeStart(event.target.value)}
        />
        <input
          className="input"
          placeholder={t("worldDetail.sceneDurationPlaceholder")}
          value={duration}
          onChange={(event) => setDuration(event.target.value)}
        />
      </div>
      <div>
        <label className="text-xs font-medium text-muted">{t("worldDetail.sceneRoster")}</label>
        <ul className="mt-1 space-y-1">
          {characters.map((character) => {
            const checked = selected.has(character.id);
            return (
              <li key={character.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-surface">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      const next = new Set(selected);
                      if (event.target.checked) next.add(character.id);
                      else next.delete(character.id);
                      setSelected(next);
                    }}
                  />
                  <PersonaIcon icon={character.icon} color={character.color} size={20} />
                  <span className="text-sm">{character.name}</span>
                  {character.identity && (
                    <span className="text-xs text-muted">（{character.identity}）</span>
                  )}
                  <span className="ml-auto text-xs text-muted">
                    {character.kind === "user" ? t("worldDetail.kindUser") : t("worldDetail.kindAi")}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn h-8 text-xs" onClick={onDone}>
          {t("common.cancel")}
        </button>
        <button
          type="submit"
          className="btn btn-primary h-8 text-xs"
          disabled={!canSubmit || create.isPending}
        >
          {create.isPending ? t("worldDetail.creating") : t("worldDetail.createAndEnter")}
        </button>
      </div>
    </form>
  );
}
