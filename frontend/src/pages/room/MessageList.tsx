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

function personaColor(id?: string | null): string {
  if (!id) return "rgb(var(--muted))";
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 52% 48%)`;
}

function personaInitial(name?: string | null): string {
  if (!name) return "?";
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed.slice(0, 2);
}

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
        <div className="mt-12 text-center text-sm text-muted">{t("message.empty")}</div>
      </div>
    );
  }

  return (
    <Virtuoso
      className="min-h-0 flex-1 bg-surface"
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
        <div className="px-4">
          <div className="mx-auto max-w-3xl py-1.5">
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
                personaName={personaById.get(entry.personaId)?.name}
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

function StreamingRow({
  personaName,
  personaId,
  text
}: {
  personaName?: string;
  personaId: string;
  text: string;
}) {
  const { t } = useI18n();
  return (
    <ChatRow
      side="left"
      avatar={{ label: personaInitial(personaName), color: personaColor(personaId) }}
    >
      <div className="text-xs font-medium text-brand">
        {t("message.streaming", { name: personaName ?? "AI" })}
      </div>
      <div className="mt-1">
        <MarkdownBlock content={text} />
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
      <div className="w-full max-w-2xl rounded-md border border-border bg-panel px-3 py-2 text-xs shadow-soft">
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
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-surface p-2 text-[11px] text-muted">
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
  const { t, display } = useI18n();
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
    const ghostAvatar = {
      label: personaInitial(ghostName),
      color: personaColor(persona?.id ?? ghostName)
    };
    return (
      <ChatRow side="left" avatar={ghostAvatar}>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted/70">
          <span className="font-semibold">{ghostName}</span>
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
        <span>{label}</span>
        <div className="h-px flex-1 bg-border" />
      </div>
    );
  }

  const isUser = message.author_actual === "user" || message.author_actual === "user_as_judge";
  const side: "left" | "right" = isUser ? "right" : "left";
  const masqueradeName = message.user_masquerade_name || persona?.name || t("message.guest");
  const avatar = isUser
    ? { label: message.author_actual === "user_as_judge" ? t("message.judgeShort") : t("message.me"), color: "rgb(var(--accent))" }
    : {
        label: personaInitial(masqueradeName),
        color: personaColor(persona?.id ?? message.user_masquerade_name)
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
    ? "bg-brand text-white"
    : message.author_actual === "user_as_persona"
      ? "bg-panel border border-brand"
      : "bg-panel border border-border";

  return (
    <ChatRow side={side} avatar={avatar}>
      <div className={`flex flex-wrap items-center gap-2 text-xs ${isUser ? "justify-end" : ""}`}>
        <span className="font-semibold">{authorName}</span>
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
      </div>
      <div className={`mt-1 rounded-2xl px-3 py-2 text-sm shadow-soft ${bubbleTone}`}>
        <MarkdownBlock content={message.content} />
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
  avatar: { label: string; color: string };
  children: React.ReactNode;
}) {
  return (
    <div className={`flex items-start gap-3 ${side === "right" ? "flex-row-reverse" : ""}`}>
      <div
        className="mt-1 grid h-8 w-8 flex-shrink-0 place-items-center rounded-full text-xs font-semibold text-white"
        style={{ background: avatar.color }}
        aria-hidden="true"
      >
        {avatar.label}
      </div>
      <div className={`min-w-0 max-w-[min(680px,80%)] ${side === "right" ? "text-right" : ""}`}>{children}</div>
    </div>
  );
}
