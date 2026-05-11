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
import { COVER_PALETTE } from "../constants/colors";
import { queryKeys } from "../queryKeys";
import { useI18n } from "../i18n";

export function WorldDetailPage() {
  const { worldId = "" } = useParams();
  const { t } = useI18n();
  const world = useQuery({
    queryKey: queryKeys.world(worldId),
    queryFn: () => api.world(worldId),
    enabled: Boolean(worldId)
  });
  const timeline = useQuery({
    queryKey: queryKeys.worldTimeline(worldId),
    queryFn: () => api.worldTimeline(worldId),
    enabled: Boolean(worldId)
  });
  const aiTemplates = useQuery({
    // Story-world characters bind to user-authored persona templates. Built-in
    // templates (架构师, 性能批评者 …) are written for discussion rooms and
    // their identities don't make sense as story characters — the user should
    // duplicate-then-edit a built-in if they want to derive from one.
    queryKey: queryKeys.personaTemplates.discussantUser,
    queryFn: () => api.personaTemplates("discussant", false)
  });

  const [addingCharacter, setAddingCharacter] = useState(false);
  const [batchPickerOpen, setBatchPickerOpen] = useState(false);
  const [creatingScene, setCreatingScene] = useState(false);
  const [inspectingScene, setInspectingScene] = useState<SceneTimelineEntry | null>(null);

  const inspectorMembers = useQuery({
    queryKey: queryKeys.sceneMembers(inspectingScene?.id),
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
          // Snapshot the template's system_prompt into core_identity so the
          // character carries its own (editable) prompt — same convention as
          // the inline AddCharacterForm path.
          core_identity: tpl.system_prompt,
          persona_template_id: tpl.id,
          color: tpl.color,
          icon: tpl.icon
        });
        created.push(character);
      }
      return created;
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.world(worldId) });
      toast.success(t("worldDetail.batchAdded", { count: created.length }));
      setBatchPickerOpen(false);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err))
  });

  if (world.isLoading || !world.data) {
    return (
      <div className="px-6 py-10 text-center text-sm text-muted">
        {world.isError ? t("worldDetail.loadError") : t("common.loading")}
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
          {t("worldDetail.backToWorlds")}
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
              {data.calendar_hint && <span>{t("worldDetail.calendar", { value: data.calendar_hint })}</span>}
              {data.setting && <span>{t("worldDetail.setting", { value: data.setting })}</span>}
            </div>
          </div>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Users size={16} className="text-muted" />
              {t("worldDetail.charactersTitle", { count: activeCharacters.length })}
            </h2>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="btn h-8 px-3 text-xs"
                onClick={() => setBatchPickerOpen(true)}
                disabled={batchAdd.isPending}
                title={t("worldDetail.batchAddTitle")}
              >
                <Layers size={14} />
                {t("worldDetail.batchAdd")}
              </button>
              <button
                type="button"
                className="btn h-8 px-3 text-xs"
                onClick={() => setAddingCharacter((value) => !value)}
              >
                <UserPlus size={14} />
                {addingCharacter ? t("common.collapse") : t("worldDetail.addCharacter")}
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
              <li className="py-4 text-center text-xs text-muted">{t("worldDetail.noCharacters")}</li>
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
            title={t("worldDetail.batchPickerTitle")}
            description={t("worldDetail.batchPickerDescription")}
            onPickMany={(picked) => batchAdd.mutate(picked)}
          />
        </section>

        <section className="panel space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <ChevronRight size={16} className="text-muted" />
              {t("worldDetail.timelineTitle", { count: timeline.data?.length ?? 0 })}
            </h2>
            <button
              type="button"
              className="btn h-8 px-3 text-xs"
              onClick={() => setCreatingScene((value) => !value)}
              disabled={activeCharacters.length === 0}
              title={activeCharacters.length === 0 ? t("worldDetail.needCharacterTitle") : ""}
            >
              <Plus size={14} />
              {creatingScene ? t("common.collapse") : t("worldDetail.newScene")}
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
              <li className="py-4 text-center text-xs text-muted">{t("worldDetail.noScenes")}</li>
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
                          {t("worldDetail.sceneAct", { n: scene.scene_index })}
                        </span>
                        {scene.sealed_at && (
                          <span className="inline-flex items-center gap-1 text-xs text-success">
                            <Lock size={12} />
                            {t("worldDetail.sceneSealed")}
                          </span>
                        )}
                        {scene.status === "frozen" && (
                          <span className="text-xs text-danger">{t("worldDetail.sceneFrozen")}</span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate text-sm font-medium">{scene.title}</div>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                        {scene.in_world_time_start && <span>{scene.in_world_time_start}</span>}
                        <span>{t("worldDetail.sceneCharacters", { count: scene.member_count })}</span>
                        <span>{t("worldDetail.sceneMessages", { count: scene.message_count })}</span>
                      </div>
                    </div>
                    <ChevronRight size={16} className="text-muted" />
                  </Link>
                  {scene.sealed_at && (
                    <button
                      type="button"
                      className="flex items-center gap-1 border-l border-border px-3 text-xs text-muted hover:bg-surface hover:text-text"
                      onClick={() => setInspectingScene(scene)}
                      title={t("worldDetail.sceneOutputTitle")}
                    >
                      <Eye size={14} />
                      {t("worldDetail.sceneOutput")}
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
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const remove = useMutation({
    mutationFn: () => api.deleteWorldCharacter(worldId, character.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.world(worldId) });
      toast.message(t("worldDetail.characterRetiredToast", { name: character.name }));
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
            className={`text-xs uppercase tracking-wide ${
              character.kind === "user" ? "text-accent" : "text-muted"
            }`}
          >
            {character.kind === "user" ? t("worldDetail.kindUser") : t("worldDetail.kindAi")}
          </span>
          {dim && <span className="text-xs text-muted">{t("worldDetail.characterRetired")}</span>}
        </div>
        {character.brief && (
          <div className="truncate text-xs text-muted">{character.brief}</div>
        )}
      </div>
      {character.status === "active" && (
        <>
          <button
            type="button"
            className="btn h-9 w-9 px-0 text-muted hover:text-brand"
            title={t("worldDetail.characterEditTitle")}
            onClick={() => setEditing(true)}
          >
            <Pencil size={16} />
          </button>
          <button
            type="button"
            className="btn h-9 w-9 px-0 text-muted hover:text-danger"
            title={t("worldDetail.characterRetireTitle")}
            onClick={async () => {
              const ok = await confirm({
                title: t("worldDetail.retireConfirmTitle", { name: character.name }),
                description: t("worldDetail.retireConfirmDescription"),
                confirmLabel: t("worldDetail.retireConfirmLabel"),
                danger: true
              });
              if (ok) remove.mutate();
            }}
            disabled={remove.isPending}
          >
            <Trash2 size={16} />
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
  const { t } = useI18n();
  const [kind, setKind] = useState<WorldCharacterKind>("ai");
  const [name, setName] = useState("");
  const [identity, setIdentity] = useState("");
  const [brief, setBrief] = useState("");
  const [coreIdentity, setCoreIdentity] = useState("");
  const [skillsText, setSkillsText] = useState("");
  const [goalsText, setGoalsText] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [color, setColor] = useState(COVER_PALETTE[9]); // 3b82f6
  const [icon, setIcon] = useState<string>("Sparkles");
  const [pickerOpen, setPickerOpen] = useState(false);
  // Track whether the user has hand-edited each field. Picking a template
  // auto-fills only the fields that haven't been touched (or that were
  // last filled BY a previous template selection). This stops switching
  // templates from clobbering deliberate character names like "苏离".
  const userEdited = useRef({
    name: false,
    identity: false,
    brief: false,
    coreIdentity: false
  });

  const selectedTemplate = templateId
    ? templates.find((tpl) => tpl.id === templateId) ?? null
    : null;

  const applyTemplate = (template: PersonaTemplate) => {
    setTemplateId(template.id);
    if (!userEdited.current.name) setName(template.name);
    if (!userEdited.current.identity) setIdentity(template.identity);
    if (!userEdited.current.brief) setBrief(template.description);
    // The template's system_prompt is what actually drives the LLM. Snapshot
    // it into core_identity so the user can see it, edit it, and so the
    // engine relies on a single canonical field per character.
    if (!userEdited.current.coreIdentity) setCoreIdentity(template.system_prompt);
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.world(worldId) });
      toast.success(t("worldDetail.characterAdded", { name: character.name }));
      setName("");
      setIdentity("");
      setBrief("");
      setCoreIdentity("");
      setSkillsText("");
      setGoalsText("");
      setTemplateId(null);
      userEdited.current = { name: false, identity: false, brief: false, coreIdentity: false };
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
      <FormSection label={t("worldDetail.characterType")}>
        <div className="flex gap-1.5 text-xs">
          <button
            type="button"
            className={`rounded px-3 py-1.5 ${
              kind === "ai" ? "bg-brand/10 text-brand" : "border border-border text-muted hover:bg-surface"
            }`}
            onClick={() => setKind("ai")}
          >
            {t("worldDetail.aiCharacter")}
          </button>
          <button
            type="button"
            className={`rounded px-3 py-1.5 ${
              kind === "user" ? "bg-accent/10 text-accent" : "border border-border text-muted hover:bg-surface"
            }`}
            onClick={() => setKind("user")}
          >
            {t("worldDetail.userCharacter")}
          </button>
        </div>
      </FormSection>

      {kind === "ai" && (
        <FormSection
          label={t("worldDetail.personaTemplate")}
          hint={t("worldDetail.personaTemplateHint")}
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
                <span className="text-xs text-muted">{t("worldDetail.changeTemplate")}</span>
              </>
            ) : (
              <>
                <span className="grid h-8 w-8 place-items-center rounded-full bg-panel text-muted">
                  ?
                </span>
                <span className="text-sm text-muted">{t("worldDetail.pickTemplate")}</span>
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

      <FormSection label={t("worldDetail.basics")}>
        <div className="space-y-2.5">
          <LabeledField label={t("worldDetail.characterName")} required>
            <input
              className="input w-full"
              placeholder={t("worldDetail.characterNamePlaceholder")}
              value={name}
              onChange={(event) => {
                userEdited.current.name = true;
                setName(event.target.value);
              }}
              maxLength={120}
              required
            />
          </LabeledField>
          <LabeledField label={t("worldDetail.identity")}>
            <input
              className="input w-full"
              placeholder={t("worldDetail.identityPlaceholder")}
              value={identity}
              onChange={(event) => {
                userEdited.current.identity = true;
                setIdentity(event.target.value);
              }}
              maxLength={120}
            />
          </LabeledField>
          <LabeledField label={t("worldDetail.brief")} hint={t("worldDetail.briefHint")}>
            <input
              className="input w-full"
              placeholder={t("worldDetail.briefPlaceholder")}
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
          label={t("worldDetail.coreProfile")}
          hint={t("worldDetail.coreProfileHint")}
        >
          <div className="space-y-2.5">
            <LabeledField
              label={t("worldDetail.coreIdentity")}
              hint={t("worldDetail.coreIdentityHint")}
            >
              <textarea
                className="textarea w-full"
                rows={5}
                placeholder={t("worldDetail.coreIdentityPlaceholder")}
                value={coreIdentity}
                onChange={(event) => {
                  userEdited.current.coreIdentity = true;
                  setCoreIdentity(event.target.value);
                }}
              />
            </LabeledField>
            <LabeledField label={t("worldDetail.skills")}>
              <input
                className="input w-full"
                placeholder={t("worldDetail.skillsPlaceholder")}
                value={skillsText}
                onChange={(event) => setSkillsText(event.target.value)}
              />
            </LabeledField>
            <LabeledField label={t("worldDetail.currentGoal")}>
              <input
                className="input w-full"
                placeholder={t("worldDetail.currentGoalPlaceholder")}
                value={goalsText}
                onChange={(event) => setGoalsText(event.target.value)}
              />
            </LabeledField>
          </div>
        </FormSection>
      )}

      <FormSection label={t("worldDetail.appearanceColor")}>
        <div className="flex flex-wrap gap-1.5">
          {COVER_PALETTE.map((value) => (
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
          {t("common.cancel")}
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!canSubmit || create.isPending}
        >
          {create.isPending ? t("worldDetail.adding") : t("worldDetail.addCharacter")}
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
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
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
        {required && <span className="ml-0.5 text-danger">*</span>}
      </span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
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
  const { t } = useI18n();
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.world(worldId) });
      toast.success(t("worldDetail.characterUpdated", { name: name.trim() || character.name }));
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
                  {t("worldDetail.editCharacterProfile")}
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
                aria-label={t("common.close")}
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
                  ? "border-warning/40 bg-warning/10 text-warning"
                  : "border-border bg-surface text-muted"
              }`}
            >
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="font-medium">
                  {worldHasActivity ? t("worldDetail.editRiskActiveTitle") : t("worldDetail.editRiskSafeTitle")}
                </div>
                <div className="mt-0.5 leading-relaxed">
                  {t("worldDetail.editRiskDescription")}
                </div>
              </div>
            </div>

            <FormSection label={t("worldDetail.basics")}>
              <div className="space-y-2.5">
                <LabeledField label={t("worldDetail.characterName")} required>
                  <input
                    className="input w-full"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={120}
                    required
                  />
                </LabeledField>
                <LabeledField label={t("worldDetail.identity")}>
                  <input
                    className="input w-full"
                    value={identity}
                    onChange={(event) => setIdentity(event.target.value)}
                    maxLength={120}
                  />
                </LabeledField>
                <LabeledField label={t("worldDetail.brief")} hint={t("worldDetail.briefHint")}>
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
                label={t("worldDetail.coreProfile")}
                hint={t("worldDetail.coreProfileEditHint")}
              >
                <div className="space-y-2.5">
                  <LabeledField label={t("worldDetail.coreIdentity")}>
                    <textarea
                      className="textarea w-full"
                      rows={4}
                      value={coreIdentity}
                      onChange={(event) => setCoreIdentity(event.target.value)}
                    />
                  </LabeledField>
                  <LabeledField label={t("worldDetail.skills")}>
                    <input
                      className="input w-full"
                      value={skillsText}
                      onChange={(event) => setSkillsText(event.target.value)}
                    />
                  </LabeledField>
                  <LabeledField label={t("worldDetail.currentGoal")}>
                    <input
                      className="input w-full"
                      value={goalsText}
                      onChange={(event) => setGoalsText(event.target.value)}
                    />
                  </LabeledField>
                </div>
              </FormSection>
            )}

            <FormSection label={t("worldDetail.appearanceColor")}>
              <div className="flex flex-wrap gap-1.5">
                {COVER_PALETTE.map((value) => (
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
                {t("common.cancel")}
              </button>
            </Dialog.Close>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canSubmit || update.isPending}
              onClick={() => update.mutate()}
            >
              {update.isPending ? t("worldDetail.saving") : t("common.save")}
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
  const { t } = useI18n();
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.world(worldId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.worldTimeline(worldId) });
      // Story-world scenes intentionally don't yank the user into the
      // discussion-room shell — the timeline is the source of truth and the
      // user can pick when to drop into the scene from the new card.
      toast.success(t("worldDetail.sceneCreated", { n: state.room.scene_index }));
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
        placeholder={t("worldDetail.sceneTitlePlaceholder")}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        required
      />
      <textarea
        className="textarea w-full"
        rows={2}
        placeholder={t("worldDetail.sceneBackgroundPlaceholder")}
        value={background}
        onChange={(event) => setBackground(event.target.value)}
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          className="input"
          placeholder={t("worldDetail.sceneTimePlaceholder")}
          value={timeStart}
          onChange={(event) => setTimeStart(event.target.value)}
        />
        <input
          className="input"
          placeholder={t("worldDetail.sceneDurationPlaceholder")}
          value={duration}
          onChange={(event) => setDuration(event.target.value)}
        />
      </div>
      <div>
        <label className="text-xs font-medium text-muted">{t("worldDetail.sceneRoster")}</label>
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
                  <span className="ml-auto text-xs text-muted">
                    {character.kind === "user" ? t("worldDetail.kindUser") : t("worldDetail.kindAi")}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn h-8 text-xs" onClick={onDone}>
          {t("common.cancel")}
        </button>
        <button
          type="submit"
          className="btn btn-primary h-8 text-xs"
          disabled={!canSubmit || create.isPending}
        >
          {create.isPending ? t("worldDetail.creating") : t("worldDetail.createAndEnter")}
        </button>
      </div>
    </form>
  );
}
