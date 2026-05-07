import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Gavel, MessageSquarePlus, MoreHorizontal, UserRoundCheck } from "lucide-react";
import { api } from "../../api";
import { useI18n } from "../../i18n";
import type { PersonaInstance } from "../../types";

type Mode = "normal" | "judge" | "dead_end" | "masquerade";

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [dismissedMentionKey, setDismissedMentionKey] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

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
      if ((event.key === "Enter" || event.key === "Tab") && mentionSuggestions[activeMentionIndex]) {
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
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!frozen && content.trim() && !submit.isPending) submit.mutate();
    }
  };

  const modeIcon = (m: Mode) =>
    m === "judge" ? <Gavel size={14} /> : m === "dead_end" ? <Ban size={14} /> : m === "masquerade" ? <UserRoundCheck size={14} /> : <MessageSquarePlus size={14} />;

  return (
    <div className="border-t border-border bg-panel">
      {mode !== "normal" && (
        <div className="flex items-center justify-between gap-3 border-b border-border bg-surface px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            {modeIcon(mode)}
            <span>{t("composer.mode", { mode: display("mode", mode) })}</span>
            {mode === "masquerade" && (
              <input
                name="masquerade-guest-name"
                className="input h-7 w-32 text-xs"
                value={guestName}
                onChange={(event) => setGuestName(event.target.value)}
                placeholder={t("composer.guestName")}
              />
            )}
          </div>
          <button className="text-xs text-muted underline" type="button" onClick={() => setMode("normal")}>
            {t("common.cancel")}
          </button>
        </div>
      )}
      <div className="flex items-end gap-2 p-3">
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            className="btn h-9 w-9 px-0"
            onClick={() => setMenuOpen((open) => !open)}
            disabled={frozen}
            title={t("composer.moreModes")}
          >
            <MoreHorizontal size={16} />
          </button>
          {menuOpen && (
            <div className="absolute bottom-11 left-0 z-10 w-40 overflow-hidden rounded-md border border-border bg-panel shadow-soft">
              <ModeOption
                onClick={() => {
                  setMode("judge");
                  setMenuOpen(false);
                }}
                icon={<Gavel size={14} />}
                label={t("composer.judge")}
              />
              <ModeOption
                onClick={() => {
                  setMode("dead_end");
                  setMenuOpen(false);
                }}
                icon={<Ban size={14} />}
                label={t("composer.deadEnd")}
              />
              <ModeOption
                onClick={() => {
                  setMode("masquerade");
                  setMenuOpen(false);
                }}
                icon={<UserRoundCheck size={14} />}
                label={t("composer.masquerade")}
              />
            </div>
          )}
        </div>
        <div className="relative flex-1">
          {mentionPanelOpen && (
            <div className="absolute bottom-full left-0 z-20 mb-2 max-h-56 w-full max-w-md overflow-hidden rounded-md border border-border bg-panel shadow-soft">
              <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted">{t("composer.mentionMembers")}</div>
              {mentionSuggestions.length === 0 ? (
                <div className="px-3 py-3 text-sm text-muted">{t("composer.noMentionMatches")}</div>
              ) : (
                <div className="max-h-44 overflow-auto py-1">
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
            className="textarea min-h-[40px] w-full resize-none"
            value={content}
            onChange={(event) => {
              setContent(event.target.value);
              setCursorPosition(event.target.selectionStart ?? 0);
              setDismissedMentionKey("");
            }}
            onClick={updateCursor}
            onKeyDown={handleKeyDown}
            onKeyUp={updateCursor}
            rows={2}
            placeholder={frozen ? t("composer.frozenPlaceholder") : t("composer.placeholder")}
            disabled={frozen}
          />
        </div>
        <button
          className="btn btn-primary"
          disabled={frozen || !content.trim() || submit.isPending}
          onClick={() => submit.mutate()}
        >
          {modeIcon(mode)}
          {t("composer.send")}
        </button>
      </div>
    </div>
  );
}

function ModeOption({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface" onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}
