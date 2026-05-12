import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  Ban,
  BookOpen,
  Drama,
  Gavel,
  Clapperboard,
  MessageSquarePlus,
  Paperclip,
  Play,
  SendHorizontal,
  UserRoundCheck
} from "lucide-react";
import { api } from "../../api";
import { useI18n } from "../../i18n";
import { queryKeys } from "../../queryKeys";
import { PersonaIcon } from "../../components/PersonaIcon";
import {
  inferDirectorTargetPersona,
  type StoryComposerContext,
  type StoryComposerMode
} from "./storyComposer";
import type { PersonaInstance } from "../../types";

type DiscussionMode = "normal" | "judge" | "dead_end" | "masquerade";

const DISCUSSION_MODES: DiscussionMode[] = ["normal", "judge", "dead_end", "masquerade"];

export function Composer({
  roomId,
  personas,
  frozen,
  sealed = false,
  story
}: {
  roomId: string;
  personas: PersonaInstance[];
  frozen: boolean;
  sealed?: boolean;
  story?: StoryComposerContext | null;
}) {
  const queryClient = useQueryClient();
  const { t, display } = useI18n();
  const [params, setParams] = useSearchParams();
  const [content, setContent] = useState("");
  const [discussionMode, setDiscussionMode] = useState<DiscussionMode>("normal");
  const [storyMode, setStoryMode] = useState<StoryComposerMode>("narration");
  const [actCharacterId, setActCharacterId] = useState<string | null>(
    story?.playableUserCharacters[0]?.id ?? null
  );
  const [directorTargetPersonaId, setDirectorTargetPersonaId] = useState<string | null>(null);
  const [guestName, setGuestName] = useState(() => t("message.guest"));
  const [cursorPosition, setCursorPosition] = useState(0);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [dismissedMentionKey, setDismissedMentionKey] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Keep the act-as selection valid as the roster shifts (character exits,
  // user adds new user character mid-scene, etc).
  useEffect(() => {
    if (!story) return;
    if (story.playableUserCharacters.length === 0) {
      setActCharacterId(null);
      if (storyMode === "act_as") setStoryMode("narration");
      return;
    }
    if (!actCharacterId || !story.playableUserCharacters.find((c) => c.id === actCharacterId)) {
      setActCharacterId(story.playableUserCharacters[0].id);
    }
  }, [story, actCharacterId, storyMode]);

  useEffect(() => {
    if (!story) return;
    if (story.presentAiPersonas.length === 0) {
      setDirectorTargetPersonaId(null);
      if (storyMode === "director") setStoryMode("narration");
      return;
    }
    if (
      directorTargetPersonaId &&
      !story.presentAiPersonas.find((persona) => persona.id === directorTargetPersonaId)
    ) {
      setDirectorTargetPersonaId(story.presentAiPersonas[0].id);
    }
  }, [story, directorTargetPersonaId, storyMode]);

  const openUploadPanel = () => {
    const next = new URLSearchParams(params);
    next.set("panel", "upload");
    setParams(next, { replace: true });
  };

  const submit = useMutation({
    mutationFn: async () => {
      if (story) {
        if (storyMode === "narration") {
          return api.appendMessage(roomId, content, { message_type: "narration" });
        }
        if (storyMode === "director") {
          const target = inferDirectorTargetPersona(
            content,
            directorTargetPersonaId,
            story.presentAiPersonas
          );
          return api.runTurn(roomId, target?.id);
        }
        return api.appendMessage(roomId, content, { as_character_id: actCharacterId });
      }
      if (discussionMode === "judge") return api.verdict(roomId, content, true);
      if (discussionMode === "dead_end")
        return api.verdict(roomId, content, false, { dead_end: true });
      if (discussionMode === "masquerade")
        return api.masquerade(roomId, guestName.trim() || t("message.guest"), content);
      return api.appendMessage(roomId, content);
    },
    onSuccess: () => {
      setContent("");
      void queryClient.invalidateQueries({ queryKey: queryKeys.room(roomId) });
      // Reset back to the default mode after special-mode submissions so the
      // next message is a normal one (matches QQ-like ergonomics).
      if (!story) setDiscussionMode("normal");
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  });

  const mentionMatch = useMemo(() => {
    const beforeCursor = content.slice(0, cursorPosition);
    const atIndex = beforeCursor.lastIndexOf("@");
    if (atIndex < 0) return null;
    if (atIndex > 0 && !/\s/.test(beforeCursor[atIndex - 1])) return null;
    const query = beforeCursor.slice(atIndex + 1);
    if (query.includes("@") || /\s/.test(query)) return null;
    return { start: atIndex, end: cursorPosition, query };
  }, [content, cursorPosition]);

  const mentionKey = mentionMatch ? `${mentionMatch.start}:${mentionMatch.end}:${mentionMatch.query}:${content.length}` : "";
  const mentionSuggestions = useMemo(() => {
    if (!mentionMatch) return [];
    const query = mentionMatch.query.toLowerCase();
    return personas
      .filter((persona) => {
        if (!query) return true;
        return `${persona.name} ${persona.description} ${(persona.tags ?? []).join(" ")}`.toLowerCase().includes(query);
      })
      .slice(0, 8);
  }, [mentionMatch, personas]);
  const mentionPanelOpen = Boolean(mentionMatch && mentionKey !== dismissedMentionKey && !frozen && personas.length > 0);

  useEffect(() => {
    setActiveMentionIndex(0);
  }, [mentionMatch?.query, mentionSuggestions.length]);

  const updateCursor = () => {
    const textarea = textareaRef.current;
    if (textarea) setCursorPosition(textarea.selectionStart ?? 0);
  };

  const insertMention = (persona: PersonaInstance) => {
    if (!mentionMatch) return;
    const mentionText = `@${persona.name} `;
    const nextContent = `${content.slice(0, mentionMatch.start)}${mentionText}${content.slice(mentionMatch.end)}`;
    const nextCursor = mentionMatch.start + mentionText.length;
    setContent(nextContent);
    setCursorPosition(nextCursor);
    setDismissedMentionKey("");
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const isComposingIme = (event: React.KeyboardEvent<HTMLTextAreaElement>) =>
    event.nativeEvent.isComposing || event.keyCode === 229;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionPanelOpen) {
      if (event.key === "ArrowDown" && mentionSuggestions.length > 0) {
        event.preventDefault();
        setActiveMentionIndex((index) => (index + 1) % mentionSuggestions.length);
        return;
      }
      if (event.key === "ArrowUp" && mentionSuggestions.length > 0) {
        event.preventDefault();
        setActiveMentionIndex((index) => (index - 1 + mentionSuggestions.length) % mentionSuggestions.length);
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && !isComposingIme(event) && mentionSuggestions[activeMentionIndex]) {
        event.preventDefault();
        insertMention(mentionSuggestions[activeMentionIndex]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissedMentionKey(mentionKey);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !isComposingIme(event)) {
      event.preventDefault();
      if (!submitDisabled) submit.mutate();
    }
  };

  const modeIcon = (m: DiscussionMode) =>
    m === "judge" ? <Gavel size={14} /> : m === "dead_end" ? <Ban size={14} /> : m === "masquerade" ? <UserRoundCheck size={14} /> : <MessageSquarePlus size={14} />;

  const canActAs = story && story.playableUserCharacters.length > 0;
  const canDirect = story && story.presentAiPersonas.length > 0;
  const activeActCharacter =
    story && actCharacterId
      ? story.playableUserCharacters.find((c) => c.id === actCharacterId) ?? null
      : null;
  const directorTarget =
    story && storyMode === "director"
      ? inferDirectorTargetPersona(content, directorTargetPersonaId, story.presentAiPersonas)
      : null;
  const storyModeUnavailable = story
    ? storyMode === "act_as" && !canActAs
      ? t("composer.story.actAsUnavailable")
      : storyMode === "director" && !canDirect
        ? t("composer.story.directorUnavailable")
        : ""
    : "";
  const submitDisabled =
    frozen ||
    submit.isPending ||
    (story
      ? storyMode === "director"
        ? !canDirect
        : storyMode === "act_as"
          ? !content.trim() || !activeActCharacter
        : !content.trim()
      : !content.trim());
  const submitLabel = story
    ? storyMode === "narration"
      ? t("composer.story.writeNarration")
      : storyMode === "act_as"
        ? activeActCharacter
          ? t("composer.story.speakAs", { name: activeActCharacter.name })
          : t("composer.story.actAs")
        : directorTarget
          ? t("composer.story.directResponse")
          : t("composer.story.nextBeat")
    : t("composer.send");

  return (
    <div className="flex-shrink-0 border-t border-border/80 bg-panel px-5 py-4 shadow-card max-sm:px-3">
      <div className="mx-auto max-w-5xl rounded-lg border border-border/90 bg-panel p-3 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {story ? (
            // Story World mode bar — narration vs act-as. Discussion modes
            // (judge/dead_end/masquerade) intentionally don't appear: the
            // story shell isn't a deliberation room.
            <div className="flex flex-wrap items-center gap-1 rounded-md border border-border/80 bg-surface p-1">
              <button
                type="button"
                className={`inline-flex h-8 items-center gap-1.5 rounded px-2 text-xs font-medium transition ${
                  storyMode === "narration" ? "bg-panel text-brand shadow-card" : "text-muted hover:text-text"
                }`}
                onClick={() => setStoryMode("narration")}
                disabled={frozen}
                title={t("composer.story.narrationTitle")}
              >
                <BookOpen size={14} />
                <span>{t("composer.story.narration")}</span>
              </button>
              <button
                type="button"
                className={`inline-flex h-8 items-center gap-1.5 rounded px-2 text-xs font-medium transition ${
                  storyMode === "act_as"
                    ? "bg-panel text-accent shadow-card"
                    : canActAs
                      ? "text-muted hover:text-text"
                      : "text-muted/50"
                }`}
                onClick={() => canActAs && setStoryMode("act_as")}
                disabled={frozen || !canActAs}
                title={
                  canActAs
                    ? t("composer.story.actAsTitle")
                    : t("composer.story.actAsUnavailableTitle")
                }
              >
                <Drama size={14} />
                <span>{t("composer.story.actAs")}</span>
              </button>
              <button
                type="button"
                className={`inline-flex h-8 items-center gap-1.5 rounded px-2 text-xs font-medium transition ${
                  storyMode === "director"
                    ? "bg-panel text-brand shadow-card"
                    : canDirect
                      ? "text-muted hover:text-text"
                      : "text-muted/50"
                }`}
                onClick={() => canDirect && setStoryMode("director")}
                disabled={frozen || !canDirect}
                title={
                  canDirect
                    ? t("composer.story.directorTitle")
                    : t("composer.story.directorUnavailableTitle")
                }
              >
                <Clapperboard size={14} />
                <span>{t("composer.story.director")}</span>
              </button>
              {storyMode === "act_as" && story && story.playableUserCharacters.length > 0 && (
                <div className="ml-1 flex items-center gap-1 border-l border-border/80 pl-2">
                  {story.playableUserCharacters.map((character) => {
                    const active = character.id === actCharacterId;
                    return (
                      <button
                        key={character.id}
                        type="button"
                        className={`inline-flex h-7 items-center gap-1.5 rounded px-1.5 text-xs transition ${
                          active ? "bg-accent/15 text-accent" : "text-muted hover:text-text"
                        }`}
                        onClick={() => setActCharacterId(character.id)}
                        disabled={frozen}
                        title={character.identity || character.name}
                      >
                        <PersonaIcon icon={character.icon} color={character.color} size={18} />
                        <span>{character.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {storyMode === "director" && story && story.presentAiPersonas.length > 0 && (
                <div className="ml-1 flex items-center gap-1 border-l border-border/80 pl-2">
                  <button
                    type="button"
                    className={`inline-flex h-7 items-center gap-1.5 rounded px-1.5 text-xs transition ${
                      directorTargetPersonaId === null ? "bg-brand/15 text-brand" : "text-muted hover:text-text"
                    }`}
                    onClick={() => setDirectorTargetPersonaId(null)}
                    disabled={frozen}
                    title={t("composer.story.nextBeatTitle")}
                  >
                    <Play size={13} />
                    <span>{t("composer.story.nextBeat")}</span>
                  </button>
                  {story.presentAiPersonas.map((persona) => {
                    const active = persona.id === directorTargetPersonaId;
                    return (
                      <button
                        key={persona.id}
                        type="button"
                        className={`inline-flex h-7 items-center gap-1.5 rounded px-1.5 text-xs transition ${
                          active ? "bg-brand/15 text-brand" : "text-muted hover:text-text"
                        }`}
                        onClick={() => setDirectorTargetPersonaId(persona.id)}
                        disabled={frozen}
                        title={persona.identity || persona.name}
                      >
                        <PersonaIcon icon={persona.icon} color={persona.color} size={18} />
                        <span>{persona.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1 rounded-md border border-border/80 bg-surface p-1">
              {DISCUSSION_MODES.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  className={`inline-flex h-8 items-center gap-1.5 rounded px-2 text-xs font-medium transition ${
                    discussionMode === entry ? "bg-panel text-brand shadow-card" : "text-muted hover:text-text"
                  }`}
                  onClick={() => setDiscussionMode(entry)}
                  disabled={frozen}
                  title={display("mode", entry)}
                >
                  {modeIcon(entry)}
                  <span>{display("mode", entry)}</span>
                </button>
              ))}
            </div>
          )}
          {!story && discussionMode === "masquerade" && (
            <input
              name="masquerade-guest-name"
              className="input h-8 w-36 text-xs"
              value={guestName}
              onChange={(event) => setGuestName(event.target.value)}
              placeholder={t("composer.guestName")}
            />
          )}
          <button
            type="button"
            className="ml-auto inline-flex h-8 items-center gap-1 rounded-md border border-border/80 bg-panel px-2 text-xs text-muted transition hover:border-brand hover:text-brand"
            onClick={openUploadPanel}
            disabled={frozen}
            title={t("composer.attach")}
          >
            <Paperclip size={14} />
            <span>{t("composer.attach")}</span>
          </button>
        </div>
        {storyModeUnavailable && (
          <div className="mt-2 text-xs text-muted">{storyModeUnavailable}</div>
        )}
        <div className="mt-3 flex items-end gap-2 max-sm:flex-col max-sm:items-stretch">
          <div className="relative flex-1">
            {mentionPanelOpen && (
              <div className="absolute bottom-full left-0 z-20 mb-2 max-h-56 w-full max-w-md overflow-hidden rounded-md border border-border bg-panel shadow-soft">
                <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted">{t("composer.mentionMembers")}</div>
                {mentionSuggestions.length === 0 ? (
                  <div className="px-3 py-3 text-sm text-muted">{t("composer.noMentionMatches")}</div>
                ) : (
                  <div className="mai-scrollbar max-h-44 overflow-auto py-1">
                    {mentionSuggestions.map((persona, index) => {
                      const active = index === activeMentionIndex;
                      return (
                        <button
                          key={persona.id}
                          type="button"
                          className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm ${
                            active ? "bg-brand text-white" : "hover:bg-surface"
                          }`}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            insertMention(persona);
                          }}
                        >
                          <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface text-xs text-muted">
                            {persona.name.slice(0, 1)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {persona.name}
                              {persona.identity && (
                                <span
                                  className={`ml-1 text-xs font-normal ${active ? "text-white/85" : "text-muted"}`}
                                >
                                  · {persona.identity}
                                </span>
                              )}
                            </span>
                            <span className={`mt-0.5 block truncate text-xs ${active ? "text-white/80" : "text-muted"}`}>{persona.description}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <textarea
              ref={textareaRef}
              name="message-content"
              className="textarea min-h-[72px] w-full resize-none"
              value={content}
              onChange={(event) => {
                setContent(event.target.value);
                setCursorPosition(event.target.selectionStart ?? 0);
                setDismissedMentionKey("");
              }}
              onClick={updateCursor}
              onKeyDown={handleKeyDown}
              onKeyUp={updateCursor}
              rows={3}
              placeholder={
                sealed
                  ? t("composer.sealedPlaceholder")
                  : frozen
                    ? t("composer.frozenPlaceholder")
                    : story
                      ? storyMode === "narration"
                        ? t("composer.story.narrationPlaceholder")
                        : storyMode === "act_as"
                          ? t("composer.story.actAsPlaceholder")
                          : t("composer.story.directorPlaceholder")
                      : t("composer.placeholder")
              }
              disabled={frozen}
            />
          </div>
          <button
            className="btn btn-primary h-10 rounded-full px-5 text-sm max-sm:w-full max-sm:rounded-md"
            disabled={submitDisabled}
            onClick={() => submit.mutate()}
            title={submit.isPending ? t("composer.sending") : t("composer.enterHint")}
          >
            <SendHorizontal size={16} />
            {submit.isPending ? t("composer.sending") : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
