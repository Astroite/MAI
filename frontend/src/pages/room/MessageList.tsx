import { useEffect, useMemo, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { api } from "../../api";
import { useUIStore } from "../../store";
import type { Message, PersonaInstance } from "../../types";
import { MarkdownBlock } from "../../components/MarkdownBlock";
import { StatusPill } from "../../components/StatusPill";

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
  const scrollRef = useRef<HTMLDivElement | null>(null);
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
  const streamed = useMemo(
    () => Object.values(streaming).filter((item) => item.roomId === roomId),
    [streaming, roomId]
  );
  const visibleCount = messages.length + streamed.length;

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    // Auto-scroll to bottom on new content (keeps the chat feel).
    node.scrollTop = node.scrollHeight;
  }, [visibleCount]);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto bg-surface px-4 py-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        {messages.map((message) => (
          <MessageRow
            key={message.id}
            roomId={roomId}
            frozen={frozen}
            message={message}
            persona={message.author_persona_id ? personaById.get(message.author_persona_id) : undefined}
            revoked={revokedMessageIds.has(message.id) ?? false}
          />
        ))}
        {streamed.map((item) => {
          const persona = personaById.get(item.personaId);
          return (
            <ChatRow
              key={item.messageId}
              side="left"
              avatar={{ label: personaInitial(persona?.name), color: personaColor(persona?.id) }}
            >
              <div className="text-xs font-medium text-brand">{persona?.name ?? "AI"} 正在发言…</div>
              <div className="mt-1">
                <MarkdownBlock content={item.text} />
              </div>
            </ChatRow>
          );
        })}
        {!messages.length && !streamed.length && (
          <div className="mt-12 text-center text-sm text-muted">
            还没有消息，下面发条消息开始讨论吧。
          </div>
        )}
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
  const revoke = useMutation({
    mutationFn: () =>
      api.verdict(roomId, `撤销裁决：${message.content}`, false, { revoke_message_id: message.id }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["room", roomId] })
  });

  // Render system/meta messages as a centered info strip, not a bubble.
  if (message.message_type === "meta" || message.author_actual === "system") {
    return (
      <div className="my-1 flex items-center justify-center gap-2 text-xs text-muted">
        <div className="h-px flex-1 bg-border" />
        <span>{message.content}</span>
        <div className="h-px flex-1 bg-border" />
      </div>
    );
  }

  const isUser = message.author_actual === "user" || message.author_actual === "user_as_judge";
  const side: "left" | "right" = isUser ? "right" : "left";
  const masqueradeName = message.user_masquerade_name || persona?.name || "群友";
  const avatar = isUser
    ? { label: message.author_actual === "user_as_judge" ? "裁" : "我", color: "rgb(var(--accent))" }
    : {
        label: personaInitial(masqueradeName),
        color: personaColor(persona?.id ?? message.user_masquerade_name)
      };

  const authorName =
    message.author_actual === "user"
      ? "我"
      : message.author_actual === "user_as_judge"
        ? "裁决者"
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
            {message.message_type}
          </StatusPill>
        )}
        {message.author_actual === "user_as_persona" && (
          <StatusPill tone="brand">{message.user_revealed_at ? "已揭示" : "群友"}</StatusPill>
        )}
        {revoked && <StatusPill tone="danger">已撤销</StatusPill>}
        {message.truncated_reason && <StatusPill tone="danger">{message.truncated_reason}</StatusPill>}
        {message.message_type === "verdict" && message.author_actual === "user_as_judge" && !revoked && (
          <button
            className="btn h-7 px-2 text-xs"
            disabled={frozen || revoke.isPending}
            onClick={() => revoke.mutate()}
            title="撤销裁决"
          >
            <RotateCcw size={13} />
            撤销
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
