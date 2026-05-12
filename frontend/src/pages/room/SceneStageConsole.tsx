import { AlertTriangle, Bot, Brain, Clock, Eye, Heart, MapPin, User, UserCheck, UserX, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { PersonaIcon } from "../../components/PersonaIcon";
import { StatusPill } from "../../components/StatusPill";
import { useI18n } from "../../i18n";
import type { SceneSpeakerContext } from "../../types";
import type { StagePresenceCharacter, StagePresenceView } from "./stagePresence";

export function SceneStageConsole({
  view,
  selectedCharacterId,
  speakerContext,
  loading,
  cueLoading,
  contextError,
  onSelectCharacter
}: {
  view: StagePresenceView;
  selectedCharacterId: string | null;
  speakerContext?: SceneSpeakerContext | null;
  loading: boolean;
  cueLoading: boolean;
  contextError: boolean;
  onSelectCharacter: (characterId: string) => void;
}) {
  const { t } = useI18n();
  const selected =
    view.characters.find((character) => character.id === selectedCharacterId) ??
    view.presentCharacters[0] ??
    view.characters[0] ??
    null;

  return (
    <section className="flex-shrink-0 border-b border-border/80 bg-panel/70 px-5 py-3">
      <div className="mx-auto grid max-w-6xl gap-3 xl:grid-cols-[minmax(0,0.9fr)_minmax(320px,0.8fr)]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            {view.worldId ? (
              <Link
                to={`/worlds/${view.worldId}`}
                className="inline-flex min-w-0 items-center gap-1 rounded border border-accent/40 bg-accent/10 px-2 py-0.5 text-accent hover:bg-accent/20"
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
            {view.sealed && <StatusPill tone="success">{t("room.scene.sealed")}</StatusPill>}
            {view.frozen && <StatusPill tone="warning">{t("room.stage.frozen")}</StatusPill>}
            {loading && <span>{t("room.stage.loading")}</span>}
            {contextError && (
              <span className="inline-flex items-center gap-1 text-warning">
                <AlertTriangle size={13} />
                {t("room.stage.contextFallback")}
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold tracking-normal text-text">{view.sceneTitle}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted">
                <span className="inline-flex items-center gap-1">
                  <Clock size={13} />
                  {view.currentTime || t("room.stage.timeUnknown")}
                </span>
                <span className="inline-flex items-center gap-1">
                  <MapPin size={13} />
                  {view.currentLocation || t("room.stage.locationUnknown")}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <StatusPill tone="success">
                {t("room.stage.presentCount", { count: view.presentCharacters.length })}
              </StatusPill>
              <StatusPill tone="neutral">
                {t("room.stage.exitedCount", { count: view.exitedCharacters.length })}
              </StatusPill>
            </div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <StageRosterGroup
              title={t("room.stage.present")}
              emptyText={t("room.stage.noPresent")}
              characters={view.presentCharacters}
              selectedCharacterId={selected?.id ?? null}
              onSelectCharacter={onSelectCharacter}
            />
            <StageRosterGroup
              title={t("room.stage.exited")}
              emptyText={t("room.stage.noExited")}
              characters={view.exitedCharacters}
              selectedCharacterId={selected?.id ?? null}
              onSelectCharacter={onSelectCharacter}
            />
          </div>
        </div>
        <CharacterCuePanel character={selected} speakerContext={speakerContext} cueLoading={cueLoading} />
      </div>
    </section>
  );
}

function StageRosterGroup({
  title,
  emptyText,
  characters,
  selectedCharacterId,
  onSelectCharacter
}: {
  title: string;
  emptyText: string;
  characters: StagePresenceCharacter[];
  selectedCharacterId: string | null;
  onSelectCharacter: (characterId: string) => void;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted">
        <Users size={13} />
        <span>{title}</span>
      </div>
      {characters.length === 0 ? (
        <div className="rounded border border-dashed border-border/80 px-3 py-2 text-xs text-muted">{emptyText}</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {characters.map((character) => (
            <StageCharacterButton
              key={character.id}
              character={character}
              selected={character.id === selectedCharacterId}
              onSelect={() => onSelectCharacter(character.id)}
            />
          ))}
        </div>
      )}
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
  return (
    <button
      type="button"
      className={`min-w-0 rounded border px-2 py-2 text-left transition ${
        selected
          ? "border-brand/50 bg-brand/10"
          : "border-border/80 bg-surface/70 hover:border-brand/30 hover:bg-panel"
      }`}
      onClick={onSelect}
      title={character.name}
    >
      <div className="flex min-w-0 items-center gap-2">
        <PersonaIcon icon={character.icon} color={character.color} size={24} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-text">{character.name}</span>
            <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted">
              {character.kind === "ai" ? <Bot size={12} /> : <User size={12} />}
              {character.kind === "ai" ? t("room.stage.ai") : t("room.stage.user")}
            </span>
          </div>
          <div className="mt-0.5 truncate text-xs text-muted">
            {character.roleInScene || character.identity || t("room.stage.noRole")}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-[11px]">
          {character.canSpeak && (
            <span className="rounded bg-success/10 px-1.5 py-0.5 text-success">
              {t("room.stage.canSpeak")}
            </span>
          )}
          {character.canUserSpeakAs && (
            <span className="rounded bg-brand/10 px-1.5 py-0.5 text-brand">
              {t("room.stage.playable")}
            </span>
          )}
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
  if (!character) {
    return (
      <div className="rounded border border-border/80 bg-surface/70 p-3 text-sm text-muted">
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
    <aside className="min-w-0 rounded border border-border/80 bg-surface/70 p-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <PersonaIcon icon={character.icon} color={character.color} size={28} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-text">{character.name}</div>
            <div className="truncate text-xs text-muted">{character.identity || character.roleInScene || t("room.stage.noRole")}</div>
          </div>
        </div>
        <StatusPill tone={character.isPresent ? "success" : "neutral"} dot>
          {character.isPresent ? t("room.stage.presentStatus") : t("room.stage.exitedStatus")}
        </StatusPill>
      </div>
      <div className="mt-3 grid gap-2 text-xs text-muted sm:grid-cols-2">
        <CueFact icon={<UserCheck size={13} />} label={t("room.stage.role")} value={character.roleInScene || t("room.stage.noRole")} />
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
          value={character.canSpeak ? t("room.stage.canSpeak") : character.canUserSpeakAs ? t("room.stage.playable") : t("room.stage.cannotSpeak")}
        />
      </div>
      <div className="mt-3 text-xs">
        <div className="font-semibold text-muted">{t("room.stage.coreIdentity")}</div>
        <p className="mt-1 line-clamp-2 text-text/90">
          {character.coreIdentity || character.brief || t("room.stage.noCoreIdentity")}
        </p>
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
          cue.label ? `${cue.to_character_name}: ${cue.label} - ${cue.notes}` : `${cue.to_character_name}: ${cue.notes}`
        )}
      />
    </aside>
  );
}

function CueFact({ icon, label, value }: { icon: JSX.Element; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded bg-panel/70 px-2 py-1.5">
      <div className="flex items-center gap-1 text-muted">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-0.5 truncate font-medium text-text">{value}</div>
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
  icon: JSX.Element;
  loading: boolean;
  emptyText: string;
  items: string[];
}) {
  const { t } = useI18n();
  return (
    <div className="mt-3 min-w-0 text-xs">
      <div className="flex items-center gap-1 font-semibold text-muted">
        {icon}
        <span>{title}</span>
      </div>
      {loading ? (
        <div className="mt-1 text-muted">{t("common.loading")}</div>
      ) : items.length === 0 ? (
        <div className="mt-1 text-muted">{emptyText}</div>
      ) : (
        <ul className="mt-1 space-y-1">
          {items.slice(0, 3).map((item, index) => (
            <li key={`${title}-${index}`} className="line-clamp-2 text-text/90">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
