import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Gavel, MessageSquarePlus, MoreHorizontal, UserRoundCheck } from "lucide-react";
import { api } from "../../api";

type Mode = "normal" | "judge" | "dead_end" | "masquerade";

export function Composer({
  roomId,
  frozen
}: {
  roomId: string;
  personas: unknown[];
  frozen: boolean;
}) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<Mode>("normal");
  const [guestName, setGuestName] = useState("群友");
  const [menuOpen, setMenuOpen] = useState(false);
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
      if (mode === "masquerade") return api.masquerade(roomId, guestName.trim() || "群友", content);
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

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!frozen && content.trim() && !submit.isPending) submit.mutate();
    }
  };

  const modeLabel: Record<Mode, string> = {
    normal: "普通发言",
    judge: "裁决锁定",
    dead_end: "标记死路",
    masquerade: "群友发言"
  };
  const modeIcon = (m: Mode) =>
    m === "judge" ? <Gavel size={14} /> : m === "dead_end" ? <Ban size={14} /> : m === "masquerade" ? <UserRoundCheck size={14} /> : <MessageSquarePlus size={14} />;

  return (
    <div className="border-t border-border bg-panel">
      {mode !== "normal" && (
        <div className="flex items-center justify-between gap-3 border-b border-border bg-surface px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            {modeIcon(mode)}
            <span>当前模式：{modeLabel[mode]}</span>
            {mode === "masquerade" && (
              <input
                name="masquerade-guest-name"
                className="input h-7 w-32 text-xs"
                value={guestName}
                onChange={(event) => setGuestName(event.target.value)}
                placeholder="群友昵称"
              />
            )}
          </div>
          <button className="text-xs text-muted underline" type="button" onClick={() => setMode("normal")}>
            取消
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
            title="更多模式"
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
                label="裁决锁定"
              />
              <ModeOption
                onClick={() => {
                  setMode("dead_end");
                  setMenuOpen(false);
                }}
                icon={<Ban size={14} />}
                label="标记死路"
              />
              <ModeOption
                onClick={() => {
                  setMode("masquerade");
                  setMenuOpen(false);
                }}
                icon={<UserRoundCheck size={14} />}
                label="群友发言"
              />
            </div>
          )}
        </div>
        <textarea
          ref={textareaRef}
          name="message-content"
          className="textarea min-h-[40px] flex-1 resize-none"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          placeholder={frozen ? "房间已冻结" : "输入消息（Enter 发送，Shift+Enter 换行）"}
          disabled={frozen}
        />
        <button
          className="btn btn-primary"
          disabled={frozen || !content.trim() || submit.isPending}
          onClick={() => submit.mutate()}
        >
          {modeIcon(mode)}
          发送
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
