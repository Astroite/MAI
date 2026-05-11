import { useMemo, useState, type MouseEvent } from "react";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GripVertical, Pencil, Plus, Save, Trash2, Workflow } from "lucide-react";
import { api } from "../../api";
import type { DebateFormat, PhaseTemplate } from "../../types";
import { StatusPill } from "../../components/StatusPill";
import { toast } from "../../components/Toaster";
import { useConfirm } from "../../components/ConfirmDialog";
import { useI18n } from "../../i18n";
import { queryKeys } from "../../queryKeys";
import { filterByTags, newSlotId, splitTags } from "./shared/templateUtils";
import { BuiltinLibrary, EmptyState, Header, TagFilterBar } from "./shared/TemplateChrome";
interface FormatSlotDraft {
  id: string;
  phaseId: string;
  phaseVersion?: number;
  transitions?: Array<Record<string, unknown>>;
}

export function FormatsTab() {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const confirm = useConfirm();
  const formats = useQuery({ queryKey: queryKeys.formats.editable, queryFn: () => api.formats(false) });
  const builtinFormats = useQuery({ queryKey: queryKeys.formats.builtin, queryFn: () => api.formats(true) });
  const phases = useQuery({ queryKey: queryKeys.phases.all, queryFn: () => api.phases() });
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);
  const [name, setName] = useState(() => t("templates.defaultFormatName"));
  const [description, setDescription] = useState(() => t("templates.defaultFormatDescription"));
  const [tags, setTags] = useState("custom");
  const [phaseId, setPhaseId] = useState("");
  const [phaseSlots, setPhaseSlots] = useState<FormatSlotDraft[]>([]);
  const [editingFormatId, setEditingFormatId] = useState<string | null>(null);
  const items = filterByTags(formats.data, selectedTags);
  const phaseById = useMemo(() => new Map((phases.data ?? []).map((phase) => [phase.id, phase])), [phases.data]);
  const formatPayload = () => ({
    name,
    description,
    phase_sequence: phaseSlots.map((slot) => ({
      phase_template_id: slot.phaseId,
      phase_template_version: slot.phaseVersion ?? phaseById.get(slot.phaseId)?.version ?? 1,
      transitions: slot.transitions ?? [{ condition: "always", target: "next" }]
    })),
    tags: splitTags(tags)
  });
  const loadFormat = (format: DebateFormat) => {
    setEditingFormatId(format.id);
    setName(format.name);
    setDescription(format.description);
    setTags(format.tags.join(","));
    setPhaseSlots(
      format.phase_sequence.map((slot) => ({
        id: newSlotId(),
        phaseId: slot.phase_template_id,
        phaseVersion: slot.phase_template_version,
        transitions: slot.transitions
      }))
    );
  };
  const resetFormatForm = () => {
    setEditingFormatId(null);
    setName(t("templates.defaultFormatName"));
    setDescription(t("templates.defaultFormatDescription"));
    setTags("custom");
    setPhaseId("");
    setPhaseSlots([]);
  };
  const save = useMutation({
    mutationFn: () =>
      editingFormatId ? api.updateFormat(editingFormatId, formatPayload()) : api.createFormat(formatPayload()),
    onSuccess: (saved) => {
      loadFormat(saved);
      void queryClient.invalidateQueries({ queryKey: queryKeys.formats.all });
    }
  });
  const addFromBuiltin = useMutation({
    mutationFn: (formatId: string) => api.duplicateFormat(formatId),
    onSuccess: (copy) => {
      loadFormat(copy);
      setShowLibrary(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.formats.all });
    }
  });
  const remove = useMutation({
    mutationFn: (formatId: string) => api.deleteFormat(formatId),
    onSuccess: () => {
      resetFormatForm();
      void queryClient.invalidateQueries({ queryKey: queryKeys.formats.all });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("api.deleteFailed"))
  });
  const deleteFormat = async (format: DebateFormat, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (await confirm({
      title: t("templates.deleteFormatConfirm", { name: format.name }),
      danger: true,
      confirmLabel: t("common.delete")
    })) {
      remove.mutate(format.id);
    }
  };

  const addPhase = () => {
    const selectedPhaseId = phaseId || phases.data?.[0]?.id;
    if (!selectedPhaseId) return;
    setPhaseSlots((current) => [
      ...current,
      { id: newSlotId(), phaseId: selectedPhaseId, phaseVersion: phaseById.get(selectedPhaseId)?.version ?? 1 }
    ]);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const overId = event.over?.id;
    if (!overId || event.active.id === overId) return;
    setPhaseSlots((current) => {
      const oldIndex = current.findIndex((slot) => slot.id === event.active.id);
      const newIndex = current.findIndex((slot) => slot.id === overId);
      if (oldIndex < 0 || newIndex < 0) return current;
      return arrayMove(current, oldIndex, newIndex);
    });
  };

  return (
    <section className="grid grid-cols-[minmax(0,1fr)_400px] gap-4 max-xl:grid-cols-1">
      <div className="space-y-3">
        <Header
          title={t("templates.formats")}
          subtitle={t("templates.formatHelp")}
          actionLabel={t("templates.fromBuiltin")}
          onAction={() => setShowLibrary((value) => !value)}
          metrics={<StatusPill tone="info">{t("templates.formatCount", { count: items.length })}</StatusPill>}
        />
        {showLibrary && (
          <BuiltinLibrary
            title={t("templates.formatBuiltin")}
            items={builtinFormats.data ?? []}
            addingId={addFromBuiltin.variables}
            isAdding={addFromBuiltin.isPending}
            onAdd={(format) => addFromBuiltin.mutate(format.id)}
            renderMeta={(format) => <StatusPill tone="brand">{t("common.phaseCount", { count: format.phase_sequence.length })}</StatusPill>}
          />
        )}
        <TagFilterBar items={formats.data ?? []} selected={selectedTags} onChange={setSelectedTags} />
        <div className="space-y-3">
          {items.map((format: DebateFormat) => {
            const active = editingFormatId === format.id;
            return (
              <div
                key={format.id}
                className={`group relative cursor-pointer overflow-hidden rounded-lg border bg-panel p-4 shadow-card transition hover:border-brand ${
                  active ? "border-brand ring-1 ring-brand" : "border-border"
                }`}
                role="button"
                tabIndex={0}
                onClick={() => loadFormat(format)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    loadFormat(format);
                  }
                }}
              >
                <span
                  aria-hidden
                  className={`absolute left-0 top-3 h-8 w-1 rounded-r-full ${active ? "bg-brand" : "bg-brand/40"}`}
                />
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-brand/10 text-brand">
                      <Workflow size={16} />
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold">{format.name}</h2>
                      <p className="mt-1 line-clamp-2 text-xs text-muted">{format.description}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <StatusPill tone="brand">{t("common.phaseCount", { count: format.phase_sequence.length })}</StatusPill>
                    <button
                      className="btn h-9 w-9 px-0"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        loadFormat(format);
                      }}
                      title={t("common.edit")}
                      aria-label={t("common.edit")}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="btn btn-danger h-9 w-9 px-0"
                      type="button"
                      onClick={(event) => deleteFormat(format, event)}
                      disabled={remove.isPending && remove.variables === format.id}
                      title={t("common.delete")}
                      aria-label={t("common.delete")}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <ol className="mai-scrollbar mt-3 flex items-center gap-1 overflow-x-auto text-xs">
                  {format.phase_sequence.slice(0, 8).map((slot, index) => {
                    const phase = phaseById.get(slot.phase_template_id);
                    return (
                      <li key={`${format.id}-${index}-${slot.phase_template_id}`} className="flex shrink-0 items-center gap-1">
                        <span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-muted">
                          <span className="text-xs">{index + 1}</span>
                          <span className="max-w-[8rem] truncate">{phase?.name ?? slot.phase_template_id}</span>
                        </span>
                        {index < Math.min(format.phase_sequence.length, 8) - 1 && (
                          <span className="text-muted">→</span>
                        )}
                      </li>
                    );
                  })}
                  {format.phase_sequence.length > 8 && (
                    <li className="shrink-0 text-xs text-muted">
                      +{format.phase_sequence.length - 8}
                    </li>
                  )}
                </ol>
                {format.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    {format.tags.slice(0, 4).map((tag) => (
                      <span key={tag} className="rounded-md bg-surface px-1.5 py-0.5 text-xs text-muted">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {items.length === 0 && <EmptyState title={t("templates.emptyEditableFormat")} onAdd={() => setShowLibrary(true)} />}
        </div>
      </div>
      <aside className="panel p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">{editingFormatId ? t("templates.editFormat") : t("templates.blankFormat")}</h2>
          {editingFormatId && (
            <button className="btn h-8 px-2 text-xs" type="button" onClick={resetFormatForm}>
              <Plus size={14} />
              {t("common.new")}
            </button>
          )}
        </div>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="label">{t("common.name")}</span>
            <input name="format-name" className="input mt-1 w-full" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="block">
            <span className="label">{t("common.description")}</span>
            <textarea name="format-description" className="textarea mt-1 w-full" value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <label className="block">
            <span className="label">{t("common.tags")}</span>
            <input name="format-tags" className="input mt-1 w-full" value={tags} onChange={(event) => setTags(event.target.value)} />
          </label>
          <div>
            <span className="label">{t("templates.phaseSlots")}</span>
            <div className="mt-2 flex gap-2">
              <select name="format-phase" className="input min-w-0 flex-1" value={phaseId} onChange={(event) => setPhaseId(event.target.value)}>
                <option value="">{t("templates.selectPhase")}</option>
                {(phases.data ?? []).map((phase) => (
                  <option key={phase.id} value={phase.id}>
                    {phase.name}
                  </option>
                ))}
              </select>
              <button className="btn" type="button" onClick={addPhase} disabled={!phases.data?.length}>
                <Plus size={16} />
                {t("templates.addPhaseSlot")}
              </button>
            </div>
            <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={phaseSlots.map((slot) => slot.id)} strategy={verticalListSortingStrategy}>
                <div className="mt-3 space-y-2">
                  {phaseSlots.map((slot, index) => (
                    <FormatPhaseCard
                      key={slot.id}
                      index={index}
                      slot={slot}
                      phase={phaseById.get(slot.phaseId)}
                      onRemove={() => setPhaseSlots((current) => current.filter((item) => item.id !== slot.id))}
                    />
                  ))}
                  {phaseSlots.length === 0 && <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted">{t("templates.dragPhaseHint")}</div>}
                </div>
              </SortableContext>
            </DndContext>
          </div>
          <button className="btn btn-primary w-full" onClick={() => save.mutate()} disabled={!name.trim() || phaseSlots.length === 0 || save.isPending}>
            <Save size={16} />
            {editingFormatId ? t("common.saveChanges") : t("templates.saveFormat")}
          </button>
        </div>
      </aside>
    </section>
  );
}
function FormatPhaseCard({
  index,
  slot,
  phase,
  onRemove
}: {
  index: number;
  slot: FormatSlotDraft;
  phase?: PhaseTemplate;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slot.id });
  const { t, display } = useI18n();
  const style = {
    transform: transform
      ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0) scaleX(${transform.scaleX}) scaleY(${transform.scaleY})`
      : undefined,
    transition
  };
  return (
    <div ref={setNodeRef} style={style} className={`rounded-md border border-border bg-panel p-3 ${isDragging ? "shadow-soft" : ""}`}>
      <div className="flex items-start gap-2">
        <button className="btn h-8 w-8 shrink-0 px-0" type="button" aria-label={t("templates.phaseSlots")} {...attributes} {...listeners}>
          <GripVertical size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">{index + 1}</span>
            <div className="truncate text-sm font-medium">{phase?.name ?? slot.phaseId}</div>
          </div>
          <div className="mt-1 flex flex-wrap gap-2">
            <StatusPill tone="brand">{phase ? display("orderingRule", phase.ordering_rule.type) : t("common.unknown")}</StatusPill>
            {(phase?.tags ?? []).slice(0, 3).map((tag) => (
              <StatusPill key={tag}>{tag}</StatusPill>
            ))}
          </div>
        </div>
        <button className="btn btn-danger h-8 w-8 shrink-0 px-0" type="button" aria-label={t("common.delete")} onClick={onRemove}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
