import { useMemo, useState, type MouseEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cog, Pencil, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { api } from "../../api";
import type { PersonaKind, PersonaTemplate } from "../../types";
import { StatusPill } from "../../components/StatusPill";
import { toast } from "../../components/Toaster";
import { useConfirm } from "../../components/ConfirmDialog";
import { useUnsavedChangesWarning } from "../../hooks";
import { useI18n } from "../../i18n";
import { queryKeys } from "../../queryKeys";
import { personaModelLabel } from "../../utils/modelLabels";
import {
  DEFAULT_PERSONA_COLOR,
  DEFAULT_PERSONA_ICON,
  PERSONA_COLORS,
  PERSONA_ICONS,
  PERSONA_ICON_KEYS,
  PersonaIcon,
  resolvePersonaIcon
} from "../../components/PersonaIcon";
import { filterByTags, parseJsonObject, splitTags } from "./shared/templateUtils";
import { BuiltinLibrary, EmptyState, Header, TagFilterBar } from "./shared/TemplateChrome";
import { ModelSelector } from "./shared/ModelSelector";
export function PersonasTab() {
  const queryClient = useQueryClient();
  const { t, display } = useI18n();
  const confirm = useConfirm();
  const personas = useQuery({ queryKey: queryKeys.personaTemplates.editable, queryFn: () => api.personaTemplates(undefined, false) });
  const builtinPersonas = useQuery({ queryKey: queryKeys.personaTemplates.builtin, queryFn: () => api.personaTemplates(undefined, true) });
  const apiProviders = useQuery({ queryKey: queryKeys.apiProviders, queryFn: api.apiProviders });
  const apiModels = useQuery({ queryKey: queryKeys.apiModels, queryFn: () => api.apiModels() });
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
  const [identity, setIdentity] = useState("");
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
          api_model_id: selectedApiModel.id
        }
      : {
          api_model_id: null
        };
  const personaPayload = () => ({
    kind,
    name,
    identity,
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
    setIdentity(persona.identity ?? "");
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
    setIdentity("");
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.personaTemplates.all });
    }
  });
  const draftPersona = useMutation({
    mutationFn: () => api.templateDraft({ kind: "persona", prompt: draftPrompt }),
    onSuccess: (draft) => {
      const payload = draft.payload ?? {};
      setEditingPersonaId(null);
      setKind(payload.kind === "scribe" || payload.kind === "facilitator" ? payload.kind : "discussant");
      setName(typeof payload.name === "string" ? payload.name : name);
      setIdentity(typeof payload.identity === "string" ? payload.identity : identity);
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.personaTemplates.all });
    }
  });
  const remove = useMutation({
    mutationFn: (templateId: string) => api.deletePersonaTemplate(templateId),
    onSuccess: () => {
      resetPersonaForm();
      void queryClient.invalidateQueries({ queryKey: queryKeys.personaTemplates.all });
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
                      <h2 className="min-w-0 truncate text-sm font-semibold leading-5">
                        {persona.name}
                        {persona.identity && (
                          <span className="ml-1.5 text-xs font-normal text-muted">· {persona.identity}</span>
                        )}
                      </h2>
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
                          <Pencil size={14} />
                        </button>
                        <button
                          className="btn btn-danger h-8 w-8 px-0"
                          type="button"
                          onClick={(event) => deletePersona(persona, event)}
                          disabled={remove.isPending && remove.variables === persona.id}
                          title={t("common.delete")}
                          aria-label={t("common.delete")}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <StatusPill tone={persona.kind === "discussant" ? "brand" : "accent"}>
                        {display("personaKind", persona.kind)}
                      </StatusPill>
                      <span className="truncate text-xs text-muted">
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
                        className="rounded-md bg-surface px-1.5 py-0.5 text-xs text-muted"
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
          {/* Identity: avatar + name + identity + kind on one row */}
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
            <label className="block min-w-0 flex-1">
              <span className="label">{t("templates.identity")}</span>
              <input
                name="persona-identity"
                className="input mt-1 w-full"
                placeholder={t("templates.identityPlaceholder")}
                value={identity}
                onChange={(event) => setIdentity(event.target.value)}
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

          <ModelSelector
            name="persona-api-model"
            value={apiModelId}
            models={apiModels.data ?? []}
            providerById={providerById}
            onChange={setApiModelId}
          />

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
                      <Icon size={14} />
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
