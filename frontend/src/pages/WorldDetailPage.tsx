import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronRight,
  Lock,
  Plus,
  Sparkles,
  Trash2,
  UserPlus,
  Users
} from "lucide-react";
import { api } from "../api";
import { PersonaIcon } from "../components/PersonaIcon";
import { PersonaTemplatePicker } from "../components/PersonaTemplatePicker";
import { useConfirm } from "../components/ConfirmDialog";
import { toast } from "../components/Toaster";
import type {
  PersonaTemplate,
  WorldCharacter,
  WorldCharacterKind,
  SceneRosterEntry
} from "../types";

const PALETTE = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#84cc16",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#0ea5e9",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#ec4899"
];

export function WorldDetailPage() {
  const { worldId = "" } = useParams();
  const world = useQuery({
    queryKey: ["world", worldId],
    queryFn: () => api.world(worldId),
    enabled: Boolean(worldId)
  });
  const timeline = useQuery({
    queryKey: ["world-timeline", worldId],
    queryFn: () => api.worldTimeline(worldId),
    enabled: Boolean(worldId)
  });
  const aiTemplates = useQuery({
    queryKey: ["persona-templates", "discussant"],
    queryFn: () => api.personaTemplates("discussant")
  });

  const [addingCharacter, setAddingCharacter] = useState(false);
  const [creatingScene, setCreatingScene] = useState(false);

  if (world.isLoading || !world.data) {
    return (
      <div className="px-6 py-10 text-center text-sm text-muted">
        {world.isError ? "找不到这个世界。" : "加载中…"}
      </div>
    );
  }

  const data = world.data;
  const characters = data.characters;
  const activeCharacters = characters.filter((c) => c.status === "active");

  return (
    <div className="space-y-4">
      <div>
        <Link to="/worlds" className="inline-flex items-center gap-1 text-xs text-muted hover:text-text">
          <ArrowLeft size={12} />
          返回世界列表
        </Link>
      </div>

      <header className="panel space-y-2 p-4">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-lg text-white"
            style={{ background: data.cover_color }}
          >
            <Sparkles size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold">{data.name}</h1>
            {data.synopsis && <p className="mt-1 text-sm text-text">{data.synopsis}</p>}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              {data.calendar_hint && <span>纪年法：{data.calendar_hint}</span>}
              {data.setting && <span>设定：{data.setting}</span>}
            </div>
          </div>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Users size={16} className="text-muted" />
              角色（{activeCharacters.length}）
            </h2>
            <button
              type="button"
              className="btn h-8 px-3 text-xs"
              onClick={() => setAddingCharacter((value) => !value)}
            >
              <UserPlus size={14} />
              {addingCharacter ? "收起" : "添加角色"}
            </button>
          </div>
          {addingCharacter && (
            <AddCharacterForm
              worldId={worldId}
              templates={aiTemplates.data ?? []}
              onDone={() => setAddingCharacter(false)}
            />
          )}
          <ul className="divide-y divide-border">
            {characters.length === 0 && (
              <li className="py-4 text-center text-xs text-muted">还没有角色。</li>
            )}
            {characters.map((character) => (
              <CharacterRow key={character.id} worldId={worldId} character={character} />
            ))}
          </ul>
        </section>

        <section className="panel space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <ChevronRight size={16} className="text-muted" />
              时间线（{timeline.data?.length ?? 0} 幕）
            </h2>
            <button
              type="button"
              className="btn h-8 px-3 text-xs"
              onClick={() => setCreatingScene((value) => !value)}
              disabled={activeCharacters.length === 0}
              title={activeCharacters.length === 0 ? "先添加至少一个角色" : ""}
            >
              <Plus size={14} />
              {creatingScene ? "收起" : "新建场景"}
            </button>
          </div>
          {creatingScene && (
            <CreateSceneForm
              worldId={worldId}
              characters={activeCharacters}
              onDone={() => setCreatingScene(false)}
            />
          )}
          <ul className="space-y-2">
            {(timeline.data ?? []).length === 0 && (
              <li className="py-4 text-center text-xs text-muted">还没有场景。</li>
            )}
            {(timeline.data ?? []).map((scene) => (
              <li key={scene.id}>
                <Link
                  to={`/rooms/${scene.id}`}
                  className="block rounded-md border border-border p-3 transition hover:border-brand/40 hover:bg-surface"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-muted">
                          第 {scene.scene_index} 幕
                        </span>
                        {scene.sealed_at && (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                            <Lock size={10} />
                            已封幕
                          </span>
                        )}
                        {scene.status === "frozen" && (
                          <span className="text-xs text-danger">已冻结</span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate text-sm font-medium">{scene.title}</div>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                        {scene.in_world_time_start && <span>{scene.in_world_time_start}</span>}
                        <span>角色 {scene.member_count}</span>
                        <span>消息 {scene.message_count}</span>
                      </div>
                    </div>
                    <ChevronRight size={16} className="text-muted" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function CharacterRow({
  worldId,
  character
}: {
  worldId: string;
  character: WorldCharacter;
}) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const remove = useMutation({
    mutationFn: () => api.deleteWorldCharacter(worldId, character.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["world", worldId] });
      toast.message(`已退场角色「${character.name}」（保留历史记忆）。`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err))
  });
  const dim = character.status !== "active";
  return (
    <li className={`flex items-center gap-3 py-2 ${dim ? "opacity-50" : ""}`}>
      <PersonaIcon icon={character.icon} color={character.color} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{character.name}</span>
          {character.identity && (
            <span className="text-xs text-muted">（{character.identity}）</span>
          )}
          <span
            className={`text-[10px] uppercase tracking-wide ${
              character.kind === "user" ? "text-accent" : "text-muted"
            }`}
          >
            {character.kind === "user" ? "USER" : "AI"}
          </span>
          {dim && <span className="text-[10px] text-muted">（已退场）</span>}
        </div>
        {character.brief && (
          <div className="truncate text-xs text-muted">{character.brief}</div>
        )}
      </div>
      {character.status === "active" && (
        <button
          type="button"
          className="btn h-7 w-7 px-0 text-muted hover:text-danger"
          title="退场（保留历史）"
          onClick={async () => {
            const ok = await confirm({
              title: `让「${character.name}」退场？`,
              description: "角色被标记为 retired，不再出现在新场景的可选名册里，但已存在的记忆和关系卡完整保留。",
              confirmLabel: "退场",
              danger: true
            });
            if (ok) remove.mutate();
          }}
          disabled={remove.isPending}
        >
          <Trash2 size={14} />
        </button>
      )}
    </li>
  );
}

function AddCharacterForm({
  worldId,
  templates,
  onDone
}: {
  worldId: string;
  templates: PersonaTemplate[];
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<WorldCharacterKind>("ai");
  const [name, setName] = useState("");
  const [identity, setIdentity] = useState("");
  const [brief, setBrief] = useState("");
  const [coreIdentity, setCoreIdentity] = useState("");
  const [skillsText, setSkillsText] = useState("");
  const [goalsText, setGoalsText] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [color, setColor] = useState(PALETTE[9]); // 3b82f6
  const [icon, setIcon] = useState<string>("Sparkles");
  const [pickerOpen, setPickerOpen] = useState(false);
  // Track whether the user has hand-edited each field. Picking a template
  // auto-fills only the fields that haven't been touched (or that were
  // last filled BY a previous template selection). This stops switching
  // templates from clobbering deliberate character names like "苏离".
  const userEdited = useRef({ name: false, identity: false, brief: false });

  const selectedTemplate = templateId
    ? templates.find((tpl) => tpl.id === templateId) ?? null
    : null;

  const applyTemplate = (template: PersonaTemplate) => {
    setTemplateId(template.id);
    if (!userEdited.current.name) setName(template.name);
    if (!userEdited.current.identity) setIdentity(template.identity);
    if (!userEdited.current.brief) setBrief(template.description);
    setColor(template.color || color);
    setIcon(template.icon || icon);
    setPickerOpen(false);
  };

  const create = useMutation({
    mutationFn: () =>
      api.createWorldCharacter(worldId, {
        kind,
        name: name.trim(),
        identity: identity.trim(),
        brief: brief.trim(),
        persona_template_id: kind === "ai" ? templateId : null,
        core_identity: coreIdentity.trim(),
        skills_text: skillsText.trim(),
        goals_text: goalsText.trim(),
        color,
        icon
      }),
    onSuccess: (character) => {
      void queryClient.invalidateQueries({ queryKey: ["world", worldId] });
      toast.success(`已添加角色「${character.name}」。`);
      setName("");
      setIdentity("");
      setBrief("");
      setCoreIdentity("");
      setSkillsText("");
      setGoalsText("");
      setTemplateId(null);
      userEdited.current = { name: false, identity: false, brief: false };
      onDone();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err))
  });
  const canSubmit =
    name.trim().length > 0 && (kind === "user" || templateId !== null);
  return (
    <form
      className="space-y-3 rounded-md border border-dashed border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        create.mutate();
      }}
    >
      <div className="flex gap-1.5 text-xs">
        <button
          type="button"
          className={`rounded px-2 py-1 ${kind === "ai" ? "bg-brand/10 text-brand" : "text-muted"}`}
          onClick={() => setKind("ai")}
        >
          AI 角色
        </button>
        <button
          type="button"
          className={`rounded px-2 py-1 ${kind === "user" ? "bg-accent/10 text-accent" : "text-muted"}`}
          onClick={() => setKind("user")}
        >
          User 角色（玩家驱动）
        </button>
      </div>

      {kind === "ai" && (
        <div>
          <label className="text-xs font-medium text-muted">
            绑定 Persona 模板（决定模型 + 基础 prompt）
          </label>
          <button
            type="button"
            className="mt-1 flex w-full items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-left transition hover:border-brand/40"
            onClick={() => setPickerOpen(true)}
          >
            {selectedTemplate ? (
              <>
                <PersonaIcon
                  icon={selectedTemplate.icon}
                  color={selectedTemplate.color}
                  size={28}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{selectedTemplate.name}</div>
                  {selectedTemplate.identity && (
                    <div className="truncate text-xs text-muted">{selectedTemplate.identity}</div>
                  )}
                </div>
                <span className="text-xs text-muted">更换</span>
              </>
            ) : (
              <>
                <span className="grid h-7 w-7 place-items-center rounded-full bg-panel text-muted">
                  ?
                </span>
                <span className="text-sm text-muted">点击选择模板…</span>
              </>
            )}
          </button>
          <PersonaTemplatePicker
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            templates={templates}
            selectedId={templateId}
            onPick={applyTemplate}
          />
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <input
          className="input"
          placeholder="角色名（必填）"
          value={name}
          onChange={(event) => {
            userEdited.current.name = true;
            setName(event.target.value);
          }}
          maxLength={120}
          required
        />
        <input
          className="input"
          placeholder="身份/称谓（如：剑客）"
          value={identity}
          onChange={(event) => {
            userEdited.current.identity = true;
            setIdentity(event.target.value);
          }}
          maxLength={120}
        />
      </div>
      <input
        className="input w-full"
        placeholder="简介（一句话，每场都进 prompt）"
        value={brief}
        onChange={(event) => {
          userEdited.current.brief = true;
          setBrief(event.target.value);
        }}
      />
      {kind === "ai" && (
        <>
          <textarea
            className="input w-full"
            rows={2}
            placeholder="Core identity（性格、底色，每场都进 prompt）"
            value={coreIdentity}
            onChange={(event) => setCoreIdentity(event.target.value)}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="input"
              placeholder="技能（自由文本）"
              value={skillsText}
              onChange={(event) => setSkillsText(event.target.value)}
            />
            <input
              className="input"
              placeholder="当前目标"
              value={goalsText}
              onChange={(event) => setGoalsText(event.target.value)}
            />
          </div>
        </>
      )}
      <div>
        <label className="text-xs font-medium text-muted">颜色</label>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {PALETTE.map((value) => (
            <button
              key={value}
              type="button"
              className={`h-6 w-6 rounded-full border-2 transition ${
                color === value ? "border-text scale-110" : "border-border hover:scale-105"
              }`}
              style={{ background: value }}
              onClick={() => setColor(value)}
              aria-label={value}
            />
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn h-8 text-xs" onClick={onDone}>
          取消
        </button>
        <button
          type="submit"
          className="btn btn-primary h-8 text-xs"
          disabled={!canSubmit || create.isPending}
        >
          {create.isPending ? "添加中..." : "添加"}
        </button>
      </div>
    </form>
  );
}

function CreateSceneForm({
  worldId,
  characters,
  onDone
}: {
  worldId: string;
  characters: WorldCharacter[];
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [background, setBackground] = useState("");
  const [timeStart, setTimeStart] = useState("");
  const [duration, setDuration] = useState("");
  const initialSelected = useMemo(
    () => new Set(characters.map((c) => c.id)),
    [characters]
  );
  const [selected, setSelected] = useState<Set<string>>(initialSelected);
  const create = useMutation({
    mutationFn: () => {
      const members: SceneRosterEntry[] = characters
        .filter((character) => selected.has(character.id))
        .map((character) => ({ world_character_id: character.id }));
      return api.createScene(worldId, {
        title: title.trim(),
        background: background.trim(),
        in_world_time_start: timeStart.trim(),
        in_world_duration_hint: duration.trim(),
        members
      });
    },
    onSuccess: (state) => {
      void queryClient.invalidateQueries({ queryKey: ["world", worldId] });
      void queryClient.invalidateQueries({ queryKey: ["world-timeline", worldId] });
      toast.success(`已创建第 ${state.room.scene_index} 幕。`);
      onDone();
      navigate(`/rooms/${state.room.id}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err))
  });
  const canSubmit = title.trim().length > 0 && selected.size > 0;
  return (
    <form
      className="space-y-3 rounded-md border border-dashed border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        create.mutate();
      }}
    >
      <input
        className="input w-full"
        placeholder="标题（如：第一幕：相遇）"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        required
      />
      <textarea
        className="input w-full"
        rows={2}
        placeholder="场景背景（黄昏的酒馆，烛光摇曳…）"
        value={background}
        onChange={(event) => setBackground(event.target.value)}
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          className="input"
          placeholder="故事内时间（如：第七日 黄昏）"
          value={timeStart}
          onChange={(event) => setTimeStart(event.target.value)}
        />
        <input
          className="input"
          placeholder="时长（如：约一个时辰）"
          value={duration}
          onChange={(event) => setDuration(event.target.value)}
        />
      </div>
      <div>
        <label className="text-xs font-medium text-muted">在场角色（至少 1 个）</label>
        <ul className="mt-1 space-y-1">
          {characters.map((character) => {
            const checked = selected.has(character.id);
            return (
              <li key={character.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-surface">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      const next = new Set(selected);
                      if (event.target.checked) next.add(character.id);
                      else next.delete(character.id);
                      setSelected(next);
                    }}
                  />
                  <PersonaIcon icon={character.icon} color={character.color} size={20} />
                  <span className="text-sm">{character.name}</span>
                  {character.identity && (
                    <span className="text-xs text-muted">（{character.identity}）</span>
                  )}
                  <span className="ml-auto text-[10px] text-muted">
                    {character.kind === "user" ? "USER" : "AI"}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn h-8 text-xs" onClick={onDone}>
          取消
        </button>
        <button
          type="submit"
          className="btn btn-primary h-8 text-xs"
          disabled={!canSubmit || create.isPending}
        >
          {create.isPending ? "创建中..." : "创建并进入"}
        </button>
      </div>
    </form>
  );
}
