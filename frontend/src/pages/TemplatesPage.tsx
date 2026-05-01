import { useMemo, useState } from "react";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, useParams } from "react-router-dom";
import { Download, GripVertical, Plus, Save, Trash2 } from "lucide-react";
import { api } from "../api";
import type { DebateFormat, Persona, PhaseTemplate, Recipe } from "../types";
import { StatusPill } from "../components/StatusPill";

export function TemplatesPage() {
  const { kind = "phases" } = useParams();
  return (
    <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-4 max-lg:grid-cols-1">
      <aside className="panel p-2">
        <TemplateNav to="/templates/personas" label="人设" />
        <TemplateNav to="/templates/phases" label="Phase" />
        <TemplateNav to="/templates/formats" label="赛制" />
        <TemplateNav to="/templates/recipes" label="配方" />
      </aside>
      {kind === "personas" && <PersonasView />}
      {kind === "formats" && <FormatsView />}
      {kind === "recipes" && <RecipesView />}
      {kind === "phases" && <PhasesView />}
    </div>
  );
}

function TemplateNav({ to, label }: { to: string; label: string }) {
  return (
    <NavLink to={to} className={({ isActive }) => `block rounded-md px-3 py-2 text-sm ${isActive ? "bg-surface text-brand" : "text-muted hover:bg-surface"}`}>
      {label}
    </NavLink>
  );
}

function PersonasView() {
  const personas = useQuery({ queryKey: ["personas"], queryFn: () => api.personas() });
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const items = filterByTags(personas.data, selectedTags);
  return (
    <section className="space-y-3">
      <Header title="人设模板" />
      <TagFilterBar items={personas.data ?? []} selected={selectedTags} onChange={setSelectedTags} />
      <div className="grid grid-cols-2 gap-3 max-xl:grid-cols-1">
        {items.map((persona: Persona) => (
          <div key={persona.id} className="panel p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">{persona.name}</h2>
              <StatusPill tone={persona.kind === "discussant" ? "brand" : "accent"}>{persona.kind}</StatusPill>
            </div>
            <p className="mt-2 text-sm text-muted">{persona.description}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>{persona.backing_model}</span>
              {persona.tags.map((tag) => (
                <StatusPill key={tag}>{tag}</StatusPill>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

interface FormatSlotDraft {
  id: string;
  phaseId: string;
}

function FormatsView() {
  const queryClient = useQueryClient();
  const formats = useQuery({ queryKey: ["formats"], queryFn: api.formats });
  const phases = useQuery({ queryKey: ["phases"], queryFn: api.phases });
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [name, setName] = useState("我的评审赛制");
  const [description, setDescription] = useState("从模板页拖拽编排的讨论赛制。");
  const [tags, setTags] = useState("custom");
  const [phaseId, setPhaseId] = useState("");
  const [phaseSlots, setPhaseSlots] = useState<FormatSlotDraft[]>([]);
  const items = filterByTags(formats.data, selectedTags);
  const phaseById = useMemo(() => new Map((phases.data ?? []).map((phase) => [phase.id, phase])), [phases.data]);
  const create = useMutation({
    mutationFn: () =>
      api.createFormat({
        name,
        description,
        phase_sequence: phaseSlots.map((slot) => ({
          phase_template_id: slot.phaseId,
          phase_template_version: phaseById.get(slot.phaseId)?.version ?? 1,
          transitions: [{ condition: "always", target: "next" }]
        })),
        tags: splitTags(tags)
      }),
    onSuccess: () => {
      setName("我的评审赛制");
      setDescription("从模板页拖拽编排的讨论赛制。");
      setTags("custom");
      setPhaseSlots([]);
      void queryClient.invalidateQueries({ queryKey: ["formats"] });
    }
  });

  const addPhase = () => {
    const selectedPhaseId = phaseId || phases.data?.[0]?.id;
    if (!selectedPhaseId) return;
    setPhaseSlots((current) => [...current, { id: newSlotId(), phaseId: selectedPhaseId }]);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const overId = event.over?.id;
    if (!overId || event.active.id === overId) return;
    setPhaseSlots((current) => {
      const oldIndex = current.findIndex((slot) => slot.id === event.active.id);
      const newIndex = current.findIndex((slot) => slot.id === overId);
      if (oldIndex < 0 || newIndex < 0) return current;
      return arrayMove(current, oldIndex, newIndex);
    });
  };

  return (
    <section className="grid grid-cols-[minmax(0,1fr)_400px] gap-4 max-xl:grid-cols-1">
      <div className="space-y-3">
        <Header title="赛制模板" />
        <TagFilterBar items={formats.data ?? []} selected={selectedTags} onChange={setSelectedTags} />
        <div className="space-y-3">
          {items.map((format: DebateFormat) => (
            <div key={format.id} className="panel p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{format.name}</h2>
                  <p className="mt-1 text-sm text-muted">{format.description}</p>
                </div>
                <StatusPill tone={format.is_builtin ? "brand" : "accent"}>{format.phase_sequence.length} phases</StatusPill>
              </div>
              <ol className="mt-3 space-y-1 text-sm text-muted">
                {format.phase_sequence.slice(0, 5).map((slot, index) => (
                  <li key={`${format.id}-${index}-${slot.phase_template_id}`} className="flex gap-2">
                    <span className="text-xs text-muted">{index + 1}.</span>
                    <span>{phaseById.get(slot.phase_template_id)?.name ?? slot.phase_template_id}</span>
                  </li>
                ))}
                {format.phase_sequence.length > 5 && <li>+{format.phase_sequence.length - 5} phases</li>}
              </ol>
              {format.tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {format.tags.map((tag) => (
                    <StatusPill key={tag}>{tag}</StatusPill>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <aside className="panel p-4">
        <h2 className="font-semibold">新建赛制</h2>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="label">名称</span>
            <input className="input mt-1 w-full" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="block">
            <span className="label">描述</span>
            <textarea className="textarea mt-1 w-full" value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <label className="block">
            <span className="label">Tags</span>
            <input className="input mt-1 w-full" value={tags} onChange={(event) => setTags(event.target.value)} />
          </label>
          <div>
            <span className="label">Phase 顺序</span>
            <div className="mt-2 flex gap-2">
              <select className="input min-w-0 flex-1" value={phaseId} onChange={(event) => setPhaseId(event.target.value)}>
                <option value="">选择 Phase</option>
                {(phases.data ?? []).map((phase) => (
                  <option key={phase.id} value={phase.id}>
                    {phase.name}
                  </option>
                ))}
              </select>
              <button className="btn" type="button" onClick={addPhase} disabled={!phases.data?.length}>
                <Plus size={16} />
                加入
              </button>
            </div>
            <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={phaseSlots.map((slot) => slot.id)} strategy={verticalListSortingStrategy}>
                <div className="mt-3 space-y-2">
                  {phaseSlots.map((slot, index) => (
                    <FormatPhaseCard
                      key={slot.id}
                      index={index}
                      slot={slot}
                      phase={phaseById.get(slot.phaseId)}
                      onRemove={() => setPhaseSlots((current) => current.filter((item) => item.id !== slot.id))}
                    />
                  ))}
                  {phaseSlots.length === 0 && <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted">从上方加入 phase 后可拖拽排序。</div>}
                </div>
              </SortableContext>
            </DndContext>
          </div>
          <button className="btn btn-primary w-full" onClick={() => create.mutate()} disabled={!name.trim() || phaseSlots.length === 0 || create.isPending}>
            <Save size={16} />
            保存赛制
          </button>
        </div>
      </aside>
    </section>
  );
}

function FormatPhaseCard({
  index,
  slot,
  phase,
  onRemove
}: {
  index: number;
  slot: FormatSlotDraft;
  phase?: PhaseTemplate;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slot.id });
  const style = {
    transform: transform
      ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0) scaleX(${transform.scaleX}) scaleY(${transform.scaleY})`
      : undefined,
    transition
  };
  return (
    <div ref={setNodeRef} style={style} className={`rounded-md border border-border bg-panel p-3 ${isDragging ? "shadow-soft" : ""}`}>
      <div className="flex items-start gap-2">
        <button className="btn h-8 w-8 shrink-0 px-0" type="button" aria-label="拖拽排序" {...attributes} {...listeners}>
          <GripVertical size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">{index + 1}</span>
            <div className="truncate text-sm font-medium">{phase?.name ?? slot.phaseId}</div>
          </div>
          <div className="mt-1 flex flex-wrap gap-2">
            <StatusPill tone="brand">{phase?.ordering_rule.type ?? "unknown"}</StatusPill>
            {(phase?.tags ?? []).slice(0, 3).map((tag) => (
              <StatusPill key={tag}>{tag}</StatusPill>
            ))}
          </div>
        </div>
        <button className="btn btn-danger h-8 w-8 shrink-0 px-0" type="button" aria-label="移除 phase" onClick={onRemove}>
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}

function PhasesView() {
  const queryClient = useQueryClient();
  const phases = useQuery({ queryKey: ["phases"], queryFn: api.phases });
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const items = filterByTags(phases.data, selectedTags);
  const [name, setName] = useState("快速投票");
  const [tags, setTags] = useState("vote,parallel");
  const create = useMutation({
    mutationFn: () =>
      api.createPhase({
        name,
        description: "所有参辩者并行给出投票和理由。",
        declared_variables: [],
        allowed_speakers: { type: "all" },
        ordering_rule: { type: "parallel" },
        exit_conditions: [{ type: "all_voted" }],
        role_constraints: "给出赞成/反对/保留和一句理由。",
        prompt_template: "请投票并用一句话说明理由。",
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["phases"] })
  });
  return (
    <section className="grid grid-cols-[minmax(0,1fr)_340px] gap-4 max-xl:grid-cols-1">
      <div className="space-y-3">
        <Header title="Phase 模板" />
        <TagFilterBar items={phases.data ?? []} selected={selectedTags} onChange={setSelectedTags} />
        {items.map((phase: PhaseTemplate) => (
          <div key={phase.id} className="panel p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">{phase.name}</h2>
                <p className="mt-1 text-sm text-muted">{phase.description}</p>
              </div>
              <a className="btn" href={`/api/templates/phases/${phase.id}/export`}>
                <Download size={16} />
                导出
              </a>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusPill tone="brand">{phase.ordering_rule.type}</StatusPill>
              {phase.tags.map((tag) => (
                <StatusPill key={tag}>{tag}</StatusPill>
              ))}
            </div>
          </div>
        ))}
      </div>
      <aside className="panel p-4">
        <h2 className="font-semibold">新建 Phase</h2>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="label">名称</span>
            <input className="input mt-1 w-full" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="block">
            <span className="label">Tags</span>
            <input className="input mt-1 w-full" value={tags} onChange={(event) => setTags(event.target.value)} />
          </label>
          <button className="btn btn-primary w-full" onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>
            <Save size={16} />
            保存为 published
          </button>
        </div>
      </aside>
    </section>
  );
}

function RecipesView() {
  const queryClient = useQueryClient();
  const recipes = useQuery({ queryKey: ["recipes"], queryFn: api.recipes });
  const formats = useQuery({ queryKey: ["formats"], queryFn: api.formats });
  const personas = useQuery({ queryKey: ["personas", "discussant"], queryFn: () => api.personas("discussant") });
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const items = filterByTags(recipes.data, selectedTags);
  const [name, setName] = useState("我的方案评审配方");
  const [formatId, setFormatId] = useState("");
  const [personaIds, setPersonaIds] = useState<string[]>([]);
  const create = useMutation({
    mutationFn: () =>
      api.createRecipe({
        name,
        description: "从模板页创建的房间配方。",
        persona_ids: personaIds,
        format_id: formatId || formats.data?.[0]?.id,
        format_version: 1,
        initial_settings: { max_message_tokens: 900, max_room_tokens: 120000, auto_transition: false },
        tags: ["custom"]
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["recipes"] })
  });
  return (
    <section className="grid grid-cols-[minmax(0,1fr)_360px] gap-4 max-xl:grid-cols-1">
      <div className="space-y-3">
        <Header title="配方模板" />
        <TagFilterBar items={recipes.data ?? []} selected={selectedTags} onChange={setSelectedTags} />
        {items.map((recipe: Recipe) => (
          <div key={recipe.id} className="panel p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">{recipe.name}</h2>
                <p className="mt-1 text-sm text-muted">{recipe.description}</p>
              </div>
              <a className="btn" href={`/api/templates/recipes/${recipe.id}/export`}>
                <Download size={16} />
                导出
              </a>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusPill tone="brand">{recipe.persona_ids.length} personas</StatusPill>
              {recipe.tags.map((tag) => (
                <StatusPill key={tag}>{tag}</StatusPill>
              ))}
            </div>
          </div>
        ))}
      </div>
      <aside className="panel p-4">
        <h2 className="font-semibold">新建配方</h2>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="label">名称</span>
            <input className="input mt-1 w-full" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="block">
            <span className="label">赛制</span>
            <select className="input mt-1 w-full" value={formatId} onChange={(event) => setFormatId(event.target.value)}>
              <option value="">默认第一个赛制</option>
              {(formats.data ?? []).map((format) => (
                <option key={format.id} value={format.id}>
                  {format.name}
                </option>
              ))}
            </select>
          </label>
          <div>
            <div className="label">人设</div>
            <div className="mt-2 max-h-64 space-y-2 overflow-auto">
              {(personas.data ?? []).map((persona) => (
                <label key={persona.id} className="flex items-center gap-2 rounded-md border border-border p-2 text-sm">
                  <input
                    type="checkbox"
                    checked={personaIds.includes(persona.id)}
                    onChange={(event) =>
                      setPersonaIds(event.target.checked ? [...personaIds, persona.id] : personaIds.filter((id) => id !== persona.id))
                    }
                  />
                  {persona.name}
                </label>
              ))}
            </div>
          </div>
          <button className="btn btn-primary w-full" onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>
            <Save size={16} />
            保存配方
          </button>
        </div>
      </aside>
    </section>
  );
}

function splitTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function newSlotId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `slot-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function filterByTags<T extends { tags?: string[] }>(items: T[] | undefined, selected: string[]): T[] {
  if (!items) return [];
  if (!selected.length) return items;
  return items.filter((item) => selected.every((tag) => (item.tags ?? []).includes(tag)));
}

function TagFilterBar<T extends { tags?: string[] }>({
  items,
  selected,
  onChange
}: {
  items: T[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const allTags = Array.from(new Set(items.flatMap((item) => item.tags ?? []))).sort();
  if (!allTags.length) return null;
  const toggle = (tag: string) =>
    onChange(selected.includes(tag) ? selected.filter((value) => value !== tag) : [...selected, tag]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted">按 tag 过滤</span>
      {allTags.map((tag) => {
        const active = selected.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
              active ? "border-brand bg-brand/10 text-brand" : "border-border text-muted hover:bg-surface"
            }`}
            onClick={() => toggle(tag)}
          >
            #{tag}
          </button>
        );
      })}
      {selected.length > 0 && (
        <button type="button" className="text-xs text-muted underline" onClick={() => onChange([])}>
          清空
        </button>
      )}
    </div>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <section className="panel p-6">
      <Header title={`${title}模板`} />
      <p className="mt-3 text-sm text-muted">数据结构已在后端保留，当前界面先聚焦人设、phase 和赛制。</p>
    </section>
  );
}

function Header({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-muted">模板直接 published，fork 和 draft 状态按 schema 保留。</p>
      </div>
      <button className="btn">
        <Plus size={16} />
        新建
      </button>
    </div>
  );
}
