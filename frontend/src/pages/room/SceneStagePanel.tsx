import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Eye,
  Heart,
  MapPin,
  User,
  UserCheck,
  UserX,
  Users
} from "lucide-react";
import { Link } from "react-router-dom";
import { PersonaIcon } from "../../components/PersonaIcon";
import { StatusPill } from "../../components/StatusPill";
import { useI18n } from "../../i18n";
import type { SceneSpeakerContext } from "../../types";
import type { StagePresenceCharacter, StagePresenceView } from "./stagePresence";

export type SceneStagePanelData = {
  view: StagePresenceView;
  selectedStageCharacterId: string | null;
  speakerContext?: SceneSpeakerContext | null;
  stageLoading: boolean;
  stageCueLoading: boolean;
  stageContextError: boolean;
  onSelectStageCharacter: (characterId: string) => void;
};

export function SceneStagePanel({
  view,
  selectedStageCharacterId,
  speakerContext,
  stageLoading,
  stageCueLoading,
  stageContextError,
  onSelectStageCharacter,
  className = "border-b border-border/80 bg-panel px-3 py-3"
}: SceneStagePanelData & { className?: string }) {
  const { t } = useI18n();
  const [panelExpanded, setPanelExpanded] = useState(true);
  const [showExited, setShowExited] = useState(false);
  const selected =
    view.characters.find((character) => character.id === selectedStageCharacterId) ??
    view.presentCharacters[0] ??
    view.characters[0] ??
    null;

  return (
    <section className={className} aria-label={t("room.panel.stage")}>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-text">
            <Users size={15} className="shrink-0 text-brand" />
            <span className="truncate">{t("room.panel.stage")}</span>
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted">
            {view.worldId ? (
              <Link
                to={`/worlds/${view.worldId}`}
                className="inline-flex min-w-0 items-center rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-accent hover:bg-accent/20"
                title={t("room.stage.backToWorld")}
              >
                <span className="truncate">{view.worldName || t("room.stage.unknownWorld")}</span>
              </Link>
            ) : (
              <StatusPill tone="accent">{view.worldName || t("room.stage.unknownWorld")}</StatusPill>
            )}
            <StatusPill tone="brand">
              {view.sceneIndex ? t("room.scene.act", { n: view.sceneIndex }) : t("room.stage.actUnknown")}
            </StatusPill>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {view.sealed && <StatusPill tone="success">{t("room.scene.sealed")}</StatusPill>}
          {view.frozen && <StatusPill tone="warning">{t("room.stage.frozen")}</StatusPill>}
          <button
            type="button"
            className="grid h-7 w-7 place-items-center rounded text-muted transition hover:bg-surface hover:text-brand"
            onClick={() => setPanelExpanded((value) => !value)}
            title={panelExpanded ? t("common.collapse") : t("common.expand")}
            aria-expanded={panelExpanded}
          >
            {panelExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {!panelExpanded ? (
        <div className="mt-3 min-w-0 rounded-md border border-border/80 bg-surface/70 px-3 py-2">
          <div className="line-clamp-1 text-sm font-semibold leading-snug text-text">{view.sceneTitle}</div>
          <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
            <StatusPill tone="success">
              {t("room.stage.presentCount", { count: view.presentCharacters.length })}
            </StatusPill>
            <StatusPill tone="neutral">
              {t("room.stage.exitedCount", { count: view.exitedCharacters.length })}
            </StatusPill>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-3 min-w-0 rounded-md border border-border/80 bg-surface/70 px-3 py-2">
            <div className="line-clamp-2 text-sm font-semibold leading-snug text-text">{view.sceneTitle}</div>
            <div className="mt-2 grid gap-1.5 text-xs text-muted">
              <StageMeta icon={<Clock size={13} />} value={view.currentTime || t("room.stage.timeUnknown")} />
              <StageMeta
                icon={<MapPin size={13} />}
                value={view.currentLocation || t("room.stage.locationUnknown")}
              />
            </div>
            {(stageLoading || stageContextError) && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-warning">
                {stageContextError && <AlertTriangle size={13} />}
                <span>{stageContextError ? t("room.stage.contextFallback") : t("room.stage.loading")}</span>
              </div>
            )}
          </div>

          <div className="mt-3">
            <div className="mb-2 flex items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-muted">{t("room.stage.present")}</span>
              <StatusPill tone="success">
                {t("room.stage.presentCount", { count: view.presentCharacters.length })}
              </StatusPill>
            </div>
            <StageRosterList
              characters={view.presentCharacters}
              emptyText={t("room.stage.noPresent")}
              selectedCharacterId={selected?.id ?? null}
              onSelectCharacter={onSelectStageCharacter}
              maxHeightClassName="max-h-64"
            />
          </div>

          <div className="mt-3 border-t border-border/80 pt-2">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded px-1 py-1 text-left text-xs font-semibold text-muted hover:bg-surface hover:text-brand"
              onClick={() => setShowExited((value) => !value)}
              aria-expanded={showExited}
            >
              <span className="inline-flex min-w-0 items-center gap-1.5">
                {showExited ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <span className="truncate">{t("room.stage.exited")}</span>
              </span>
              <StatusPill tone="neutral">
                {t("room.stage.exitedCount", { count: view.exitedCharacters.length })}
              </StatusPill>
            </button>
            {showExited && (
              <div className="mt-2">
                <StageRosterList
                  characters={view.exitedCharacters}
                  emptyText={t("room.stage.noExited")}
                  selectedCharacterId={selected?.id ?? null}
                  onSelectCharacter={onSelectStageCharacter}
                  maxHeightClassName="max-h-40"
                />
              </div>
            )}
          </div>

          <CharacterCuePanel character={selected} speakerContext={speakerContext} cueLoading={stageCueLoading} />
        </>
      )}
    </section>
  );
}

function StageMeta({ icon, value }: { icon: ReactNode; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="shrink-0 text-muted">{icon}</span>
      <span className="truncate">{value}</span>
    </div>
  );
}

function StageRosterList({
  characters,
  emptyText,
  selectedCharacterId,
  onSelectCharacter,
  maxHeightClassName
}: {
  characters: StagePresenceCharacter[];
  emptyText: string;
  selectedCharacterId: string | null;
  onSelectCharacter: (characterId: string) => void;
  maxHeightClassName?: string;
}) {
  if (characters.length === 0) {
    return (
      <div className="rounded border border-dashed border-border/80 px-3 py-2 text-xs text-muted">
        {emptyText}
      </div>
    );
  }

  return (
    <div
      className={`mai-scrollbar flex ${maxHeightClassName ?? "max-h-56"} flex-col gap-1.5 overflow-auto pr-1`}
    >
      {characters.map((character) => (
        <StageCharacterButton
          key={character.id}
          character={character}
          selected={character.id === selectedCharacterId}
          onSelect={() => onSelectCharacter(character.id)}
        />
      ))}
    </div>
  );
}

function StageCharacterButton({
  character,
  selected,
  onSelect
}: {
  character: StagePresenceCharacter;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  const accessLabel = character.canSpeak
    ? t("room.stage.canSpeak")
    : character.canUserSpeakAs
      ? t("room.stage.playable")
      : t("room.stage.cannotSpeak");

  return (
    <button
      type="button"
      className={`min-w-0 rounded-md border px-2 py-2 text-left transition ${
        selected
          ? "border-brand bg-brand/10 shadow-card ring-2 ring-brand/15"
          : "border-border/80 bg-panel hover:border-brand/30 hover:bg-brand/5"
      }`}
      onClick={onSelect}
      title={character.name}
      aria-pressed={selected}
    >
      <div className="flex min-w-0 items-start gap-2">
        <PersonaIcon icon={character.icon} color={character.color} size={30} iconSize={15} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-text">{character.name}</span>
            <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted">
              {character.kind === "ai" ? <Bot size={12} /> : <User size={12} />}
              {character.kind === "ai" ? t("room.stage.ai") : t("room.stage.user")}
            </span>
            {selected && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded bg-brand/10 px-1.5 py-0.5 text-[11px] font-medium text-brand">
                <CheckCircle2 size={11} />
                {t("room.stage.selected")}
              </span>
            )}
          </div>
          <div className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted">
            {character.roleInScene || character.identity || t("room.stage.noRole")}
          </div>
          <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
            <span
              className={`rounded px-1.5 py-0.5 ${
                character.canSpeak || character.canUserSpeakAs
                  ? "bg-success/10 text-success"
                  : "bg-surface text-muted"
              }`}
            >
              {accessLabel}
            </span>
            {character.canSpeak && character.canUserSpeakAs && (
              <span className="rounded bg-brand/10 px-1.5 py-0.5 text-brand">
                {t("room.stage.playable")}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

function CharacterCuePanel({
  character,
  speakerContext,
  cueLoading
}: {
  character: StagePresenceCharacter | null;
  speakerContext?: SceneSpeakerContext | null;
  cueLoading: boolean;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    setExpanded(character?.isPresent ?? true);
  }, [character?.id, character?.isPresent]);

  if (!character) {
    return (
      <div className="mt-3 rounded-md border border-border/80 bg-surface/70 p-3 text-sm text-muted">
        {t("room.stage.noCharacterSelected")}
      </div>
    );
  }
  const memoryCues = speakerContext?.world_character_id === character.id ? speakerContext.memory_cues : [];
  const relationshipCues =
    speakerContext?.world_character_id === character.id ? speakerContext.relationship_cues : [];
  const visibility =
    speakerContext?.world_character_id === character.id ? speakerContext.visibility : null;

  return (
    <aside className="mt-3 min-w-0 rounded-md border border-border/80 bg-surface/70 p-3">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <PersonaIcon icon={character.icon} color={character.color} size={32} iconSize={16} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-text">{character.name}</div>
            <div className="line-clamp-2 text-xs leading-snug text-muted">
              {character.identity || character.roleInScene || t("room.stage.noRole")}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <StatusPill tone={character.isPresent ? "success" : "neutral"} dot>
            {character.isPresent ? t("room.stage.presentStatus") : t("room.stage.exitedStatus")}
          </StatusPill>
          <button
            type="button"
            className="grid h-7 w-7 place-items-center rounded text-muted transition hover:bg-panel hover:text-brand"
            onClick={() => setExpanded((value) => !value)}
            title={expanded ? t("common.collapse") : t("common.expand")}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {expanded && (
        <>
          <div className="mt-3 grid gap-2 text-xs text-muted">
            <CueFact
              icon={<UserCheck size={13} />}
              label={t("room.stage.role")}
              value={character.roleInScene || t("room.stage.noRole")}
            />
            <CueFact
              icon={character.isPresent ? <UserCheck size={13} /> : <UserX size={13} />}
              label={t("room.stage.presence")}
              value={character.isPresent ? t("room.stage.presentStatus") : t("room.stage.exitedStatus")}
            />
            <CueFact
              icon={<Eye size={13} />}
              label={t("room.stage.visibleMessages")}
              value={
                visibility
                  ? t("room.stage.visibleMessagesCount", { count: visibility.visible_message_count })
                  : t("room.stage.visibleMessagesUnavailable")
              }
            />
            <CueFact
              icon={character.kind === "ai" ? <Bot size={13} /> : <User size={13} />}
              label={t("room.stage.speaker")}
              value={
                character.canSpeak
                  ? t("room.stage.canSpeak")
                  : character.canUserSpeakAs
                    ? t("room.stage.playable")
                    : t("room.stage.cannotSpeak")
              }
            />
          </div>

          <div className="mt-3 text-xs">
            <div className="font-semibold text-muted">{t("room.stage.coreIdentity")}</div>
            <ExpandableText
              text={character.coreIdentity || character.brief}
              fallback={t("room.stage.noCoreIdentity")}
              collapsedClassName="line-clamp-3"
              className="mt-1 leading-snug text-text/90"
              limit={140}
            />
          </div>

          <CueList
            title={t("room.stage.memoryCues")}
            icon={<Brain size={13} />}
            loading={cueLoading}
            emptyText={
              character.personaInstanceId ? t("room.stage.noMemoryCues") : t("room.stage.aiCueOnly")
            }
            items={memoryCues.map((cue) => cue.content)}
          />
          <CueList
            title={t("room.stage.relationshipCues")}
            icon={<Heart size={13} />}
            loading={cueLoading}
            emptyText={
              character.personaInstanceId ? t("room.stage.noRelationshipCues") : t("room.stage.aiCueOnly")
            }
            items={relationshipCues.map((cue) =>
              cue.label
                ? `${cue.to_character_name}: ${cue.label} - ${cue.notes}`
                : `${cue.to_character_name}: ${cue.notes}`
            )}
          />
        </>
      )}
    </aside>
  );
}

function CueFact({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded bg-panel/70 px-2 py-1.5">
      <div className="flex items-center gap-1 text-muted">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-0.5 truncate font-medium text-text" title={value}>
        {value}
      </div>
    </div>
  );
}

function CueList({
  title,
  icon,
  loading,
  emptyText,
  items
}: {
  title: string;
  icon: ReactNode;
  loading: boolean;
  emptyText: string;
  items: string[];
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  return (
    <div className="mt-3 min-w-0 rounded border border-border/70 bg-panel/60 text-xs">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left font-semibold text-muted hover:text-brand"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="inline-flex min-w-0 items-center gap-1">
          {icon}
          <span className="truncate">{title}</span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1">
          <span className="rounded bg-surface px-1.5 py-0.5 text-[11px] font-medium text-muted">{items.length}</span>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
      </button>
      {open && (
        <div className="border-t border-border/70 px-2 py-2">
          {loading ? (
            <div className="text-muted">{t("common.loading")}</div>
          ) : items.length === 0 ? (
            <div className="text-muted">{emptyText}</div>
          ) : (
            <ul className="mai-scrollbar max-h-36 space-y-1 overflow-auto pr-1">
              {items.map((item, index) => (
                <li key={`${title}-${index}`} className="rounded bg-surface/70 px-2 py-1.5">
                  <ExpandableText
                    text={item}
                    collapsedClassName="line-clamp-2"
                    className="leading-snug text-text/90"
                    limit={90}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ExpandableText({
  text,
  fallback,
  collapsedClassName,
  className,
  limit = 120
}: {
  text?: string | null;
  fallback?: string;
  collapsedClassName: string;
  className?: string;
  limit?: number;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const value = text?.trim() || fallback || "";
  const isLong = value.length > limit || value.includes("\n");

  return (
    <div>
      <p
        className={`${className ?? ""} ${
          expanded || !isLong ? "whitespace-pre-wrap break-words" : `${collapsedClassName} break-words`
        }`}
      >
        {value}
      </p>
      {isLong && (
        <button
          type="button"
          className="mt-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] font-medium text-muted hover:bg-surface hover:text-brand"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {expanded ? t("common.collapse") : t("common.expand")}
        </button>
      )}
    </div>
  );
}
