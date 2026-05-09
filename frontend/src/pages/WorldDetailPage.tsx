import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  Eye,
  Layers,
  Lock,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  X
} from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { api } from "../api";
import { PersonaIcon } from "../components/PersonaIcon";
import { PersonaTemplatePicker } from "../components/PersonaTemplatePicker";
import { useConfirm } from "../components/ConfirmDialog";
import { toast } from "../components/Toaster";
import { SceneInspectorDialog } from "./world/SceneInspectorDialog";
import type {
  PersonaTemplate,
  SceneTimelineEntry,
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
    // Story-world characters bind to user-authored persona templates. Built-in
    // templates (架构师, 性能批评者 …) are written for discussion rooms and
    // their identities don't make sense as story characters — the user should
    // duplicate-then-edit a built-in if they want to derive from one.
    queryKey: ["persona-templates", "discussant", "user"],
    queryFn: () => api.personaTemplates("discussant", false)
  });

  const [addingCharacter, setAddingCharacter] = useState(false);
  const [batchPickerOpen, setBatchPickerOpen] = useState(false);
  const [creatingScene, setCreatingScene] = useState(false);
  const [inspectingScene, setInspectingScene] = useState<SceneTimelineEntry | null>(null);

  const inspectorMembers = useQuery({
    queryKey: ["scene-members", inspectingScene?.id],
    queryFn: () => api.sceneMembers(inspectingScene!.id),
    enabled: Boolean(inspectingScene)
  });

  // "World has activity" = any sealed scene OR any timeline entry with messages.
  // Used to decide whether character edits should show a stronger warning
  // (since the LLM has already produced memories under the old archetype).
  const worldHasActivity = useMemo(
    () =>
      (timeline.data ?? []).some(
        (scene) => scene.sealed_at !== null || (scene.message_count ?? 0) > 0
      ),
    [timeline.data]
  );

  const queryClient = useQueryClient();
  const batchAdd = useMutation({
    mutationFn: async (templates: PersonaTemplate[]) => {
      // Sequential rather than Promise.all: a 5-character batch hitting
      // SQLite at the same time can race against the WAL writer; the cost
      // of going one-by-one is trivial for a UI flow this size.
      const created: WorldCharacter[] = [];
      for (const tpl of templates) {
        const character = await api.createWorldCharacter(worldId, {
          kind: "ai",
          name: tpl.name,
          identity: tpl.identity,
          brief: tpl.description,
          persona_template_id: tpl.id,
          color: tpl.color,
          icon: tpl.icon
        });
        created.push(character);
      }
      return created;
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ["world", worldId] });
      toast.success(`已批量添加 ${created.length} 个角色，可点击编辑细节。`);
      setBatchPickerOpen(false);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err))
  });

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
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="btn h-8 px-3 text-xs"
                onClick={() => setBatchPickerOpen(true)}
                disabled={batchAdd.isPending}
                title="一次从多个 Persona 模板批量添加角色"
              >
                <Layers size={14} />
                批量添加
              </button>
              <button
                type="button"
                className="btn h-8 px-3 text-xs"
                onClick={() => setAddingCharacter((value) => !value)}
              >
                <UserPlus size={14} />
                {addingCharacter ? "收起" : "添加角色"}
              </button>
            </div>
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
              <CharacterRow
                key={character.id}
                worldId={worldId}
                character={character}
                worldHasActivity={worldHasActivity}
              />
            ))}
          </ul>
          <PersonaTemplatePicker
            mode="multi"
            open={batchPickerOpen}
            onOpenChange={setBatchPickerOpen}
            templates={aiTemplates.data ?? []}
            title="批量从模板添加角色"
            description="勾选多个 Persona 模板，每个会创建一个新角色（名字默认 = 模板名，可在角色卡上编辑）。"
            onPickMany={(picked) => batchAdd.mutate(picked)}
          />
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
              <li
                key={scene.id}
                className="rounded-md border border-border transition hover:border-brand/40"
              >
                <div className="flex items-stretch">
                  <Link
                    to={`/rooms/${scene.id}`}
                    className="flex min-w-0 flex-1 items-center justify-between gap-2 p-3 hover:bg-surface"
                  >
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
                  </Link>
                  {scene.sealed_at && (
                    <button
                      type="button"
                      className="flex items-center gap-1 border-l border-border px-3 text-xs text-muted hover:bg-surface hover:text-text"
                      onClick={() => setInspectingScene(scene)}
                      title="查看本幕产出的记忆与关系"
                    >
                      <Eye size={14} />
                      产出
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <SceneInspectorDialog
        open={inspectingScene !== null}
        onOpenChange={(open) => {
          if (!open) setInspectingScene(null);
        }}
        worldId={worldId}
        scene={inspectingScene}
        rosterCharacters={
          inspectingScene && inspectorMembers.data
            ? characters.filter((c) =>
                inspectorMembers.data!.some((m) => m.world_character_id === c.id)
              )
            : []
        }
      />
    </div>
  );
}

function CharacterRow({
  worldId,
  character,
  worldHasActivity
}: {
  worldId: string;
  character: WorldCharacter;
  worldHasActivity: boolean;
}) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
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
        <>
          <button
            type="button"
            className="btn h-7 w-7 px-0 text-muted hover:text-brand"
            title="编辑角色档案"
            onClick={() => setEditing(true)}
          >
            <Pencil size={13} />
          </button>
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
        </>
      )}
      <EditCharacterDialog
        worldId={worldId}
        character={character}
        open={editing}
        onOpenChange={setEditing}
        worldHasActivity={worldHasActivity}
      />
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
      className="space-y-5 rounded-md border border-dashed border-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        create.mutate();
      }}
    >
      <FormSection label="角色类型">
        <div className="flex gap-1.5 text-xs">
          <button
            type="button"
            className={`rounded px-3 py-1.5 ${
              kind === "ai" ? "bg-brand/10 text-brand" : "border border-border text-muted hover:bg-surface"
            }`}
            onClick={() => setKind("ai")}
          >
            AI 角色
          </button>
          <button
            type="button"
            className={`rounded px-3 py-1.5 ${
              kind === "user" ? "bg-accent/10 text-accent" : "border border-border text-muted hover:bg-surface"
            }`}
            onClick={() => setKind("user")}
          >
            User 角色（玩家驱动）
          </button>
        </div>
      </FormSection>

      {kind === "ai" && (
        <FormSection
          label="绑定 Persona 模板"
          hint="模板决定模型 + 基础 prompt；点击下方卡片可换模板。"
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-left transition hover:border-brand/40"
            onClick={() => setPickerOpen(true)}
          >
            {selectedTemplate ? (
              <>
                <PersonaIcon
                  icon={selectedTemplate.icon}
                  color={selectedTemplate.color}
                  size={32}
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
                <span className="grid h-8 w-8 place-items-center rounded-full bg-panel text-muted">
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
        </FormSection>
      )}

      <FormSection label="基础信息">
        <div className="space-y-2.5">
          <LabeledField label="角色名" required>
            <input
              className="input w-full"
              placeholder="例：苏离"
              value={name}
              onChange={(event) => {
                userEdited.current.name = true;
                setName(event.target.value);
              }}
              maxLength={120}
              required
            />
          </LabeledField>
          <LabeledField label="身份 / 称谓">
            <input
              className="input w-full"
              placeholder="例：剑客 / 客栈老板 / 玄苍门掌门"
              value={identity}
              onChange={(event) => {
                userEdited.current.identity = true;
                setIdentity(event.target.value);
              }}
              maxLength={120}
            />
          </LabeledField>
          <LabeledField label="简介" hint="一句话描述，每场都会进 prompt。">
            <input
              className="input w-full"
              placeholder="例：常年游走江湖，言语不多，剑下少有活口"
              value={brief}
              onChange={(event) => {
                userEdited.current.brief = true;
                setBrief(event.target.value);
              }}
            />
          </LabeledField>
        </div>
      </FormSection>

      {kind === "ai" && (
        <FormSection
          label="内核档案"
          hint="只对 AI 角色生效，每场都进 prompt 引导发言风格。"
        >
          <div className="space-y-2.5">
            <LabeledField label="Core identity" hint="角色的底色与性格。">
              <textarea
                className="input w-full"
                rows={3}
                placeholder="例：沉默寡言，对承诺极重；少年时曾被门派遗弃，至今不愿提起。"
                value={coreIdentity}
                onChange={(event) => setCoreIdentity(event.target.value)}
              />
            </LabeledField>
            <LabeledField label="技能">
              <input
                className="input w-full"
                placeholder="例：一手「断风式」，可以一击两丈"
                value={skillsText}
                onChange={(event) => setSkillsText(event.target.value)}
              />
            </LabeledField>
            <LabeledField label="当前目标">
              <input
                className="input w-full"
                placeholder="例：寻找当年仇家，但不愿牵连客栈众人"
                value={goalsText}
                onChange={(event) => setGoalsText(event.target.value)}
              />
            </LabeledField>
          </div>
        </FormSection>
      )}

      <FormSection label="外观色">
        <div className="flex flex-wrap gap-1.5">
          {PALETTE.map((value) => (
            <button
              key={value}
              type="button"
              className={`h-7 w-7 rounded-full border-2 transition ${
                color === value ? "border-text scale-110" : "border-border hover:scale-105"
              }`}
              style={{ background: value }}
              onClick={() => setColor(value)}
              aria-label={value}
            />
          ))}
        </div>
      </FormSection>

      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <button type="button" className="btn" onClick={onDone}>
          取消
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!canSubmit || create.isPending}
        >
          {create.isPending ? "添加中..." : "添加角色"}
        </button>
      </div>
    </form>
  );
}

function FormSection({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <header>
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
        {hint && <p className="mt-0.5 text-[11px] text-muted">{hint}</p>}
      </header>
      {children}
    </section>
  );
}

function LabeledField({
  label,
  hint,
  required,
  children
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="text-xs text-muted">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

function EditCharacterDialog({
  worldId,
  character,
  open,
  onOpenChange,
  worldHasActivity
}: {
  worldId: string;
  character: WorldCharacter;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worldHasActivity: boolean;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(character.name);
  const [identity, setIdentity] = useState(character.identity);
  const [brief, setBrief] = useState(character.brief);
  const [coreIdentity, setCoreIdentity] = useState(character.core_identity);
  const [skillsText, setSkillsText] = useState(character.skills_text);
  const [goalsText, setGoalsText] = useState(character.goals_text);
  const [color, setColor] = useState(character.color);

  // Reset local state when dialog opens for a different character.
  useEffect(() => {
    if (open) {
      setName(character.name);
      setIdentity(character.identity);
      setBrief(character.brief);
      setCoreIdentity(character.core_identity);
      setSkillsText(character.skills_text);
      setGoalsText(character.goals_text);
      setColor(character.color);
    }
  }, [open, character]);

  const update = useMutation({
    mutationFn: () =>
      api.updateWorldCharacter(worldId, character.id, {
        name: name.trim(),
        identity: identity.trim(),
        brief: brief.trim(),
        core_identity: coreIdentity.trim(),
        skills_text: skillsText.trim(),
        goals_text: goalsText.trim(),
        color
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["world", worldId] });
      toast.success(`已更新角色「${name.trim() || character.name}」。`);
      onOpenChange(false);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err))
  });

  const isAi = character.kind === "ai";
  const canSubmit = name.trim().length > 0;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex h-[85vh] w-[92vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-panel shadow-soft">
          <div className="flex items-start justify-between gap-2 border-b border-border px-5 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <PersonaIcon icon={character.icon} color={color} size={36} />
              <div className="min-w-0">
                <Dialog.Title className="truncate text-base font-semibold text-text">
                  编辑角色档案
                </Dialog.Title>
                <Dialog.Description className="truncate text-xs text-muted">
                  {character.name}
                  {character.identity && `（${character.identity}）`}
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded text-muted hover:bg-surface hover:text-text"
                aria-label="关闭"
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          <form
            className="mai-scrollbar flex-1 space-y-5 overflow-auto px-5 py-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!canSubmit) return;
              update.mutate();
            }}
          >
            {/* Risk banner — always shown when editing, stronger copy when the
                world already has sealed scenes or scene messages. */}
            <div
              className={`flex gap-2 rounded-md border px-3 py-2 text-xs ${
                worldHasActivity
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  : "border-border bg-surface text-muted"
              }`}
            >
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="font-medium">
                  {worldHasActivity ? "本世界已有活跃 / 封幕场景，请慎重" : "修改后立即生效"}
                </div>
                <div className="mt-0.5 leading-relaxed">
                  改动只影响**下一幕**的 prompt，不会回写已经写入的 episodic / 关系卡。已封幕的场景里，AI 留下的记忆是基于旧的角色档案产出的——大幅修改 core identity 可能让前后剧情变得不连贯。
                </div>
              </div>
            </div>

            <FormSection label="基础信息">
              <div className="space-y-2.5">
                <LabeledField label="角色名" required>
                  <input
                    className="input w-full"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={120}
                    required
                  />
                </LabeledField>
                <LabeledField label="身份 / 称谓">
                  <input
                    className="input w-full"
                    value={identity}
                    onChange={(event) => setIdentity(event.target.value)}
                    maxLength={120}
                  />
                </LabeledField>
                <LabeledField label="简介" hint="一句话描述，每场都会进 prompt。">
                  <input
                    className="input w-full"
                    value={brief}
                    onChange={(event) => setBrief(event.target.value)}
                  />
                </LabeledField>
              </div>
            </FormSection>

            {isAi && (
              <FormSection
                label="内核档案"
                hint="改动 core identity 是影响最大的字段——AI 后续发言风格会以新版本为准。"
              >
                <div className="space-y-2.5">
                  <LabeledField label="Core identity">
                    <textarea
                      className="input w-full"
                      rows={4}
                      value={coreIdentity}
                      onChange={(event) => setCoreIdentity(event.target.value)}
                    />
                  </LabeledField>
                  <LabeledField label="技能">
                    <input
                      className="input w-full"
                      value={skillsText}
                      onChange={(event) => setSkillsText(event.target.value)}
                    />
                  </LabeledField>
                  <LabeledField label="当前目标">
                    <input
                      className="input w-full"
                      value={goalsText}
                      onChange={(event) => setGoalsText(event.target.value)}
                    />
                  </LabeledField>
                </div>
              </FormSection>
            )}

            <FormSection label="外观色">
              <div className="flex flex-wrap gap-1.5">
                {PALETTE.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`h-7 w-7 rounded-full border-2 transition ${
                      color === value ? "border-text scale-110" : "border-border hover:scale-105"
                    }`}
                    style={{ background: value }}
                    onClick={() => setColor(value)}
                    aria-label={value}
                  />
                ))}
              </div>
            </FormSection>
          </form>

          <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
            <Dialog.Close asChild>
              <button type="button" className="btn">
                取消
              </button>
            </Dialog.Close>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canSubmit || update.isPending}
              onClick={() => update.mutate()}
            >
              {update.isPending ? "保存中..." : "保存"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
      // Story-world scenes intentionally don't yank the user into the
      // discussion-room shell — the timeline is the source of truth and the
      // user can pick when to drop into the scene from the new card.
      toast.success(`已创建第 ${state.room.scene_index} 幕，可在时间线点击进入。`);
      onDone();
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
