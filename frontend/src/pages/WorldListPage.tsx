import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { api } from "../api";
import { useConfirm } from "../components/ConfirmDialog";
import { toast } from "../components/Toaster";
import type { WorldSummary } from "../types";
import { COVER_PALETTE } from "../constants/colors";
import { queryKeys } from "../queryKeys";

export function WorldListPage() {
  const worlds = useQuery({ queryKey: queryKeys.worlds, queryFn: api.worlds });
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-4">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold">
              <Globe size={20} className="text-brand" />
              故事世界
            </h1>
            <p className="mt-1 text-sm text-muted">
              在世界里编排时间线、角色和场景。每幕结束后角色保留记忆。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="btn"
              type="button"
              onClick={() => void worlds.refetch()}
              disabled={worlds.isFetching}
            >
              <RefreshCw size={16} className={worlds.isFetching ? "animate-spin" : ""} />
              刷新
            </button>
            <button
              className="btn btn-primary px-4"
              type="button"
              onClick={() => setCreating((value) => !value)}
            >
              <Plus size={16} />
              新建世界
            </button>
          </div>
        </div>

        {creating && <CreateWorldForm onDone={() => setCreating(false)} />}

        {worlds.data && worlds.data.length === 0 && !creating ? (
          <div className="panel px-6 py-10 text-center text-sm text-muted">
            <p>还没有世界。点击右上角「新建世界」开始。</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(worlds.data ?? []).map((world) => (
              <WorldCard key={world.id} world={world} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function WorldCard({ world }: { world: WorldSummary }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const remove = useMutation({
    mutationFn: () => api.deleteWorld(world.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.worlds });
      toast.message(`已删除世界「${world.name}」。`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err))
  });

  const last = world.last_activity_at
    ? new Date(world.last_activity_at).toLocaleString()
    : "尚无场景";

  return (
    <div className="group relative overflow-hidden rounded-lg border border-border bg-panel shadow-card transition hover:border-brand/60 hover:shadow-soft">
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: world.cover_color }}
      />
      <Link to={`/worlds/${world.id}`} className="block px-4 py-3 pl-5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-lg text-white"
            style={{ background: world.cover_color }}
          >
            <Sparkles size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-1 text-sm font-semibold leading-snug">{world.name}</h3>
            <p className="mt-1 line-clamp-2 text-xs text-muted">
              {world.synopsis || "（暂无简介）"}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span>角色 {world.character_count}</span>
          <span>场景 {world.scene_count}</span>
          <span className="ml-auto truncate">{last}</span>
        </div>
      </Link>
      <button
        className="absolute right-1.5 top-1.5 rounded p-1 text-muted opacity-0 transition group-hover:opacity-100 hover:bg-danger/10 hover:text-danger"
        type="button"
        title="删除世界"
        onClick={async (event) => {
          event.preventDefault();
          event.stopPropagation();
          const ok = await confirm({
            title: `删除世界「${world.name}」？`,
            description: "会级联删除所有角色和场景，包括所有积累的记忆和关系卡。此操作不可逆。",
            confirmLabel: "删除",
            danger: true
          });
          if (ok) remove.mutate();
        }}
        disabled={remove.isPending}
        aria-label={`删除世界 ${world.name}`}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function CreateWorldForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [synopsis, setSynopsis] = useState("");
  const [calendarHint, setCalendarHint] = useState("");
  const [coverColor, setCoverColor] = useState(COVER_PALETTE[11]); // 8b5cf6
  const create = useMutation({
    mutationFn: () =>
      api.createWorld({
        name: name.trim(),
        synopsis: synopsis.trim(),
        calendar_hint: calendarHint.trim(),
        cover_color: coverColor
    }),
    onSuccess: (world) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.worlds });
      toast.success(`已创建世界「${world.name}」。`);
      setName("");
      setSynopsis("");
      setCalendarHint("");
      onDone();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err))
  });

  return (
    <form
      className="panel space-y-3 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        create.mutate();
      }}
    >
      <div>
        <label className="text-xs font-medium text-muted">世界名</label>
        <input
          className="input mt-1 w-full"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="例：玄苍纪元"
          required
          maxLength={200}
        />
      </div>
      <div>
        <label className="text-xs font-medium text-muted">简介（每场都会进角色 prompt）</label>
        <textarea
          className="input mt-1 w-full"
          value={synopsis}
          onChange={(event) => setSynopsis(event.target.value)}
          placeholder="一段话描述这个世界的核心氛围、时代、关键设定。"
          rows={3}
        />
      </div>
      <div>
        <label className="text-xs font-medium text-muted">纪年法（可选）</label>
        <input
          className="input mt-1 w-full"
          value={calendarHint}
          onChange={(event) => setCalendarHint(event.target.value)}
          placeholder="例：玄苍纪元，一年三百日，每日十二时辰"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-muted">封面色</label>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {COVER_PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              className={`h-7 w-7 rounded-full border-2 transition ${
                coverColor === color ? "border-text scale-110" : "border-border hover:scale-105"
              }`}
              style={{ background: color }}
              onClick={() => setCoverColor(color)}
              aria-label={color}
            />
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn" onClick={onDone}>
          取消
        </button>
        <button type="submit" className="btn btn-primary" disabled={!name.trim() || create.isPending}>
          {create.isPending ? "创建中..." : "创建世界"}
        </button>
      </div>
    </form>
  );
}
