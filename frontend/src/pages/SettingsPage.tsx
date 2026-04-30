import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { StatusPill } from "../components/StatusPill";

export function SettingsPage() {
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 10000 });

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">设置</h1>
        <p className="mt-1 text-sm text-muted">当前版本保留账号和预算设置入口，房间 limit 在房间侧调整。</p>
      </div>
      <section className="panel p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">后端状态</div>
            <div className="mt-1 text-sm text-muted">FastAPI、Postgres 和 LLM 模式</div>
          </div>
          <StatusPill tone={health.data?.status === "ok" ? "brand" : "danger"}>{health.data?.status ?? "checking"}</StatusPill>
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
          <div className="rounded-md border border-border p-3">
            <dt className="label">数据库</dt>
            <dd className="mt-1">{health.data?.database ?? "-"}</dd>
          </div>
          <div className="rounded-md border border-border p-3">
            <dt className="label">LLM</dt>
            <dd className="mt-1">{health.data?.mock_llm ? "mock stream" : "LiteLLM"}</dd>
          </div>
          <div className="rounded-md border border-border p-3">
            <dt className="label">API</dt>
            <dd className="mt-1">/api</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

