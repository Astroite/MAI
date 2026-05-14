import { useCallback, useEffect, useState } from "react";
import { NavLink, Route, Routes, useMatch } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronRight, Download, Loader2, RefreshCw, X } from "lucide-react";
import { api } from "./api";
import { useUIStore } from "./store";
import { AppRail } from "./components/AppRail";
import { DashboardPage } from "./pages/DashboardPage";
import { HomePage } from "./pages/HomePage";
import { NewDiscussionPage } from "./pages/NewDiscussionPage";
import { RoomPage } from "./pages/RoomPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { ToolsPage } from "./pages/ToolsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { WorldListPage } from "./pages/WorldListPage";
import { WorldDetailPage } from "./pages/WorldDetailPage";
import { useI18n } from "./i18n";
import { queryKeys } from "./queryKeys";
import { toast } from "./components/Toaster";
import {
  installFrontendLogHooks,
  isTauriRuntime,
  openDesktopLogDir,
  writeFrontendLog,
  type BackendErrorPayload
} from "./utils/desktopDiagnostics";

export function App() {
  const dark = useUIStore((state) => state.dark);
  const inRoomView = useMatch({ path: "/rooms/:roomId/*", end: false });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  return (
    <div className="flex h-[100dvh] min-h-[100dvh] overflow-hidden bg-surface text-text">
      <AppRail />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <UpdateBanner />
        <DesktopDiagnosticsBanner />
        <SetupBanner />
        {inRoomView ? (
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Routes>
              <Route path="/rooms/:roomId" element={<RoomPage />} />
              <Route path="/rooms/:roomId/sub/:subId" element={<RoomPage />} />
            </Routes>
          </main>
        ) : (
          <main className="mai-scrollbar flex-1 overflow-auto">
            <div className="mx-auto w-full max-w-[1500px] px-4 py-5">
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/dashboard/new" element={<NewDiscussionPage />} />
                <Route path="/templates/:kind" element={<TemplatesPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/tools" element={<ToolsPage />} />
                <Route path="/worlds" element={<WorldListPage />} />
                <Route path="/worlds/:worldId" element={<WorldDetailPage />} />
              </Routes>
            </div>
          </main>
        )}
      </div>
    </div>
  );
}

function DesktopDiagnosticsBanner() {
  const { t } = useI18n();
  const [backendError, setBackendError] = useState<BackendErrorPayload | null>(null);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    installFrontendLogHooks();

    const startupError = window.__MAI_BACKEND_STARTUP_ERROR__;
    if (startupError) {
      setBackendError({ message: startupError, log_dir: window.__MAI_LOG_DIR__ });
      toast.error(t("desktop.backendStartupFailed"));
    }

    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen<BackendErrorPayload>("mai://backend-terminated", (event) => {
        if (cancelled) return;
        setBackendError(event.payload);
        toast.error(t("desktop.backendTerminated"));
      }).then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
    ).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      void writeFrontendLog(`backend termination listener failed: ${message}`).catch(() => undefined);
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [t]);

  const handleOpenLogs = useCallback(async () => {
    try {
      await openDesktopLogDir();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("desktop.openLogsFailed"));
    }
  }, [t]);

  if (!backendError) return null;

  return (
    <div className="border-b border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3">
        <AlertTriangle size={14} className="shrink-0" />
        <span className="min-w-0 flex-1 break-words">
          {t("desktop.backendError", { message: backendError.message })}
        </span>
        <button className="btn btn-sm shrink-0" type="button" onClick={handleOpenLogs}>
          {t("desktop.openLogs")}
        </button>
      </div>
    </div>
  );
}

function SetupBanner() {
  const health = useQuery({ queryKey: queryKeys.health, queryFn: api.health, refetchInterval: 30000 });
  const { t } = useI18n();
  if (!health.data || health.data.setup_complete) return null;

  // Older backends return only `setup_complete`. Fall back to a single-line
  // banner so we don't render an empty checklist.
  const steps = health.data.setup_steps;
  if (!steps) {
    return (
      <div className="border-b border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger">
        <div className="mx-auto flex max-w-[1500px] items-center gap-2">
          <AlertTriangle size={14} />
          <span>{t("setup.missingPrefix")}</span>
          <NavLink to="/settings" className="underline">
            {t("setup.goSettings")}
          </NavLink>
          <span>{t("setup.missingSuffix")}</span>
        </div>
      </div>
    );
  }

  const items: { key: keyof typeof steps; label: string; to: string }[] = [
    { key: "providers", label: t("setup.step.provider"), to: "/settings" },
    { key: "models", label: t("setup.step.model"), to: "/settings" },
    { key: "default_model", label: t("setup.step.default"), to: "/settings" },
  ];
  const doneCount = items.filter((item) => steps[item.key]).length;
  const nextItem = items.find((item) => !steps[item.key]);

  return (
    <div className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-4 gap-y-1">
        <div className="flex items-center gap-2 font-medium">
          <AlertTriangle size={14} />
          <span>{t("setup.title", { done: doneCount, total: items.length })}</span>
        </div>
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {items.map((item) => {
            const done = steps[item.key];
            return (
              <li key={item.key} className="flex items-center gap-1.5">
                {done ? (
                  <Check size={14} className="shrink-0 text-success" />
                ) : (
                  <span className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border border-current text-xs">
                    {items.indexOf(item) + 1}
                  </span>
                )}
                <span className={done ? "line-through opacity-60" : ""}>{item.label}</span>
              </li>
            );
          })}
        </ul>
        {nextItem && (
          <NavLink
            to={nextItem.to}
            className="ml-auto inline-flex items-center gap-1 rounded border border-current px-2 py-0.5 hover:bg-warning/10"
          >
            {t("setup.step.go")}
            <ChevronRight size={14} />
          </NavLink>
        )}
      </div>
    </div>
  );
}

export const SKIP_UPDATE_KEY = "mai-skip-update-version";

function UpdateBanner() {
  const { t } = useI18n();
  const [status, setStatus] = useState<"idle" | "downloading" | "installing" | "error" | "done">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState(0);
  const [updateInfo, setUpdateInfo] = useState<{ version: string; body: string } | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Only runs inside a Tauri webview
    if (!(window as any).__TAURI_INTERNALS__) return;
    const skipped = localStorage.getItem(SKIP_UPDATE_KEY);
    import("@tauri-apps/plugin-updater").then(({ check }) =>
      check().then((update) => {
        if (update && update.version !== skipped) {
          setUpdateInfo({ version: update.version, body: update.body ?? "" });
          setVisible(true);
        }
      }),
    );
  }, []);

  const handleInstall = useCallback(async () => {
    if (!updateInfo) return;
    setStatus("downloading");
    setErrorMessage(null);
    setDownloaded(0);
    setTotal(0);
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (!update) return;
      await update.downloadAndInstall((progress) => {
        if (progress.event === "Started" && progress.data.contentLength) {
          setTotal(Number(progress.data.contentLength));
        } else if (progress.event === "Progress") {
          setDownloaded((prev) => prev + Number(progress.data.chunkLength));
        }
      });
      setStatus("installing");
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }, [updateInfo]);

  const handleDismiss = useCallback(() => {
    if (updateInfo) localStorage.setItem(SKIP_UPDATE_KEY, updateInfo.version);
    setVisible(false);
  }, [updateInfo]);

  if (!visible || !updateInfo) return null;

  const progressPct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
  const tone = status === "error"
    ? "border-danger/30 bg-danger/10 text-danger"
    : "border-brand/30 bg-brand/10 text-brand";

  return (
    <div className={`border-b px-4 py-2 text-sm ${tone}`}>
      <div className="mx-auto flex max-w-[1500px] items-center gap-3">
        <Download size={14} className="shrink-0" />
        <span className="min-w-0">
          {t("update.available", { version: updateInfo.version })}
          {status === "downloading" && ` - ${t("update.downloading", { progress: progressPct })}`}
          {status === "installing" && ` - ${t("update.installing")}`}
          {status === "error" && errorMessage && ` - ${t("update.failed", { error: errorMessage })}`}
        </span>
        {status === "idle" && (
          <button onClick={handleInstall} className="btn btn-sm shrink-0 border-brand bg-brand text-white">
            {t("update.install")}
          </button>
        )}
        {status === "error" && (
          <button onClick={handleInstall} className="btn btn-sm shrink-0">
            <RefreshCw size={14} />
            {t("update.retry")}
          </button>
        )}
        {status === "downloading" && (
          <Loader2 size={14} className="shrink-0 animate-spin" />
        )}
        {(status === "idle" || status === "error") && (
          <button onClick={handleDismiss} className="ml-auto shrink-0 text-muted hover:text-text" title={t("update.skip")}>
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
