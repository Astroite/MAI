import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Plus, RefreshCw } from "lucide-react";
import { api } from "../api";
import type { DebateFormat, Persona } from "../types";
import { StatusPill } from "../components/StatusPill";

export function DashboardPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const rooms = useQuery({ queryKey: ["rooms"], queryFn: api.rooms });
  const formats = useQuery({ queryKey: ["formats"], queryFn: api.formats });
  const personas = useQuery({ queryKey: ["personas", "discussant"], queryFn: () => api.personas("discussant") });
  const [title, setTitle] = useState("方案评审讨论");
  const solutionReview = formats.data?.find((item) => item.name === "方案评审")?.id;
  const [formatId, setFormatId] = useState<string | undefined>(undefined);
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<string[]>([]);

  const initialPersonaIds = useMemo(() => {
    const names = new Set(["架构师", "性能批评者", "维护者", "反方律师"]);
    return personas.data?.filter((p) => names.has(p.name)).map((p) => p.id) ?? [];
  }, [personas.data]);

  const createRoom = useMutation({
    mutationFn: () =>
      api.createRoom({
        title,
        format_id: formatId ?? solutionReview ?? formats.data?.[0]?.id,
        persona_ids: selectedPersonaIds.length ? selectedPersonaIds : initialPersonaIds
      }),
    onSuccess: (state) => {
      void queryClient.invalidateQueries({ queryKey: ["rooms"] });
      navigate(`/rooms/${state.room.id}`);
    }
  });

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-4 max-lg:grid-cols-1">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">讨论室</h1>
            <p className="mt-1 text-sm text-muted">房间保存消息、phase 计划、书记官状态和副手信号。</p>
          </div>
          <button className="btn" onClick={() => void rooms.refetch()}>
            <RefreshCw size={16} />
            刷新
          </button>
        </div>
        <div className="panel divide-y divide-border">
          {(rooms.data ?? []).map((room) => (
            <Link key={room.id} to={`/rooms/${room.id}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-surface">
              <div>
                <div className="font-medium">{room.title}</div>
                <div className="mt-1 text-xs text-muted">{new Date(room.created_at).toLocaleString()}</div>
              </div>
              <StatusPill tone={room.status === "frozen" ? "danger" : "brand"}>{room.status}</StatusPill>
            </Link>
          ))}
          {!rooms.data?.length && <div className="px-4 py-10 text-center text-sm text-muted">暂无讨论室</div>}
        </div>
      </section>

      <aside className="panel p-4">
        <h2 className="text-base font-semibold">新建房间</h2>
        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="label">标题</span>
            <input className="input mt-1 w-full" value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="block">
            <span className="label">赛制</span>
            <select className="input mt-1 w-full" value={formatId ?? solutionReview ?? ""} onChange={(event) => setFormatId(event.target.value)}>
              {(formats.data ?? []).map((format: DebateFormat) => (
                <option key={format.id} value={format.id}>
                  {format.name}
                </option>
              ))}
            </select>
          </label>
          <div>
            <div className="label">参辩人设</div>
            <div className="mt-2 max-h-72 space-y-2 overflow-auto pr-1">
              {(personas.data ?? []).map((persona: Persona) => {
                const checked = (selectedPersonaIds.length ? selectedPersonaIds : initialPersonaIds).includes(persona.id);
                return (
                  <label key={persona.id} className="flex items-start gap-2 rounded-md border border-border p-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={checked}
                      onChange={(event) => {
                        const base = selectedPersonaIds.length ? selectedPersonaIds : initialPersonaIds;
                        setSelectedPersonaIds(event.target.checked ? [...base, persona.id] : base.filter((id) => id !== persona.id));
                      }}
                    />
                    <span>
                      <span className="font-medium">{persona.name}</span>
                      <span className="mt-0.5 block text-xs text-muted">{persona.description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
          <button className="btn btn-primary w-full" onClick={() => createRoom.mutate()} disabled={createRoom.isPending || !title.trim()}>
            <Plus size={16} />
            创建
          </button>
        </div>
      </aside>
    </div>
  );
}

