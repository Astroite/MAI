import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, useParams } from "react-router-dom";
import { Download, Plus, Save } from "lucide-react";
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

function FormatsView() {
  const formats = useQuery({ queryKey: ["formats"], queryFn: api.formats });
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const items = filterByTags(formats.data, selectedTags);
  return (
    <section className="space-y-3">
      <Header title="赛制模板" />
      <TagFilterBar items={formats.data ?? []} selected={selectedTags} onChange={setSelectedTags} />
      <div className="space-y-3">
        {items.map((format: DebateFormat) => (
          <div key={format.id} className="panel p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">{format.name}</h2>
              <StatusPill tone="brand">{format.phase_sequence.length} phases</StatusPill>
            </div>
            <p className="mt-2 text-sm text-muted">{format.description}</p>
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
    </section>
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
