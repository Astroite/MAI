import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import {
  Activity,
  Bug,
  CheckCircle2,
  Database,
  Download,
  FolderOpen,
  RefreshCw,
  Save,
  Server,
  Wifi,
  XCircle
} from "lucide-react";
import { api } from "../api";
import { SKIP_UPDATE_KEY } from "../App";
import { SectionCard } from "../components/SectionCard";
import { StatusPill } from "../components/StatusPill";
import { toast } from "../components/Toaster";
import { ProvidersTab } from "./templates/ProvidersTab";
import { useI18n } from "../i18n";
import { queryKeys } from "../queryKeys";
import { useUIStore } from "../store";
import { apiModelFullLabel, renderApiModelOptions } from "../utils/modelLabels";
import { getDesktopLogDir, isTauriRuntime, openDesktopLogDir } from "../utils/desktopDiagnostics";
import { formatLocalDateTime } from "../utils/time";

export function SettingsPage() {
  const health = useQuery({ queryKey: queryKeys.health, queryFn: api.health, refetchInterval: 10000 });
  const providers = useQuery({ queryKey: queryKeys.apiProviders, queryFn: api.apiProviders });
  const models = useQuery({ queryKey: queryKeys.apiModels, queryFn: () => api.apiModels() });
  const { t } = useI18n();

  const verifiedProviders = (providers.data ?? []).filter((p) => p.last_tested_ok === true).length;
  const enabledModels = (models.data ?? []).filter((m) => m.enabled).length;
  const setupReady = Boolean(health.data?.setup_complete);

  return (
    <div className="space-y-4">
      <header className="panel flex flex-wrap items-start justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-normal">{t("settings.title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("settings.subtitle")}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <StatusPill tone={setupReady ? "brand" : "warning"} dot>
              {setupReady ? t("settings.setupReady") : t("settings.notReady")}
            </StatusPill>
            <StatusPill tone="info">
              <Server size={12} />
              {t("settings.providerStat", {
                enabled: verifiedProviders,
                total: providers.data?.length ?? 0
              })}
            </StatusPill>
            <StatusPill tone="info">
              <Activity size={12} />
              {t("settings.modelStat", { enabled: enabledModels, total: models.data?.length ?? 0 })}
            </StatusPill>
            <StatusPill tone={health.data?.status === "ok" ? "brand" : "danger"} dot>
              {health.data?.status ?? "checking"}
            </StatusPill>
            {health.data?.database && (
              <span className="inline-flex items-center gap-1 text-muted">
                <Database size={12} />
                <span className="max-w-[20rem] truncate">{health.data.database}</span>
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-4 max-lg:grid-cols-1">
        <DefaultApiSection />
        <UpdaterSection />
      </div>

      <DebugSection />

      <ProvidersTab />
    </div>
  );
}

function UpdaterSection() {
  const { t } = useI18n();
  const [skippedVersion, setSkippedVersion] = useState<string | null>(() => localStorage.getItem(SKIP_UPDATE_KEY));
  const [checking, setChecking] = useState(false);
  const isTauri = typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__);

  const handleCheck = useCallback(async () => {
    if (!isTauri) return;
    setChecking(true);
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (!update) {
        toast.success(t("updater.upToDate"));
      } else {
        // Clear any skip so the banner re-appears at the top of the app.
        localStorage.removeItem(SKIP_UPDATE_KEY);
        setSkippedVersion(null);
        toast.message(t("updater.foundUpdate", { version: update.version }));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("updater.checkFailed"));
    } finally {
      setChecking(false);
    }
  }, [isTauri, t]);

  const handleUnskip = () => {
    localStorage.removeItem(SKIP_UPDATE_KEY);
    setSkippedVersion(null);
    toast.success(t("updater.skipCleared"));
  };

  if (!isTauri) {
    return (
      <SectionCard title={t("updater.title")} icon={<Download size={14} />}>
        <p className="text-xs text-muted">{t("updater.subtitle")}</p>
        <p className="mt-2 text-xs text-muted">{t("updater.notTauri")}</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title={t("updater.title")} icon={<Download size={14} />}>
      <p className="text-xs text-muted">{t("updater.subtitle")}</p>
      {skippedVersion && (
        <p className="mt-2 text-xs text-muted">{t("updater.skipped", { version: skippedVersion })}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn flex-1" type="button" onClick={handleCheck} disabled={checking}>
          {checking ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
          {t("updater.checkNow")}
        </button>
        {skippedVersion && (
          <button className="btn" type="button" onClick={handleUnskip}>
            <RefreshCw size={14} />
            {t("updater.unskip")}
          </button>
        )}
      </div>
    </SectionCard>
  );
}

function DefaultApiSection() {
  const queryClient = useQueryClient();
  const { locale, t } = useI18n();
  const settings = useQuery({ queryKey: queryKeys.appSettings, queryFn: api.appSettings });
  const providers = useQuery({ queryKey: queryKeys.apiProviders, queryFn: api.apiProviders });
  const models = useQuery({ queryKey: queryKeys.apiModels, queryFn: () => api.apiModels() });
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.appSettings });
      void queryClient.invalidateQueries({ queryKey: queryKeys.health });
      setError(null);
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("api.saveFailed"))
  });

  const testConfig = useMutation({
    mutationFn: () => api.testApiModel(apiModelId),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiModels });
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
    status === true ? "bg-success" : status === false ? "bg-danger" : "bg-muted";
  const statusLabel =
    status === true
      ? t("api.statusOk", { time: formatLocalDateTime(selectedModel?.last_tested_at, locale) })
      : status === false
        ? t("api.statusFailed", { error: selectedModel?.last_tested_error ?? t("common.unknown") })
        : t("api.statusUntested");

  return (
    <SectionCard
      title={t("settings.defaultApi")}
      icon={<Wifi size={14} />}
      tone="brand"
    >
      <p className="text-xs text-muted">{t("settings.defaultApiHelp")}</p>
      <div className="mt-3 space-y-3">
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
            {renderApiModelOptions(models.data ?? [], providerById, t, {
              defaultLabelKey: "api.providerDefault"
            })}
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
            <div className="font-medium text-text">
              {apiModelFullLabel(selectedModel, providerById.get(selectedModel.api_provider_id), t, {
                defaultLabelKey: "api.providerDefault"
              })}
            </div>
            <div className="mt-1 font-mono">{selectedModel.model_name}</div>
          </div>
        )}
        {error && <p className="text-xs text-danger">{error}</p>}
        {testResult && (
          <div
            className={`flex items-start gap-2 rounded-md border p-2 text-xs ${
              testResult.ok
                ? "border-success/30 bg-success/10 text-success"
                : "border-danger/30 bg-danger/10 text-danger"
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
    </SectionCard>
  );
}

function DebugSection() {
  const { t } = useI18n();
  const showApiErrorDetail = useUIStore((s) => s.showApiErrorDetail);
  const setShowApiErrorDetail = useUIStore((s) => s.setShowApiErrorDetail);
  const isTauri = isTauriRuntime();
  const [logDir, setLogDir] = useState<string | null>(null);
  const [openingLogs, setOpeningLogs] = useState(false);

  useEffect(() => {
    if (!isTauri) return;
    void getDesktopLogDir().then(setLogDir).catch(() => setLogDir(null));
  }, [isTauri]);

  const handleOpenLogs = async () => {
    setOpeningLogs(true);
    try {
      await openDesktopLogDir();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("desktop.openLogsFailed"));
    } finally {
      setOpeningLogs(false);
    }
  };

  return (
    <SectionCard title={t("settings.debug")} icon={<Bug size={14} />} tone="info">
      <p className="text-xs text-muted">{t("settings.debugHelp")}</p>
      <label className="mt-3 flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 cursor-pointer accent-brand"
          checked={showApiErrorDetail}
          onChange={(event) => setShowApiErrorDetail(event.target.checked)}
        />
        <span className="flex-1">
          <span className="block text-sm text-text">{t("settings.showApiErrorDetail")}</span>
          <span className="block text-xs text-muted">{t("settings.showApiErrorDetailHelp")}</span>
        </span>
      </label>
      {isTauri && (
        <div className="mt-4 rounded-md border border-border bg-surface p-3">
          <div className="text-sm font-medium text-text">{t("desktop.logs")}</div>
          <p className="mt-1 text-xs text-muted">{t("desktop.logsHelp")}</p>
          {logDir && (
            <p className="mt-2 break-all text-xs text-muted">
              {t("desktop.logDir", { path: logDir })}
            </p>
          )}
          <button
            type="button"
            className="btn mt-3 h-8 px-3 text-xs"
            onClick={handleOpenLogs}
            disabled={openingLogs}
          >
            {openingLogs ? <RefreshCw size={14} className="animate-spin" /> : <FolderOpen size={14} />}
            {t("desktop.openLogs")}
          </button>
        </div>
      )}
    </SectionCard>
  );
}
