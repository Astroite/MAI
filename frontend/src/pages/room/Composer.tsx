import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Gavel, MessageSquarePlus, SendHorizontal, UserRoundCheck } from "lucide-react";
import { api } from "../../api";
import { useI18n } from "../../i18n";
import type { PersonaInstance } from "../../types";

type Mode = "normal" | "judge" | "dead_end" | "masquerade";

const MODES: Mode[] = ["normal", "judge", "dead_end", "masquerade"];

export function Composer({
  roomId,
  personas,
  frozen
}: {
  roomId: string;
  personas: PersonaInstance[];
  frozen: boolean;
}) {
  const queryClient = useQueryClient();
  const { t, display } = useI18n();
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<Mode>("normal");
  const [guestName, setGuestName] = useState(() => t("message.guest"));
  const [cursorPosition, setCursorPosition] = useState(0);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [dismissedMentionKey, setDismissedMentionKey] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      if (mode === "judge") return api.verdict(roomId, content, true);
      if (mode === "dead_end") return api.verdict(roomId, content, false, { dead_end: true });
      if (mode === "masquerade") return api.masquerade(roomId, guestName.trim() || t("message.guest"), content);
      return api.appendMessage(roomId, content);
    },
    onSuccess: () => {
      setContent("");
      void queryClient.invalidateQueries({ queryKey: ["room", roomId] });
      // Reset back to the default mode after special-mode submissions so the
      // next message is a normal one (matches QQ-like ergonomics).
      setMode("normal");
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
      if (!frozen && content.trim() && !submit.isPending) submit.mutate();
    }
  };

  const modeIcon = (m: Mode) =>
    m === "judge" ? <Gavel size={14} /> : m === "dead_end" ? <Ban size={14} /> : m === "masquerade" ? <UserRoundCheck size={14} /> : <MessageSquarePlus size={14} />;

  return (
    <div className="border-t border-border/80 bg-panel px-5 py-4 shadow-card max-sm:px-3">
      <div className="mx-auto max-w-5xl rounded-lg border border-border/90 bg-panel p-3 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 rounded-md border border-border/80 bg-surface p-1">
            {MODES.map((entry) => (
              <button
                key={entry}
                type="button"
                className={`inline-flex h-8 items-center gap-1.5 rounded px-2 text-xs font-medium transition ${
                  mode === entry ? "bg-panel text-brand shadow-card" : "text-muted hover:text-text"
                }`}
                onClick={() => setMode(entry)}
                disabled={frozen}
                title={display("mode", entry)}
              >
                {modeIcon(entry)}
                <span>{display("mode", entry)}</span>
              </button>
            ))}
          </div>
          {mode === "masquerade" && (
            <input
              name="masquerade-guest-name"
              className="input h-8 w-36 text-xs"
              value={guestName}
              onChange={(event) => setGuestName(event.target.value)}
              placeholder={t("composer.guestName")}
            />
          )}
        </div>
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
                            <span className="block truncate font-medium">{persona.name}</span>
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
              placeholder={frozen ? t("composer.frozenPlaceholder") : t("composer.placeholder")}
              disabled={frozen}
            />
          </div>
          <button
            className="btn btn-primary h-10 px-4 max-sm:w-full"
            disabled={frozen || !content.trim() || submit.isPending}
            onClick={() => submit.mutate()}
            title={submit.isPending ? t("composer.sending") : t("composer.enterHint")}
          >
            <SendHorizontal size={16} />
            {submit.isPending ? t("composer.sending") : t("composer.send")}
          </button>
        </div>
      </div>
    </div>
  );
}
