import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Plug, RefreshCw, Trash2, Wrench } from "lucide-react";
import { api } from "../../../api";
import { StatusPill } from "../../../components/StatusPill";
import type { ToolInvocation } from "../../../types";
import { useI18n } from "../../../i18n";

function preview(value: unknown, fallback = ""): string {
  if (value == null) return fallback;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > 420 ? `${text.slice(0, 420)}...` : text;
}

function parseArguments(raw: string): Record<string, unknown> {
  const text = raw.trim();
  if (!text) return {};
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Arguments must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

export function ToolPanel({
  roomId,
  frozen,
  invocations
}: {
  roomId: string;
  frozen: boolean;
  invocations: ToolInvocation[];
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const tools = useQuery({ queryKey: ["tools"], queryFn: api.tools });
  const servers = useQuery({ queryKey: ["tool-servers"], queryFn: api.toolServers });
  const [serverName, setServerName] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [transport, setTransport] = useState<"streamable_http" | "sse">("streamable_http");
  const [allowWrite, setAllowWrite] = useState(false);
  const [selectedTool, setSelectedTool] = useState("");
  const [argumentsText, setArgumentsText] = useState("{}");
  const [executeError, setExecuteError] = useState<string | null>(null);

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
      void queryClient.invalidateQueries({ queryKey: ["tool-servers"] });
      void queryClient.invalidateQueries({ queryKey: ["tools"] });
    }
  });
  const syncServer = useMutation({
    mutationFn: (serverId: string) => api.syncToolServer(serverId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tool-servers"] });
      void queryClient.invalidateQueries({ queryKey: ["tools"] });
    }
  });
  const deleteServer = useMutation({
    mutationFn: (serverId: string) => api.deleteToolServer(serverId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tool-servers"] });
      void queryClient.invalidateQueries({ queryKey: ["tools"] });
    }
  });
  const execute = useMutation({
    mutationFn: () => {
      setExecuteError(null);
      const toolName = selectedTool || tools.data?.[0]?.name || "";
      if (!toolName) throw new Error(t("panel.tools.noTool"));
      return api.executeTool(roomId, {
        tool_name: toolName,
        arguments: parseArguments(argumentsText),
        allow_write: false
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["room", roomId] });
      void queryClient.invalidateQueries({ queryKey: ["tools"] });
    },
    onError: (error) => setExecuteError(error instanceof Error ? error.message : t("api.saveFailed"))
  });

  const groupedTools = useMemo(() => {
    const groups = new Map<string, NonNullable<typeof tools.data>>();
    for (const tool of tools.data ?? []) {
      const key = tool.source === "mcp" ? tool.server_name || "MCP" : t("panel.tools.builtin");
      groups.set(key, [...(groups.get(key) ?? []), tool]);
    }
    return Array.from(groups.entries());
  }, [tools.data, t]);
  const recentInvocations = [...(invocations ?? [])].reverse().slice(0, 8);

  return (
    <section className="space-y-5">
      <div>
        <div className="label">{t("panel.tools.title")}</div>
        <p className="mt-1 text-xs text-muted">{t("panel.tools.subtitle")}</p>
      </div>

      <form
        className="space-y-2 rounded-md border border-border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (serverName.trim() && serverUrl.trim()) createServer.mutate();
        }}
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          <Plug size={14} />
          {t("panel.tools.addServer")}
        </div>
        <input
          name="mcp-server-name"
          className="input w-full"
          value={serverName}
          onChange={(event) => setServerName(event.target.value)}
          placeholder={t("panel.tools.serverName")}
        />
        <input
          name="mcp-server-url"
          className="input w-full"
          value={serverUrl}
          onChange={(event) => setServerUrl(event.target.value)}
          placeholder="http://127.0.0.1:8001/mcp"
        />
        <div className="grid grid-cols-2 gap-2">
          <select
            name="mcp-transport"
            className="input w-full"
            value={transport}
            onChange={(event) => setTransport(event.target.value as "streamable_http" | "sse")}
          >
            <option value="streamable_http">streamable_http</option>
            <option value="sse">sse</option>
          </select>
          <label className="flex items-center gap-2 rounded-md border border-border px-2 text-xs">
            <input
              name="mcp-allow-write"
              type="checkbox"
              checked={allowWrite}
              onChange={(event) => setAllowWrite(event.target.checked)}
            />
            {t("panel.tools.allowWrite")}
          </label>
        </div>
        <button className="btn w-full" type="submit" disabled={!serverName.trim() || !serverUrl.trim() || createServer.isPending}>
          <Plug size={14} />
          {t("common.add")}
        </button>
        {createServer.error instanceof Error && <p className="text-xs text-danger">{createServer.error.message}</p>}
      </form>

      <div className="space-y-2">
        <div className="text-xs font-semibold text-muted">{t("panel.tools.servers")}</div>
        {(servers.data ?? []).map((server) => (
          <div key={server.id} className="rounded-md border border-border p-2 text-xs">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium text-text" title={server.name ?? undefined}>{server.name}</div>
                <div className="mt-0.5 truncate text-muted" title={server.url ?? undefined}>{server.url}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  <StatusPill tone={server.enabled ? "brand" : "neutral"}>
                    {server.enabled ? t("common.enabled") : t("common.disabled")}
                  </StatusPill>
                  <StatusPill tone={server.allow_write ? "danger" : "neutral"}>
                    {server.allow_write ? t("panel.tools.write") : t("panel.tools.readOnly")}
                  </StatusPill>
                </div>
                {server.last_error && <div className="mt-1 text-danger">{server.last_error}</div>}
              </div>
              <div className="flex gap-1">
                <button className="btn h-7 px-2" type="button" onClick={() => syncServer.mutate(server.id)} title={t("panel.tools.sync")}>
                  <RefreshCw size={14} />
                </button>
                <button className="btn h-7 px-2" type="button" onClick={() => deleteServer.mutate(server.id)} title={t("common.delete")}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {!servers.data?.length && <div className="text-sm text-muted">{t("panel.tools.noServers")}</div>}
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold text-muted">{t("panel.tools.catalog")}</div>
        {groupedTools.map(([group, items]) => (
          <div key={group} className="rounded-md border border-border p-2">
            <div className="mb-2 text-xs font-medium text-muted">{group}</div>
            <div className="space-y-2">
              {items.map((tool) => (
                <div key={tool.name} className="rounded-md bg-surface p-2 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium">{tool.display_name}</div>
                    <StatusPill tone={tool.read_only ? "neutral" : "danger"}>
                      {tool.read_only ? t("panel.tools.readOnly") : t("panel.tools.write")}
                    </StatusPill>
                  </div>
                  <p className="mt-1 text-muted">{tool.description}</p>
                  <code className="mt-1 block truncate text-xs text-muted" title={tool.name}>{tool.name}</code>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <form
        className="space-y-2 rounded-md border border-border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            execute.mutate();
          } catch (error) {
            setExecuteError(error instanceof Error ? error.message : t("api.saveFailed"));
          }
        }}
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          <Wrench size={14} />
          {t("panel.tools.manual")}
        </div>
        <select
          name="manual-tool"
          className="input w-full"
          value={selectedTool || tools.data?.[0]?.name || ""}
          onChange={(event) => setSelectedTool(event.target.value)}
        >
          {(tools.data ?? []).map((tool) => (
            <option key={tool.name} value={tool.name} disabled={!tool.read_only}>
              {tool.display_name}
            </option>
          ))}
        </select>
        <textarea
          name="tool-arguments"
          className="textarea h-24 w-full font-mono text-xs"
          value={argumentsText}
          onChange={(event) => setArgumentsText(event.target.value)}
        />
        {executeError && <p className="text-xs text-danger">{executeError}</p>}
        <button className="btn w-full" type="submit" disabled={frozen || execute.isPending || !tools.data?.length}>
          <Play size={14} />
          {t("panel.tools.runReadOnly")}
        </button>
      </form>

      <div className="space-y-2">
        <div className="text-xs font-semibold text-muted">{t("panel.tools.recent")}</div>
        {recentInvocations.map((item) => (
          <div key={item.id} className="rounded-md border border-border p-2 text-xs">
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium">{item.display_name}</div>
              <StatusPill tone={item.status === "success" ? "brand" : item.status === "error" ? "danger" : "neutral"}>
                {item.status}
              </StatusPill>
            </div>
            <pre className="mt-2 max-h-32 min-w-0 overflow-auto break-all whitespace-pre-wrap rounded bg-surface p-2 text-xs text-muted">
              {item.error || preview(item.result, preview(item.arguments))}
            </pre>
          </div>
        ))}
        {!recentInvocations.length && <div className="text-sm text-muted">{t("panel.tools.noInvocations")}</div>}
      </div>
    </section>
  );
}
