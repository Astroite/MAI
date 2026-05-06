import { useMemo, useState } from "react";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, useParams } from "react-router-dom";
import { Download, Eye, EyeOff, GripVertical, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { api } from "../api";
import type { DebateFormat, PersonaKind, PersonaTemplate, PhaseTemplate, Recipe } from "../types";
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
        <TemplateNav to="/templates/api" label="API 配置" />
      </aside>
      {kind === "personas" && <PersonasView />}
      {kind === "formats" && <FormatsView />}
      {kind === "recipes" && <RecipesView />}
      {kind === "phases" && <PhasesView />}
      {kind === "api" && <ApiProvidersView />}
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
  const queryClient = useQueryClient();
  const personas = useQuery({ queryKey: ["persona-templates"], queryFn: () => api.personaTemplates() });
  const apiProviders = useQuery({ queryKey: ["api-providers"], queryFn: api.apiProviders });
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const items = filterByTags(personas.data, selectedTags);
  const [kind, setKind] = useState<PersonaKind>("discussant");
  const [name, setName] = useState("自定义专家");
  const [description, setDescription] = useState("从模板页创建的人设。");
  const [backingModel, setBackingModel] = useState("openai/gpt-4o-mini");
  const [apiProviderId, setApiProviderId] = useState<string>("");
  const [temperature, setTemperature] = useState(0.4);
  const [tags, setTags] = useState("custom");
  const [systemPrompt, setSystemPrompt] = useState("你是参辩者。请基于事实和当前讨论上下文，给出清晰、可检验的观点。");
  const [configText, setConfigText] = useState("{}");
  const [editingPersonaId, setEditingPersonaId] = useState<string | null>(null);
  const configValue = parseJsonObject(configText);
  const editingPersona = personas.data?.find((persona) => persona.id === editingPersonaId);
  const personaPayload = () => ({
    kind,
    name,
    description,
    backing_model: backingModel,
    api_provider_id: apiProviderId || null,
    system_prompt: systemPrompt,
    temperature,
    config: configValue.value,
    tags: splitTags(tags)
  });
  const updatePayload = () => {
    const { kind: _kind, ...rest } = personaPayload();
    return rest;
  };
  const loadPersona = (persona: PersonaTemplate) => {
    setEditingPersonaId(persona.id);
    setKind(persona.kind);
    setName(persona.name);
    setDescription(persona.description);
    setBackingModel(persona.backing_model);
    setApiProviderId(persona.api_provider_id ?? "");
    setTemperature(persona.temperature);
    setTags(persona.tags.join(","));
    setSystemPrompt(persona.system_prompt);
    setConfigText(JSON.stringify(persona.config ?? {}, null, 2));
  };
  const resetPersonaForm = () => {
    setEditingPersonaId(null);
    setKind("discussant");
    setName("自定义专家");
    setDescription("从模板页创建的人设。");
    setBackingModel("openai/gpt-4o-mini");
    setApiProviderId("");
    setTemperature(0.4);
    setTags("custom");
    setSystemPrompt("你是参辩者。请基于事实和当前讨论上下文，给出清晰、可检验的观点。");
    setConfigText("{}");
  };
  const save = useMutation({
    mutationFn: () =>
      editingPersonaId
        ? api.updatePersonaTemplate(editingPersonaId, updatePayload())
        : api.createPersonaTemplate(personaPayload()),
    onSuccess: (saved) => {
      loadPersona(saved);
      void queryClient.invalidateQueries({ queryKey: ["persona-templates"] });
    }
  });
  const duplicate = useMutation({
    mutationFn: (templateId: string) => api.duplicatePersonaTemplate(templateId),
    onSuccess: (copy) => {
      loadPersona(copy);
      void queryClient.invalidateQueries({ queryKey: ["persona-templates"] });
    }
  });
  const editingIsBuiltin = editingPersona?.is_builtin ?? false;
  return (
    <section className="grid grid-cols-[minmax(0,1fr)_380px] gap-4 max-xl:grid-cols-1">
      <div className="space-y-3">
        <Header title="人设模板" />
        <p className="text-xs text-muted">
          模板是“蓝本”，加入房间时会派生为该房间专属的实例。在房间侧栏可对实例做局部调整，不影响模板。
        </p>
        <TagFilterBar items={personas.data ?? []} selected={selectedTags} onChange={setSelectedTags} />
        <div className="grid grid-cols-2 gap-3 max-xl:grid-cols-1">
          {items.map((persona: PersonaTemplate) => (
            <div key={persona.id} className="panel p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold">{persona.name}</h2>
                <div className="flex items-center gap-2">
                  <StatusPill tone={persona.kind === "discussant" ? "brand" : "accent"}>{persona.kind}</StatusPill>
                  {persona.is_builtin ? (
                    <button
                      className="btn h-8 px-2 text-xs"
                      type="button"
                      onClick={() => duplicate.mutate(persona.id)}
                      disabled={duplicate.isPending}
                    >
                      <Plus size={14} /> 复制为我的模板
                    </button>
                  ) : (
                    <button className="btn h-8 px-2 text-xs" type="button" onClick={() => loadPersona(persona)}>
                      <Pencil size={14} />
                      编辑
                    </button>
                  )}
                </div>
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
      </div>
      <aside className="panel p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">{editingPersonaId ? "编辑模板" : "新建模板"}</h2>
          {editingPersonaId && (
            <button className="btn h-8 px-2 text-xs" type="button" onClick={resetPersonaForm}>
              <Plus size={14} />
              新建
            </button>
          )}
        </div>
        {editingIsBuiltin && (
          <p className="mt-2 rounded-md border border-border bg-surface p-2 text-xs text-muted">
            内建模板只读。请使用“复制为我的模板”创建可编辑副本。
          </p>
        )}
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="label">Kind</span>
              <select
                name="persona-kind"
                className="input mt-1 w-full"
                value={kind}
                onChange={(event) => setKind(event.target.value as PersonaKind)}
                disabled={Boolean(editingPersonaId)}
              >
                <option value="discussant">discussant</option>
                <option value="scribe">scribe</option>
                <option value="facilitator">facilitator</option>
              </select>
            </label>
            <label className="block">
              <span className="label">Temperature</span>
              <input name="persona-temperature" className="input mt-1 w-full" type="number" min={0} max={2} step={0.1} value={temperature} onChange={(event) => setTemperature(Number(event.target.value))} />
            </label>
          </div>
          <label className="block">
            <span className="label">名称</span>
            <input name="persona-name" className="input mt-1 w-full" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="block">
            <span className="label">描述</span>
            <textarea name="persona-description" className="textarea mt-1 w-full" value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <label className="block">
            <span className="label">Backing Model</span>
            <input name="persona-backing-model" className="input mt-1 w-full" value={backingModel} onChange={(event) => setBackingModel(event.target.value)} />
            <p className="mt-1 text-xs text-muted">
              LiteLLM 模型名，例如 <code>openai/gpt-4o-mini</code>、<code>anthropic/claude-sonnet-4-5</code>。
            </p>
          </label>
          <label className="block">
            <span className="label">API 配置</span>
            <select
              name="persona-api-provider"
              className="input mt-1 w-full"
              value={apiProviderId}
              onChange={(event) => setApiProviderId(event.target.value)}
            >
              <option value="">默认（使用环境变量）</option>
              {(apiProviders.data ?? []).map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name} · {provider.provider_slug}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted">
              {(apiProviders.data?.length ?? 0) === 0 ? (
                <>
                  还没有 API 配置，<NavLink className="text-brand underline" to="/templates/api">前往新增</NavLink>
                </>
              ) : (
                "选中后调用此人设时将覆盖默认凭据。"
              )}
            </p>
          </label>
          <label className="block">
            <span className="label">Tags</span>
            <input name="persona-tags" className="input mt-1 w-full" value={tags} onChange={(event) => setTags(event.target.value)} />
          </label>
          <label className="block">
            <span className="label">System Prompt</span>
            <textarea name="persona-system-prompt" className="textarea mt-1 w-full" value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} />
          </label>
          <label className="block">
            <span className="label">Config JSON</span>
            <textarea name="persona-config-json" className="textarea mt-1 w-full font-mono" value={configText} onChange={(event) => setConfigText(event.target.value)} />
          </label>
          {!configValue.ok && <div className="text-xs text-danger">Config 必须是 JSON object。</div>}
          <button
            className="btn btn-primary w-full"
            onClick={() => save.mutate()}
            disabled={editingIsBuiltin || !name.trim() || !systemPrompt.trim() || !configValue.ok || save.isPending}
          >
            <Save size={16} />
            {editingPersonaId ? "保存修改" : "保存模板"}
          </button>
        </div>
      </aside>
    </section>
  );
}

interface FormatSlotDraft {
  id: string;
  phaseId: string;
  phaseVersion?: number;
  transitions?: Array<Record<string, unknown>>;
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
  const [editingFormatId, setEditingFormatId] = useState<string | null>(null);
  const items = filterByTags(formats.data, selectedTags);
  const phaseById = useMemo(() => new Map((phases.data ?? []).map((phase) => [phase.id, phase])), [phases.data]);
  const editingFormat = formats.data?.find((format) => format.id === editingFormatId);
  const formatPayload = () => ({
    name,
    description,
    phase_sequence: phaseSlots.map((slot) => ({
      phase_template_id: slot.phaseId,
      phase_template_version: slot.phaseVersion ?? phaseById.get(slot.phaseId)?.version ?? 1,
      transitions: slot.transitions ?? [{ condition: "always", target: "next" }]
    })),
    tags: splitTags(tags)
  });
  const loadFormat = (format: DebateFormat) => {
    setEditingFormatId(format.id);
    setName(format.name);
    setDescription(format.description);
    setTags(format.tags.join(","));
    setPhaseSlots(
      format.phase_sequence.map((slot) => ({
        id: newSlotId(),
        phaseId: slot.phase_template_id,
        phaseVersion: slot.phase_template_version,
        transitions: slot.transitions
      }))
    );
  };
  const resetFormatForm = () => {
    setEditingFormatId(null);
    setName("我的评审赛制");
    setDescription("从模板页拖拽编排的讨论赛制。");
    setTags("custom");
    setPhaseId("");
    setPhaseSlots([]);
  };
  const save = useMutation({
    mutationFn: () =>
      editingFormatId ? api.updateFormat(editingFormatId, formatPayload()) : api.createFormat(formatPayload()),
    onSuccess: (saved) => {
      loadFormat(saved);
      void queryClient.invalidateQueries({ queryKey: ["formats"] });
    }
  });

  const addPhase = () => {
    const selectedPhaseId = phaseId || phases.data?.[0]?.id;
    if (!selectedPhaseId) return;
    setPhaseSlots((current) => [
      ...current,
      { id: newSlotId(), phaseId: selectedPhaseId, phaseVersion: phaseById.get(selectedPhaseId)?.version ?? 1 }
    ]);
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
                <div className="flex items-center gap-2">
                  <StatusPill tone={format.is_builtin ? "brand" : "accent"}>{format.phase_sequence.length} phases</StatusPill>
                  <button className="btn h-8 px-2 text-xs" type="button" onClick={() => loadFormat(format)}>
                    <Pencil size={14} />
                    编辑
                  </button>
                </div>
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
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">{editingFormatId ? "编辑赛制" : "新建赛制"}</h2>
          {editingFormatId && (
            <button className="btn h-8 px-2 text-xs" type="button" onClick={resetFormatForm}>
              <Plus size={14} />
              新建
            </button>
          )}
        </div>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="label">名称</span>
            <input name="format-name" className="input mt-1 w-full" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="block">
            <span className="label">描述</span>
            <textarea name="format-description" className="textarea mt-1 w-full" value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <label className="block">
            <span className="label">Tags</span>
            <input name="format-tags" className="input mt-1 w-full" value={tags} onChange={(event) => setTags(event.target.value)} />
          </label>
          <div>
            <span className="label">Phase 顺序</span>
            <div className="mt-2 flex gap-2">
              <select name="format-phase" className="input min-w-0 flex-1" value={phaseId} onChange={(event) => setPhaseId(event.target.value)}>
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
          <button className="btn btn-primary w-full" onClick={() => save.mutate()} disabled={!name.trim() || phaseSlots.length === 0 || save.isPending}>
            <Save size={16} />
            {editingFormat?.is_builtin ? "保存为副本" : editingFormatId ? "保存修改" : "保存赛制"}
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
  const [description, setDescription] = useState("所有参辩者并行给出投票和理由。");
  const [tags, setTags] = useState("vote,parallel");
  const [allowedType, setAllowedType] = useState<"all" | "variables" | "specific">("all");
  const [allowedValues, setAllowedValues] = useState("");
  const [orderingType, setOrderingType] = useState("parallel");
  const [roleConstraints, setRoleConstraints] = useState("给出赞成/反对/保留和一句理由。");
  const [promptTemplate, setPromptTemplate] = useState("请投票并用一句话说明理由。");
  const [roundsExit, setRoundsExit] = useState(false);
  const [roundsN, setRoundsN] = useState(2);
  const [allSpokenExit, setAllSpokenExit] = useState(false);
  const [minEach, setMinEach] = useState(1);
  const [allVotedExit, setAllVotedExit] = useState(true);
  const [manualExit, setManualExit] = useState(false);
  const [tokenBudgetExit, setTokenBudgetExit] = useState(false);
  const [tokenBudget, setTokenBudget] = useState(12000);
  const [facilitatorExit, setFacilitatorExit] = useState(false);
  const [facilitatorTags, setFacilitatorTags] = useState("phase_exhausted");
  const allowedItems = splitTags(allowedValues);
  const exitConditions = buildExitConditions({
    roundsExit,
    roundsN,
    allSpokenExit,
    minEach,
    allVotedExit,
    manualExit,
    tokenBudgetExit,
    tokenBudget,
    facilitatorExit,
    facilitatorTags
  });
  const canSavePhase = Boolean(name.trim()) && exitConditions.length > 0 && (allowedType === "all" || allowedItems.length > 0);
  const create = useMutation({
    mutationFn: () =>
      api.createPhase({
        name,
        description,
        declared_variables:
          allowedType === "variables"
            ? allowedItems.map((item) => ({ name: item, description: "", cardinality: "many", required: true }))
            : [],
        allowed_speakers:
          allowedType === "variables"
            ? { type: "variables", variable_names: allowedItems }
            : allowedType === "specific"
              ? { type: "specific", persona_ids: allowedItems }
              : { type: "all" },
        ordering_rule: { type: orderingType },
        exit_conditions: exitConditions,
        role_constraints: roleConstraints,
        prompt_template: promptTemplate,
        tags: splitTags(tags)
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["phases"] })
  });
  return (
    <section className="grid grid-cols-[minmax(0,1fr)_440px] gap-4 max-xl:grid-cols-1">
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
              <StatusPill tone="accent">{String(phase.allowed_speakers.type ?? "allowed")}</StatusPill>
              {phase.exit_conditions.slice(0, 3).map((condition, index) => (
                <StatusPill key={`${phase.id}-exit-${index}`}>{String(condition.type ?? "exit")}</StatusPill>
              ))}
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
            <input name="phase-name" className="input mt-1 w-full" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="block">
            <span className="label">描述</span>
            <textarea name="phase-description" className="textarea mt-1 w-full" value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <label className="block">
            <span className="label">Tags</span>
            <input name="phase-tags" className="input mt-1 w-full" value={tags} onChange={(event) => setTags(event.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="label">发言范围</span>
              <select name="phase-allowed-type" className="input mt-1 w-full" value={allowedType} onChange={(event) => setAllowedType(event.target.value as "all" | "variables" | "specific")}>
                <option value="all">all</option>
                <option value="variables">variables</option>
                <option value="specific">specific</option>
              </select>
            </label>
            <label className="block">
              <span className="label">排序规则</span>
              <select name="phase-ordering-type" className="input mt-1 w-full" value={orderingType} onChange={(event) => setOrderingType(event.target.value)}>
                <option value="alternating">alternating</option>
                <option value="round_robin">round_robin</option>
                <option value="mention_driven">mention_driven</option>
                <option value="question_paired">question_paired</option>
                <option value="parallel">parallel</option>
                <option value="user_picks">user_picks</option>
              </select>
            </label>
          </div>
          {allowedType !== "all" && (
            <label className="block">
              <span className="label">{allowedType === "variables" ? "变量名" : "Persona IDs"}</span>
              <input name="phase-allowed-values" className="input mt-1 w-full" value={allowedValues} onChange={(event) => setAllowedValues(event.target.value)} />
            </label>
          )}
          <div>
            <div className="label">退出条件</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <label className="flex items-center gap-2 rounded-md border border-border p-2">
                <input name="phase-exit-rounds" type="checkbox" checked={roundsExit} onChange={(event) => setRoundsExit(event.target.checked)} />
                rounds
              </label>
              <input name="phase-rounds-count" className="input w-full" type="number" min={1} value={roundsN} onChange={(event) => setRoundsN(Number(event.target.value))} />
              <label className="flex items-center gap-2 rounded-md border border-border p-2">
                <input name="phase-exit-all-spoken" type="checkbox" checked={allSpokenExit} onChange={(event) => setAllSpokenExit(event.target.checked)} />
                all_spoken
              </label>
              <input name="phase-min-each" className="input w-full" type="number" min={1} value={minEach} onChange={(event) => setMinEach(Number(event.target.value))} />
              <label className="flex items-center gap-2 rounded-md border border-border p-2">
                <input name="phase-exit-all-voted" type="checkbox" checked={allVotedExit} onChange={(event) => setAllVotedExit(event.target.checked)} />
                all_voted
              </label>
              <label className="flex items-center gap-2 rounded-md border border-border p-2">
                <input name="phase-exit-manual" type="checkbox" checked={manualExit} onChange={(event) => setManualExit(event.target.checked)} />
                user_manual
              </label>
              <label className="flex items-center gap-2 rounded-md border border-border p-2">
                <input name="phase-exit-token-budget" type="checkbox" checked={tokenBudgetExit} onChange={(event) => setTokenBudgetExit(event.target.checked)} />
                token_budget
              </label>
              <input name="phase-token-budget" className="input w-full" type="number" min={1} value={tokenBudget} onChange={(event) => setTokenBudget(Number(event.target.value))} />
              <label className="flex items-center gap-2 rounded-md border border-border p-2">
                <input name="phase-exit-facilitator" type="checkbox" checked={facilitatorExit} onChange={(event) => setFacilitatorExit(event.target.checked)} />
                facilitator
              </label>
              <input name="phase-facilitator-tags" className="input w-full" value={facilitatorTags} onChange={(event) => setFacilitatorTags(event.target.value)} />
            </div>
          </div>
          <label className="block">
            <span className="label">角色约束</span>
            <textarea name="phase-role-constraints" className="textarea mt-1 w-full" value={roleConstraints} onChange={(event) => setRoleConstraints(event.target.value)} />
          </label>
          <label className="block">
            <span className="label">Prompt Template</span>
            <textarea name="phase-prompt-template" className="textarea mt-1 w-full" value={promptTemplate} onChange={(event) => setPromptTemplate(event.target.value)} />
          </label>
          <button className="btn btn-primary w-full" onClick={() => create.mutate()} disabled={!canSavePhase || create.isPending}>
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
  const personas = useQuery({
    queryKey: ["persona-templates", "discussant"],
    queryFn: () => api.personaTemplates("discussant")
  });
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
            <input name="recipe-name" className="input mt-1 w-full" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="block">
            <span className="label">赛制</span>
            <select name="recipe-format" className="input mt-1 w-full" value={formatId} onChange={(event) => setFormatId(event.target.value)}>
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
                    name={`recipe-persona-${persona.id}`}
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

export function ApiProvidersView() {
  const queryClient = useQueryClient();
  const providers = useQuery({ queryKey: ["api-providers"], queryFn: api.apiProviders });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [providerSlug, setProviderSlug] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [apiBase, setApiBase] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const editing = providers.data?.find((p) => p.id === editingId) ?? null;
  const resetForm = () => {
    setEditingId(null);
    setName("");
    setProviderSlug("openai");
    setApiKey("");
    setApiBase("");
    setShowKey(false);
    setPendingError(null);
  };
  const loadProvider = async (id: string) => {
    setEditingId(id);
    setPendingError(null);
    try {
      const detail = await api.apiProviderDetail(id);
      setName(detail.name);
      setProviderSlug(detail.provider_slug);
      setApiKey(detail.api_key);
      setApiBase(detail.api_base ?? "");
      setShowKey(false);
    } catch (err) {
      setPendingError(err instanceof Error ? err.message : "无法加载 API 配置");
    }
  };
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        provider_slug: providerSlug.trim(),
        api_key: apiKey,
        api_base: apiBase.trim() ? apiBase.trim() : null
      };
      return editingId ? api.updateApiProvider(editingId, body) : api.createApiProvider(body);
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ["api-providers"] });
      void queryClient.invalidateQueries({ queryKey: ["personas"] });
      setEditingId(saved.id);
      setName(saved.name);
      setProviderSlug(saved.provider_slug);
      setApiKey(saved.api_key);
      setApiBase(saved.api_base ?? "");
      setPendingError(null);
    },
    onError: (err) => setPendingError(err instanceof Error ? err.message : "保存失败")
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteApiProvider(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["api-providers"] });
      void queryClient.invalidateQueries({ queryKey: ["personas"] });
      resetForm();
    },
    onError: (err) => setPendingError(err instanceof Error ? err.message : "删除失败")
  });
  const handleDelete = (id: string) => {
    if (window.confirm("删除该 API 配置？引用它的人设会回退到默认凭据。")) {
      remove.mutate(id);
    }
  };
  return (
    <section className="grid grid-cols-[minmax(0,1fr)_380px] gap-4 max-xl:grid-cols-1">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">API 配置</h1>
            <p className="mt-1 text-sm text-muted">为人设指定外部 LLM 凭据。明文保存在本地数据库，不上传任何远端。</p>
          </div>
          <button className="btn" type="button" onClick={resetForm}>
            <Plus size={16} />
            新建
          </button>
        </div>
        <div className="space-y-3">
          {(providers.data ?? []).map((provider) => (
            <div
              key={provider.id}
              className={`panel p-4 ${editingId === provider.id ? "ring-1 ring-brand" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate font-semibold">{provider.name}</h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <StatusPill tone="brand">{provider.provider_slug}</StatusPill>
                    <span className="font-mono">{provider.api_key_preview || "(未设置)"}</span>
                    {provider.api_base && <span>· {provider.api_base}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button className="btn h-8 px-2 text-xs" type="button" onClick={() => void loadProvider(provider.id)}>
                    <Pencil size={14} />
                    编辑
                  </button>
                  <button
                    className="btn h-8 px-2 text-xs text-danger"
                    type="button"
                    onClick={() => handleDelete(provider.id)}
                    disabled={remove.isPending && remove.variables === provider.id}
                  >
                    <Trash2 size={14} />
                    删除
                  </button>
                </div>
              </div>
            </div>
          ))}
          {(providers.data ?? []).length === 0 && (
            <div className="panel p-6 text-sm text-muted">尚未创建任何 API 配置。</div>
          )}
        </div>
      </div>
      <aside className="panel p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">{editingId ? "编辑 API 配置" : "新建 API 配置"}</h2>
          {editingId && (
            <button className="btn h-8 px-2 text-xs" type="button" onClick={resetForm}>
              <Plus size={14} />
              新建
            </button>
          )}
        </div>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="label">名称</span>
            <input
              name="api-provider-name"
              className="input mt-1 w-full"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如 我的 OpenAI"
            />
          </label>
          <label className="block">
            <span className="label">Provider Slug</span>
            <select
              name="api-provider-slug"
              className="input mt-1 w-full"
              value={providerSlug}
              onChange={(event) => setProviderSlug(event.target.value)}
            >
              <option value="openai">openai</option>
              <option value="anthropic">anthropic</option>
              <option value="gemini">gemini</option>
              <option value="openrouter">openrouter</option>
              <option value="azure">azure</option>
              <option value="custom">custom</option>
            </select>
            <p className="mt-1 text-xs text-muted">
              用于在 UI 上区分；具体 LiteLLM 路由仍由人设的 Backing Model 决定。
            </p>
          </label>
          <label className="block">
            <span className="label">API Key</span>
            <div className="mt-1 flex items-stretch gap-2">
              <input
                name="api-provider-key"
                className="input flex-1"
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk-..."
              />
              <button
                type="button"
                className="btn px-2"
                onClick={() => setShowKey((value) => !value)}
                aria-label={showKey ? "隐藏" : "显示"}
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            {editing && !apiKey && (
              <p className="mt-1 text-xs text-muted">当前密钥：{editing.api_key_preview}（修改时请重新填入完整密钥）</p>
            )}
          </label>
          <label className="block">
            <span className="label">API Base（可选）</span>
            <input
              name="api-provider-base"
              className="input mt-1 w-full"
              value={apiBase}
              onChange={(event) => setApiBase(event.target.value)}
              placeholder="https://api.example.com/v1"
            />
            <p className="mt-1 text-xs text-muted">
              用于 OpenAI 兼容代理或自部署网关；空表示走 LiteLLM 默认地址。
            </p>
          </label>
          {pendingError && <div className="text-xs text-danger">{pendingError}</div>}
          <button
            className="btn btn-primary w-full"
            onClick={() => save.mutate()}
            disabled={!name.trim() || !providerSlug.trim() || save.isPending}
          >
            <Save size={16} />
            {editingId ? "保存修改" : "保存配置"}
          </button>
        </div>
      </aside>
    </section>
  );
}

function buildExitConditions(options: {
  roundsExit: boolean;
  roundsN: number;
  allSpokenExit: boolean;
  minEach: number;
  allVotedExit: boolean;
  manualExit: boolean;
  tokenBudgetExit: boolean;
  tokenBudget: number;
  facilitatorExit: boolean;
  facilitatorTags: string;
}): Array<Record<string, unknown>> {
  const conditions: Array<Record<string, unknown>> = [];
  if (options.roundsExit) conditions.push({ type: "rounds", n: Math.max(1, options.roundsN) });
  if (options.allSpokenExit) conditions.push({ type: "all_spoken", min_each: Math.max(1, options.minEach) });
  if (options.allVotedExit) conditions.push({ type: "all_voted" });
  if (options.manualExit) conditions.push({ type: "user_manual" });
  if (options.tokenBudgetExit) conditions.push({ type: "token_budget", max: Math.max(1, options.tokenBudget) });
  if (options.facilitatorExit) conditions.push({ type: "facilitator_suggests", trigger_if: splitTags(options.facilitatorTags) });
  return conditions;
}

function parseJsonObject(value: string): { ok: true; value: Record<string, unknown> } | { ok: false; value: Record<string, unknown> } {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ok: true, value: parsed as Record<string, unknown> };
    }
  } catch {
    return { ok: false, value: {} };
  }
  return { ok: false, value: {} };
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
