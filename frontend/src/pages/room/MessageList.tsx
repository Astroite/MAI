import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Virtuoso } from "react-virtuoso";
import { RotateCcw, Wrench } from "lucide-react";
import { api } from "../../api";
import { useUIStore } from "../../store";
import type { Message, PersonaInstance } from "../../types";
import { MarkdownBlock } from "../../components/MarkdownBlock";
import { StatusPill } from "../../components/StatusPill";
import { useI18n } from "../../i18n";
import { DEFAULT_PERSONA_COLOR, PersonaIcon } from "../../components/PersonaIcon";
import { splitActions } from "./splitActions";

type PersonaLike = { id?: string | null; color?: string | null; icon?: string | null };

function personaTone(persona: PersonaLike | undefined | null, fallbackKey?: string | null): string {
  if (persona?.color) return persona.color;
  const key = persona?.id ?? fallbackKey ?? null;
  if (!key) return DEFAULT_PERSONA_COLOR;
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 52% 48%)`;
}

type Avatar =
  | { kind: "icon"; icon?: string | null; color: string }
  | { kind: "label"; label: string; color: string };

function previewValue(value: unknown, fallback = ""): string {
  if (value == null) return fallback;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > 520 ? `${text.slice(0, 520)}...` : text;
}

type Entry =
  | { kind: "message"; key: string; message: Message }
  | { kind: "stream"; key: string; messageId: string; personaId: string; text: string };

export function MessageList({
  roomId,
  frozen,
  messages,
  personas
}: {
  roomId: string;
  frozen: boolean;
  messages: Message[];
  personas: PersonaInstance[];
}) {
  const streaming = useUIStore((state) => state.streaming);
  const { t } = useI18n();
  const personaById = useMemo(() => new Map(personas.map((persona) => [persona.id, persona])), [personas]);
  const revokedMessageIds = useMemo(
    () =>
      new Set(
        messages
          .filter((message) => message.message_type === "verdict_revoke" && message.parent_message_id)
          .map((message) => message.parent_message_id)
      ),
    [messages]
  );
  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = messages.map((message) => ({ kind: "message", key: message.id, message }));
    for (const item of Object.values(streaming)) {
      if (item.roomId !== roomId) continue;
      out.push({
        kind: "stream",
        key: `stream-${item.messageId}`,
        messageId: item.messageId,
        personaId: item.personaId,
        text: item.text
      });
    }
    return out;
  }, [messages, streaming, roomId]);

  if (!entries.length) {
    return (
      <div className="min-h-0 flex-1 overflow-auto bg-surface">
        <div className="mx-auto mt-12 max-w-md rounded-lg border border-dashed border-border bg-panel/70 px-4 py-6 text-center text-sm text-muted">
          {t("message.empty")}
        </div>
      </div>
    );
  }

  return (
    <Virtuoso
      className="mai-scrollbar min-h-0 flex-1 bg-surface"
      data={entries}
      followOutput="smooth"
      // Smooth-scroll on append rather than fixed-bottom so users reading
      // history aren't yanked to the latest message.
      computeItemKey={(_, entry) => entry.key}
      components={{
        Header: () => <div className="h-3" />,
        Footer: () => <div className="h-3" />
      }}
      itemContent={(_, entry) => (
        <div className="px-5">
          <div className="mx-auto max-w-5xl py-2">
            {entry.kind === "message" ? (
              <MessageRow
                roomId={roomId}
                frozen={frozen}
                message={entry.message}
                persona={entry.message.author_persona_id ? personaById.get(entry.message.author_persona_id) : undefined}
                revoked={revokedMessageIds.has(entry.message.id) ?? false}
              />
            ) : (
              <StreamingRow
                persona={personaById.get(entry.personaId)}
                personaId={entry.personaId}
                text={entry.text}
              />
            )}
          </div>
        </div>
      )}
    />
  );
}

function ActionAwareBody({ text }: { text: string }) {
  const segments = splitActions(text);
  if (segments.length === 0) return null;
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === "action" ? (
          <div
            key={i}
            className="my-1.5 rounded-md border-l-2 border-muted/40 bg-surface/60 px-3 py-1 text-xs italic text-muted"
          >
            {seg.text}
          </div>
        ) : (
          <MarkdownBlock key={i} content={seg.text} />
        )
      )}
    </>
  );
}

function AuthorLabel({
  name,
  identity,
  muted = false
}: {
  name: string;
  identity?: string;
  muted?: boolean;
}) {
  return (
    <>
      <span className={muted ? "font-medium text-muted" : "font-semibold text-text"}>{name}</span>
      {identity && (
        <span className="text-xs text-muted">· {identity}</span>
      )}
    </>
  );
}

function StreamingRow({
  persona,
  personaId,
  text
}: {
  persona?: PersonaInstance;
  personaId: string;
  text: string;
}) {
  const { t } = useI18n();
  const personaName = persona?.name;
  return (
    <ChatRow
      side="left"
      avatar={{ kind: "icon", icon: persona?.icon, color: personaTone(persona, personaId) }}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="font-semibold text-text">{t("message.streaming", { name: personaName ?? "AI" })}</span>
        {persona?.identity && <span className="text-xs text-muted">· {persona.identity}</span>}
        <span className="h-1.5 w-1.5 rounded-full bg-brand" style={{ animation: "pulse-ring 1.4s ease-out infinite" }} />
      </div>
      <div className="mt-1 rounded-lg border border-brand/30 bg-panel px-3 py-2 text-sm shadow-card">
        <ActionAwareBody text={text} />
      </div>
    </ChatRow>
  );
}

function ToolInvocationRow({ message }: { message: Message }) {
  const { t } = useI18n();
  const parsed = useMemo(() => {
    if (message.tool_invocation) return message.tool_invocation;
    try {
      return JSON.parse(message.content) as {
        display_name?: string;
        tool_name?: string;
        status?: "pending" | "success" | "error";
        arguments?: Record<string, unknown>;
        result?: unknown;
        error?: string | null;
      };
    } catch {
      return null;
    }
  }, [message.content, message.tool_invocation]);
  const status = parsed?.status ?? "pending";
  return (
    <div className="my-1 flex justify-center">
      <div className="w-full max-w-[min(760px,82%)] rounded-lg border border-border/90 bg-panel px-3 py-2 text-xs shadow-card">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-medium">
              <Wrench size={14} />
              <span className="truncate">{parsed?.display_name || parsed?.tool_name || t("message.tool.unknown")}</span>
            </div>
            {parsed?.tool_name && <code className="mt-1 block truncate text-[11px] text-muted">{parsed.tool_name}</code>}
          </div>
          <StatusPill tone={status === "success" ? "brand" : status === "error" ? "danger" : "neutral"}>
            {status}
          </StatusPill>
        </div>
        <pre className="mai-scrollbar mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-surface p-2 text-[11px] text-muted">
          {parsed?.error || previewValue(parsed?.result, previewValue(parsed?.arguments, message.content))}
        </pre>
      </div>
    </div>
  );
}

function MessageRow({
  roomId,
  frozen,
  message,
  persona,
  revoked
}: {
  roomId: string;
  frozen: boolean;
  message: Message;
  persona?: PersonaInstance;
  revoked: boolean;
}) {
  const queryClient = useQueryClient();
  const { t, display, locale } = useI18n();
  const revoke = useMutation({
    mutationFn: () =>
      api.verdict(roomId, t("message.revokeVerdict", { content: message.content }), false, { revoke_message_id: message.id }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["room", roomId] })
  });

  if (message.message_type === "tool_invocation") {
    return <ToolInvocationRow message={message} />;
  }

  if (message.message_type === "silence") {
    const ghostName = persona?.name ?? "AI";
    const ghostAvatar: Avatar = {
      kind: "icon",
      icon: persona?.icon,
      color: personaTone(persona, ghostName)
    };
    return (
      <ChatRow side="left" avatar={ghostAvatar}>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted/70">
          <span className="font-semibold">{ghostName}</span>
          {persona?.identity && <span className="text-xs text-muted">· {persona.identity}</span>}
          <StatusPill tone="neutral">{t("message.silence")}</StatusPill>
        </div>
        <div className="mt-1 inline-block rounded-2xl border border-dashed border-border px-3 py-1.5 text-sm text-muted/60">
          ...
        </div>
      </ChatRow>
    );
  }

  // Render system/meta/dead_end messages as a centered info strip, not a bubble.
  if (
    message.message_type === "meta" ||
    message.message_type === "dead_end" ||
    message.message_type === "background_update" ||
    message.author_actual === "system"
  ) {
    let label: string;
    if (message.message_type === "dead_end") {
      label = t("message.deadEndPrefix", { content: message.content });
    } else if (message.message_type === "background_update") {
      const preview = message.content.length > 80 ? `${message.content.slice(0, 80)}...` : message.content;
      label = preview ? t("message.backgroundUpdatePrefix", { content: preview }) : t("message.backgroundUpdateBare");
    } else {
      label = message.content;
    }
    return (
      <div className="my-1 flex items-center justify-center gap-2 text-xs text-muted">
        <div className="h-px flex-1 bg-border" />
        <span className="max-w-2xl rounded-md border border-border/80 bg-panel px-2 py-1 text-center shadow-card">{label}</span>
        <div className="h-px flex-1 bg-border" />
      </div>
    );
  }

  const isUser = message.author_actual === "user" || message.author_actual === "user_as_judge";
  const side: "left" | "right" = isUser ? "right" : "left";
  const masqueradeName = message.user_masquerade_name || persona?.name || t("message.guest");
  const avatar: Avatar = isUser
    ? {
        kind: "label",
        label: message.author_actual === "user_as_judge" ? t("message.judgeShort") : t("message.me"),
        color: "rgb(var(--accent))"
      }
    : {
        kind: "icon",
        icon: persona?.icon,
        color: personaTone(persona, message.user_masquerade_name ?? masqueradeName)
      };

  const authorName =
    message.author_actual === "user"
      ? t("message.me")
      : message.author_actual === "user_as_judge"
        ? t("message.judge")
        : message.author_actual === "user_as_persona"
          ? masqueradeName
          : persona?.name ?? "AI";

  const bubbleTone = isUser
    ? "border border-brand/50 bg-brand/5 text-text"
    : message.author_actual === "user_as_persona"
      ? "border border-brand/50 bg-panel"
      : "border border-border/90 bg-panel";

  return (
    <ChatRow side={side} avatar={avatar}>
      <div className={`flex flex-wrap items-center gap-2 text-xs text-muted ${isUser ? "justify-end" : ""}`}>
        {!isUser && message.author_actual === "ai" && persona ? (
          <AuthorLabel name={persona.name} identity={persona.identity} />
        ) : (
          <span className="font-semibold text-text">{authorName}</span>
        )}
        <span>{formatMessageTime(message.created_at, locale)}</span>
        {message.message_type !== "speech" && (
          <StatusPill tone={message.message_type === "facilitator_signal" ? "accent" : "neutral"}>
            {display("messageType", message.message_type)}
          </StatusPill>
        )}
        {message.author_actual === "user_as_persona" && (
          <StatusPill tone="brand">{message.user_revealed_at ? t("message.revealed") : t("message.guest")}</StatusPill>
        )}
        {revoked && <StatusPill tone="danger">{t("message.revoked")}</StatusPill>}
        {message.truncated_reason && <StatusPill tone="danger">{display("truncatedReason", message.truncated_reason)}</StatusPill>}
        {message.message_type === "verdict" && message.author_actual === "user_as_judge" && !revoked && (
          <button
            className="btn h-7 px-2 text-xs"
            disabled={frozen || revoke.isPending}
            onClick={() => revoke.mutate()}
            title={t("message.revokeTitle")}
          >
            <RotateCcw size={13} />
            {t("message.revoke")}
          </button>
        )}
        <span className="rounded-md border border-border/80 bg-panel px-1.5 py-0.5 text-[11px] text-muted">
          #{shortMessageId(message.id)}
        </span>
      </div>
      <div className={`mt-1 rounded-lg px-3 py-2 text-sm shadow-card ${bubbleTone}`}>
        <ActionAwareBody text={message.content} />
      </div>
    </ChatRow>
  );
}

function ChatRow({
  side,
  avatar,
  children
}: {
  side: "left" | "right";
  avatar: Avatar;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex items-start gap-3 ${side === "right" ? "flex-row-reverse" : ""}`}>
      <div className="mt-1 flex-shrink-0">
        {avatar.kind === "icon" ? (
          <PersonaIcon icon={avatar.icon} color={avatar.color} size={32} iconSize={16} rounded="full" />
        ) : (
          <div
            className="grid h-8 w-8 place-items-center rounded-full text-xs font-semibold text-white"
            style={{ background: avatar.color }}
            aria-hidden="true"
          >
            {avatar.label}
          </div>
        )}
      </div>
      <div className={`min-w-0 max-w-[min(760px,82%)] ${side === "right" ? "text-right" : ""}`}>{children}</div>
    </div>
  );
}

function shortMessageId(id: string): string {
  return id.length > 4 ? id.slice(-4) : id;
}

function formatMessageTime(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date);
}
