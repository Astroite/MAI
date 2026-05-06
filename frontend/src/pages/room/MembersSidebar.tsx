import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Save, Users, X } from "lucide-react";
import { api } from "../../api";
import { useUIStore } from "../../store";
import type { PersonaInstance } from "../../types";

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

export function MembersSidebar({
  roomId,
  personas,
  compact = false
}: {
  roomId: string;
  personas: PersonaInstance[];
  compact?: boolean;
}) {
  const streaming = useUIStore((state) => state.streaming);
  const [editingId, setEditingId] = useState<string | null>(null);
  const activePersonaIds = new Set(
    Object.values(streaming)
      .filter((item) => item.roomId === roomId)
      .map((item) => item.personaId)
  );
  const discussants = personas.filter((p) => p.kind === "discussant");
  const systemPersonas = personas.filter((p) => p.kind !== "discussant");

  if (compact) {
    return (
      <div className="border-b border-border px-3 py-2">
        <div className="mb-1 flex items-center gap-1 text-xs font-semibold text-muted">
          <Users size={12} />
          成员 · {discussants.length}
        </div>
        <div className="flex flex-wrap gap-1">
          {discussants.map((persona) => (
            <span
              key={persona.id}
              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs ${
                activePersonaIds.has(persona.id) ? "bg-brand/10 text-brand" : "bg-surface text-muted"
              }`}
              title={persona.name}
            >
              <span
                className="inline-block h-3.5 w-3.5 rounded-full text-[8px] font-semibold leading-3.5 text-white text-center"
                style={{ background: personaColor(persona.id) }}
              >
                {personaInitial(persona.name).slice(0, 1)}
              </span>
              {persona.name}
              {activePersonaIds.has(persona.id) && (
                <span className="h-1.5 w-1.5 rounded-full bg-brand" style={{ animation: "pulse-ring 1.4s ease-out infinite" }} />
              )}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-border bg-panel">
      <div className="border-b border-border px-3 py-3 text-sm font-semibold">
        成员 · {discussants.length}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {discussants.map((persona) => (
          <PersonaRow
            key={persona.id}
            roomId={roomId}
            persona={persona}
            speaking={activePersonaIds.has(persona.id)}
            isEditing={editingId === persona.id}
            onEditOpen={() => setEditingId(persona.id)}
            onEditClose={() => setEditingId(null)}
          />
        ))}
        {systemPersonas.length > 0 && (
          <>
            <div className="mt-4 px-2 text-xs uppercase tracking-wider text-muted">系统角色</div>
            {systemPersonas.map((persona) => (
              <PersonaRow
                key={persona.id}
                roomId={roomId}
                persona={persona}
                speaking={false}
                muted
                isEditing={editingId === persona.id}
                onEditOpen={() => setEditingId(persona.id)}
                onEditClose={() => setEditingId(null)}
              />
            ))}
          </>
        )}
      </div>
    </aside>
  );
}

function PersonaRow({
  roomId,
  persona,
  speaking,
  muted = false,
  isEditing,
  onEditOpen,
  onEditClose
}: {
  roomId: string;
  persona: PersonaInstance;
  speaking: boolean;
  muted?: boolean;
  isEditing: boolean;
  onEditOpen: () => void;
  onEditClose: () => void;
}) {
  return (
    <div
      className={`rounded-md px-2 py-2 text-sm ${
        speaking ? "bg-brand/10" : isEditing ? "bg-surface" : "hover:bg-surface"
      } ${muted ? "opacity-70" : ""}`}
    >
      <div className="flex items-start gap-2">
        <div className="relative">
          <div
            className="grid h-9 w-9 place-items-center rounded-full text-xs font-semibold text-white"
            style={{ background: personaColor(persona.id) }}
            aria-hidden="true"
          >
            {personaInitial(persona.name)}
          </div>
          {speaking && (
            <span
              className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-panel bg-brand"
              style={{ animation: "pulse-ring 1.4s ease-out infinite" }}
              aria-hidden="true"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{persona.name}</div>
          <div className="mt-0.5 truncate text-xs text-muted">{persona.backing_model}</div>
          {speaking && <div className="mt-0.5 text-xs text-brand">正在发言</div>}
        </div>
        <button
          type="button"
          className="btn h-7 px-2 text-xs"
          onClick={isEditing ? onEditClose : onEditOpen}
          aria-label={isEditing ? "关闭编辑" : "编辑人设"}
        >
          {isEditing ? <X size={12} /> : <Pencil size={12} />}
        </button>
      </div>
      {isEditing && (
        <PersonaInstanceEditor roomId={roomId} persona={persona} onClose={onEditClose} />
      )}
    </div>
  );
}

function PersonaInstanceEditor({
  roomId,
  persona,
  onClose
}: {
  roomId: string;
  persona: PersonaInstance;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [description, setDescription] = useState(persona.description);
  const [backingModel, setBackingModel] = useState(persona.backing_model);
  const [temperature, setTemperature] = useState(persona.temperature);
  const [systemPrompt, setSystemPrompt] = useState(persona.system_prompt);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api.updatePersonaInstance(roomId, persona.id, {
        description,
        backing_model: backingModel,
        temperature,
        system_prompt: systemPrompt
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["room", roomId] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "保存失败")
  });

  return (
    <form
      className="mt-3 space-y-2 rounded-md border border-border bg-panel p-2 text-xs"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <p className="text-muted">仅本房间生效。名称和角色继承自模板，不可修改。</p>
      <label className="block">
        <span className="label">描述</span>
        <textarea
          name="instance-description"
          className="textarea mt-1 w-full"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
        />
      </label>
      <label className="block">
        <span className="label">Backing model</span>
        <input
          name="instance-backing-model"
          className="input mt-1 w-full"
          value={backingModel}
          onChange={(event) => setBackingModel(event.target.value)}
        />
      </label>
      <label className="block">
        <span className="label">Temperature</span>
        <input
          name="instance-temperature"
          className="input mt-1 w-full"
          type="number"
          min={0}
          max={2}
          step={0.1}
          value={temperature}
          onChange={(event) => setTemperature(Number(event.target.value))}
        />
      </label>
      <label className="block">
        <span className="label">System prompt</span>
        <textarea
          name="instance-system-prompt"
          className="textarea mt-1 w-full font-mono"
          value={systemPrompt}
          onChange={(event) => setSystemPrompt(event.target.value)}
          rows={5}
        />
      </label>
      {error && <p className="text-danger">{error}</p>}
      <div className="flex gap-2">
        <button className="btn btn-primary h-8 px-2" type="submit" disabled={save.isPending}>
          <Save size={12} /> 保存
        </button>
        <button className="btn h-8 px-2" type="button" onClick={onClose}>
          取消
        </button>
      </div>
    </form>
  );
}
