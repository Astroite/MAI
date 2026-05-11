export interface BackendErrorPayload {
  message: string;
  log_dir?: string;
}

declare global {
  interface Window {
    __MAI_BACKEND_STARTUP_ERROR__?: string | null;
    __MAI_LOG_DIR__?: string;
    __MAI_FRONTEND_DIAGNOSTICS_READY__?: boolean;
  }
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__);
}

export async function openDesktopLogDir(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_log_dir");
}

export async function getDesktopLogDir(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("get_log_dir");
}

export async function writeFrontendLog(message: string): Promise<void> {
  if (!isTauriRuntime()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("write_frontend_log", { message });
}

function logFrontendDiagnostic(message: string): void {
  void writeFrontendLog(message).catch(() => undefined);
}

export function installFrontendLogHooks(): void {
  if (!isTauriRuntime() || window.__MAI_FRONTEND_DIAGNOSTICS_READY__) return;
  window.__MAI_FRONTEND_DIAGNOSTICS_READY__ = true;

  logFrontendDiagnostic("frontend loaded");

  window.addEventListener("error", (event) => {
    logFrontendDiagnostic(
      `window error: ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`
    );
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason instanceof Error ? event.reason.stack ?? event.reason.message : String(event.reason);
    logFrontendDiagnostic(`unhandled rejection: ${reason}`);
  });
}
