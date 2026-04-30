import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, useParams } from "react-router-dom";
import { Download, Plus, Save } from "lucide-react";
import { api } from "../api";
import type { DebateFormat, Persona, PhaseTemplate } from "../types";
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
      {kind === "recipes" && <Placeholder title="配方" />}
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
  return (
    <section className="space-y-3">
      <Header title="人设模板" />
      <div className="grid grid-cols-2 gap-3 max-xl:grid-cols-1">
        {(personas.data ?? []).map((persona: Persona) => (
          <div key={persona.id} className="panel p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">{persona.name}</h2>
              <StatusPill tone={persona.kind === "discussant" ? "brand" : "accent"}>{persona.kind}</StatusPill>
            </div>
            <p className="mt-2 text-sm text-muted">{persona.description}</p>
            <div className="mt-3 text-xs text-muted">{persona.backing_model}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FormatsView() {
  const formats = useQuery({ queryKey: ["formats"], queryFn: api.formats });
  return (
    <section className="space-y-3">
      <Header title="赛制模板" />
      <div className="space-y-3">
        {(formats.data ?? []).map((format: DebateFormat) => (
          <div key={format.id} className="panel p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">{format.name}</h2>
              <StatusPill tone="brand">{format.phase_sequence.length} phases</StatusPill>
            </div>
            <p className="mt-2 text-sm text-muted">{format.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function PhasesView() {
  const queryClient = useQueryClient();
  const phases = useQuery({ queryKey: ["phases"], queryFn: api.phases });
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
        {(phases.data ?? []).map((phase: PhaseTemplate) => (
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

