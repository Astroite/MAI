import { useQuery } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import { api } from "../api";
import { StatusPill } from "../components/StatusPill";
import { ApiProvidersView } from "./TemplatesPage";

export function SettingsPage() {
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 10000 });

  return (
    <div className="space-y-4">
      <div className="max-w-3xl">
        <h1 className="text-xl font-semibold">设置</h1>
        <p className="mt-1 text-sm text-muted">管理本机后端状态和外部 LLM API。房间 limit 仍在房间侧调整。</p>
      </div>
      <section className="panel max-w-3xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">后端状态</div>
            <div className="mt-1 text-sm text-muted">FastAPI、SQLite/PostgreSQL 与 LiteLLM 凭据由 ApiProvider 管理</div>
          </div>
          <StatusPill tone={health.data?.status === "ok" ? "brand" : "danger"}>{health.data?.status ?? "checking"}</StatusPill>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-md border border-border p-3">
            <dt className="label">数据库</dt>
            <dd className="mt-1">{health.data?.database ?? "-"}</dd>
          </div>
          <div className="rounded-md border border-border p-3">
            <dt className="label">API</dt>
            <dd className="mt-1">/api</dd>
          </div>
        </dl>
        <div className="mt-4 rounded-md border border-border bg-surface p-3 text-sm text-muted">
          所有 LLM 调用走 LiteLLM。在下方"API 配置"区域为 persona 绑定凭据，或在 <code>backend/.env</code> 配置 provider 默认 key。
          <NavLink className="ml-1 text-brand underline" to="/templates/personas">
            去绑定人设
          </NavLink>
        </div>
      </section>
      <ApiProvidersView />
    </div>
  );
}

