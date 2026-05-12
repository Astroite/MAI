import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, ChevronUp, Eye, EyeOff, Plus, Save, Trash2, Wifi, XCircle } from "lucide-react";
import { api } from "../../api";
import type { ApiModel, ApiProvider } from "../../types";
import { StatusPill } from "../../components/StatusPill";
import { toast } from "../../components/Toaster";
import { useConfirm } from "../../components/ConfirmDialog";
import { useI18n } from "../../i18n";
import { PROVIDER_KINDS, providerKindLabel } from "../../providers";
import { queryKeys } from "../../queryKeys";
import { splitTags } from "./shared/templateUtils";
import { Header } from "./shared/TemplateChrome";
import { ProviderModelsPanel } from "./ModelsTab";
import { formatLocalDateTime } from "../../utils/time";
const DRAFT_PROVIDER_ID = "__new__";

export function ProvidersTab() {
  const queryClient = useQueryClient();
  const { locale, t, formatRelativeTime } = useI18n();
  const confirm = useConfirm();
  const providers = useQuery({ queryKey: queryKeys.apiProviders, queryFn: api.apiProviders });
  const models = useQuery({ queryKey: queryKeys.apiModels, queryFn: () => api.apiModels() });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [providerSlug, setProviderSlug] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [apiBase, setApiBase] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [modelDisplayName, setModelDisplayName] = useState("");
  const [modelName, setModelName] = useState("");
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
  const resetModelForm = (_slug = providerSlug) => {
    setEditingModelId(null);
    setModelDisplayName("");
    // Backend auto-prepends the provider slug at call time, so the input
    // is left empty — placeholder shows the bare model id to fill in.
    setModelName("");
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
      setModelName("");
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiProviders });
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiModels });
      void queryClient.invalidateQueries({ queryKey: queryKeys.personaTemplates.all });
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiProviders });
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiModels });
      void queryClient.invalidateQueries({ queryKey: queryKeys.appSettings });
      void queryClient.invalidateQueries({ queryKey: queryKeys.health });
      void queryClient.invalidateQueries({ queryKey: queryKeys.personaTemplates.all });
      resetForm();
    },
    onError: (err) => setPendingError(err instanceof Error ? err.message : t("api.deleteFailed"))
  });
  const test = useMutation({
    mutationFn: (id: string) => api.testApiProvider(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.apiProviders })
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiModels });
      void queryClient.invalidateQueries({ queryKey: queryKeys.appSettings });
      void queryClient.invalidateQueries({ queryKey: queryKeys.health });
      void queryClient.invalidateQueries({ queryKey: queryKeys.personaTemplates.all });
      loadModel(saved);
    },
    onError: (err) => setModelError(err instanceof Error ? err.message : t("api.saveFailed"))
  });
  const removeModel = useMutation({
    mutationFn: (id: string) => api.deleteApiModel(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiModels });
      void queryClient.invalidateQueries({ queryKey: queryKeys.appSettings });
      void queryClient.invalidateQueries({ queryKey: queryKeys.health });
      void queryClient.invalidateQueries({ queryKey: queryKeys.personaTemplates.all });
      resetModelForm();
    },
    onError: (err) => setModelError(err instanceof Error ? err.message : t("api.deleteFailed"))
  });
  const testModel = useMutation({
    mutationFn: (id: string) => api.testApiModel(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.apiModels }),
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
                  <Plus size={14} className="text-brand" />
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
              ? "bg-success"
              : provider.last_tested_ok === false
                ? "bg-danger"
                : "bg-muted";
          const tip =
            provider.last_tested_ok === true
              ? t("api.statusOk", { time: formatLocalDateTime(provider.last_tested_at, locale) })
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
                      <CheckCircle2 size={14} className="text-success" />
                    ) : provider.last_tested_ok === false ? (
                      <XCircle size={14} className="text-danger" />
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
                    locale={locale}
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
  expandedHeader: ReactNode;
  children: ReactNode;
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
            // Backend now prepends the slug for routable providers; we no
            // longer pre-fill the model input with `slug/` here.
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
