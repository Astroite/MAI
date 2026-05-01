import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Ban,
  FileUp,
  Gavel,
  GitBranchPlus,
  Merge,
  MessageSquarePlus,
  Play,
  Plus,
  RotateCcw,
  Snowflake,
  Unlock,
  UserRoundCheck
} from "lucide-react";
import { api } from "../api";
import { useRoomEvents } from "../hooks";
import { useUIStore } from "../store";
import type { Message, Persona, Room, Runtime, ScribeState } from "../types";
import { MarkdownBlock } from "../components/MarkdownBlock";
import { StatusPill } from "../components/StatusPill";

export function RoomPage() {
  const { roomId, subId } = useParams();
  const activeRoomId = subId ?? roomId;
  useRoomEvents(activeRoomId);
  const queryClient = useQueryClient();
  const room = useQuery({ queryKey: ["room", activeRoomId], queryFn: () => api.roomState(activeRoomId!), enabled: Boolean(activeRoomId) });
  const rooms = useQuery({ queryKey: ["rooms"], queryFn: api.rooms });
  const phases = useQuery({ queryKey: ["phases"], queryFn: api.phases });
  const [speakerId, setSpeakerId] = useState("");
  const [insertPhaseId, setInsertPhaseId] = useState("");
  const state = room.data;
  const discussants = useMemo(() => state?.personas.filter((p) => p.kind === "discussant") ?? [], [state]);
  const currentPhaseTemplate = phases.data?.find((phase) => phase.id === state?.current_phase?.phase_template_id);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["room", activeRoomId] });
  const runTurn = useMutation({ mutationFn: () => api.runTurn(activeRoomId!, speakerId || undefined), onSuccess: invalidate });
  const nextPhase = useMutation({ mutationFn: () => api.nextPhase(activeRoomId!), onSuccess: invalidate });
  const continuePhase = useMutation({ mutationFn: () => api.continuePhase(activeRoomId!), onSuccess: invalidate });
  const freeze = useMutation({ mutationFn: () => api.freeze(activeRoomId!), onSuccess: invalidate });
  const unfreeze = useMutation({ mutationFn: () => api.unfreeze(activeRoomId!), onSuccess: invalidate });
  const insertPhase = useMutation({ mutationFn: () => api.insertPhase(activeRoomId!, insertPhaseId), onSuccess: invalidate });

  if (!activeRoomId) return null;
  if (room.isLoading || !state) return <div className="panel p-6 text-sm text-muted">加载中...</div>;
  const childRooms = (rooms.data ?? []).filter((item) => item.parent_room_id === state.room.id);

  return (
    <div className="grid grid-cols-[280px_minmax(0,1fr)_340px] gap-4 max-xl:grid-cols-[260px_minmax(0,1fr)] max-lg:grid-cols-1">
      <aside className="space-y-4">
        <section className="panel p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold">{state.room.title}</h1>
              <div className="mt-2 flex flex-wrap gap-2">
                <StatusPill tone={state.room.status === "frozen" ? "danger" : "brand"}>{state.room.status}</StatusPill>
                <StatusPill tone="accent">≈{state.runtime.token_counter_total} tokens</StatusPill>
                {state.room.parent_room_id && <StatusPill tone="accent">子讨论</StatusPill>}
              </div>
            </div>
          </div>
          {state.room.parent_room_id && (
            <Link className="btn mt-3 w-full" to={`/rooms/${state.room.parent_room_id}`}>
              <ArrowLeft size={16} />
              返回父讨论
            </Link>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2">
            {state.runtime.frozen ? (
              <button className="btn" onClick={() => unfreeze.mutate()}>
                <Unlock size={16} />
                解冻
              </button>
            ) : (
              <button className="btn btn-danger" onClick={() => freeze.mutate()}>
                <Snowflake size={16} />
                冻结
              </button>
            )}
            <button className="btn" onClick={() => nextPhase.mutate()} disabled={state.runtime.frozen}>
              <Play size={16} />
              下一阶段
            </button>
          </div>
        </section>

        <section className="panel p-4">
          <div className="label">当前 Phase</div>
          <div className="mt-2 font-medium">{currentPhaseTemplate?.name ?? "-"}</div>
          <p className="mt-1 text-sm text-muted">{currentPhaseTemplate?.description}</p>
          <ol className="mt-4 space-y-2">
            {state.phase_plan.map((slot) => {
              const phase = phases.data?.find((item) => item.id === slot.phase_template_id);
              const active = slot.position === state.current_phase?.plan_position;
              return (
                <li key={`${slot.room_id}-${slot.position}`} className={`rounded-md border p-2 text-sm ${active ? "border-brand" : "border-border"}`}>
                  <div className="font-medium">
                    {slot.position + 1}. {phase?.name ?? slot.phase_template_id}
                  </div>
                  <div className="mt-0.5 text-xs text-muted">{slot.source}</div>
                </li>
              );
            })}
          </ol>
          <div className="mt-4 flex gap-2">
            <select className="input min-w-0 flex-1" value={insertPhaseId} onChange={(event) => setInsertPhaseId(event.target.value)}>
              <option value="">插入 phase</option>
              {(phases.data ?? []).map((phase) => (
                <option key={phase.id} value={phase.id}>
                  {phase.name}
                </option>
              ))}
            </select>
            <button className="btn w-9 px-0" disabled={!insertPhaseId || state.runtime.frozen} onClick={() => insertPhase.mutate()} title="插入">
              <Plus size={16} />
            </button>
          </div>
        </section>

        <section className="panel p-4">
          <div className="label">参辩人设</div>
          <div className="mt-3 space-y-2">
            {discussants.map((persona) => (
              <PersonaRow key={persona.id} persona={persona} />
            ))}
          </div>
        </section>
      </aside>

      <section className="flex min-h-[calc(100vh-96px)] flex-col overflow-hidden rounded-lg border border-border bg-panel">
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold">时间线</div>
              <div className="text-xs text-muted">append-only 消息、裁决、伪装和系统信号</div>
            </div>
            <div className="flex items-center gap-2">
              <select className="input" value={speakerId} onChange={(event) => setSpeakerId(event.target.value)}>
                <option value="">自动/等待用户</option>
                {discussants.map((persona) => (
                  <option key={persona.id} value={persona.id}>
                    {persona.name}
                  </option>
                ))}
              </select>
              <button className="btn btn-primary" disabled={state.runtime.frozen || runTurn.isPending} onClick={() => runTurn.mutate()}>
                <Play size={16} />
                发言
              </button>
            </div>
          </div>
        </div>
        {state.runtime.phase_exit_suggested && (
          <PhaseExitBanner
            matched={state.runtime.phase_exit_matched_conditions}
            onNext={() => nextPhase.mutate()}
            onContinue={() => continuePhase.mutate()}
            disabled={state.runtime.frozen || nextPhase.isPending || continuePhase.isPending}
          />
        )}
        <MessageList roomId={activeRoomId} frozen={state.runtime.frozen} messages={state.messages} personas={state.personas} />
        <Composer roomId={activeRoomId} personas={discussants} frozen={state.runtime.frozen} />
      </section>

      <aside className="space-y-4 max-xl:col-span-2 max-lg:col-span-1">
        <SubroomPanel
          roomId={activeRoomId}
          parentRoomId={state.room.parent_room_id}
          title={state.room.title}
          formatId={state.room.format_id ?? undefined}
          personaIds={discussants.map((persona) => persona.id)}
          childRooms={childRooms}
        />
        <LimitPanel roomId={activeRoomId} runtime={state.runtime} />
        <ScribePanel state={state.scribe_state.current_state} />
        <FacilitatorPanel roomId={activeRoomId} frozen={state.runtime.frozen} signals={state.facilitator_signals} />
        <UploadPanel roomId={activeRoomId} frozen={state.runtime.frozen} />
      </aside>
    </div>
  );
}

function PersonaRow({ persona }: { persona: Persona }) {
  return (
    <div className="rounded-md border border-border p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">{persona.name}</div>
        <span className="text-xs text-muted">{persona.backing_model}</span>
      </div>
      <div className="mt-1 text-xs text-muted">{persona.description}</div>
    </div>
  );
}

function PhaseExitBanner({
  matched,
  onNext,
  onContinue,
  disabled
}: {
  matched: Array<Record<string, unknown>>;
  onNext: () => void;
  onContinue: () => void;
  disabled: boolean;
}) {
  const label = matched.map((item) => String(item.type ?? "condition")).join(", ");
  return (
    <div className="border-b border-accent bg-accent/10 px-4 py-3">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 max-md:flex-col max-md:items-stretch">
        <div>
          <div className="text-sm font-semibold text-accent">当前阶段已满足退出条件</div>
          <div className="mt-0.5 text-xs text-muted">{label || "phase exit suggested"}</div>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-primary" disabled={disabled} onClick={onNext}>
            <Play size={16} />
            进入下一阶段
          </button>
          <button className="btn" disabled={disabled} onClick={onContinue}>
            再来一回合
          </button>
        </div>
      </div>
    </div>
  );
}

function SubroomPanel({
  roomId,
  parentRoomId,
  title,
  formatId,
  personaIds,
  childRooms
}: {
  roomId: string;
  parentRoomId?: string | null;
  title: string;
  formatId?: string;
  personaIds: string[];
  childRooms: Room[];
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [subroomTitle, setSubroomTitle] = useState(`子讨论：${title}`);
  const [conclusion, setConclusion] = useState("");
  const [keyReasoning, setKeyReasoning] = useState("");
  const [unresolved, setUnresolved] = useState("");
  const create = useMutation({
    mutationFn: () =>
      api.createSubroom(roomId, {
        title: subroomTitle,
        format_id: formatId,
        persona_ids: personaIds
      }),
    onSuccess: (state) => {
      void queryClient.invalidateQueries({ queryKey: ["rooms"] });
      navigate(`/rooms/${roomId}/sub/${state.room.id}`);
    }
  });
  const merge = useMutation({
    mutationFn: () =>
      api.mergeBack(roomId, {
        conclusion,
        key_reasoning: keyReasoning
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, 3),
        unresolved: unresolved
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
        rejected_alternatives: [],
        artifacts_ref: {}
      }),
    onSuccess: () => {
      if (parentRoomId) {
        void queryClient.invalidateQueries({ queryKey: ["room", parentRoomId] });
        navigate(`/rooms/${parentRoomId}`);
      }
    }
  });

  if (parentRoomId) {
    return (
      <section className="panel p-4">
        <div className="label">合并回父讨论</div>
        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="text-xs text-muted">结论</span>
            <textarea className="textarea mt-1 w-full" value={conclusion} onChange={(event) => setConclusion(event.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs text-muted">关键推理，每行一条</span>
            <textarea className="textarea mt-1 w-full" value={keyReasoning} onChange={(event) => setKeyReasoning(event.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs text-muted">未解决问题，每行一条</span>
            <textarea className="textarea mt-1 w-full" value={unresolved} onChange={(event) => setUnresolved(event.target.value)} />
          </label>
          <button className="btn btn-primary w-full" disabled={!conclusion.trim() || merge.isPending} onClick={() => merge.mutate()}>
            <Merge size={16} />
            合并
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="panel p-4">
      <div className="label">子讨论</div>
      <div className="mt-3 space-y-2">
        {childRooms.map((room) => (
          <Link key={room.id} className="block rounded-md border border-border p-2 text-sm hover:border-brand" to={`/rooms/${roomId}/sub/${room.id}`}>
            <span className="font-medium">{room.title}</span>
            <span className="mt-0.5 block text-xs text-muted">{room.status}</span>
          </Link>
        ))}
        {!childRooms.length && <div className="text-sm text-muted">暂无子讨论</div>}
      </div>
      <div className="mt-4 space-y-2">
        <input className="input w-full" value={subroomTitle} onChange={(event) => setSubroomTitle(event.target.value)} />
        <button className="btn w-full" disabled={!subroomTitle.trim() || create.isPending} onClick={() => create.mutate()}>
          <GitBranchPlus size={16} />
          开子讨论
        </button>
      </div>
    </section>
  );
}

function LimitPanel({ roomId, runtime }: { roomId: string; runtime: Runtime }) {
  const queryClient = useQueryClient();
  const [maxMessageTokens, setMaxMessageTokens] = useState(runtime.max_message_tokens);
  const [maxRoomTokens, setMaxRoomTokens] = useState(runtime.max_room_tokens);
  const [autoTransition, setAutoTransition] = useState(runtime.auto_transition);
  const update = useMutation({
    mutationFn: () =>
      api.updateLimits(roomId, {
        max_message_tokens: maxMessageTokens,
        max_room_tokens: maxRoomTokens,
        auto_transition: autoTransition
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["room", roomId] })
  });
  return (
    <section className="panel p-4">
      <div className="label">Limit 与阶段切换</div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-xs text-muted">单条 tokens</span>
          <input
            className="input mt-1 w-full"
            type="number"
            min={1}
            value={maxMessageTokens}
            onChange={(event) => setMaxMessageTokens(Number(event.target.value))}
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted">房间 tokens</span>
          <input
            className="input mt-1 w-full"
            type="number"
            min={1}
            value={maxRoomTokens}
            onChange={(event) => setMaxRoomTokens(Number(event.target.value))}
          />
        </label>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={autoTransition} onChange={(event) => setAutoTransition(event.target.checked)} />
        自动进入下一阶段
      </label>
      <button className="btn mt-3 w-full" onClick={() => update.mutate()} disabled={update.isPending}>
        保存
      </button>
    </section>
  );
}

function MessageList({ roomId, frozen, messages, personas }: { roomId: string; frozen: boolean; messages: Message[]; personas: Persona[] }) {
  const streaming = useUIStore((state) => state.streaming);
  const personaById = new Map(personas.map((persona) => [persona.id, persona]));
  const revokedMessageIds = new Set(
    messages
      .filter((message) => message.message_type === "verdict_revoke" && message.parent_message_id)
      .map((message) => message.parent_message_id)
  );
  const streamed = Object.values(streaming);
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-surface px-4 py-4">
      <div className="mx-auto max-w-4xl space-y-3">
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            roomId={roomId}
            frozen={frozen}
            message={message}
            persona={message.author_persona_id ? personaById.get(message.author_persona_id) : undefined}
            revoked={revokedMessageIds.has(message.id)}
          />
        ))}
        {streamed.map((item) => (
          <div key={item.messageId} className="rounded-lg border border-brand bg-panel p-3 shadow-soft">
            <div className="mb-2 text-xs font-medium text-brand">{personaById.get(item.personaId)?.name ?? "AI"} 正在发言</div>
            <MarkdownBlock content={item.text} />
          </div>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({
  roomId,
  frozen,
  message,
  persona,
  revoked
}: {
  roomId: string;
  frozen: boolean;
  message: Message;
  persona?: Persona;
  revoked: boolean;
}) {
  const queryClient = useQueryClient();
  const revoke = useMutation({
    mutationFn: () => api.verdict(roomId, `撤销裁决：${message.content}`, false, { revoke_message_id: message.id }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["room", roomId] })
  });
  const tone =
    message.author_actual === "user_as_judge"
      ? "border-accent"
      : message.author_actual === "user_as_persona"
        ? "border-brand"
        : message.visibility_to_models
          ? "border-border"
          : "border-dashed border-muted";
  const author =
    message.author_actual === "user"
      ? "用户"
      : message.author_actual === "user_as_judge"
        ? "裁决者"
        : message.author_actual === "system"
          ? "系统"
          : persona?.name ?? "AI";
  return (
    <article className={`rounded-lg border bg-panel p-3 ${tone}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{author}</span>
        <StatusPill tone={message.message_type === "facilitator_signal" ? "accent" : "neutral"}>{message.message_type}</StatusPill>
        {message.author_actual === "user_as_persona" && <StatusPill tone="brand">{message.user_revealed_at ? "已揭示" : "伪装"}</StatusPill>}
        {revoked && <StatusPill tone="danger">已撤销</StatusPill>}
        {message.truncated_reason && <StatusPill tone="danger">{message.truncated_reason}</StatusPill>}
        {message.message_type === "verdict" && message.author_actual === "user_as_judge" && !revoked && (
          <button className="btn h-7 px-2 text-xs" disabled={frozen || revoke.isPending} onClick={() => revoke.mutate()} title="撤销裁决">
            <RotateCcw size={13} />
            撤销
          </button>
        )}
      </div>
      <MarkdownBlock content={message.content} />
    </article>
  );
}

function Composer({ roomId, personas, frozen }: { roomId: string; personas: Persona[]; frozen: boolean }) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<"normal" | "judge" | "dead_end" | "masquerade">("normal");
  const [personaId, setPersonaId] = useState("");
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["room", roomId] });
  const submit = useMutation({
    mutationFn: async () => {
      if (mode === "judge") return api.verdict(roomId, content, true);
      if (mode === "dead_end") return api.verdict(roomId, content, false, { dead_end: true });
      if (mode === "masquerade") return api.masquerade(roomId, personaId || personas[0]?.id, content);
      return api.appendMessage(roomId, content);
    },
    onSuccess: () => {
      setContent("");
      invalidate();
    }
  });
  return (
    <div className="border-t border-border p-3">
      <div className="mb-2 flex flex-wrap gap-2">
        <select className="input" value={mode} onChange={(event) => setMode(event.target.value as "normal" | "judge" | "dead_end" | "masquerade")}>
          <option value="normal">普通发言</option>
          <option value="judge">裁决锁定</option>
          <option value="dead_end">标记死路</option>
          <option value="masquerade">伪装人设</option>
        </select>
        {mode === "masquerade" && (
          <select className="input" value={personaId} onChange={(event) => setPersonaId(event.target.value)}>
            {personas.map((persona) => (
              <option key={persona.id} value={persona.id}>
                {persona.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <textarea className="textarea w-full" value={content} onChange={(event) => setContent(event.target.value)} disabled={frozen} />
      <div className="mt-2 flex justify-end">
        <button className="btn btn-primary" disabled={frozen || !content.trim() || submit.isPending} onClick={() => submit.mutate()}>
          {mode === "judge" ? (
            <Gavel size={16} />
          ) : mode === "dead_end" ? (
            <Ban size={16} />
          ) : mode === "masquerade" ? (
            <UserRoundCheck size={16} />
          ) : (
            <MessageSquarePlus size={16} />
          )}
          提交
        </button>
      </div>
    </div>
  );
}

function ScribePanel({ state }: { state: ScribeState }) {
  const keys: Array<[string, string]> = [
    ["decisions", "决议"],
    ["consensus", "共识"],
    ["disagreements", "分歧"],
    ["open_questions", "开放问题"],
    ["artifacts", "产物"],
    ["dead_ends", "死路"]
  ];
  return (
    <section className="panel p-4">
      <div className="label">书记官状态</div>
      <div className="mt-3 space-y-3">
        {keys.map(([key, label]) => (
          <div key={key}>
            <div className="text-sm font-medium">{label}</div>
            <div className="mt-1 space-y-1">
              {(state[key as keyof ScribeState] ?? []).slice(-3).map((item, index) => (
                <div key={index} className="rounded-md bg-surface p-2 text-xs text-muted">
                  {String(item.content ?? item.title ?? item.message_id ?? "已记录")}
                </div>
              ))}
              {!state[key as keyof ScribeState]?.length && <div className="text-xs text-muted">暂无</div>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FacilitatorPanel({
  roomId,
  frozen,
  signals
}: {
  roomId: string;
  frozen: boolean;
  signals: Array<{ id: string; overall_health: string; pacing_note: string; signals: Array<{ tag: string; reasoning: string; severity: string }> }>;
}) {
  const queryClient = useQueryClient();
  const ask = useMutation({
    mutationFn: () => api.askFacilitator(roomId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["room", roomId] })
  });
  return (
    <section className="panel p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="label">上帝副手</div>
        <button className="btn h-8 px-2 text-xs" disabled={frozen || ask.isPending} onClick={() => ask.mutate()} title="请求当前讨论健康度">
          <MessageSquarePlus size={14} />
          询问
        </button>
      </div>
      <div className="mt-3 space-y-2">
        {signals.slice(0, 4).map((signal) => (
          <div key={signal.id} className="rounded-md border border-border p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">{signal.overall_health}</div>
              <StatusPill tone="accent">{signal.signals[0]?.tag ?? "signal"}</StatusPill>
            </div>
            <div className="mt-1 text-xs text-muted">{signal.pacing_note}</div>
          </div>
        ))}
        {!signals.length && <div className="text-sm text-muted">暂无信号</div>}
      </div>
    </section>
  );
}

function UploadPanel({ roomId, frozen }: { roomId: string; frozen: boolean }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const upload = useMutation({
    mutationFn: async () => {
      if (!file) return;
      const saved = await api.upload(roomId, file);
      await api.messageFromUpload(roomId, saved.id);
    },
    onSuccess: () => {
      setFile(null);
      void queryClient.invalidateQueries({ queryKey: ["room", roomId] });
    }
  });
  return (
    <section className="panel p-4">
      <div className="label">文档上传</div>
      <input
        className="mt-3 block w-full text-sm"
        type="file"
        accept=".md,.txt,.pdf"
        disabled={frozen}
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      <button className="btn mt-3 w-full" disabled={!file || frozen || upload.isPending} onClick={() => upload.mutate()}>
        <FileUp size={16} />
        作为附件消息加入
      </button>
    </section>
  );
}
