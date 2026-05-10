import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PauseCircle, Pencil, Save, Users, Wrench, X } from "lucide-react";
import { api } from "../../api";
import { useUIStore } from "../../store";
import type { ApiModel, ApiProvider, PersonaInstance } from "../../types";
import { useI18n } from "../../i18n";
import { providerKindLabel } from "../../providers";
import { PersonaIcon } from "../../components/PersonaIcon";
import { personaTone } from "../../utils/color";

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

function personaModelLabel(
  persona: { api_model_id?: string | null; backing_model?: string | null },
  modelById: Map<string, ApiModel>,
  providerById: Map<string, ApiProvider>,
  t: (key: string) => string
): string {
  if (persona.api_model_id) {
    const model = modelById.get(persona.api_model_id);
    if (model) return `${providerDisplayName(providerById.get(model.api_provider_id), t)} · ${apiModelOptionLabel(model, t)}`;
  }
  return persona.backing_model?.trim() || t("room.defaultModel");
}

function renderApiModelOptions(models: ApiModel[], providerById: Map<string, ApiProvider>, t: (key: string) => string) {
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
  const { t } = useI18n();
  const providers = useQuery({ queryKey: ["api-providers"], queryFn: api.apiProviders });
  const models = useQuery({ queryKey: ["api-models"], queryFn: () => api.apiModels() });
  const [editingId, setEditingId] = useState<string | null>(null);
  const providerById = useMemo(
    () => new Map((providers.data ?? []).map((provider) => [provider.id, provider])),
    [providers.data]
  );
  const modelById = useMemo(
    () => new Map((models.data ?? []).map((model) => [model.id, model])),
    [models.data]
  );
  const activePersonaIds = new Set(
    Object.values(streaming)
      .filter((item) => item.roomId === roomId)
      .map((item) => item.personaId)
  );
  const discussants = personas.filter((p) => p.kind === "discussant");
  const systemPersonas = personas.filter((p) => p.kind !== "discussant");

  if (compact) {
    return (
      <div className="border-b border-border/80 bg-panel px-4 py-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Users size={14} className="text-brand" />
          {t("room.members", { count: discussants.length })}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {discussants.map((persona) => (
            <div
              key={persona.id}
              className={`min-w-0 rounded-lg border px-2 py-2 shadow-card ${
                activePersonaIds.has(persona.id) ? "border-brand/50 bg-brand/10" : "border-border/80 bg-panel"
              }`}
              title={persona.identity ? `${persona.name} · ${persona.identity}` : persona.name}
            >
              <div className="flex min-w-0 items-center gap-2">
                <PersonaIcon
                  icon={persona.icon}
                  color={personaTone(persona)}
                  size={28}
                  iconSize={14}
                  rounded="full"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-text">
                    {persona.name}
                    {persona.identity && (
                      <span className="ml-1 text-xs font-normal text-muted">· {persona.identity}</span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted">
                    {personaModelLabel(persona, modelById, providerById, t)}
                  </div>
                </div>
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    activePersonaIds.has(persona.id) ? "bg-brand" : "bg-success"
                  }`}
                  style={activePersonaIds.has(persona.id) ? { animation: "pulse-ring 1.4s ease-out infinite" } : undefined}
                />
              </div>
              <div className="mt-2 flex items-center gap-1 text-xs text-muted">
                {Boolean(persona.config?.tools_enabled) && <Wrench size={12} aria-label={t("room.toolsEnabled")} />}
                {(persona.config?.auto_reply_enabled ?? true) === false && (
                  <PauseCircle size={12} aria-label={t("room.autoReplyDisabled")} />
                )}
                <span className="truncate">{persona.tags?.slice(0, 2).join(" · ") || persona.description}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-border bg-panel">
      <div className="border-b border-border px-3 py-3 text-sm font-semibold">
        {t("room.members", { count: discussants.length })}
      </div>
      <div className="mai-scrollbar min-h-0 flex-1 overflow-auto px-2 py-2">
        {discussants.map((persona) => (
          <PersonaRow
            key={persona.id}
            roomId={roomId}
            persona={persona}
            apiModels={models.data ?? []}
            modelById={modelById}
            providerById={providerById}
            t={t}
            speaking={activePersonaIds.has(persona.id)}
            isEditing={editingId === persona.id}
            onEditOpen={() => setEditingId(persona.id)}
            onEditClose={() => setEditingId(null)}
          />
        ))}
        {systemPersonas.length > 0 && (
          <>
            <div className="mt-4 px-2 text-xs uppercase tracking-wider text-muted">{t("room.systemRoles")}</div>
            {systemPersonas.map((persona) => (
              <PersonaRow
                key={persona.id}
                roomId={roomId}
                persona={persona}
                apiModels={models.data ?? []}
                modelById={modelById}
                providerById={providerById}
                t={t}
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
  apiModels,
  modelById,
  providerById,
  t,
  speaking,
  muted = false,
  isEditing,
  onEditOpen,
  onEditClose
}: {
  roomId: string;
  persona: PersonaInstance;
  apiModels: ApiModel[];
  modelById: Map<string, ApiModel>;
  providerById: Map<string, ApiProvider>;
  t: (key: string, params?: Record<string, string | number | null | undefined>) => string;
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
          <PersonaIcon
            icon={persona.icon}
            color={personaTone(persona)}
            size={36}
            iconSize={18}
            rounded="full"
          />
          {speaking && (
            <span
              className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-panel bg-brand"
              style={{ animation: "pulse-ring 1.4s ease-out infinite" }}
              aria-hidden="true"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">
            {persona.name}
            {persona.identity && (
              <span className="ml-1.5 text-xs font-normal text-muted">· {persona.identity}</span>
            )}
          </div>
          <div className="mt-0.5 truncate text-xs text-muted">{personaModelLabel(persona, modelById, providerById, t)}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {(persona.config?.auto_reply_enabled ?? true) === false && (
              <span className="inline-flex items-center gap-1 rounded bg-surface px-1.5 py-0.5 text-xs text-muted">
                <PauseCircle size={12} />
                {t("room.autoReplyDisabled")}
              </span>
            )}
            {Boolean(persona.config?.tools_enabled) && (
              <span className="inline-flex items-center gap-1 rounded bg-surface px-1.5 py-0.5 text-xs text-brand">
                <Wrench size={12} />
                {t("room.toolsEnabled")}
              </span>
            )}
          </div>
          {speaking && <div className="mt-0.5 text-xs text-brand">{t("room.speaking")}</div>}
        </div>
        <button
          type="button"
          className="btn h-7 px-2 text-xs"
          onClick={isEditing ? onEditClose : onEditOpen}
          aria-label={isEditing ? t("room.closeEdit") : t("room.editPersona")}
        >
          {isEditing ? <X size={12} /> : <Pencil size={12} />}
        </button>
      </div>
      {isEditing && (
        <PersonaInstanceEditor
          roomId={roomId}
          persona={persona}
          apiModels={apiModels}
          providerById={providerById}
          t={t}
          onClose={onEditClose}
        />
      )}
    </div>
  );
}

function PersonaInstanceEditor({
  roomId,
  persona,
  apiModels,
  providerById,
  t,
  onClose
}: {
  roomId: string;
  persona: PersonaInstance;
  apiModels: ApiModel[];
  providerById: Map<string, ApiProvider>;
  t: (key: string, params?: Record<string, string | number | null | undefined>) => string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [description, setDescription] = useState(persona.description);
  const [apiModelId, setApiModelId] = useState(persona.api_model_id ?? "");
  const [temperature, setTemperature] = useState(persona.temperature);
  const [talkativeness, setTalkativeness] = useState(persona.talkativeness ?? 1.0);
  const [systemPrompt, setSystemPrompt] = useState(persona.system_prompt);
  const [autoReplyEnabled, setAutoReplyEnabled] = useState((persona.config?.auto_reply_enabled ?? true) !== false);
  const [toolsEnabled, setToolsEnabled] = useState(Boolean(persona.config?.tools_enabled));
  const [toolsAllowWrite, setToolsAllowWrite] = useState(Boolean(persona.config?.tools_allow_write));
  const [error, setError] = useState<string | null>(null);
  const selectedApiModel = apiModels.find((model) => model.id === apiModelId);

  const save = useMutation({
    mutationFn: () =>
      api.updatePersonaInstance(roomId, persona.id, {
        description,
        api_model_id: selectedApiModel?.id ?? null,
        api_provider_id: selectedApiModel?.api_provider_id ?? null,
        backing_model: selectedApiModel?.model_name ?? "",
        temperature,
        talkativeness,
        system_prompt: systemPrompt,
        config: {
          ...(persona.config ?? {}),
          auto_reply_enabled: autoReplyEnabled,
          tools_enabled: toolsEnabled,
          tools_allow_write: toolsEnabled ? toolsAllowWrite : false
        }
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["room", roomId] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("api.saveFailed"))
  });

  return (
    <form
      className="mt-3 space-y-2 rounded-md border border-border bg-panel p-2 text-xs"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <p className="text-muted">{t("room.instanceHelp")}</p>
      <label className="block">
        <span className="label">{t("common.description")}</span>
        <textarea
          name="instance-description"
          className="textarea mt-1 w-full"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
        />
      </label>
      <label className="block">
        <span className="label">{t("common.model")}</span>
        <select
          name="instance-api-model"
          className="input mt-1 w-full"
          value={apiModelId}
          onChange={(event) => setApiModelId(event.target.value)}
        >
          <option value="">{t("room.defaultModel")}</option>
          {renderApiModelOptions(apiModels, providerById, t)}
        </select>
      </label>
      <label className="block">
        <span className="label">{t("templates.temperature")}</span>
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
        <span className="label">{t("templates.talkativeness")} <span className="ml-1 text-xs text-muted">{talkativeness.toFixed(1)}</span></span>
        <input
          name="instance-talkativeness"
          className="mt-1 w-full"
          type="range"
          min={0}
          max={3}
          step={0.1}
          value={talkativeness}
          onChange={(event) => setTalkativeness(Number(event.target.value))}
        />
        <p className="mt-1 text-xs text-muted">{t("templates.talkativenessHelp")}</p>
      </label>
      <label className="block">
        <span className="label">{t("templates.systemPrompt")}</span>
        <textarea
          name="instance-system-prompt"
          className="textarea mt-1 w-full font-mono"
          value={systemPrompt}
          onChange={(event) => setSystemPrompt(event.target.value)}
          rows={5}
        />
      </label>
      <div className="space-y-2 rounded-md border border-border bg-surface p-2">
        <label className="flex items-center gap-2">
          <input
            name="instance-auto-reply"
            type="checkbox"
            checked={autoReplyEnabled}
            onChange={(event) => setAutoReplyEnabled(event.target.checked)}
          />
          {t("room.autoReplyEnabled")}
        </label>
        <label className="flex items-center gap-2">
          <input
            name="instance-tools-enabled"
            type="checkbox"
            checked={toolsEnabled}
            onChange={(event) => setToolsEnabled(event.target.checked)}
          />
          {t("room.toolsEnabled")}
        </label>
        <label className={`flex items-center gap-2 ${toolsEnabled ? "" : "opacity-50"}`}>
          <input
            name="instance-tools-write"
            type="checkbox"
            checked={toolsAllowWrite}
            disabled={!toolsEnabled}
            onChange={(event) => setToolsAllowWrite(event.target.checked)}
          />
          {t("room.toolsAllowWrite")}
        </label>
      </div>
      {error && <p className="text-danger">{error}</p>}
      <div className="flex gap-2">
        <button className="btn btn-primary h-8 px-2" type="submit" disabled={save.isPending}>
          <Save size={12} /> {t("common.save")}
        </button>
        <button className="btn h-8 px-2" type="button" onClick={onClose}>
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}
