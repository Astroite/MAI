import { useState, type MouseEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Layers, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { api } from "../../api";
import type { PhaseTemplate } from "../../types";
import { StatusPill } from "../../components/StatusPill";
import { toast } from "../../components/Toaster";
import { useConfirm } from "../../components/ConfirmDialog";
import { useI18n } from "../../i18n";
import { queryKeys } from "../../queryKeys";
import { buildExitConditions, filterByTags, splitTags } from "./shared/templateUtils";
import { BuiltinLibrary, EmptyState, Header, TagFilterBar } from "./shared/TemplateChrome";
export function PhasesTab() {
  const queryClient = useQueryClient();
  const { t, display } = useI18n();
  const confirm = useConfirm();
  const phases = useQuery({ queryKey: queryKeys.phases.editable, queryFn: () => api.phases(false) });
  const builtinPhases = useQuery({ queryKey: queryKeys.phases.builtin, queryFn: () => api.phases(true) });
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);
  const items = filterByTags(phases.data, selectedTags);
  const [name, setName] = useState(() => t("templates.defaultPhaseName"));
  const [description, setDescription] = useState(() => t("templates.defaultPhaseDescription"));
  const [tags, setTags] = useState("vote,parallel");
  const [allowedType, setAllowedType] = useState<"all" | "variables" | "specific">("all");
  const [allowedValues, setAllowedValues] = useState("");
  const [orderingType, setOrderingType] = useState("parallel");
  const [roleConstraints, setRoleConstraints] = useState(() => t("templates.defaultRoleConstraints"));
  const [promptTemplate, setPromptTemplate] = useState(() => t("templates.defaultPromptTemplate"));
  const [roundsExit, setRoundsExit] = useState(false);
  const [roundsN, setRoundsN] = useState(2);
  const [allSpokenExit, setAllSpokenExit] = useState(false);
  const [minEach, setMinEach] = useState(1);
  const [allVotedExit, setAllVotedExit] = useState(true);
  const [manualExit, setManualExit] = useState(false);
  const [tokenBudgetExit, setTokenBudgetExit] = useState(false);
  const [tokenBudget, setTokenBudget] = useState(12000);
  const [facilitatorExit, setFacilitatorExit] = useState(false);
  const [facilitatorTags, setFacilitatorTags] = useState("phase_exhausted");
  const [autoDiscuss, setAutoDiscuss] = useState(false);
  const [editingPhaseId, setEditingPhaseId] = useState<string | null>(null);
  const allowedItems = splitTags(allowedValues);
  const phaseExitConditions = buildExitConditions({
    roundsExit,
    roundsN,
    allSpokenExit,
    minEach,
    allVotedExit,
    manualExit,
    tokenBudgetExit,
    tokenBudget,
    facilitatorExit,
    facilitatorTags
  });
  const phasePayload = () => ({
    name,
    description,
    declared_variables:
      allowedType === "variables"
        ? allowedItems.map((item) => ({ name: item, description: "", cardinality: "many", required: true }))
        : [],
    allowed_speakers:
      allowedType === "variables"
        ? { type: "variables", variable_names: allowedItems }
        : allowedType === "specific"
          ? { type: "specific", persona_ids: allowedItems }
          : { type: "all" },
    ordering_rule: { type: orderingType },
    exit_conditions: phaseExitConditions,
    auto_discuss: autoDiscuss,
    role_constraints: roleConstraints,
    prompt_template: promptTemplate,
    tags: splitTags(tags)
  });
  const loadPhase = (phase: PhaseTemplate) => {
    const allowed = phase.allowed_speakers as { type?: string; variable_names?: string[]; persona_ids?: string[] };
    const allowedKind = allowed.type === "variables" || allowed.type === "specific" ? allowed.type : "all";
    const rounds = phase.exit_conditions.find((condition) => condition.type === "rounds");
    const allSpoken = phase.exit_conditions.find((condition) => condition.type === "all_spoken");
    const tokenBudgetCondition = phase.exit_conditions.find((condition) => condition.type === "token_budget");
    const facilitator = phase.exit_conditions.find((condition) => condition.type === "facilitator_suggests");
    const facilitatorTrigger = Array.isArray(facilitator?.trigger_if) ? facilitator.trigger_if : [];

    setEditingPhaseId(phase.id);
    setName(phase.name);
    setDescription(phase.description);
    setTags(phase.tags.join(","));
    setAllowedType(allowedKind);
    setAllowedValues(allowedKind === "variables" ? (allowed.variable_names ?? []).join(",") : allowedKind === "specific" ? (allowed.persona_ids ?? []).join(",") : "");
    setOrderingType(phase.ordering_rule.type);
    setRoleConstraints(phase.role_constraints);
    setPromptTemplate(phase.prompt_template);
    setRoundsExit(Boolean(rounds));
    setRoundsN(Number(rounds?.n ?? 2));
    setAllSpokenExit(Boolean(allSpoken));
    setMinEach(Number(allSpoken?.min_each ?? 1));
    setAllVotedExit(phase.exit_conditions.some((condition) => condition.type === "all_voted"));
    setManualExit(phase.exit_conditions.some((condition) => condition.type === "user_manual"));
    setTokenBudgetExit(Boolean(tokenBudgetCondition));
    setTokenBudget(Number(tokenBudgetCondition?.max ?? 12000));
    setFacilitatorExit(Boolean(facilitator));
    setFacilitatorTags(facilitatorTrigger.map(String).join(","));
    setAutoDiscuss(Boolean(phase.auto_discuss));
  };
  const resetPhaseForm = () => {
    setEditingPhaseId(null);
    setName(t("templates.defaultPhaseName"));
    setDescription(t("templates.defaultPhaseDescription"));
    setTags("vote,parallel");
    setAllowedType("all");
    setAllowedValues("");
    setOrderingType("parallel");
    setRoleConstraints(t("templates.defaultRoleConstraints"));
    setPromptTemplate(t("templates.defaultPromptTemplate"));
    setRoundsExit(false);
    setRoundsN(2);
    setAllSpokenExit(false);
    setMinEach(1);
    setAllVotedExit(true);
    setManualExit(false);
    setTokenBudgetExit(false);
    setTokenBudget(12000);
    setFacilitatorExit(false);
    setFacilitatorTags("phase_exhausted");
    setAutoDiscuss(false);
  };
  const canSavePhase = Boolean(name.trim()) && phaseExitConditions.length > 0 && (allowedType === "all" || allowedItems.length > 0);
  const save = useMutation({
    mutationFn: () =>
      editingPhaseId ? api.updatePhase(editingPhaseId, phasePayload()) : api.createPhase(phasePayload()),
    onSuccess: (saved) => {
      loadPhase(saved);
      void queryClient.invalidateQueries({ queryKey: queryKeys.phases.all });
    }
  });
  const addFromBuiltin = useMutation({
    mutationFn: (phaseId: string) => api.duplicatePhase(phaseId),
    onSuccess: (copy) => {
      loadPhase(copy);
      setShowLibrary(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.phases.all });
    }
  });
  const remove = useMutation({
    mutationFn: (phaseId: string) => api.deletePhase(phaseId),
    onSuccess: () => {
      resetPhaseForm();
      void queryClient.invalidateQueries({ queryKey: queryKeys.phases.all });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("api.deleteFailed"))
  });
  const deletePhase = async (phase: PhaseTemplate, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (await confirm({
      title: t("templates.deletePhaseConfirm", { name: phase.name }),
      danger: true,
      confirmLabel: t("common.delete")
    })) {
      remove.mutate(phase.id);
    }
  };
  return (
    <section className="grid grid-cols-[minmax(0,1fr)_440px] gap-4 max-xl:grid-cols-1">
      <div className="space-y-3">
        <Header
          title={t("templates.phases")}
          subtitle={t("templates.phaseHelp")}
          actionLabel={t("templates.fromBuiltin")}
          onAction={() => setShowLibrary((value) => !value)}
          metrics={<StatusPill>{t("common.phaseCount", { count: items.length })}</StatusPill>}
        />
        {showLibrary && (
          <BuiltinLibrary
            title={t("templates.phaseBuiltin")}
            items={builtinPhases.data ?? []}
            addingId={addFromBuiltin.variables}
            isAdding={addFromBuiltin.isPending}
            onAdd={(phase) => addFromBuiltin.mutate(phase.id)}
            renderMeta={(phase) => (
              <>
                <StatusPill tone="brand">{display("orderingRule", phase.ordering_rule.type)}</StatusPill>
                <StatusPill tone="accent">{display("allowedSpeakers", String(phase.allowed_speakers.type ?? "allowed"))}</StatusPill>
              </>
            )}
          />
        )}
        <TagFilterBar items={phases.data ?? []} selected={selectedTags} onChange={setSelectedTags} />
        <div className="grid grid-cols-1 gap-3">
          {items.map((phase: PhaseTemplate) => {
            const active = editingPhaseId === phase.id;
            return (
              <div
                key={phase.id}
                className={`group relative cursor-pointer overflow-hidden rounded-lg border bg-panel p-4 shadow-card transition hover:border-brand ${
                  active ? "border-brand ring-1 ring-brand" : "border-border"
                }`}
                role="button"
                tabIndex={0}
                onClick={() => loadPhase(phase)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    loadPhase(phase);
                  }
                }}
              >
                <span
                  aria-hidden
                  className={`absolute left-0 top-3 h-8 w-1 rounded-r-full ${active ? "bg-brand" : "bg-info/50"}`}
                />
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      aria-hidden
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-info/10 text-info"
                    >
                      <Layers size={16} />
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold">{phase.name}</h2>
                      <p className="mt-1 line-clamp-2 text-xs text-muted">{phase.description}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      className="btn h-9 w-9 px-0"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        loadPhase(phase);
                      }}
                      title={t("common.edit")}
                      aria-label={t("common.edit")}
                    >
                      <Pencil size={16} />
                    </button>
                    <a
                      className="btn h-9 w-9 px-0"
                      href={`/api/templates/phases/${phase.id}/export`}
                      onClick={(event) => event.stopPropagation()}
                      title={t("common.export")}
                      aria-label={t("common.export")}
                    >
                      <Download size={16} />
                    </a>
                    <button
                      className="btn btn-danger h-9 w-9 px-0"
                      type="button"
                      onClick={(event) => deletePhase(phase, event)}
                      disabled={remove.isPending && remove.variables === phase.id}
                      title={t("common.delete")}
                      aria-label={t("common.delete")}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <StatusPill tone="brand">{display("orderingRule", phase.ordering_rule.type)}</StatusPill>
                  <StatusPill tone="accent">{display("allowedSpeakers", String(phase.allowed_speakers.type ?? "allowed"))}</StatusPill>
                  {phase.auto_discuss && <StatusPill tone="accent">{t("templates.autoDiscuss")}</StatusPill>}
                  {phase.exit_conditions.slice(0, 3).map((condition, index) => (
                    <StatusPill key={`${phase.id}-exit-${index}`}>
                      {display("exitCondition", String(condition.type ?? "exit"))}
                    </StatusPill>
                  ))}
                  {phase.tags.slice(0, 4).map((tag) => (
                    <span key={tag} className="rounded-md bg-surface px-1.5 py-0.5 text-xs text-muted">
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {items.length === 0 && <EmptyState title={t("templates.emptyEditablePhase")} onAdd={() => setShowLibrary(true)} />}
      </div>
      <aside className="panel p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">{editingPhaseId ? t("templates.editPhase") : t("templates.blankPhase")}</h2>
          {editingPhaseId && (
            <button className="btn h-8 px-2 text-xs" type="button" onClick={resetPhaseForm}>
              <Plus size={14} />
              {t("common.new")}
            </button>
          )}
        </div>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="label">{t("common.name")}</span>
            <input name="phase-name" className="input mt-1 w-full" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="block">
            <span className="label">{t("common.description")}</span>
            <textarea name="phase-description" className="textarea mt-1 w-full" value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <label className="block">
            <span className="label">{t("common.tags")}</span>
            <input name="phase-tags" className="input mt-1 w-full" value={tags} onChange={(event) => setTags(event.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="label">{t("templates.speakerScope")}</span>
              <select name="phase-allowed-type" className="input mt-1 w-full" value={allowedType} onChange={(event) => setAllowedType(event.target.value as "all" | "variables" | "specific")}>
                <option value="all">{display("allowedSpeakers", "all")}</option>
                <option value="variables">{display("allowedSpeakers", "variables")}</option>
                <option value="specific">{display("allowedSpeakers", "specific")}</option>
              </select>
            </label>
            <label className="block">
              <span className="label">{t("templates.orderingRule")}</span>
              <select name="phase-ordering-type" className="input mt-1 w-full" value={orderingType} onChange={(event) => setOrderingType(event.target.value)}>
                <option value="alternating">{display("orderingRule", "alternating")}</option>
                <option value="round_robin">{display("orderingRule", "round_robin")}</option>
                <option value="mention_driven">{display("orderingRule", "mention_driven")}</option>
                <option value="question_paired">{display("orderingRule", "question_paired")}</option>
                <option value="parallel">{display("orderingRule", "parallel")}</option>
                <option value="user_picks">{display("orderingRule", "user_picks")}</option>
                <option value="casual">{display("orderingRule", "casual")}</option>
              </select>
            </label>
          </div>
          {allowedType !== "all" && (
            <label className="block">
              <span className="label">{allowedType === "variables" ? t("templates.variableName") : t("templates.personaIds")}</span>
              <input name="phase-allowed-values" className="input mt-1 w-full" value={allowedValues} onChange={(event) => setAllowedValues(event.target.value)} />
            </label>
          )}
          <div>
            <div className="label">{t("templates.exitConditions")}</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <label className="flex items-center gap-2 rounded-md border border-border p-2">
                <input name="phase-exit-rounds" type="checkbox" checked={roundsExit} onChange={(event) => setRoundsExit(event.target.checked)} />
                {display("exitCondition", "rounds")}
              </label>
              <input name="phase-rounds-count" className="input w-full" type="number" min={1} value={roundsN} onChange={(event) => setRoundsN(Number(event.target.value))} />
              <label className="flex items-center gap-2 rounded-md border border-border p-2">
                <input name="phase-exit-all-spoken" type="checkbox" checked={allSpokenExit} onChange={(event) => setAllSpokenExit(event.target.checked)} />
                {display("exitCondition", "all_spoken")}
              </label>
              <input name="phase-min-each" className="input w-full" type="number" min={1} value={minEach} onChange={(event) => setMinEach(Number(event.target.value))} />
              <label className="flex items-center gap-2 rounded-md border border-border p-2">
                <input name="phase-exit-all-voted" type="checkbox" checked={allVotedExit} onChange={(event) => setAllVotedExit(event.target.checked)} />
                {display("exitCondition", "all_voted")}
              </label>
              <label className="flex items-center gap-2 rounded-md border border-border p-2">
                <input name="phase-exit-manual" type="checkbox" checked={manualExit} onChange={(event) => setManualExit(event.target.checked)} />
                {display("exitCondition", "user_manual")}
              </label>
              <label className="flex items-center gap-2 rounded-md border border-border p-2">
                <input name="phase-exit-token-budget" type="checkbox" checked={tokenBudgetExit} onChange={(event) => setTokenBudgetExit(event.target.checked)} />
                {display("exitCondition", "token_budget")}
              </label>
              <input name="phase-token-budget" className="input w-full" type="number" min={1} value={tokenBudget} onChange={(event) => setTokenBudget(Number(event.target.value))} />
              <label className="flex items-center gap-2 rounded-md border border-border p-2">
                <input name="phase-exit-facilitator" type="checkbox" checked={facilitatorExit} onChange={(event) => setFacilitatorExit(event.target.checked)} />
                {display("exitCondition", "facilitator_suggests")}
              </label>
              <input name="phase-facilitator-tags" className="input w-full" value={facilitatorTags} onChange={(event) => setFacilitatorTags(event.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              name="phase-auto-discuss"
              type="checkbox"
              checked={autoDiscuss}
              onChange={(event) => setAutoDiscuss(event.target.checked)}
            />
            {t("templates.autoDiscuss")}
          </label>
          <label className="block">
            <span className="label">{t("templates.roleConstraints")}</span>
            <textarea name="phase-role-constraints" className="textarea mt-1 w-full" value={roleConstraints} onChange={(event) => setRoleConstraints(event.target.value)} />
          </label>
          <label className="block">
            <span className="label">{t("templates.promptTemplate")}</span>
            <textarea name="phase-prompt-template" className="textarea mt-1 w-full" value={promptTemplate} onChange={(event) => setPromptTemplate(event.target.value)} />
          </label>
          <button className="btn btn-primary w-full" onClick={() => save.mutate()} disabled={!canSavePhase || save.isPending}>
            <Save size={16} />
            {editingPhaseId ? t("common.saveChanges") : t("templates.savePhase")}
          </button>
        </div>
      </aside>
    </section>
  );
}
