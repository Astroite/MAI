import { useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, useParams } from "react-router-dom";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cog,
  Download,
  Eye,
  EyeOff,
  GripVertical,
  Layers,
  Pencil,
  Plus,
  Save,
  ScrollText,
  Sparkles,
  Trash2,
  UsersRound,
  Wifi,
  Workflow,
  XCircle
} from "lucide-react";
import { api } from "../api";
import type { ApiModel, ApiProvider, DebateFormat, PersonaKind, PersonaTemplate, PhaseTemplate, Recipe } from "../types";
import { StatusPill } from "../components/StatusPill";
import { toast } from "../components/Toaster";
import { useConfirm } from "../components/ConfirmDialog";
import { useUnsavedChangesWarning } from "../hooks";
import { useI18n } from "../i18n";
import { PROVIDER_KINDS, providerKindLabel } from "../providers";
import {
  DEFAULT_PERSONA_COLOR,
  DEFAULT_PERSONA_ICON,
  PERSONA_COLORS,
  PERSONA_ICONS,
  PERSONA_ICON_KEYS,
  PersonaIcon,
  resolvePersonaIcon
} from "../components/PersonaIcon";

const TAB_ENTRIES = [
  { kind: "personas", labelKey: "templates.personas", icon: UsersRound },
  { kind: "phases", labelKey: "templates.phases", icon: Layers },
  { kind: "formats", labelKey: "templates.formats", icon: Workflow },
  { kind: "recipes", labelKey: "templates.recipes", icon: ScrollText },
  { kind: "api", labelKey: "templates.api", icon: Cog }
] as const;

export function TemplatesPage() {
  const { kind = "phases" } = useParams();
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <nav
        className="panel mai-scrollbar flex items-center gap-1 overflow-x-auto p-1.5"
        aria-label={t("templates.navAria")}
      >
        {TAB_ENTRIES.map((entry) => {
          const Icon = entry.icon;
          return (
            <NavLink
              key={entry.kind}
              to={`/templates/${entry.kind}`}
              className={({ isActive }) =>
                `inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition ${
                  isActive
                    ? "bg-brand text-white shadow-card"
                    : "text-muted hover:bg-surface hover:text-text"
                }`
              }
            >
              <Icon size={15} />
              {t(entry.labelKey)}
            </NavLink>
          );
        })}
      </nav>
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
  const { t, display } = useI18n();
  const confirm = useConfirm();
  const personas = useQuery({ queryKey: ["persona-templates", "editable"], queryFn: () => api.personaTemplates(undefined, false) });
  const builtinPersonas = useQuery({ queryKey: ["persona-templates", "builtin"], queryFn: () => api.personaTemplates(undefined, true) });
  const apiProviders = useQuery({ queryKey: ["api-providers"], queryFn: api.apiProviders });
  const apiModels = useQuery({ queryKey: ["api-models"], queryFn: () => api.apiModels() });
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);
  const items = filterByTags(personas.data, selectedTags);
  const providerById = useMemo(
    () => new Map((apiProviders.data ?? []).map((provider) => [provider.id, provider])),
    [apiProviders.data]
  );
  const modelById = useMemo(
    () => new Map((apiModels.data ?? []).map((model) => [model.id, model])),
    [apiModels.data]
  );
  const [kind, setKind] = useState<PersonaKind>("discussant");
  const [name, setName] = useState(() => t("templates.defaultPersonaName"));
  const [description, setDescription] = useState(() => t("templates.defaultPersonaDescription"));
  const [apiModelId, setApiModelId] = useState<string>("");
  const [temperature, setTemperature] = useState(0.4);
  const [talkativeness, setTalkativeness] = useState(1.0);
  const [color, setColor] = useState<string>(DEFAULT_PERSONA_COLOR);
  const [icon, setIcon] = useState<string>(DEFAULT_PERSONA_ICON);
  const [tags, setTags] = useState("custom");
  const [systemPrompt, setSystemPrompt] = useState(() => t("templates.defaultPersonaPrompt"));
  const [configText, setConfigText] = useState("{}");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [editingPersonaId, setEditingPersonaId] = useState<string | null>(null);
  const configValue = parseJsonObject(configText);
  const editingPersona = personas.data?.find((persona) => persona.id === editingPersonaId);
  const selectedApiModel = apiModelId ? modelById.get(apiModelId) : undefined;
  const personaModelPayload = () =>
    selectedApiModel
      ? {
          api_model_id: selectedApiModel.id,
          api_provider_id: selectedApiModel.api_provider_id,
          backing_model: selectedApiModel.model_name
        }
      : {
          api_model_id: null,
          api_provider_id: null,
          backing_model: ""
        };
  const personaPayload = () => ({
    kind,
    name,
    description,
    ...personaModelPayload(),
    system_prompt: systemPrompt,
    temperature,
    talkativeness,
    color,
    icon,
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
    setApiModelId(persona.api_model_id ?? "");
    setTemperature(persona.temperature);
    setTalkativeness(persona.talkativeness ?? 1.0);
    setColor(persona.color || DEFAULT_PERSONA_COLOR);
    setIcon(persona.icon || DEFAULT_PERSONA_ICON);
    setTags(persona.tags.join(","));
    setSystemPrompt(persona.system_prompt);
    setConfigText(JSON.stringify(persona.config ?? {}, null, 2));
  };
  const resetPersonaForm = () => {
    setEditingPersonaId(null);
    setKind("discussant");
    setName(t("templates.defaultPersonaName"));
    setDescription(t("templates.defaultPersonaDescription"));
    setApiModelId("");
    setTemperature(0.4);
    setTalkativeness(1.0);
    setColor(DEFAULT_PERSONA_COLOR);
    setIcon(DEFAULT_PERSONA_ICON);
    setTags("custom");
    setSystemPrompt(t("templates.defaultPersonaPrompt"));
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
  const draftPersona = useMutation({
    mutationFn: () => api.templateDraft({ kind: "persona", prompt: draftPrompt }),
    onSuccess: (draft) => {
      const payload = draft.payload ?? {};
      setEditingPersonaId(null);
      setKind(payload.kind === "scribe" || payload.kind === "facilitator" ? payload.kind : "discussant");
      setName(typeof payload.name === "string" ? payload.name : name);
      setDescription(typeof payload.description === "string" ? payload.description : description);
      setSystemPrompt(typeof payload.system_prompt === "string" ? payload.system_prompt : systemPrompt);
      setTemperature(typeof payload.temperature === "number" ? payload.temperature : temperature);
      setTalkativeness(typeof payload.talkativeness === "number" ? payload.talkativeness : talkativeness);
      if (typeof payload.color === "string" && /^#[0-9a-fA-F]{6}$/.test(payload.color)) {
        setColor(payload.color);
      }
      if (typeof payload.icon === "string" && PERSONA_ICON_KEYS.includes(payload.icon)) {
        setIcon(payload.icon);
      }
      setTags(Array.isArray(payload.tags) ? payload.tags.map(String).join(",") : tags);
      setConfigText(
        payload.config && typeof payload.config === "object" && !Array.isArray(payload.config)
          ? JSON.stringify(payload.config, null, 2)
          : "{}"
      );
    }
  });
  const addFromBuiltin = useMutation({
    mutationFn: (templateId: string) => api.duplicatePersonaTemplate(templateId),
    onSuccess: (copy) => {
      loadPersona(copy);
      setShowLibrary(false);
      void queryClient.invalidateQueries({ queryKey: ["persona-templates"] });
    }
  });
  const remove = useMutation({
    mutationFn: (templateId: string) => api.deletePersonaTemplate(templateId),
    onSuccess: () => {
      resetPersonaForm();
      void queryClient.invalidateQueries({ queryKey: ["persona-templates"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("api.deleteFailed"))
  });
  const deletePersona = async (persona: PersonaTemplate, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (await confirm({
      title: t("templates.deletePersonaConfirm", { name: persona.name }),
      danger: true,
      confirmLabel: t("common.delete")
    })) {
      remove.mutate(persona.id);
    }
  };
  const editingIsBuiltin = editingPersona?.is_builtin ?? false;
  // Form is dirty when the current values diverge from the loaded persona's
  // values (or from the blank default if creating a new one). JSON.stringify
  // is good enough for this shallow compare.
  const personaDirty = useMemo(() => {
    const current = JSON.stringify(personaPayload());
    if (editingPersona) {
      const loaded = {
        kind: editingPersona.kind,
        name: editingPersona.name,
        description: editingPersona.description,
        api_model_id: editingPersona.api_model_id ?? null,
        api_provider_id: editingPersona.api_provider_id ?? null,
        backing_model: editingPersona.backing_model ?? "",
        system_prompt: editingPersona.system_prompt,
        temperature: editingPersona.temperature,
        talkativeness: editingPersona.talkativeness ?? 1.0,
        color: editingPersona.color || DEFAULT_PERSONA_COLOR,
        icon: editingPersona.icon || DEFAULT_PERSONA_ICON,
        config: editingPersona.config ?? {},
        tags: editingPersona.tags ?? []
      };
      return current !== JSON.stringify(loaded);
    }
    return false;
  }, [personaPayload, editingPersona]); // eslint-disable-line react-hooks/exhaustive-deps
  useUnsavedChangesWarning(personaDirty && !editingIsBuiltin);
  return (
    <section className="grid grid-cols-[minmax(0,1fr)_380px] gap-4 max-xl:grid-cols-1">
      <div className="space-y-3">
        <Header
          title={t("templates.personas")}
          subtitle={t("templates.personaHelp")}
          actionLabel={t("templates.fromBuiltin")}
          onAction={() => setShowLibrary((value) => !value)}
          metrics={
            <>
              <StatusPill>{t("common.personaCount", { count: items.length })}</StatusPill>
              {(builtinPersonas.data?.length ?? 0) > 0 && (
                <span>
                  {t("templates.builtinAvailable", { count: builtinPersonas.data?.length ?? 0 })}
                </span>
              )}
            </>
          }
        />
        {showLibrary && (
          <BuiltinLibrary
            title={t("templates.personaBuiltin")}
            items={builtinPersonas.data ?? []}
            addingId={addFromBuiltin.variables}
            isAdding={addFromBuiltin.isPending}
            onAdd={(persona) => addFromBuiltin.mutate(persona.id)}
            renderMeta={(persona) => (
              <>
                <StatusPill tone={persona.kind === "discussant" ? "brand" : "accent"}>{display("personaKind", persona.kind)}</StatusPill>
                <span>{personaModelLabel(persona, modelById, providerById, t)}</span>
              </>
            )}
          />
        )}
        <TagFilterBar items={personas.data ?? []} selected={selectedTags} onChange={setSelectedTags} />
        <div className="grid grid-cols-2 gap-3 max-xl:grid-cols-1">
          {items.map((persona: PersonaTemplate) => {
            const active = editingPersonaId === persona.id;
            const personaColor = persona.color || DEFAULT_PERSONA_COLOR;
            return (
              <div
                key={persona.id}
                className={`group relative cursor-pointer overflow-hidden rounded-lg border bg-panel p-4 pl-5 shadow-card transition hover:shadow-soft ${
                  active ? "ring-1" : ""
                }`}
                style={{
                  borderColor: active ? personaColor : undefined,
                  ["--tw-ring-color" as string]: personaColor
                }}
                role="button"
                tabIndex={0}
                onClick={() => loadPersona(persona)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    loadPersona(persona);
                  }
                }}
              >
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 w-1.5"
                  style={{ backgroundColor: personaColor }}
                />
                <div className="flex items-start gap-3">
                  <PersonaIcon icon={persona.icon} color={personaColor} size={44} rounded="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="min-w-0 truncate text-sm font-semibold leading-5">{persona.name}</h2>
                      <div className="flex shrink-0 items-center gap-1.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                        <button
                          className="btn h-8 w-8 px-0"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            loadPersona(persona);
                          }}
                          title={t("common.edit")}
                          aria-label={t("common.edit")}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          className="btn btn-danger h-8 w-8 px-0"
                          type="button"
                          onClick={(event) => deletePersona(persona, event)}
                          disabled={remove.isPending && remove.variables === persona.id}
                          title={t("common.delete")}
                          aria-label={t("common.delete")}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <StatusPill tone={persona.kind === "discussant" ? "brand" : "accent"}>
                        {display("personaKind", persona.kind)}
                      </StatusPill>
                      <span className="truncate text-[11px] text-muted">
                        {personaModelLabel(persona, modelById, providerById, t)}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs text-muted">{persona.description}</p>
                  </div>
                </div>
                {persona.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2 text-xs">
                    {persona.tags.slice(0, 5).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-md bg-surface px-1.5 py-0.5 text-[11px] text-muted"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {items.length === 0 && <EmptyState title={t("templates.emptyEditablePersona")} onAdd={() => setShowLibrary(true)} />}
        </div>
      </div>
      <aside className="panel p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">{editingPersonaId ? t("templates.editPersona") : t("templates.blankPersona")}</h2>
            {personaDirty && !editingIsBuiltin && (
              <StatusPill tone="accent">{t("common.unsaved")}</StatusPill>
            )}
          </div>
          {editingPersonaId && (
            <button className="btn h-8 px-2 text-xs" type="button" onClick={resetPersonaForm}>
              <Plus size={14} />
              {t("common.new")}
            </button>
          )}
        </div>
        {editingIsBuiltin && (
          <p className="mt-2 rounded-md border border-border bg-surface p-2 text-xs text-muted">
            {t("templates.readonlyBuiltin")}
          </p>
        )}
        <div className="mt-4 space-y-3">
          {/* Identity: avatar + name + kind on one row */}
          <div className="flex items-end gap-2">
            <PersonaIcon icon={icon} color={color} size={44} rounded="lg" />
            <label className="block min-w-0 flex-1">
              <span className="label">{t("common.name")}</span>
              <input
                name="persona-name"
                className="input mt-1 w-full"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="block w-28 shrink-0">
              <span className="label">{t("templates.kind")}</span>
              <select
                name="persona-kind"
                className="input mt-1 w-full"
                value={kind}
                onChange={(event) => setKind(event.target.value as PersonaKind)}
                disabled={Boolean(editingPersonaId)}
              >
                <option value="discussant">{display("personaKind", "discussant")}</option>
                <option value="scribe">{display("personaKind", "scribe")}</option>
                <option value="facilitator">{display("personaKind", "facilitator")}</option>
              </select>
            </label>
          </div>

          {/* Numeric row — temperature + talkativeness inline */}
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="label">{t("templates.temperature")}</span>
              <input
                name="persona-temperature"
                className="input mt-1 w-full"
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={temperature}
                onChange={(event) => setTemperature(Number(event.target.value))}
              />
            </label>
            <label className="block" title={t("templates.talkativenessHelp")}>
              <span className="label">
                {t("templates.talkativeness")}
                <span className="ml-1 text-xs text-muted">{talkativeness.toFixed(1)}</span>
              </span>
              <input
                name="persona-talkativeness"
                className="mt-2 w-full"
                type="range"
                min={0}
                max={3}
                step={0.1}
                value={talkativeness}
                onChange={(event) => setTalkativeness(Number(event.target.value))}
              />
            </label>
          </div>

          <label className="block">
            <span className="label">{t("common.description")}</span>
            <textarea
              name="persona-description"
              className="textarea mt-1 w-full"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>

          <label className="block">
            <span className="label">{t("common.model")}</span>
            <select
              name="persona-api-model"
              className="input mt-1 w-full"
              value={apiModelId}
              onChange={(event) => setApiModelId(event.target.value)}
            >
              <option value="">{t("room.defaultModel")}</option>
              {renderApiModelOptions(apiModels.data ?? [], providerById, t)}
            </select>
            {(apiModels.data?.length ?? 0) === 0 && (
              <p className="mt-1 text-xs text-muted">
                {t("templates.noModelGoAdd")}{" "}
                <NavLink className="text-brand underline" to="/templates/api">
                  {t("common.add")}
                </NavLink>
              </p>
            )}
          </label>

          <label className="block">
            <span className="label">{t("templates.systemPrompt")}</span>
            <textarea
              name="persona-system-prompt"
              className="textarea mt-1 w-full"
              rows={5}
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
            />
          </label>

          {/* Collapsible: appearance picker */}
          <details className="rounded-md border border-border bg-surface">
            <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm font-medium">
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: color }}
                />
                {t("templates.appearance")}
              </span>
              <span className="text-xs text-muted">{icon}</span>
            </summary>
            <div className="border-t border-border px-3 py-3">
              <div className="flex flex-wrap gap-1.5">
                {PERSONA_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={c}
                    aria-pressed={color === c}
                    onClick={() => setColor(c)}
                    disabled={editingIsBuiltin}
                    className="h-7 w-7 rounded-full border-2 transition hover:scale-110"
                    style={{
                      backgroundColor: c,
                      borderColor: color === c ? "var(--text)" : "transparent"
                    }}
                  />
                ))}
              </div>
              <div className="mt-3 grid grid-cols-8 gap-1">
                {PERSONA_ICON_KEYS.map((key) => {
                  const Icon = PERSONA_ICONS[key];
                  const selected = icon === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-label={key}
                      aria-pressed={selected}
                      onClick={() => setIcon(key)}
                      disabled={editingIsBuiltin}
                      className={`grid h-8 w-8 place-items-center rounded-md border transition ${
                        selected ? "border-current" : "border-border bg-panel hover:border-current"
                      }`}
                      style={{
                        color: selected ? color : undefined,
                        backgroundColor: selected ? `${color}1f` : undefined
                      }}
                    >
                      <Icon size={15} />
                    </button>
                  );
                })}
              </div>
            </div>
          </details>

          {/* Collapsible: AI assistant draft */}
          <details className="rounded-md border border-border bg-surface">
            <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium">
              <Sparkles size={14} />
              {t("templates.assistant")}
            </summary>
            <div className="border-t border-border px-3 py-3">
              <textarea
                name="persona-draft-prompt"
                className="textarea h-20 w-full"
                value={draftPrompt}
                onChange={(event) => setDraftPrompt(event.target.value)}
                placeholder={t("templates.personaDraftPlaceholder")}
              />
              <button
                className="btn mt-2 w-full"
                type="button"
                onClick={() => draftPersona.mutate()}
                disabled={!draftPrompt.trim() || draftPersona.isPending}
              >
                <Sparkles size={14} />
                {draftPersona.isPending ? t("common.loading") : t("templates.applyDraft")}
              </button>
              {draftPersona.error instanceof Error && (
                <p className="mt-2 text-xs text-danger">{draftPersona.error.message}</p>
              )}
            </div>
          </details>

          {/* Collapsible: advanced (tags + raw config) */}
          <details className="rounded-md border border-border bg-surface">
            <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium">
              <Cog size={14} />
              {t("templates.advanced")}
            </summary>
            <div className="space-y-3 border-t border-border px-3 py-3">
              <label className="block">
                <span className="label">{t("common.tags")}</span>
                <input
                  name="persona-tags"
                  className="input mt-1 w-full"
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="label">{t("templates.configJson")}</span>
                <textarea
                  name="persona-config-json"
                  className="textarea mt-1 w-full font-mono"
                  rows={4}
                  value={configText}
                  onChange={(event) => setConfigText(event.target.value)}
                />
              </label>
              {!configValue.ok && (
                <div className="text-xs text-danger">{t("templates.configJsonInvalid")}</div>
              )}
            </div>
          </details>

          <button
            className="btn btn-primary w-full"
            onClick={() => save.mutate()}
            disabled={editingIsBuiltin || !name.trim() || !systemPrompt.trim() || !configValue.ok || save.isPending}
          >
            <Save size={16} />
            {editingPersonaId ? t("common.saveChanges") : t("templates.savePersona")}
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
  const { t } = useI18n();
  const confirm = useConfirm();
  const formats = useQuery({ queryKey: ["formats", "editable"], queryFn: () => api.formats(false) });
  const builtinFormats = useQuery({ queryKey: ["formats", "builtin"], queryFn: () => api.formats(true) });
  const phases = useQuery({ queryKey: ["phases"], queryFn: () => api.phases() });
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);
  const [name, setName] = useState(() => t("templates.defaultFormatName"));
  const [description, setDescription] = useState(() => t("templates.defaultFormatDescription"));
  const [tags, setTags] = useState("custom");
  const [phaseId, setPhaseId] = useState("");
  const [phaseSlots, setPhaseSlots] = useState<FormatSlotDraft[]>([]);
  const [editingFormatId, setEditingFormatId] = useState<string | null>(null);
  const items = filterByTags(formats.data, selectedTags);
  const phaseById = useMemo(() => new Map((phases.data ?? []).map((phase) => [phase.id, phase])), [phases.data]);
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
    setName(t("templates.defaultFormatName"));
    setDescription(t("templates.defaultFormatDescription"));
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
  const addFromBuiltin = useMutation({
    mutationFn: (formatId: string) => api.duplicateFormat(formatId),
    onSuccess: (copy) => {
      loadFormat(copy);
      setShowLibrary(false);
      void queryClient.invalidateQueries({ queryKey: ["formats"] });
    }
  });
  const remove = useMutation({
    mutationFn: (formatId: string) => api.deleteFormat(formatId),
    onSuccess: () => {
      resetFormatForm();
      void queryClient.invalidateQueries({ queryKey: ["formats"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("api.deleteFailed"))
  });
  const deleteFormat = async (format: DebateFormat, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (await confirm({
      title: t("templates.deleteFormatConfirm", { name: format.name }),
      danger: true,
      confirmLabel: t("common.delete")
    })) {
      remove.mutate(format.id);
    }
  };

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
        <Header
          title={t("templates.formats")}
          subtitle={t("templates.formatHelp")}
          actionLabel={t("templates.fromBuiltin")}
          onAction={() => setShowLibrary((value) => !value)}
          metrics={<StatusPill tone="info">{t("templates.formatCount", { count: items.length })}</StatusPill>}
        />
        {showLibrary && (
          <BuiltinLibrary
            title={t("templates.formatBuiltin")}
            items={builtinFormats.data ?? []}
            addingId={addFromBuiltin.variables}
            isAdding={addFromBuiltin.isPending}
            onAdd={(format) => addFromBuiltin.mutate(format.id)}
            renderMeta={(format) => <StatusPill tone="brand">{t("common.phaseCount", { count: format.phase_sequence.length })}</StatusPill>}
          />
        )}
        <TagFilterBar items={formats.data ?? []} selected={selectedTags} onChange={setSelectedTags} />
        <div className="space-y-3">
          {items.map((format: DebateFormat) => {
            const active = editingFormatId === format.id;
            return (
              <div
                key={format.id}
                className={`group relative cursor-pointer overflow-hidden rounded-lg border bg-panel p-4 shadow-card transition hover:border-brand ${
                  active ? "border-brand ring-1 ring-brand" : "border-border"
                }`}
                role="button"
                tabIndex={0}
                onClick={() => loadFormat(format)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    loadFormat(format);
                  }
                }}
              >
                <span
                  aria-hidden
                  className={`absolute left-0 top-3 h-8 w-1 rounded-r-full ${active ? "bg-brand" : "bg-brand/40"}`}
                />
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-brand/10 text-brand">
                      <Workflow size={16} />
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold">{format.name}</h2>
                      <p className="mt-1 line-clamp-2 text-xs text-muted">{format.description}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <StatusPill tone="brand">{t("common.phaseCount", { count: format.phase_sequence.length })}</StatusPill>
                    <button
                      className="btn h-9 w-9 px-0"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        loadFormat(format);
                      }}
                      title={t("common.edit")}
                      aria-label={t("common.edit")}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="btn btn-danger h-9 w-9 px-0"
                      type="button"
                      onClick={(event) => deleteFormat(format, event)}
                      disabled={remove.isPending && remove.variables === format.id}
                      title={t("common.delete")}
                      aria-label={t("common.delete")}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <ol className="mai-scrollbar mt-3 flex items-center gap-1 overflow-x-auto text-xs">
                  {format.phase_sequence.slice(0, 8).map((slot, index) => {
                    const phase = phaseById.get(slot.phase_template_id);
                    return (
                      <li key={`${format.id}-${index}-${slot.phase_template_id}`} className="flex shrink-0 items-center gap-1">
                        <span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-0.5 text-[11px] text-muted">
                          <span className="text-[10px]">{index + 1}</span>
                          <span className="max-w-[8rem] truncate">{phase?.name ?? slot.phase_template_id}</span>
                        </span>
                        {index < Math.min(format.phase_sequence.length, 8) - 1 && (
                          <span className="text-muted">→</span>
                        )}
                      </li>
                    );
                  })}
                  {format.phase_sequence.length > 8 && (
                    <li className="shrink-0 text-[11px] text-muted">
                      +{format.phase_sequence.length - 8}
                    </li>
                  )}
                </ol>
                {format.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    {format.tags.slice(0, 4).map((tag) => (
                      <span key={tag} className="rounded-md bg-surface px-1.5 py-0.5 text-[11px] text-muted">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {items.length === 0 && <EmptyState title={t("templates.emptyEditableFormat")} onAdd={() => setShowLibrary(true)} />}
        </div>
      </div>
      <aside className="panel p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">{editingFormatId ? t("templates.editFormat") : t("templates.blankFormat")}</h2>
          {editingFormatId && (
            <button className="btn h-8 px-2 text-xs" type="button" onClick={resetFormatForm}>
              <Plus size={14} />
              {t("common.new")}
            </button>
          )}
        </div>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="label">{t("common.name")}</span>
            <input name="format-name" className="input mt-1 w-full" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="block">
            <span className="label">{t("common.description")}</span>
            <textarea name="format-description" className="textarea mt-1 w-full" value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <label className="block">
            <span className="label">{t("common.tags")}</span>
            <input name="format-tags" className="input mt-1 w-full" value={tags} onChange={(event) => setTags(event.target.value)} />
          </label>
          <div>
            <span className="label">{t("templates.phaseSlots")}</span>
            <div className="mt-2 flex gap-2">
              <select name="format-phase" className="input min-w-0 flex-1" value={phaseId} onChange={(event) => setPhaseId(event.target.value)}>
                <option value="">{t("templates.selectPhase")}</option>
                {(phases.data ?? []).map((phase) => (
                  <option key={phase.id} value={phase.id}>
                    {phase.name}
                  </option>
                ))}
              </select>
              <button className="btn" type="button" onClick={addPhase} disabled={!phases.data?.length}>
                <Plus size={16} />
                {t("templates.addPhaseSlot")}
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
                  {phaseSlots.length === 0 && <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted">{t("templates.dragPhaseHint")}</div>}
                </div>
              </SortableContext>
            </DndContext>
          </div>
          <button className="btn btn-primary w-full" onClick={() => save.mutate()} disabled={!name.trim() || phaseSlots.length === 0 || save.isPending}>
            <Save size={16} />
            {editingFormatId ? t("common.saveChanges") : t("templates.saveFormat")}
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
  const { t, display } = useI18n();
  const style = {
    transform: transform
      ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0) scaleX(${transform.scaleX}) scaleY(${transform.scaleY})`
      : undefined,
    transition
  };
  return (
    <div ref={setNodeRef} style={style} className={`rounded-md border border-border bg-panel p-3 ${isDragging ? "shadow-soft" : ""}`}>
      <div className="flex items-start gap-2">
        <button className="btn h-8 w-8 shrink-0 px-0" type="button" aria-label={t("templates.phaseSlots")} {...attributes} {...listeners}>
          <GripVertical size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">{index + 1}</span>
            <div className="truncate text-sm font-medium">{phase?.name ?? slot.phaseId}</div>
          </div>
          <div className="mt-1 flex flex-wrap gap-2">
            <StatusPill tone="brand">{phase ? display("orderingRule", phase.ordering_rule.type) : t("common.unknown")}</StatusPill>
            {(phase?.tags ?? []).slice(0, 3).map((tag) => (
              <StatusPill key={tag}>{tag}</StatusPill>
            ))}
          </div>
        </div>
        <button className="btn btn-danger h-8 w-8 shrink-0 px-0" type="button" aria-label={t("common.delete")} onClick={onRemove}>
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}

function PhasesView() {
  const queryClient = useQueryClient();
  const { t, display } = useI18n();
  const confirm = useConfirm();
  const phases = useQuery({ queryKey: ["phases", "editable"], queryFn: () => api.phases(false) });
  const builtinPhases = useQuery({ queryKey: ["phases", "builtin"], queryFn: () => api.phases(true) });
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);
  const items = filterByTags(phases.data, selectedTags);
  const [name, setName] = useState(() => t("templates.defaultPhaseName"));
  const [description, setDescription] = useState(() => t("templates.defaultPhaseDescription"));
  const [tags, setTags] = useState("vote,parallel");
  const [allowedType, setAllowedType] = useState<"all" | "variables" | "specific">("all");
  const [allowedValues, setAllowedValues] = useState("");
  const [orderingType, setOrderingType] = useState("parallel");
  const [roleConstraints, setRoleConstraints] = useState(() => t("templates.defaultRoleConstraints"));
  const [promptTemplate, setPromptTemplate] = useState(() => t("templates.defaultPromptTemplate"));
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
  const [autoDiscuss, setAutoDiscuss] = useState(false);
  const [editingPhaseId, setEditingPhaseId] = useState<string | null>(null);
  const allowedItems = splitTags(allowedValues);
  const phaseExitConditions = buildExitConditions({
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
  const phasePayload = () => ({
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
    exit_conditions: phaseExitConditions,
    auto_discuss: autoDiscuss,
    role_constraints: roleConstraints,
    prompt_template: promptTemplate,
    tags: splitTags(tags)
  });
  const loadPhase = (phase: PhaseTemplate) => {
    const allowed = phase.allowed_speakers as { type?: string; variable_names?: string[]; persona_ids?: string[] };
    const allowedKind = allowed.type === "variables" || allowed.type === "specific" ? allowed.type : "all";
    const rounds = phase.exit_conditions.find((condition) => condition.type === "rounds");
    const allSpoken = phase.exit_conditions.find((condition) => condition.type === "all_spoken");
    const tokenBudgetCondition = phase.exit_conditions.find((condition) => condition.type === "token_budget");
    const facilitator = phase.exit_conditions.find((condition) => condition.type === "facilitator_suggests");
    const facilitatorTrigger = Array.isArray(facilitator?.trigger_if) ? facilitator.trigger_if : [];

    setEditingPhaseId(phase.id);
    setName(phase.name);
    setDescription(phase.description);
    setTags(phase.tags.join(","));
    setAllowedType(allowedKind);
    setAllowedValues(allowedKind === "variables" ? (allowed.variable_names ?? []).join(",") : allowedKind === "specific" ? (allowed.persona_ids ?? []).join(",") : "");
    setOrderingType(phase.ordering_rule.type);
    setRoleConstraints(phase.role_constraints);
    setPromptTemplate(phase.prompt_template);
    setRoundsExit(Boolean(rounds));
    setRoundsN(Number(rounds?.n ?? 2));
    setAllSpokenExit(Boolean(allSpoken));
    setMinEach(Number(allSpoken?.min_each ?? 1));
    setAllVotedExit(phase.exit_conditions.some((condition) => condition.type === "all_voted"));
    setManualExit(phase.exit_conditions.some((condition) => condition.type === "user_manual"));
    setTokenBudgetExit(Boolean(tokenBudgetCondition));
    setTokenBudget(Number(tokenBudgetCondition?.max ?? 12000));
    setFacilitatorExit(Boolean(facilitator));
    setFacilitatorTags(facilitatorTrigger.map(String).join(","));
    setAutoDiscuss(Boolean(phase.auto_discuss));
  };
  const resetPhaseForm = () => {
    setEditingPhaseId(null);
    setName(t("templates.defaultPhaseName"));
    setDescription(t("templates.defaultPhaseDescription"));
    setTags("vote,parallel");
    setAllowedType("all");
    setAllowedValues("");
    setOrderingType("parallel");
    setRoleConstraints(t("templates.defaultRoleConstraints"));
    setPromptTemplate(t("templates.defaultPromptTemplate"));
    setRoundsExit(false);
    setRoundsN(2);
    setAllSpokenExit(false);
    setMinEach(1);
    setAllVotedExit(true);
    setManualExit(false);
    setTokenBudgetExit(false);
    setTokenBudget(12000);
    setFacilitatorExit(false);
    setFacilitatorTags("phase_exhausted");
    setAutoDiscuss(false);
  };
  const canSavePhase = Boolean(name.trim()) && phaseExitConditions.length > 0 && (allowedType === "all" || allowedItems.length > 0);
  const save = useMutation({
    mutationFn: () =>
      editingPhaseId ? api.updatePhase(editingPhaseId, phasePayload()) : api.createPhase(phasePayload()),
    onSuccess: (saved) => {
      loadPhase(saved);
      void queryClient.invalidateQueries({ queryKey: ["phases"] });
    }
  });
  const addFromBuiltin = useMutation({
    mutationFn: (phaseId: string) => api.duplicatePhase(phaseId),
    onSuccess: (copy) => {
      loadPhase(copy);
      setShowLibrary(false);
      void queryClient.invalidateQueries({ queryKey: ["phases"] });
    }
  });
  const remove = useMutation({
    mutationFn: (phaseId: string) => api.deletePhase(phaseId),
    onSuccess: () => {
      resetPhaseForm();
      void queryClient.invalidateQueries({ queryKey: ["phases"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("api.deleteFailed"))
  });
  const deletePhase = async (phase: PhaseTemplate, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (await confirm({
      title: t("templates.deletePhaseConfirm", { name: phase.name }),
      danger: true,
      confirmLabel: t("common.delete")
    })) {
      remove.mutate(phase.id);
    }
  };
  return (
    <section className="grid grid-cols-[minmax(0,1fr)_440px] gap-4 max-xl:grid-cols-1">
      <div className="space-y-3">
        <Header
          title={t("templates.phases")}
          subtitle={t("templates.phaseHelp")}
          actionLabel={t("templates.fromBuiltin")}
          onAction={() => setShowLibrary((value) => !value)}
          metrics={<StatusPill>{t("common.phaseCount", { count: items.length })}</StatusPill>}
        />
        {showLibrary && (
          <BuiltinLibrary
            title={t("templates.phaseBuiltin")}
            items={builtinPhases.data ?? []}
            addingId={addFromBuiltin.variables}
            isAdding={addFromBuiltin.isPending}
            onAdd={(phase) => addFromBuiltin.mutate(phase.id)}
            renderMeta={(phase) => (
              <>
                <StatusPill tone="brand">{display("orderingRule", phase.ordering_rule.type)}</StatusPill>
                <StatusPill tone="accent">{display("allowedSpeakers", String(phase.allowed_speakers.type ?? "allowed"))}</StatusPill>
              </>
            )}
          />
        )}
        <TagFilterBar items={phases.data ?? []} selected={selectedTags} onChange={setSelectedTags} />
        <div className="grid grid-cols-1 gap-3">
          {items.map((phase: PhaseTemplate) => {
            const active = editingPhaseId === phase.id;
            return (
              <div
                key={phase.id}
                className={`group relative cursor-pointer overflow-hidden rounded-lg border bg-panel p-4 shadow-card transition hover:border-brand ${
                  active ? "border-brand ring-1 ring-brand" : "border-border"
                }`}
                role="button"
                tabIndex={0}
                onClick={() => loadPhase(phase)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    loadPhase(phase);
                  }
                }}
              >
                <span
                  aria-hidden
                  className={`absolute left-0 top-3 h-8 w-1 rounded-r-full ${active ? "bg-brand" : "bg-info/50"}`}
                />
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      aria-hidden
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-info/10 text-info"
                    >
                      <Layers size={16} />
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold">{phase.name}</h2>
                      <p className="mt-1 line-clamp-2 text-xs text-muted">{phase.description}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      className="btn h-9 w-9 px-0"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        loadPhase(phase);
                      }}
                      title={t("common.edit")}
                      aria-label={t("common.edit")}
                    >
                      <Pencil size={16} />
                    </button>
                    <a
                      className="btn h-9 w-9 px-0"
                      href={`/api/templates/phases/${phase.id}/export`}
                      onClick={(event) => event.stopPropagation()}
                      title={t("common.export")}
                      aria-label={t("common.export")}
                    >
                      <Download size={16} />
                    </a>
                    <button
                      className="btn btn-danger h-9 w-9 px-0"
                      type="button"
                      onClick={(event) => deletePhase(phase, event)}
                      disabled={remove.isPending && remove.variables === phase.id}
                      title={t("common.delete")}
                      aria-label={t("common.delete")}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <StatusPill tone="brand">{display("orderingRule", phase.ordering_rule.type)}</StatusPill>
                  <StatusPill tone="accent">{display("allowedSpeakers", String(phase.allowed_speakers.type ?? "allowed"))}</StatusPill>
                  {phase.auto_discuss && <StatusPill tone="accent">{t("templates.autoDiscuss")}</StatusPill>}
                  {phase.exit_conditions.slice(0, 3).map((condition, index) => (
                    <StatusPill key={`${phase.id}-exit-${index}`}>
                      {display("exitCondition", String(condition.type ?? "exit"))}
                    </StatusPill>
                  ))}
                  {phase.tags.slice(0, 4).map((tag) => (
                    <span key={tag} className="rounded-md bg-surface px-1.5 py-0.5 text-[11px] text-muted">
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {items.length === 0 && <EmptyState title={t("templates.emptyEditablePhase")} onAdd={() => setShowLibrary(true)} />}
      </div>
      <aside className="panel p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">{editingPhaseId ? t("templates.editPhase") : t("templates.blankPhase")}</h2>
          {editingPhaseId && (
            <button className="btn h-8 px-2 text-xs" type="button" onClick={resetPhaseForm}>
              <Plus size={14} />
              {t("common.new")}
            </button>
          )}
        </div>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="label">{t("common.name")}</span>
            <input name="phase-name" className="input mt-1 w-full" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="block">
            <span className="label">{t("common.description")}</span>
            <textarea name="phase-description" className="textarea mt-1 w-full" value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <label className="block">
            <span className="label">{t("common.tags")}</span>
            <input name="phase-tags" className="input mt-1 w-full" value={tags} onChange={(event) => setTags(event.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="label">{t("templates.speakerScope")}</span>
              <select name="phase-allowed-type" className="input mt-1 w-full" value={allowedType} onChange={(event) => setAllowedType(event.target.value as "all" | "variables" | "specific")}>
                <option value="all">{display("allowedSpeakers", "all")}</option>
                <option value="variables">{display("allowedSpeakers", "variables")}</option>
                <option value="specific">{display("allowedSpeakers", "specific")}</option>
              </select>
            </label>
            <label className="block">
              <span className="label">{t("templates.orderingRule")}</span>
              <select name="phase-ordering-type" className="input mt-1 w-full" value={orderingType} onChange={(event) => setOrderingType(event.target.value)}>
                <option value="alternating">{display("orderingRule", "alternating")}</option>
                <option value="round_robin">{display("orderingRule", "round_robin")}</option>
                <option value="mention_driven">{display("orderingRule", "mention_driven")}</option>
                <option value="question_paired">{display("orderingRule", "question_paired")}</option>
                <option value="parallel">{display("orderingRule", "parallel")}</option>
                <option value="user_picks">{display("orderingRule", "user_picks")}</option>
                <option value="casual">{display("orderingRule", "casual")}</option>
              </select>
            </label>
          </div>
          {allowedType !== "all" && (
            <label className="block">
              <span className="label">{allowedType === "variables" ? t("templates.variableName") : t("templates.personaIds")}</span>
              <input name="phase-allowed-values" className="input mt-1 w-full" value={allowedValues} onChange={(event) => setAllowedValues(event.target.value)} />
            </label>
          )}
          <div>
            <div className="label">{t("templates.exitConditions")}</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <label className="flex items-center gap-2 rounded-md border border-border p-2">
                <input name="phase-exit-rounds" type="checkbox" checked={roundsExit} onChange={(event) => setRoundsExit(event.target.checked)} />
                {display("exitCondition", "rounds")}
              </label>
              <input name="phase-rounds-count" className="input w-full" type="number" min={1} value={roundsN} onChange={(event) => setRoundsN(Number(event.target.value))} />
              <label className="flex items-center gap-2 rounded-md border border-border p-2">
                <input name="phase-exit-all-spoken" type="checkbox" checked={allSpokenExit} onChange={(event) => setAllSpokenExit(event.target.checked)} />
                {display("exitCondition", "all_spoken")}
              </label>
              <input name="phase-min-each" className="input w-full" type="number" min={1} value={minEach} onChange={(event) => setMinEach(Number(event.target.value))} />
              <label className="flex items-center gap-2 rounded-md border border-border p-2">
                <input name="phase-exit-all-voted" type="checkbox" checked={allVotedExit} onChange={(event) => setAllVotedExit(event.target.checked)} />
                {display("exitCondition", "all_voted")}
              </label>
              <label className="flex items-center gap-2 rounded-md border border-border p-2">
                <input name="phase-exit-manual" type="checkbox" checked={manualExit} onChange={(event) => setManualExit(event.target.checked)} />
                {display("exitCondition", "user_manual")}
              </label>
              <label className="flex items-center gap-2 rounded-md border border-border p-2">
                <input name="phase-exit-token-budget" type="checkbox" checked={tokenBudgetExit} onChange={(event) => setTokenBudgetExit(event.target.checked)} />
                {display("exitCondition", "token_budget")}
              </label>
              <input name="phase-token-budget" className="input w-full" type="number" min={1} value={tokenBudget} onChange={(event) => setTokenBudget(Number(event.target.value))} />
              <label className="flex items-center gap-2 rounded-md border border-border p-2">
                <input name="phase-exit-facilitator" type="checkbox" checked={facilitatorExit} onChange={(event) => setFacilitatorExit(event.target.checked)} />
                {display("exitCondition", "facilitator_suggests")}
              </label>
              <input name="phase-facilitator-tags" className="input w-full" value={facilitatorTags} onChange={(event) => setFacilitatorTags(event.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              name="phase-auto-discuss"
              type="checkbox"
              checked={autoDiscuss}
              onChange={(event) => setAutoDiscuss(event.target.checked)}
            />
            {t("templates.autoDiscuss")}
          </label>
          <label className="block">
            <span className="label">{t("templates.roleConstraints")}</span>
            <textarea name="phase-role-constraints" className="textarea mt-1 w-full" value={roleConstraints} onChange={(event) => setRoleConstraints(event.target.value)} />
          </label>
          <label className="block">
            <span className="label">{t("templates.promptTemplate")}</span>
            <textarea name="phase-prompt-template" className="textarea mt-1 w-full" value={promptTemplate} onChange={(event) => setPromptTemplate(event.target.value)} />
          </label>
          <button className="btn btn-primary w-full" onClick={() => save.mutate()} disabled={!canSavePhase || save.isPending}>
            <Save size={16} />
            {editingPhaseId ? t("common.saveChanges") : t("templates.savePhase")}
          </button>
        </div>
      </aside>
    </section>
  );
}

function RecipesView() {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const confirm = useConfirm();
  const recipes = useQuery({ queryKey: ["recipes", "editable"], queryFn: () => api.recipes(false) });
  const builtinRecipes = useQuery({ queryKey: ["recipes", "builtin"], queryFn: () => api.recipes(true) });
  const formats = useQuery({ queryKey: ["formats"], queryFn: () => api.formats() });
  const personas = useQuery({
    queryKey: ["persona-templates", "discussant"],
    queryFn: () => api.personaTemplates("discussant")
  });
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);
  const items = filterByTags(recipes.data, selectedTags);
  const [name, setName] = useState(() => t("templates.defaultRecipeName"));
  const [description, setDescription] = useState(() => t("templates.defaultRecipeDescription"));
  const [tags, setTags] = useState("custom");
  const [formatId, setFormatId] = useState("");
  const [personaIds, setPersonaIds] = useState<string[]>([]);
  const [initialSettingsText, setInitialSettingsText] = useState(
    JSON.stringify({ max_message_tokens: 900, max_room_tokens: 120000, auto_transition: false }, null, 2)
  );
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null);
  const settingsValue = parseJsonObject(initialSettingsText);
  const formatById = useMemo(() => new Map((formats.data ?? []).map((format) => [format.id, format])), [formats.data]);
  const personaById = useMemo(() => new Map((personas.data ?? []).map((persona) => [persona.id, persona])), [personas.data]);
  const recipePayload = () => {
    const selectedFormatId = formatId || formats.data?.[0]?.id || null;
    return {
      name,
      description,
      persona_ids: personaIds,
      format_id: selectedFormatId,
      format_version: selectedFormatId ? (formatById.get(selectedFormatId)?.version ?? 1) : null,
      initial_settings: settingsValue.value,
      tags: splitTags(tags)
    };
  };
  const loadRecipe = (recipe: Recipe) => {
    setEditingRecipeId(recipe.id);
    setName(recipe.name);
    setDescription(recipe.description);
    setTags(recipe.tags.join(","));
    setFormatId(recipe.format_id ?? "");
    setPersonaIds(recipe.persona_ids);
    setInitialSettingsText(JSON.stringify(recipe.initial_settings ?? {}, null, 2));
  };
  const resetRecipeForm = () => {
    setEditingRecipeId(null);
    setName(t("templates.defaultRecipeName"));
    setDescription(t("templates.defaultRecipeDescription"));
    setTags("custom");
    setFormatId("");
    setPersonaIds([]);
    setInitialSettingsText(JSON.stringify({ max_message_tokens: 900, max_room_tokens: 120000, auto_transition: false }, null, 2));
  };
  const save = useMutation({
    mutationFn: () => (editingRecipeId ? api.updateRecipe(editingRecipeId, recipePayload()) : api.createRecipe(recipePayload())),
    onSuccess: (saved) => {
      loadRecipe(saved);
      void queryClient.invalidateQueries({ queryKey: ["recipes"] });
    }
  });
  const addFromBuiltin = useMutation({
    mutationFn: (recipeId: string) => api.duplicateRecipe(recipeId),
    onSuccess: (copy) => {
      loadRecipe(copy);
      setShowLibrary(false);
      void queryClient.invalidateQueries({ queryKey: ["recipes"] });
    }
  });
  const remove = useMutation({
    mutationFn: (recipeId: string) => api.deleteRecipe(recipeId),
    onSuccess: () => {
      resetRecipeForm();
      void queryClient.invalidateQueries({ queryKey: ["recipes"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("api.deleteFailed"))
  });
  const deleteRecipe = async (recipe: Recipe, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (await confirm({
      title: t("templates.deleteRecipeConfirm", { name: recipe.name }),
      danger: true,
      confirmLabel: t("common.delete")
    })) {
      remove.mutate(recipe.id);
    }
  };
  return (
    <section className="grid grid-cols-[minmax(0,1fr)_360px] gap-4 max-xl:grid-cols-1">
      <div className="space-y-3">
        <Header
          title={t("templates.recipes")}
          subtitle={t("templates.recipeHelp")}
          actionLabel={t("templates.fromBuiltin")}
          onAction={() => setShowLibrary((value) => !value)}
          metrics={<StatusPill tone="info">{t("templates.recipeCount", { count: items.length })}</StatusPill>}
        />
        {showLibrary && (
          <BuiltinLibrary
            title={t("templates.recipeBuiltin")}
            items={builtinRecipes.data ?? []}
            addingId={addFromBuiltin.variables}
            isAdding={addFromBuiltin.isPending}
            onAdd={(recipe) => addFromBuiltin.mutate(recipe.id)}
            renderMeta={(recipe) => <StatusPill tone="brand">{t("common.personaCount", { count: recipe.persona_ids.length })}</StatusPill>}
          />
        )}
        <TagFilterBar items={recipes.data ?? []} selected={selectedTags} onChange={setSelectedTags} />
        <div className="space-y-3">
          {items.map((recipe: Recipe) => {
            const active = editingRecipeId === recipe.id;
            const personaSample = recipe.persona_ids
              .map((id) => personaById.get(id))
              .filter(Boolean)
              .slice(0, 5);
            return (
              <div
                key={recipe.id}
                className={`group relative cursor-pointer overflow-hidden rounded-lg border bg-panel p-4 shadow-card transition hover:border-brand ${
                  active ? "border-brand ring-1 ring-brand" : "border-border"
                }`}
                role="button"
                tabIndex={0}
                onClick={() => loadRecipe(recipe)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    loadRecipe(recipe);
                  }
                }}
              >
                <span
                  aria-hidden
                  className={`absolute left-0 top-3 h-8 w-1 rounded-r-full ${active ? "bg-brand" : "bg-accent/50"}`}
                />
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-accent/10 text-accent">
                      <ScrollText size={16} />
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold">{recipe.name}</h2>
                      <p className="mt-1 line-clamp-2 text-xs text-muted">{recipe.description}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      className="btn h-9 w-9 px-0"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        loadRecipe(recipe);
                      }}
                      title={t("common.edit")}
                      aria-label={t("common.edit")}
                    >
                      <Pencil size={16} />
                    </button>
                    <a
                      className="btn h-9 w-9 px-0"
                      href={`/api/templates/recipes/${recipe.id}/export`}
                      onClick={(event) => event.stopPropagation()}
                      title={t("common.export")}
                      aria-label={t("common.export")}
                    >
                      <Download size={16} />
                    </a>
                    <button
                      className="btn btn-danger h-9 w-9 px-0"
                      type="button"
                      onClick={(event) => deleteRecipe(recipe, event)}
                      disabled={remove.isPending && remove.variables === recipe.id}
                      title={t("common.delete")}
                      aria-label={t("common.delete")}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <StatusPill tone="brand">{t("common.personaCount", { count: recipe.persona_ids.length })}</StatusPill>
                  {recipe.format_id && (
                    <StatusPill tone="info">
                      {formatById.get(recipe.format_id)?.name ?? t("templates.formatFallback")}
                    </StatusPill>
                  )}
                  {recipe.tags.slice(0, 4).map((tag) => (
                    <span key={tag} className="rounded-md bg-surface px-1.5 py-0.5 text-[11px] text-muted">
                      #{tag}
                    </span>
                  ))}
                </div>
                {personaSample.length > 0 && (
                  <div className="mt-3 flex items-center gap-1.5">
                    {personaSample.map((persona) => (
                      <span
                        key={persona!.id}
                        className="grid h-7 w-7 place-items-center rounded-full bg-brand/10 text-[10px] font-semibold text-brand"
                        title={persona!.name}
                      >
                        {persona!.name.trim().slice(0, 2) || "?"}
                      </span>
                    ))}
                    {recipe.persona_ids.length > personaSample.length && (
                      <span className="text-[11px] text-muted">+{recipe.persona_ids.length - personaSample.length}</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {items.length === 0 && <EmptyState title={t("templates.emptyEditableRecipe")} onAdd={() => setShowLibrary(true)} />}
        </div>
      </div>
      <aside className="panel p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">{editingRecipeId ? t("templates.editRecipe") : t("templates.blankRecipe")}</h2>
          {editingRecipeId && (
            <button className="btn h-8 px-2 text-xs" type="button" onClick={resetRecipeForm}>
              <Plus size={14} />
              {t("templates.blankRecipe")}
            </button>
          )}
        </div>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="label">{t("common.name")}</span>
            <input name="recipe-name" className="input mt-1 w-full" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="block">
            <span className="label">{t("common.description")}</span>
            <textarea name="recipe-description" className="textarea mt-1 w-full" value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <label className="block">
            <span className="label">{t("dashboard.format")}</span>
            <select name="recipe-format" className="input mt-1 w-full" value={formatId} onChange={(event) => setFormatId(event.target.value)}>
              <option value="">{t("templates.defaultFirstFormat")}</option>
              {(formats.data ?? []).map((format) => (
                <option key={format.id} value={format.id}>
                  {format.name}
                </option>
              ))}
            </select>
          </label>
          <div>
            <div className="label">{t("templates.personaList")}</div>
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
          <label className="block">
            <span className="label">{t("common.tags")}</span>
            <input name="recipe-tags" className="input mt-1 w-full" value={tags} onChange={(event) => setTags(event.target.value)} />
          </label>
          <label className="block">
            <span className="label">{t("templates.initialSettings")}</span>
            <textarea name="recipe-settings-json" className="textarea mt-1 w-full font-mono" value={initialSettingsText} onChange={(event) => setInitialSettingsText(event.target.value)} />
          </label>
          {!settingsValue.ok && <div className="text-xs text-danger">{t("templates.initialSettingsInvalid")}</div>}
          <button className="btn btn-primary w-full" onClick={() => save.mutate()} disabled={!name.trim() || !settingsValue.ok || save.isPending}>
            <Save size={16} />
            {editingRecipeId ? t("common.saveChanges") : t("templates.saveRecipe")}
          </button>
        </div>
      </aside>
    </section>
  );
}

// Sentinel id for the "new provider" draft state. Lets us reuse the
// expand/collapse logic without a parallel `creating` flag.
const DRAFT_PROVIDER_ID = "__new__";

export function ApiProvidersView() {
  const queryClient = useQueryClient();
  const { t, formatRelativeTime } = useI18n();
  const confirm = useConfirm();
  const providers = useQuery({ queryKey: ["api-providers"], queryFn: api.apiProviders });
  const models = useQuery({ queryKey: ["api-models"], queryFn: () => api.apiModels() });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [providerSlug, setProviderSlug] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [apiBase, setApiBase] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [modelDisplayName, setModelDisplayName] = useState("");
  const [modelName, setModelName] = useState("openai/gpt-4o-mini");
  const [modelEnabled, setModelEnabled] = useState(true);
  const [modelIsDefault, setModelIsDefault] = useState(false);
  const [contextWindow, setContextWindow] = useState("");
  const [modelTags, setModelTags] = useState("");
  const [modelError, setModelError] = useState<string | null>(null);
  const editing = providers.data?.find((p) => p.id === editingId) ?? null;
  const selectedProviderModels = useMemo(
    () => (models.data ?? []).filter((model) => model.api_provider_id === editingId),
    [models.data, editingId]
  );
  const resetModelForm = (slug = providerSlug) => {
    setEditingModelId(null);
    setModelDisplayName("");
    setModelName(`${slug.trim() || "openai"}/`);
    setModelEnabled(true);
    setModelIsDefault(selectedProviderModels.length === 0);
    setContextWindow("");
    setModelTags("");
    setModelError(null);
  };
  const resetForm = () => {
    setEditingId(null);
    setName("");
    setProviderSlug("openai");
    setApiKey("");
    setApiBase("");
    setShowKey(false);
    setPendingError(null);
    resetModelForm("openai");
  };
  // Open an inline draft card at the top of the list. Uses a sentinel id so
  // the same expand/collapse machinery works without a separate "creating"
  // boolean. The save mutation already treats falsy/sentinel ids as create.
  const startNewProvider = () => {
    setEditingId(DRAFT_PROVIDER_ID);
    setName("");
    setProviderSlug("openai");
    setApiKey("");
    setApiBase("");
    setShowKey(false);
    setPendingError(null);
    resetModelForm("openai");
  };
  const togglePane = async (providerId: string) => {
    if (editingId === providerId) {
      resetForm();
      return;
    }
    await loadProvider(providerId);
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
      setEditingModelId(null);
      setModelDisplayName("");
      setModelName(`${detail.provider_slug || "openai"}/`);
      setModelEnabled(true);
      setModelIsDefault(false);
      setContextWindow("");
      setModelTags("");
      setModelError(null);
    } catch (err) {
      setPendingError(err instanceof Error ? err.message : t("api.loadFailed"));
    }
  };
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        provider_slug: providerSlug.trim(),
        api_base: apiBase.trim() ? apiBase.trim() : null
      };
      const isExisting = editingId && editingId !== DRAFT_PROVIDER_ID;
      return isExisting
        ? api.updateApiProvider(editingId!, apiKey ? { ...body, api_key: apiKey } : body)
        : api.createApiProvider({ ...body, api_key: apiKey });
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ["api-providers"] });
      void queryClient.invalidateQueries({ queryKey: ["api-models"] });
      void queryClient.invalidateQueries({ queryKey: ["personas"] });
      setEditingId(saved.id);
      setName(saved.name);
      setProviderSlug(saved.provider_slug);
      setApiKey(saved.api_key);
      setApiBase(saved.api_base ?? "");
      resetModelForm(saved.provider_slug);
      setPendingError(null);
    },
    onError: (err) => setPendingError(err instanceof Error ? err.message : t("api.saveFailed"))
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteApiProvider(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["api-providers"] });
      void queryClient.invalidateQueries({ queryKey: ["api-models"] });
      void queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      void queryClient.invalidateQueries({ queryKey: ["health"] });
      void queryClient.invalidateQueries({ queryKey: ["personas"] });
      resetForm();
    },
    onError: (err) => setPendingError(err instanceof Error ? err.message : t("api.deleteFailed"))
  });
  const test = useMutation({
    mutationFn: (id: string) => api.testApiProvider(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["api-providers"] })
  });
  const handleDelete = async (id: string) => {
    if (await confirm({
      title: t("api.deleteProviderConfirm"),
      danger: true,
      confirmLabel: t("common.delete")
    })) {
      remove.mutate(id);
    }
  };
  const loadModel = (model: ApiModel) => {
    setEditingModelId(model.id);
    setModelDisplayName(model.display_name);
    setModelName(model.model_name);
    setModelEnabled(model.enabled);
    setModelIsDefault(model.is_default);
    setContextWindow(model.context_window ? String(model.context_window) : "");
    setModelTags(model.tags.join(","));
    setModelError(null);
  };
  const saveModel = useMutation({
    mutationFn: () => {
      if (!editingId) throw new Error(t("api.saveProviderFirst"));
      const body = {
        api_provider_id: editingId,
        display_name: modelDisplayName.trim(),
        model_name: modelName.trim(),
        enabled: modelEnabled,
        is_default: modelIsDefault,
        context_window: contextWindow.trim() ? Number(contextWindow) : null,
        tags: splitTags(modelTags)
      };
      return editingModelId ? api.updateApiModel(editingModelId, body) : api.createApiModel(body);
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ["api-models"] });
      void queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      void queryClient.invalidateQueries({ queryKey: ["health"] });
      void queryClient.invalidateQueries({ queryKey: ["persona-templates"] });
      loadModel(saved);
    },
    onError: (err) => setModelError(err instanceof Error ? err.message : t("api.saveFailed"))
  });
  const removeModel = useMutation({
    mutationFn: (id: string) => api.deleteApiModel(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["api-models"] });
      void queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      void queryClient.invalidateQueries({ queryKey: ["health"] });
      void queryClient.invalidateQueries({ queryKey: ["persona-templates"] });
      resetModelForm();
    },
    onError: (err) => setModelError(err instanceof Error ? err.message : t("api.deleteFailed"))
  });
  const testModel = useMutation({
    mutationFn: (id: string) => api.testApiModel(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["api-models"] }),
    onError: (err) => setModelError(err instanceof Error ? err.message : t("api.testFailed"))
  });
  const handleDeleteModel = async (model: ApiModel) => {
    if (await confirm({
      title: t("api.deleteModelConfirm", { name: model.display_name || model.model_name }),
      danger: true,
      confirmLabel: t("common.delete")
    })) {
      removeModel.mutate(model.id);
    }
  };
  const isDraft = editingId === DRAFT_PROVIDER_ID;
  const hasRealSelection = Boolean(editingId) && !isDraft;
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{t("api.title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("api.subtitle")}</p>
        </div>
        <button
          className="btn btn-primary"
          type="button"
          onClick={startNewProvider}
          disabled={isDraft}
        >
          <Plus size={16} />
          {t("common.new")}
        </button>
      </div>
      <div className="space-y-3">
        {isDraft && (
          <ExpandedProviderCard
            isDraft
            expandedHeader={
              <div className="flex items-center justify-between gap-2 px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Plus size={15} className="text-brand" />
                  {t("api.newProvider")}
                </div>
                <button className="btn h-8 px-2 text-xs" type="button" onClick={resetForm}>
                  {t("common.cancel")}
                </button>
              </div>
            }
          >
            <ProviderConfigForm
              t={t}
              isDraft={isDraft}
              editing={editing}
              name={name}
              setName={setName}
              providerSlug={providerSlug}
              setProviderSlug={setProviderSlug}
              apiKey={apiKey}
              setApiKey={setApiKey}
              apiBase={apiBase}
              setApiBase={setApiBase}
              showKey={showKey}
              setShowKey={setShowKey}
              pendingError={pendingError}
              save={save}
              editingModelId={editingModelId}
              setModelName={setModelName}
              modelName={modelName}
            />
            <div className="grid place-items-center text-center text-xs text-muted">
              {t("api.saveProviderFirst")}
            </div>
          </ExpandedProviderCard>
        )}

        {(providers.data ?? []).map((provider) => {
          const tone =
            provider.last_tested_ok === true
              ? "bg-emerald-500"
              : provider.last_tested_ok === false
                ? "bg-rose-500"
                : "bg-zinc-400";
          const tip =
            provider.last_tested_ok === true
              ? t("api.statusOk", { time: provider.last_tested_at?.slice(0, 19).replace("T", " ") ?? "" })
              : provider.last_tested_ok === false
                ? t("api.statusFailed", { error: provider.last_tested_error ?? t("common.unknown") })
                : t("api.statusUntested");
          const expanded = editingId === provider.id;
          const providerModelCount = (models.data ?? []).filter(
            (model) => model.api_provider_id === provider.id
          ).length;
          return (
            <div
              key={provider.id}
              className={`overflow-hidden rounded-lg border bg-panel transition ${
                expanded ? "border-brand shadow-card" : "border-border hover:border-brand/60"
              }`}
            >
              {/* Header is the click target. Test/Delete inside use stopPropagation
                  so they don't accidentally toggle the pane. */}
              <button
                type="button"
                onClick={() => void togglePane(provider.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                aria-expanded={expanded}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${tone}`}
                      title={tip}
                      aria-label={tip}
                    />
                    <h2 className="truncate font-semibold">{provider.name}</h2>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <StatusPill tone="brand">{providerKindLabel(provider.provider_slug, t)}</StatusPill>
                    <span>{providerModelCount} {t("api.models")}</span>
                    <span className="font-mono">{provider.api_key_preview || `(${t("api.keyMissing")})`}</span>
                    {provider.api_base && <span className="truncate">· {provider.api_base}</span>}
                  </div>
                </div>
                <div
                  className="flex items-center gap-2"
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    className="btn h-8 px-2 text-xs"
                    type="button"
                    onClick={() => test.mutate(provider.id)}
                    disabled={test.isPending && test.variables === provider.id}
                    title={t("api.testProviderTitle")}
                  >
                    {test.isPending && test.variables === provider.id ? (
                      <Wifi size={14} className="animate-pulse" />
                    ) : provider.last_tested_ok === true ? (
                      <CheckCircle2 size={14} className="text-emerald-500" />
                    ) : provider.last_tested_ok === false ? (
                      <XCircle size={14} className="text-rose-500" />
                    ) : (
                      <Wifi size={14} />
                    )}
                    {t("common.test")}
                  </button>
                  <button
                    className="btn h-8 px-2 text-xs text-danger"
                    type="button"
                    onClick={() => handleDelete(provider.id)}
                    disabled={remove.isPending && remove.variables === provider.id}
                  >
                    <Trash2 size={14} />
                    {t("common.delete")}
                  </button>
                  <span className="grid h-8 w-8 place-items-center text-muted">
                    {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </span>
                </div>
              </button>

              {expanded && (
                <div className="grid grid-cols-2 gap-4 border-t border-border bg-surface/40 p-4 max-lg:grid-cols-1">
                  {/* Left column: API config */}
                  <ProviderConfigForm
                    t={t}
                    isDraft={false}
                    editing={editing}
                    name={name}
                    setName={setName}
                    providerSlug={providerSlug}
                    setProviderSlug={setProviderSlug}
                    apiKey={apiKey}
                    setApiKey={setApiKey}
                    apiBase={apiBase}
                    setApiBase={setApiBase}
                    showKey={showKey}
                    setShowKey={setShowKey}
                    pendingError={pendingError}
                    save={save}
                    editingModelId={editingModelId}
                    setModelName={setModelName}
                    modelName={modelName}
                  />

                  {/* Right column: models for this provider */}
                  <ProviderModelsPanel
                    t={t}
                    formatRelativeTime={formatRelativeTime}
                    selectedProviderModels={selectedProviderModels}
                    editingModelId={editingModelId}
                    loadModel={loadModel}
                    handleDeleteModel={handleDeleteModel}
                    testModel={testModel}
                    removeModel={removeModel}
                    resetModelForm={resetModelForm}
                    modelDisplayName={modelDisplayName}
                    setModelDisplayName={setModelDisplayName}
                    modelName={modelName}
                    setModelName={setModelName}
                    modelEnabled={modelEnabled}
                    setModelEnabled={setModelEnabled}
                    modelIsDefault={modelIsDefault}
                    setModelIsDefault={setModelIsDefault}
                    contextWindow={contextWindow}
                    setContextWindow={setContextWindow}
                    modelTags={modelTags}
                    setModelTags={setModelTags}
                    modelError={modelError}
                    saveModel={saveModel}
                    providerSlug={providerSlug}
                  />
                </div>
              )}
            </div>
          );
        })}
        {(providers.data ?? []).length === 0 && !isDraft && (
          <div className="panel p-6 text-sm text-muted">{t("api.emptyProviders")}</div>
        )}
      </div>

      {/* keep `hasRealSelection` referenced — used to silence unused-var lint
          in case future expansion needs it */}
      {!hasRealSelection && null}
    </section>
  );
}

// Reusable wrapper for the inline-expanded "draft" card variant — same chrome
// as a real provider card minus the header click target.
function ExpandedProviderCard({
  expandedHeader,
  children
}: {
  isDraft: boolean;
  expandedHeader: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-brand bg-panel shadow-card">
      {expandedHeader}
      <div className="grid grid-cols-2 gap-4 border-t border-border bg-surface/40 p-4 max-lg:grid-cols-1">
        {children}
      </div>
    </div>
  );
}

type TFn = ReturnType<typeof useI18n>["t"];

function ProviderConfigForm({
  t,
  isDraft,
  editing,
  name,
  setName,
  providerSlug,
  setProviderSlug,
  apiKey,
  setApiKey,
  apiBase,
  setApiBase,
  showKey,
  setShowKey,
  pendingError,
  save,
  editingModelId,
  setModelName,
  modelName
}: {
  t: TFn;
  isDraft: boolean;
  editing: ApiProvider | null | undefined;
  name: string;
  setName: (v: string) => void;
  providerSlug: string;
  setProviderSlug: (v: string) => void;
  apiKey: string;
  setApiKey: (v: string) => void;
  apiBase: string;
  setApiBase: (v: string) => void;
  showKey: boolean;
  setShowKey: (fn: (v: boolean) => boolean) => void;
  pendingError: string | null;
  save: { mutate: () => void; isPending: boolean };
  editingModelId: string | null;
  setModelName: (v: string) => void;
  modelName: string;
}) {
  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold uppercase text-muted">{t("api.providerConfig")}</div>
      <label className="block">
        <span className="label">{t("common.name")}</span>
        <input
          name="api-provider-name"
          className="input mt-1 w-full"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("api.providerNamePlaceholder")}
        />
      </label>
      <label className="block">
        <span className="label">{t("api.provider")}</span>
        <select
          name="api-provider-slug"
          className="input mt-1 w-full"
          value={providerSlug}
          onChange={(event) => {
            setProviderSlug(event.target.value);
            if (!editingModelId && (!modelName.trim() || modelName.endsWith("/"))) {
              setModelName(`${event.target.value}/`);
            }
          }}
        >
          {PROVIDER_KINDS.map((slug) => (
            <option key={slug} value={slug}>{providerKindLabel(slug, t)}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted">{t("api.providerHelp")}</p>
      </label>
      <label className="block">
        <span className="label">{t("api.apiKey")}</span>
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
            aria-label={showKey ? t("api.hide") : t("api.show")}
          >
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        {editing && !apiKey && (
          <p className="mt-1 text-xs text-muted">{t("api.currentKey", { preview: editing.api_key_preview })}</p>
        )}
      </label>
      <label className="block">
        <span className="label">{t("api.apiBase")}</span>
        <input
          name="api-provider-base"
          className="input mt-1 w-full"
          value={apiBase}
          onChange={(event) => setApiBase(event.target.value)}
          placeholder="https://api.example.com/v1"
        />
        <p className="mt-1 text-xs text-muted">{t("api.apiBaseHelp")}</p>
      </label>
      {pendingError && <div className="text-xs text-danger">{pendingError}</div>}
      <button
        className="btn btn-primary w-full"
        onClick={() => save.mutate()}
        disabled={!name.trim() || !providerSlug.trim() || save.isPending}
      >
        <Save size={16} />
        {isDraft ? t("api.saveProvider") : t("common.saveChanges")}
      </button>
    </div>
  );
}

function ProviderModelsPanel({
  t,
  formatRelativeTime,
  selectedProviderModels,
  editingModelId,
  loadModel,
  handleDeleteModel,
  testModel,
  removeModel,
  resetModelForm,
  modelDisplayName,
  setModelDisplayName,
  modelName,
  setModelName,
  modelEnabled,
  setModelEnabled,
  modelIsDefault,
  setModelIsDefault,
  contextWindow,
  setContextWindow,
  modelTags,
  setModelTags,
  modelError,
  saveModel,
  providerSlug
}: {
  t: TFn;
  formatRelativeTime: ReturnType<typeof useI18n>["formatRelativeTime"];
  selectedProviderModels: ApiModel[];
  editingModelId: string | null;
  loadModel: (model: ApiModel) => void;
  handleDeleteModel: (model: ApiModel) => void;
  testModel: { mutate: (id: string) => void; isPending: boolean; variables?: string };
  removeModel: { isPending: boolean; variables?: string };
  resetModelForm: () => void;
  modelDisplayName: string;
  setModelDisplayName: (v: string) => void;
  modelName: string;
  setModelName: (v: string) => void;
  modelEnabled: boolean;
  setModelEnabled: (v: boolean) => void;
  modelIsDefault: boolean;
  setModelIsDefault: (v: boolean) => void;
  contextWindow: string;
  setContextWindow: (v: string) => void;
  modelTags: string;
  setModelTags: (v: string) => void;
  modelError: string | null;
  saveModel: { mutate: () => void; isPending: boolean };
  providerSlug: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase text-muted">{t("api.models")}</div>
          <p className="mt-0.5 text-xs text-muted">{t("api.modelsHelp")}</p>
        </div>
        <button className="btn h-8 px-2 text-xs" type="button" onClick={resetModelForm}>
          <Plus size={14} />
          {t("common.new")}
        </button>
      </div>
      <div className="space-y-2">
        {selectedProviderModels.map((model) => {
          const modelTone =
            model.last_tested_ok === true
              ? "bg-emerald-500"
              : model.last_tested_ok === false
                ? "bg-rose-500"
                : "bg-zinc-400";
          const modelTip =
            model.last_tested_ok === true
              ? t("api.statusOk", { time: model.last_tested_at?.slice(0, 19).replace("T", " ") ?? "" })
              : model.last_tested_ok === false
                ? t("api.statusFailed", { error: model.last_tested_error ?? t("common.unknown") })
                : t("api.statusUntested");
          return (
            <div
              key={model.id}
              className={`rounded-md border border-border bg-panel p-2 ${editingModelId === model.id ? "ring-1 ring-brand" : ""}`}
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  className="min-w-0 flex-1 text-left"
                  type="button"
                  onClick={() => loadModel(model)}
                >
                  <div className="flex items-center gap-2">
                    <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${modelTone}`} title={modelTip} />
                    <span className="truncate text-sm font-medium">{model.display_name || model.model_name}</span>
                  </div>
                  <div className="mt-1 truncate font-mono text-xs text-muted">{model.model_name}</div>
                  {model.last_tested_at && (
                    <div className={`mt-1 text-xs ${
                      model.last_tested_ok === true
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-rose-600 dark:text-rose-400"
                    }`}>
                      {model.last_tested_ok === true
                        ? t("api.testedOk", { time: formatRelativeTime(model.last_tested_at) })
                        : t("api.testedFailed", { time: formatRelativeTime(model.last_tested_at) })}
                    </div>
                  )}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {model.is_default && <StatusPill tone="brand">{t("common.default")}</StatusPill>}
                    {!model.enabled && <StatusPill tone="danger">{t("common.disabled")}</StatusPill>}
                    {model.tags.slice(0, 3).map((tag) => (
                      <StatusPill key={tag}>{tag}</StatusPill>
                    ))}
                  </div>
                </button>
                <div className="flex shrink-0 gap-1">
                  <button
                    className="btn h-7 px-2 text-xs"
                    type="button"
                    onClick={() => testModel.mutate(model.id)}
                    disabled={testModel.isPending && testModel.variables === model.id}
                    title={t("api.testModelTitle")}
                  >
                    {testModel.isPending && testModel.variables === model.id ? (
                      <Wifi size={12} className="animate-pulse" />
                    ) : (
                      <Wifi size={12} />
                    )}
                  </button>
                  <button
                    className="btn h-7 px-2 text-xs text-danger"
                    type="button"
                    onClick={() => handleDeleteModel(model)}
                    disabled={removeModel.isPending && removeModel.variables === model.id}
                    title={t("api.deleteModelTitle")}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        {selectedProviderModels.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted">{t("api.emptyModels")}</div>
        )}
      </div>
      <div className="space-y-2 rounded-md border border-border bg-panel p-3">
        <div className="text-sm font-medium">{editingModelId ? t("api.editModel") : t("api.newModel")}</div>
        <label className="block">
          <span className="label">{t("api.displayName")}</span>
          <input
            name="api-model-display-name"
            className="input mt-1 w-full"
            value={modelDisplayName}
            onChange={(event) => setModelDisplayName(event.target.value)}
            placeholder="GPT-4o mini"
          />
        </label>
        <label className="block">
          <span className="label">{t("common.model")}</span>
          <input
            name="api-model-name"
            className="input mt-1 w-full font-mono"
            value={modelName}
            onChange={(event) => setModelName(event.target.value)}
            placeholder={`${providerSlug || "openai"}/gpt-4o-mini`}
          />
        </label>
        <label className="block">
          <span className="label">{t("api.contextWindow")}</span>
          <input
            name="api-model-context-window"
            className="input mt-1 w-full"
            type="number"
            min={1}
            value={contextWindow}
            onChange={(event) => setContextWindow(event.target.value)}
            placeholder="128000"
          />
        </label>
        <label className="block">
          <span className="label">{t("common.tags")}</span>
          <input
            name="api-model-tags"
            className="input mt-1 w-full"
            value={modelTags}
            onChange={(event) => setModelTags(event.target.value)}
            placeholder="fast,cheap"
          />
        </label>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label className="flex items-center gap-2 rounded-md border border-border bg-panel px-2 py-2">
            <input
              type="checkbox"
              checked={modelEnabled}
              onChange={(event) => setModelEnabled(event.target.checked)}
            />
            {t("common.enabled")}
          </label>
          <label className="flex items-center gap-2 rounded-md border border-border bg-panel px-2 py-2">
            <input
              type="checkbox"
              checked={modelIsDefault}
              onChange={(event) => setModelIsDefault(event.target.checked)}
            />
            {t("api.providerDefault")}
          </label>
        </div>
        {modelError && <div className="text-xs text-danger">{modelError}</div>}
        <button
          className="btn btn-primary w-full"
          type="button"
          onClick={() => saveModel.mutate()}
          disabled={!modelName.trim() || saveModel.isPending}
        >
          <Save size={14} />
          {editingModelId ? t("api.saveModel") : t("api.addModel")}
        </button>
      </div>
    </div>
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

function providerDisplayName(provider: ApiProvider | undefined, t: (key: string) => string): string {
  if (!provider) return t("room.noProvider");
  return `${provider.name} · ${providerKindLabel(provider.provider_slug, t)}`;
}

function apiModelOptionLabel(model: ApiModel, t: (key: string) => string): string {
  const name =
    model.display_name && model.display_name !== model.model_name
      ? `${model.display_name} · ${model.model_name}`
      : model.model_name;
  const markers = [
    model.is_default ? t("common.default") : "",
    model.enabled ? "" : t("common.disabled")
  ].filter(Boolean);
  return markers.length ? `${name} (${markers.join(", ")})` : name;
}

function apiModelFullLabel(model: ApiModel, provider: ApiProvider | undefined, t: (key: string) => string): string {
  return `${providerDisplayName(provider, t)} · ${apiModelOptionLabel(model, t)}`;
}

function personaModelLabel(
  persona: { api_model_id?: string | null; backing_model?: string | null },
  modelById: Map<string, ApiModel>,
  providerById: Map<string, ApiProvider>,
  t: (key: string) => string
): string {
  if (persona.api_model_id) {
    const model = modelById.get(persona.api_model_id);
    if (model) return apiModelFullLabel(model, providerById.get(model.api_provider_id), t);
  }
  return persona.backing_model?.trim() || t("room.defaultModel");
}

function renderApiModelOptions(models: ApiModel[], providerById: Map<string, ApiProvider>, t: (key: string) => string): ReactNode {
  const groups = new Map<string, ApiModel[]>();
  for (const model of models) {
    groups.set(model.api_provider_id, [...(groups.get(model.api_provider_id) ?? []), model]);
  }
  return Array.from(groups.entries())
    .sort(([left], [right]) =>
      providerDisplayName(providerById.get(left), t).localeCompare(providerDisplayName(providerById.get(right), t))
    )
    .map(([providerId, group]) => (
      <optgroup key={providerId} label={providerDisplayName(providerById.get(providerId), t)}>
        {group
          .slice()
          .sort((left, right) => Number(right.is_default) - Number(left.is_default) || left.display_name.localeCompare(right.display_name))
          .map((model) => (
            <option key={model.id} value={model.id} disabled={!model.enabled}>
              {apiModelOptionLabel(model, t)}
            </option>
          ))}
      </optgroup>
    ));
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
  const { t } = useI18n();
  const allTags = Array.from(new Set(items.flatMap((item) => item.tags ?? []))).sort();
  if (!allTags.length) return null;
  const toggle = (tag: string) =>
    onChange(selected.includes(tag) ? selected.filter((value) => value !== tag) : [...selected, tag]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted">{t("templates.filterTags")}</span>
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
          {t("common.clear")}
        </button>
      )}
    </div>
  );
}

type BuiltinItem = {
  id: string;
  name: string;
  description: string;
  tags?: string[];
};

function BuiltinLibrary<T extends BuiltinItem>({
  title,
  items,
  addingId,
  isAdding,
  onAdd,
  renderMeta
}: {
  title: string;
  items: T[];
  addingId?: string;
  isAdding: boolean;
  onAdd: (item: T) => void;
  renderMeta?: (item: T) => ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-lg border border-brand/30 bg-brand/5 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand">
          <Sparkles size={14} />
          {title}
        </h2>
        <StatusPill tone="brand">{t("templates.libraryCount", { count: items.length })}</StatusPill>
      </div>
      <div className="grid grid-cols-2 gap-2 max-lg:grid-cols-1">
        {items.map((item) => (
          <div key={item.id} className="rounded-md border border-border bg-panel p-3 shadow-card transition hover:border-brand">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-medium">{item.name}</h3>
                <p className="mt-1 line-clamp-2 text-xs text-muted">{item.description}</p>
              </div>
              <button
                className="btn btn-primary h-8 shrink-0 px-2 text-xs"
                type="button"
                onClick={() => onAdd(item)}
                disabled={isAdding && addingId === item.id}
              >
                <Plus size={14} />
                {t("common.add")}
              </button>
            </div>
            {(renderMeta || (item.tags?.length ?? 0) > 0) && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                {renderMeta?.(item)}
                {(item.tags ?? []).slice(0, 4).map((tag) => (
                  <StatusPill key={tag}>{tag}</StatusPill>
                ))}
              </div>
            )}
          </div>
        ))}
        {items.length === 0 && <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted">{t("templates.libraryEmpty")}</div>}
      </div>
    </div>
  );
}

function EmptyState({ title, onAdd }: { title: string; onAdd: () => void }) {
  const { t } = useI18n();
  return (
    <div className="panel col-span-full p-6 text-sm text-muted">
      <div className="flex items-center justify-between gap-3">
        <span>{title}</span>
        <button className="btn h-8 px-2 text-xs" type="button" onClick={onAdd}>
          <Plus size={14} />
          {t("common.add")}
        </button>
      </div>
    </div>
  );
}

function Placeholder({ title }: { title: string }) {
  const { t } = useI18n();
  return (
    <section className="panel p-6">
      <Header title={t("templates.placeholderTitle", { title })} />
      <p className="mt-3 text-sm text-muted">{t("templates.placeholderBody")}</p>
    </section>
  );
}

function Header({
  title,
  subtitle,
  actionLabel,
  onAction,
  metrics
}: {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  metrics?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-normal">{title}</h1>
        <p className="mt-1 text-sm text-muted">{subtitle ?? t("templates.headerHelp")}</p>
        {metrics && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">{metrics}</div>}
      </div>
      {onAction && (
        <button className="btn btn-primary rounded-full px-4" type="button" onClick={onAction}>
          <Plus size={16} />
          {actionLabel ?? t("common.add")}
        </button>
      )}
    </div>
  );
}
