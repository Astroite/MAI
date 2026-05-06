import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import { CheckCircle2, Save, Wifi, XCircle } from "lucide-react";
import { api } from "../api";
import { StatusPill } from "../components/StatusPill";
import { ApiProvidersView } from "./TemplatesPage";

export function SettingsPage() {
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 10000 });

  return (
    <div className="space-y-4">
      <div className="max-w-3xl">
        <h1 className="text-xl font-semibold">设置</h1>
        <p className="mt-1 text-sm text-muted">默认 API、本机后端状态、外部 LLM 凭据。房间 limit 仍在房间侧调整。</p>
      </div>
      <DefaultApiSection />
      <section className="panel max-w-3xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">后端状态</div>
            <div className="mt-1 text-sm text-muted">FastAPI · SQLite/PostgreSQL · LiteLLM</div>
          </div>
          <StatusPill tone={health.data?.status === "ok" ? "brand" : "danger"}>{health.data?.status ?? "checking"}</StatusPill>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-md border border-border p-3">
            <dt className="label">数据库</dt>
            <dd className="mt-1">{health.data?.database ?? "-"}</dd>
          </div>
          <div className="rounded-md border border-border p-3">
            <dt className="label">配置就绪</dt>
            <dd className="mt-1">
              {health.data?.setup_complete ? (
                <span className="text-brand">是</span>
              ) : (
                <span className="text-danger">否（请先填写默认 API）</span>
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
  const settings = useQuery({ queryKey: ["app-settings"], queryFn: api.appSettings });
  const providers = useQuery({ queryKey: ["api-providers"], queryFn: api.apiProviders });
  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Sync local state with server-side once loaded.
  useEffect(() => {
    if (!settings.data) return;
    setProviderId(settings.data.default_api_provider_id ?? "");
    setModel(settings.data.default_backing_model ?? "");
  }, [settings.data?.default_api_provider_id, settings.data?.default_backing_model]);

  const selectedProvider = useMemo(
    () => providers.data?.find((p) => p.id === providerId),
    [providers.data, providerId]
  );

  const save = useMutation({
    mutationFn: () =>
      api.updateAppSettings({
        default_api_provider_id: providerId || null,
        default_backing_model: model.trim() || null
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      void queryClient.invalidateQueries({ queryKey: ["health"] });
      setError(null);
    },
    onError: (err) => setError(err instanceof Error ? err.message : "保存失败")
  });

  const testConfig = useMutation({
    mutationFn: () => api.testApiProvider(providerId, model.trim()),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["api-providers"] });
      setTestResult({
        ok: result.ok,
        message: result.ok
          ? "连接 OK，模型可用"
          : result.error || "测试失败"
      });
    },
    onError: (err) =>
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : "测试请求失败"
      })
  });

  const status = selectedProvider?.last_tested_ok;
  const statusColor =
    status === true ? "bg-emerald-500" : status === false ? "bg-rose-500" : "bg-zinc-400";
  const statusLabel =
    status === true
      ? `已测试 OK · ${selectedProvider?.last_tested_at?.slice(0, 19).replace("T", " ")}`
      : status === false
        ? `测试失败：${selectedProvider?.last_tested_error ?? "未知"}`
        : "尚未测试";

  // litellm needs a provider prefix in the model string. Warn the user when
  // they enter a bare name — the runtime will reject it with "LLM Provider
  // NOT provided" otherwise.
  const trimmedModel = model.trim();
  const missingPrefix = trimmedModel.length > 0 && !trimmedModel.includes("/");

  return (
    <section className="panel max-w-3xl p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">默认 API</div>
          <div className="mt-1 text-sm text-muted">
            所有未单独绑定 API 的人设都走这里。修改后立即生效，不需要改人设。
          </div>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="label">API 提供商</span>
          <select
            name="default-api-provider"
            className="input mt-1 w-full"
            value={providerId}
            onChange={(event) => {
              setProviderId(event.target.value);
              setTestResult(null);
            }}
          >
            <option value="">-- 选择一个 --</option>
            {(providers.data ?? []).map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name} · {provider.provider_slug}
              </option>
            ))}
          </select>
          {(providers.data?.length ?? 0) === 0 && (
            <p className="mt-1 text-xs text-muted">
              还没有 API 提供商，<NavLink className="text-brand underline" to="/templates/api">前往新增</NavLink>。
            </p>
          )}
          {providerId && (
            <div className="mt-2 flex items-center gap-2 text-xs text-muted">
              <span className={`inline-block h-2 w-2 rounded-full ${statusColor}`} aria-hidden="true" />
              <span>{statusLabel}</span>
            </div>
          )}
        </label>
        <label className="block">
          <span className="label">默认模型名</span>
          <input
            name="default-backing-model"
            className="input mt-1 w-full"
            value={model}
            onChange={(event) => {
              setModel(event.target.value);
              setTestResult(null);
            }}
            placeholder="openai/gpt-4o-mini"
          />
          <p className="mt-1 text-xs text-muted">
            发往 litellm 的 model 字符串。<strong>OpenAI 兼容代理必须加 <code>openai/</code> 前缀</strong>——
            它告诉 litellm 用什么 API 格式（仅 <code>openai/</code>、<code>anthropic/</code>、<code>gemini/</code> 等已知 provider 才能识别）。
          </p>
          {missingPrefix && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              ⚠ 看起来缺少 provider 前缀，建议改成 <code>openai/{trimmedModel}</code>（如果你的代理是 OpenAI 兼容）
            </p>
          )}
        </label>
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
            disabled={save.isPending || !providerId || !model.trim()}
          >
            <Save size={14} />
            保存
          </button>
          <button
            className="btn flex-1"
            type="button"
            onClick={() => testConfig.mutate()}
            disabled={testConfig.isPending || !providerId || !model.trim()}
            title="发一条 max_tokens=1 的 ping 走全链路"
          >
            <Wifi size={14} className={testConfig.isPending ? "animate-pulse" : ""} />
            {testConfig.isPending ? "测试中…" : "测试配置"}
          </button>
        </div>
      </div>
    </section>
  );
}
