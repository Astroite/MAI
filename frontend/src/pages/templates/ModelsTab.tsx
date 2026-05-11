import { Plus, Save, Trash2, Wifi } from "lucide-react";
import type { ApiModel } from "../../types";
import { StatusPill } from "../../components/StatusPill";
import { useI18n } from "../../i18n";
import { ROUTABLE_SLUGS, SUGGESTED_MODELS } from "../../providers";

type TFn = ReturnType<typeof useI18n>["t"];
export function ProviderModelsPanel({
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
              ? "bg-success"
              : model.last_tested_ok === false
                ? "bg-danger"
                : "bg-muted";
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
                        ? "text-success"
                        : "text-danger"
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
            list={`api-model-suggestions-${providerSlug || "_"}`}
            value={modelName}
            onChange={(event) => {
              const next = event.target.value;
              setModelName(next);
              // Auto-fill display_name when the user picks (or types) one of
              // our suggestions and hasn't already named the row. They can
              // still override after — we only set, never overwrite.
              // Only auto-fill display_name when the user picks a known
              // suggestion (exact match). Free-form typing leaves
              // display_name empty — the backend will derive one from the
              // model id on save.
              if (!modelDisplayName.trim()) {
                const suggestion = (SUGGESTED_MODELS[providerSlug] ?? []).find((m) => m.id === next.trim());
                if (suggestion) setModelDisplayName(suggestion.label.split(" · ")[0]);
              }
            }}
            placeholder={
              ROUTABLE_SLUGS.has(providerSlug)
                ? (SUGGESTED_MODELS[providerSlug]?.[0]?.id ?? "gpt-4o-mini")
                : `${providerSlug || "openai"}/gpt-4o-mini`
            }
          />
          <datalist id={`api-model-suggestions-${providerSlug || "_"}`}>
            {(SUGGESTED_MODELS[providerSlug] ?? []).map((suggestion) => (
              <option key={suggestion.id} value={suggestion.id}>
                {suggestion.label}
              </option>
            ))}
          </datalist>
          {ROUTABLE_SLUGS.has(providerSlug) && (
            <p className="mt-1 text-xs text-muted">{t("api.modelNameHelp")}</p>
          )}
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
