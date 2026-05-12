import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Plug,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Wrench
} from "lucide-react";
import { api } from "../api";
import { SectionCard } from "../components/SectionCard";
import { StatusPill } from "../components/StatusPill";
import { useConfirm } from "../components/ConfirmDialog";
import { toast } from "../components/Toaster";
import { useI18n } from "../i18n";
import { queryKeys } from "../queryKeys";
import { formatLocalDateTime } from "../utils/time";

export function ToolsPage() {
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const tools = useQuery({ queryKey: queryKeys.tools, queryFn: api.tools });
  const servers = useQuery({ queryKey: queryKeys.toolServers, queryFn: api.toolServers });
  const [serverName, setServerName] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [transport, setTransport] = useState<"streamable_http" | "sse">("streamable_http");
  const [allowWrite, setAllowWrite] = useState(false);

  const createServer = useMutation({
    mutationFn: () =>
      api.createToolServer({
        name: serverName,
        url: serverUrl,
        transport,
        allow_write: allowWrite,
        enabled: true
      }),
    onSuccess: () => {
      setServerName("");
      setServerUrl("");
      setAllowWrite(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.toolServers });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tools });
    }
  });
  const syncServer = useMutation({
    mutationFn: (serverId: string) => api.syncToolServer(serverId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.toolServers });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tools });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("tools.syncFailed"))
  });
  const removeServer = useMutation({
    mutationFn: (serverId: string) => api.deleteToolServer(serverId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.toolServers });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tools });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("api.deleteFailed"))
  });

  const groupedTools = useMemo(() => {
    const groups = new Map<string, NonNullable<typeof tools.data>>();
    for (const tool of tools.data ?? []) {
      const key =
        tool.source === "mcp" ? tool.server_name || "MCP" : t("tools.builtinGroup");
      groups.set(key, [...(groups.get(key) ?? []), tool]);
    }
    return Array.from(groups.entries()).sort(([left], [right]) => {
      // Built-in group first, then alphabetical
      if (left === t("tools.builtinGroup")) return -1;
      if (right === t("tools.builtinGroup")) return 1;
      return left.localeCompare(right);
    });
  }, [tools.data, t]);

  const totalServers = servers.data?.length ?? 0;
  const enabledServers = (servers.data ?? []).filter((server) => server.enabled).length;
  const totalTools = tools.data?.length ?? 0;
  const writeTools = (tools.data ?? []).filter((tool) => !tool.read_only).length;

  const handleDelete = async (serverId: string, serverName: string) => {
    if (
      await confirm({
        title: t("tools.deleteConfirm", { name: serverName }),
        danger: true,
        confirmLabel: t("common.delete")
      })
    ) {
      removeServer.mutate(serverId);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-normal">{t("tools.title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("tools.subtitle")}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <StatusPill tone="brand">{t("tools.serverCount", { count: totalServers })}</StatusPill>
            {totalServers > 0 && (
              <StatusPill tone="info">
                {t("tools.enabledCount", { count: enabledServers })}
              </StatusPill>
            )}
            <StatusPill tone="info">{t("tools.toolCount", { count: totalTools })}</StatusPill>
            {writeTools > 0 && (
              <StatusPill tone="warning">{t("tools.writeCount", { count: writeTools })}</StatusPill>
            )}
          </div>
        </div>
        <div className="rounded-md border border-info/30 bg-info/5 px-3 py-2 text-xs text-muted">
          {t("tools.executeFromRoom")}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <SectionCard
            title={t("tools.servers")}
            icon={<Plug size={14} />}
            tone="brand"
            actions={
              <button
                className="btn h-7 px-2 text-xs"
                type="button"
                onClick={() => void servers.refetch()}
                title={t("common.refresh")}
              >
                <RefreshCw size={12} />
                {t("common.refresh")}
              </button>
            }
          >
            {(servers.data?.length ?? 0) === 0 ? (
              <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted">
                {t("tools.noServers")}
              </div>
            ) : (
              <ul className="space-y-2">
                {(servers.data ?? []).map((server) => (
                  <li
                    key={server.id}
                    className="rounded-md border border-border bg-panel p-3 shadow-card"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold">{server.name}</span>
                          <StatusPill
                            tone={server.enabled ? "brand" : "neutral"}
                            dot
                          >
                            {server.enabled ? t("common.enabled") : t("common.disabled")}
                          </StatusPill>
                          {server.allow_write ? (
                            <StatusPill tone="warning">
                              <ShieldAlert size={12} />
                              {t("tools.write")}
                            </StatusPill>
                          ) : (
                            <StatusPill tone="info">
                              <ShieldCheck size={12} />
                              {t("tools.readOnly")}
                            </StatusPill>
                          )}
                        </div>
                        <code className="mt-1 block truncate text-xs text-muted">{server.url}</code>
                        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted">
                          <span>{server.transport}</span>
                          {server.last_synced_at && (
                            <span>
                              {t("tools.syncedAt", {
                                time: formatLocalDateTime(server.last_synced_at, locale)
                              })}
                            </span>
                          )}
                        </div>
                        {server.last_error && (
                          <div className="mt-2 inline-flex items-start gap-1.5 rounded border border-danger/30 bg-danger/10 px-2 py-1 text-xs text-danger">
                            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                            <span className="break-all">{server.last_error}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          className="btn h-7 w-7 px-0"
                          type="button"
                          onClick={() => syncServer.mutate(server.id)}
                          disabled={syncServer.isPending && syncServer.variables === server.id}
                          title={t("tools.sync")}
                          aria-label={t("tools.sync")}
                        >
                          <RefreshCw
                            size={14}
                            className={
                              syncServer.isPending && syncServer.variables === server.id
                                ? "animate-spin"
                                : ""
                            }
                          />
                        </button>
                        <button
                          className="btn btn-danger h-7 w-7 px-0"
                          type="button"
                          onClick={() => handleDelete(server.id, server.name)}
                          disabled={removeServer.isPending && removeServer.variables === server.id}
                          title={t("common.delete")}
                          aria-label={t("common.delete")}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title={t("tools.catalog")} icon={<Wrench size={14} />} tone="info">
            {totalTools === 0 ? (
              <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted">
                {t("tools.noTools")}
              </div>
            ) : (
              <div className="space-y-4">
                {groupedTools.map(([group, items]) => (
                  <div key={group}>
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted">
                      <span>{group}</span>
                      <span className="text-xs text-muted">· {items.length}</span>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      {items.map((tool) => (
                        <div
                          key={tool.name}
                          className="rounded-md border border-border bg-panel p-3 shadow-card transition hover:border-brand"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold">{tool.display_name}</div>
                              <code className="mt-0.5 block truncate text-xs text-muted">
                                {tool.name}
                              </code>
                            </div>
                            <StatusPill tone={tool.read_only ? "info" : "warning"}>
                              {tool.read_only ? t("tools.readOnly") : t("tools.write")}
                            </StatusPill>
                          </div>
                          <p className="mt-2 line-clamp-2 text-xs text-muted">{tool.description}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        <aside className="space-y-4">
          <SectionCard title={t("tools.addServer")} icon={<Plus size={14} />} tone="brand">
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (serverName.trim() && serverUrl.trim()) createServer.mutate();
              }}
            >
              <label className="block">
                <span className="label">{t("tools.serverName")}</span>
                <input
                  name="mcp-server-name"
                  className="input mt-1 w-full"
                  value={serverName}
                  onChange={(event) => setServerName(event.target.value)}
                  placeholder={t("tools.serverNamePlaceholder")}
                />
              </label>
              <label className="block">
                <span className="label">{t("tools.serverUrl")}</span>
                <input
                  name="mcp-server-url"
                  className="input mt-1 w-full"
                  value={serverUrl}
                  onChange={(event) => setServerUrl(event.target.value)}
                  placeholder="http://127.0.0.1:8001/mcp"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="label">{t("tools.transport")}</span>
                  <select
                    name="mcp-transport"
                    className="input mt-1 w-full"
                    value={transport}
                    onChange={(event) => setTransport(event.target.value as "streamable_http" | "sse")}
                  >
                    <option value="streamable_http">streamable_http</option>
                    <option value="sse">sse</option>
                  </select>
                </label>
                <label className="mt-[1.4rem] flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-2 text-xs">
                  <input
                    name="mcp-allow-write"
                    type="checkbox"
                    checked={allowWrite}
                    onChange={(event) => setAllowWrite(event.target.checked)}
                  />
                  {t("tools.allowWrite")}
                </label>
              </div>
              <button
                className="btn btn-primary w-full justify-center rounded-md"
                type="submit"
                disabled={!serverName.trim() || !serverUrl.trim() || createServer.isPending}
              >
                <Plug size={14} />
                {createServer.isPending ? t("common.loading") : t("tools.addServer")}
              </button>
              {createServer.error instanceof Error && (
                <p className="text-xs text-danger">{createServer.error.message}</p>
              )}
            </form>
          </SectionCard>

          <SectionCard title={t("tools.helpTitle")} icon={<CheckCircle2 size={14} />}>
            <ul className="space-y-1.5 text-xs text-muted">
              <li>· {t("tools.help1")}</li>
              <li>· {t("tools.help2")}</li>
              <li>
                · {t("tools.help3")}
                <Link className="ml-1 text-brand underline" to="/dashboard">
                  {t("nav.rail.rooms")}
                </Link>
              </li>
            </ul>
          </SectionCard>
        </aside>
      </div>
    </div>
  );
}
