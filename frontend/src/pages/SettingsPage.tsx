import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import { CheckCircle2, Save, Wifi, XCircle } from "lucide-react";
import { api } from "../api";
import { StatusPill } from "../components/StatusPill";
import { ApiProvidersView } from "./TemplatesPage";
import type { ApiModel, ApiProvider } from "../types";
import { useI18n } from "../i18n";

export function SettingsPage() {
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 10000 });
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <div className="max-w-3xl">
        <h1 className="text-xl font-semibold">{t("settings.title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("settings.subtitle")}</p>
      </div>
      <DefaultApiSection />
      <section className="panel max-w-3xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">{t("settings.backendStatus")}</div>
            <div className="mt-1 text-sm text-muted">FastAPI · SQLite/PostgreSQL · LiteLLM</div>
          </div>
          <StatusPill tone={health.data?.status === "ok" ? "brand" : "danger"}>{health.data?.status ?? "checking"}</StatusPill>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-md border border-border p-3">
            <dt className="label">{t("settings.database")}</dt>
            <dd className="mt-1">{health.data?.database ?? "-"}</dd>
          </div>
          <div className="rounded-md border border-border p-3">
            <dt className="label">{t("settings.setupReady")}</dt>
            <dd className="mt-1">
              {health.data?.setup_complete ? (
                <span className="text-brand">{t("common.yes")}</span>
              ) : (
                <span className="text-danger">{t("settings.notReady")}</span>
              )}
            </dd>
          </div>
        </dl>
      </section>
      <ApiProvidersView />
    </div>
  );
}

function DefaultApiSection() {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const settings = useQuery({ queryKey: ["app-settings"], queryFn: api.appSettings });
  const providers = useQuery({ queryKey: ["api-providers"], queryFn: api.apiProviders });
  const models = useQuery({ queryKey: ["api-models"], queryFn: () => api.apiModels() });
  const [apiModelId, setApiModelId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Sync local state with server-side once loaded.
  useEffect(() => {
    if (!settings.data) return;
    setApiModelId(settings.data.default_api_model_id ?? "");
  }, [settings.data?.default_api_model_id]);

  const providerById = useMemo(
    () => new Map((providers.data ?? []).map((provider) => [provider.id, provider])),
    [providers.data]
  );
  const selectedModel = useMemo(
    () => models.data?.find((model) => model.id === apiModelId),
    [models.data, apiModelId]
  );

  const save = useMutation({
    mutationFn: () =>
      api.updateAppSettings({
        default_api_model_id: apiModelId || null
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      void queryClient.invalidateQueries({ queryKey: ["health"] });
      setError(null);
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("api.saveFailed"))
  });

  const testConfig = useMutation({
    mutationFn: () => api.testApiModel(apiModelId),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["api-models"] });
      setTestResult({
        ok: result.ok,
        message: result.ok
          ? t("api.connectionOk")
          : result.error || t("api.testFailed")
      });
    },
    onError: (err) =>
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : t("api.testRequestFailed")
      })
  });

  const status = selectedModel?.last_tested_ok;
  const statusColor =
    status === true ? "bg-emerald-500" : status === false ? "bg-rose-500" : "bg-zinc-400";
  const statusLabel =
    status === true
      ? t("api.statusOk", { time: selectedModel?.last_tested_at?.slice(0, 19).replace("T", " ") })
      : status === false
        ? t("api.statusFailed", { error: selectedModel?.last_tested_error ?? t("common.unknown") })
        : t("api.statusUntested");

  return (
    <section className="panel max-w-3xl p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">{t("settings.defaultApi")}</div>
          <div className="mt-1 text-sm text-muted">
            {t("settings.defaultApiHelp")}
          </div>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="label">{t("settings.defaultModel")}</span>
          <select
            name="default-api-model"
            className="input mt-1 w-full"
            value={apiModelId}
            onChange={(event) => {
              setApiModelId(event.target.value);
              setTestResult(null);
            }}
          >
            <option value="">{t("common.unset")}</option>
            {renderSettingsModelOptions(models.data ?? [], providerById, t)}
          </select>
          {(models.data?.length ?? 0) === 0 && (
            <p className="mt-1 text-xs text-muted">
              {t("settings.noModelGoAdd")} <NavLink className="text-brand underline" to="/templates/api">{t("common.add")}</NavLink>
            </p>
          )}
          {apiModelId && (
            <div className="mt-2 flex items-center gap-2 text-xs text-muted">
              <span className={`inline-block h-2 w-2 rounded-full ${statusColor}`} aria-hidden="true" />
              <span>{statusLabel}</span>
            </div>
          )}
        </label>
        {selectedModel && (
          <div className="rounded-md border border-border bg-surface p-3 text-xs text-muted">
            <div className="font-medium text-foreground">{settingsModelLabel(selectedModel, providerById.get(selectedModel.api_provider_id), t)}</div>
            <div className="mt-1 font-mono">{selectedModel.model_name}</div>
          </div>
        )}
        {error && <p className="text-xs text-danger">{error}</p>}
        {testResult && (
          <div
            className={`flex items-start gap-2 rounded-md border p-2 text-xs ${
              testResult.ok
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
            }`}
          >
            {testResult.ok ? <CheckCircle2 size={14} className="mt-0.5" /> : <XCircle size={14} className="mt-0.5" />}
            <span className="break-all">{testResult.message}</span>
          </div>
        )}
        <div className="flex gap-2">
          <button
            className="btn btn-primary flex-1"
            onClick={() => save.mutate()}
            disabled={save.isPending}
          >
            <Save size={14} />
            {t("common.save")}
          </button>
          <button
            className="btn flex-1"
            type="button"
            onClick={() => testConfig.mutate()}
            disabled={testConfig.isPending || !apiModelId}
            title={t("settings.testConfigTitle")}
          >
            <Wifi size={14} className={testConfig.isPending ? "animate-pulse" : ""} />
            {testConfig.isPending ? t("common.testing") : t("settings.testConfig")}
          </button>
        </div>
      </div>
    </section>
  );
}

function settingsProviderName(provider: ApiProvider | undefined, t: (key: string) => string): string {
  if (!provider) return t("room.noProvider");
  return `${provider.name} · ${provider.vendor || provider.provider_slug}`;
}

function settingsModelOptionLabel(model: ApiModel, t: (key: string) => string): string {
  const label =
    model.display_name && model.display_name !== model.model_name
      ? `${model.display_name} · ${model.model_name}`
      : model.model_name;
  const markers = [
    model.is_default ? t("api.providerDefault") : "",
    model.enabled ? "" : t("common.disabled")
  ].filter(Boolean);
  return markers.length ? `${label} (${markers.join(", ")})` : label;
}

function settingsModelLabel(model: ApiModel, provider: ApiProvider | undefined, t: (key: string) => string): string {
  return `${settingsProviderName(provider, t)} · ${settingsModelOptionLabel(model, t)}`;
}

function renderSettingsModelOptions(
  models: ApiModel[],
  providerById: Map<string, ApiProvider>,
  t: (key: string) => string
) {
  const groups = new Map<string, ApiModel[]>();
  for (const model of models) {
    groups.set(model.api_provider_id, [...(groups.get(model.api_provider_id) ?? []), model]);
  }
  return Array.from(groups.entries())
    .sort(([left], [right]) =>
      settingsProviderName(providerById.get(left), t).localeCompare(settingsProviderName(providerById.get(right), t))
    )
    .map(([providerId, group]) => (
      <optgroup key={providerId} label={settingsProviderName(providerById.get(providerId), t)}>
        {group
          .slice()
          .sort((left, right) => Number(right.is_default) - Number(left.is_default) || left.display_name.localeCompare(right.display_name))
          .map((model) => (
            <option key={model.id} value={model.id} disabled={!model.enabled}>
              {settingsModelOptionLabel(model, t)}
            </option>
          ))}
      </optgroup>
    ));
}
