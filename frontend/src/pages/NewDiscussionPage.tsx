import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  Layers,
  Plus,
  Save,
  Search,
  Sparkles,
  Trash2,
  Users,
  Workflow,
  X
} from "lucide-react";
import { api } from "../api";
import { PhaseStepper, type PhaseStep } from "../components/PhaseStepper";
import { SectionCard } from "../components/SectionCard";
import { StatusPill } from "../components/StatusPill";
import { useI18n } from "../i18n";
import type { DebateFormat, PersonaTemplate, Recipe, Scenario } from "../types";

const DEFAULT_RECIPE = "__default__";
const NO_RECIPE = "__none__";
const DRAFT_KEY = "mai-new-discussion-draft";

type Draft = {
  title: string;
  background: string;
  recipeId: string;
  formatId: string | undefined;
  selectedPersonaIds: string[];
  personaTouched: boolean;
};

const ANCHORS = ["scenario", "basics", "format", "personas"] as const;
type AnchorKey = (typeof ANCHORS)[number];

export function NewDiscussionPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { t } = useI18n();
  const formats = useQuery({ queryKey: ["formats"], queryFn: () => api.formats() });
  const phases = useQuery({ queryKey: ["phases"], queryFn: () => api.phases() });
  const recipes = useQuery({ queryKey: ["recipes"], queryFn: () => api.recipes() });
  const scenarios = useQuery({ queryKey: ["scenarios"], queryFn: api.scenarios });
  const personas = useQuery({
    queryKey: ["persona-templates", "discussant", "editable"],
    queryFn: () => api.personaTemplates("discussant", false)
  });

  const initial = useMemo<Draft>(() => loadDraft(), []);
  const [title, setTitle] = useState(initial.title || "");
  const [background, setBackground] = useState(initial.background);
  const [recipeId, setRecipeId] = useState(initial.recipeId);
  const [formatId, setFormatId] = useState<string | undefined>(initial.formatId);
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<string[]>(initial.selectedPersonaIds);
  const [personaTouched, setPersonaTouched] = useState(initial.personaTouched);
  const [personaSearch, setPersonaSearch] = useState("");
  const [selectedPersonaTags, setSelectedPersonaTags] = useState<string[]>([]);
  const [draftFlash, setDraftFlash] = useState<string | null>(null);
  const anchorRefs = useRef<Record<AnchorKey, HTMLDivElement | null>>({
    scenario: null,
    basics: null,
    format: null,
    personas: null
  });

  // Keep the title's default localized when no draft is loaded yet.
  useEffect(() => {
    if (!title) setTitle(t("dashboard.defaultTitle"));
    // Only seed once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist draft on each meaningful change.
  useEffect(() => {
    saveDraft({ title, background, recipeId, formatId, selectedPersonaIds, personaTouched });
  }, [title, background, recipeId, formatId, selectedPersonaIds, personaTouched]);

  const solutionReview = formats.data?.find((item) => item.name === "方案评审")?.id;
  const defaultRecipe = recipes.data?.find((item) => item.name === "方案评审默认配方")?.id;
  const effectiveRecipeId =
    recipeId === NO_RECIPE ? undefined : recipeId === DEFAULT_RECIPE ? defaultRecipe : recipeId;
  const effectiveRecipe = recipes.data?.find((item) => item.id === effectiveRecipeId);

  const editablePersonaIds = useMemo(
    () => new Set((personas.data ?? []).map((persona) => persona.id)),
    [personas.data]
  );
  const recipePersonaIds = useMemo(
    () => (effectiveRecipe?.persona_ids ?? []).filter((id) => editablePersonaIds.has(id)),
    [effectiveRecipe?.persona_ids, editablePersonaIds]
  );
  const effectivePersonaIds = personaTouched ? selectedPersonaIds : recipePersonaIds;
  const canCreate = Boolean(title.trim()) && (effectivePersonaIds.length > 0 || Boolean(effectiveRecipeId));

  const allPersonaTags = useMemo(() => {
    const tags = new Set<string>();
    for (const persona of personas.data ?? []) {
      for (const tag of persona.tags ?? []) tags.add(tag);
    }
    return Array.from(tags).sort((left, right) => left.localeCompare(right));
  }, [personas.data]);

  const filteredPersonas = useMemo(() => {
    const query = personaSearch.trim().toLowerCase();
    return (personas.data ?? []).filter((persona) => {
      const haystack = `${persona.name} ${persona.description} ${(persona.tags ?? []).join(" ")}`.toLowerCase();
      const matchesQuery = !query || haystack.includes(query);
      const matchesTags =
        selectedPersonaTags.length === 0 || selectedPersonaTags.every((tag) => (persona.tags ?? []).includes(tag));
      return matchesQuery && matchesTags;
    });
  }, [personaSearch, personas.data, selectedPersonaTags]);

  const effectiveFormatId =
    effectiveRecipe?.format_id ?? formatId ?? solutionReview ?? formats.data?.[0]?.id ?? null;
  const effectiveFormat = formats.data?.find((item) => item.id === effectiveFormatId);
  const formatPhaseSteps: PhaseStep[] = useMemo(() => {
    if (!effectiveFormat) return [];
    return effectiveFormat.phase_sequence.map((slot, index) => {
      const phase = phases.data?.find((item) => item.id === slot.phase_template_id);
      return {
        id: `${effectiveFormat.id}-${slot.phase_template_id}-${index}`,
        label: phase?.name ?? slot.phase_template_id,
        status: "upcoming" as const
      };
    });
  }, [effectiveFormat, phases.data]);

  const stepStatus = (key: AnchorKey): "done" | "current" | "upcoming" => {
    switch (key) {
      case "scenario":
        return "done";
      case "basics":
        return title.trim() ? "done" : "current";
      case "format":
        return effectiveRecipeId || formatId ? "done" : title.trim() ? "current" : "upcoming";
      case "personas":
        return effectivePersonaIds.length > 0 ? "done" : canCreate ? "current" : "upcoming";
    }
  };
  const stepperSteps: PhaseStep[] = ANCHORS.map((key) => ({
    id: key,
    label: t(`dashboard.steps.${key}`),
    status: stepStatus(key)
  }));

  const createRoom = useMutation({
    mutationFn: () => {
      if (!canCreate) throw new Error(t("dashboard.personaRequired"));
      return api.createRoom({
        title,
        background: background.trim(),
        recipe_id: effectiveRecipeId,
        format_id: effectiveRecipeId ? undefined : formatId ?? solutionReview ?? formats.data?.[0]?.id,
        persona_ids: effectivePersonaIds
      });
    },
    onSuccess: (state) => {
      void queryClient.invalidateQueries({ queryKey: ["rooms"] });
      clearDraft();
      navigate(`/rooms/${state.room.id}`);
    }
  });

  const setRecipe = (nextRecipeId: string) => {
    setRecipeId(nextRecipeId);
    setPersonaTouched(false);
    setSelectedPersonaIds([]);
  };

  const applyScenario = (scenario: Scenario) => {
    setTitle(scenario.title);
    setBackground(scenario.prompt);
    if (scenario.recipe_id) {
      setRecipeId(scenario.recipe_id);
      setFormatId(undefined);
    } else if (scenario.format_id) {
      setRecipeId(NO_RECIPE);
      setFormatId(scenario.format_id);
    }
    setPersonaTouched(false);
    setSelectedPersonaIds([]);
    scrollTo("basics");
  };

  const togglePersona = (personaId: string, checked: boolean) => {
    const base = personaTouched ? selectedPersonaIds : effectivePersonaIds;
    const next = checked ? Array.from(new Set([...base, personaId])) : base.filter((id) => id !== personaId);
    setPersonaTouched(true);
    setSelectedPersonaIds(next);
  };

  const togglePersonaTag = (tag: string) => {
    setSelectedPersonaTags((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]
    );
  };

  const clearPersonaFilters = () => {
    setPersonaSearch("");
    setSelectedPersonaTags([]);
  };

  const scrollTo = (key: AnchorKey) => {
    anchorRefs.current[key]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const persistDraftFlash = () => {
    saveDraft({ title, background, recipeId, formatId, selectedPersonaIds, personaTouched });
    setDraftFlash(t("dashboard.draftSaved"));
    window.setTimeout(() => setDraftFlash(null), 1800);
  };

  const discardDraft = () => {
    clearDraft();
    setTitle(t("dashboard.defaultTitle"));
    setBackground("");
    setRecipeId(DEFAULT_RECIPE);
    setFormatId(undefined);
    setSelectedPersonaIds([]);
    setPersonaTouched(false);
  };

  const personaById = useMemo(
    () => new Map((personas.data ?? []).map((persona) => [persona.id, persona])),
    [personas.data]
  );

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (canCreate && !createRoom.isPending) createRoom.mutate();
      }}
    >
      <header className="panel flex flex-wrap items-center gap-3 px-5 py-4">
        <Link to="/dashboard" className="btn h-9 px-2" title={t("common.back")}>
          <ArrowLeft size={14} />
          {t("common.back")}
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">{t("dashboard.newRoom")}</h1>
          <p className="mt-0.5 text-xs text-muted">{t("dashboard.newRoomSubtitle")}</p>
        </div>
        {draftFlash && (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <CheckCircle2 size={14} />
            {draftFlash}
          </span>
        )}
        <button type="button" className="btn h-9 px-3" onClick={persistDraftFlash} title={t("dashboard.draft")}>
          <Save size={14} />
          {t("dashboard.draft")}
        </button>
        <button type="button" className="btn h-9 px-3" onClick={discardDraft} title={t("dashboard.draftClear")}>
          <Trash2 size={14} />
          {t("dashboard.draftClear")}
        </button>
        <button
          type="submit"
          className="btn btn-primary h-9 rounded-md px-5"
          disabled={createRoom.isPending || !canCreate}
        >
          <Plus size={14} />
          {createRoom.isPending ? t("common.loading") : t("dashboard.createRoom")}
        </button>
      </header>

      <div className="panel px-5 py-3">
        <PhaseStepper
          steps={stepperSteps}
          size="sm"
          onSelect={(step) => scrollTo(step.id as AnchorKey)}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <SectionCard
            title={t("dashboard.steps.scenario")}
            icon={<Sparkles size={14} />}
            tone="brand"
          >
            <div ref={(node) => (anchorRefs.current.scenario = node)} />
            {(scenarios.data?.length ?? 0) === 0 ? (
              <div className="text-sm text-muted">{t("dashboard.scenarioEmpty")}</div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {(scenarios.data ?? []).map((scenario) => (
                  <button
                    key={scenario.id}
                    type="button"
                    className="group rounded-md border border-border bg-panel p-3 text-left transition hover:border-brand hover:bg-brand/5"
                    onClick={() => applyScenario(scenario)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="block font-medium text-text">{scenario.title}</span>
                      {scenario.recipe_id ? (
                        <StatusPill tone="brand">{t("dashboard.scenarioRecipe")}</StatusPill>
                      ) : scenario.format_id ? (
                        <StatusPill tone="info">{t("dashboard.scenarioFormat")}</StatusPill>
                      ) : null}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted">{scenario.description}</p>
                    {(scenario.tags ?? []).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {scenario.tags.slice(0, 4).map((tag) => (
                          <span key={tag} className="rounded bg-surface px-1.5 py-0.5 text-xs text-muted">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title={t("dashboard.steps.basics")} icon={<FileText size={14} />}>
            <div ref={(node) => (anchorRefs.current.basics = node)} />
            <label className="block">
              <span className="label">{t("dashboard.roomTitle")}</span>
              <input
                name="room-title"
                className="input mt-1 w-full"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className="mt-3 block">
              <span className="label">{t("dashboard.background")}</span>
              <textarea
                name="room-background"
                className="textarea mt-1 h-32 w-full"
                value={background}
                onChange={(event) => setBackground(event.target.value)}
                placeholder={t("dashboard.backgroundPlaceholder")}
              />
              <p className="mt-1 text-xs text-muted">{t("dashboard.backgroundHelp")}</p>
            </label>
          </SectionCard>

          <SectionCard
            title={t("dashboard.steps.format")}
            icon={<Workflow size={14} />}
            tone="info"
          >
            <div ref={(node) => (anchorRefs.current.format = node)} />
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="label">{t("dashboard.recipe")}</span>
                <select
                  name="room-recipe"
                  className="input mt-1 w-full"
                  value={recipeId}
                  onChange={(event) => setRecipe(event.target.value)}
                >
                  <option value={DEFAULT_RECIPE}>{t("dashboard.defaultRecipe")}</option>
                  <option value={NO_RECIPE}>{t("dashboard.noRecipe")}</option>
                  {(recipes.data ?? []).map((recipe: Recipe) => (
                    <option key={recipe.id} value={recipe.id}>
                      {recipe.name}
                    </option>
                  ))}
                </select>
                {effectiveRecipeId && recipePersonaIds.length === 0 && (
                  <p className="mt-1 text-xs text-muted">{t("dashboard.recipePersonaHint")}</p>
                )}
              </label>
              <label className="block">
                <span className="label">{t("dashboard.format")}</span>
                <select
                  name="room-format"
                  className="input mt-1 w-full"
                  value={formatId ?? effectiveRecipe?.format_id ?? solutionReview ?? ""}
                  disabled={Boolean(effectiveRecipeId)}
                  onChange={(event) => setFormatId(event.target.value)}
                >
                  {(formats.data ?? []).map((format: DebateFormat) => (
                    <option key={format.id} value={format.id}>
                      {format.name}
                    </option>
                  ))}
                </select>
                {effectiveRecipeId && (
                  <p className="mt-1 text-xs text-muted">{t("dashboard.formatLockedByRecipe")}</p>
                )}
              </label>
            </div>
            {formatPhaseSteps.length > 0 && (
              <div className="mt-4 rounded-md border border-border bg-surface px-3 py-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted">
                  <Layers size={14} />
                  {t("dashboard.preview.phases")}
                </div>
                <PhaseStepper steps={formatPhaseSteps} size="sm" />
              </div>
            )}
          </SectionCard>

          <SectionCard
            title={t("dashboard.steps.personas")}
            icon={<Users size={14} />}
            tone="brand"
            actions={
              (personaSearch || selectedPersonaTags.length > 0) ? (
                <button className="btn h-7 px-2 text-xs" type="button" onClick={clearPersonaFilters}>
                  <X size={12} />
                  {t("dashboard.clearPersonaFilters")}
                </button>
              ) : undefined
            }
          >
            <div ref={(node) => (anchorRefs.current.personas = node)} />
            <div className="flex flex-wrap items-end gap-3">
              <label className="block min-w-[16rem] flex-1">
                <span className="label">{t("dashboard.personaSearch")}</span>
                <span className="relative mt-1 block">
                  <Search className="pointer-events-none absolute left-3 top-2.5 text-muted" size={14} />
                  <input
                    name="persona-search"
                    className="input w-full pl-9"
                    value={personaSearch}
                    onChange={(event) => setPersonaSearch(event.target.value)}
                    placeholder={t("dashboard.personaSearchPlaceholder")}
                  />
                </span>
              </label>
              <div className="text-xs text-muted">
                {t("dashboard.selectedPersonas", { count: effectivePersonaIds.length })}
              </div>
            </div>
            {allPersonaTags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {allPersonaTags.map((tag) => (
                  <button
                    key={tag}
                    className={`rounded-md border px-2.5 py-1 text-xs ${
                      selectedPersonaTags.includes(tag)
                        ? "border-brand bg-brand/10 text-brand"
                        : "border-border text-muted hover:bg-surface"
                    }`}
                    type="button"
                    onClick={() => togglePersonaTag(tag)}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-4">
              {(personas.data?.length ?? 0) === 0 ? (
                <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted">
                  <div>{t("dashboard.noEditablePersonas")}</div>
                  <Link className="mt-2 inline-flex text-brand underline" to="/templates/personas">
                    {t("dashboard.addPersonaTemplates")}
                  </Link>
                </div>
              ) : filteredPersonas.length === 0 ? (
                <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted">
                  {t("dashboard.noPersonaMatches")}
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {filteredPersonas.map((persona: PersonaTemplate) => {
                    const checked = effectivePersonaIds.includes(persona.id);
                    return (
                      <label
                        key={persona.id}
                        className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition ${
                          checked ? "border-brand bg-brand/5 shadow-card" : "border-border hover:border-brand/50 hover:bg-surface"
                        }`}
                      >
                        <input
                          name={`room-persona-${persona.id}`}
                          type="checkbox"
                          className="mt-1"
                          checked={checked}
                          onChange={(event) => togglePersona(persona.id, event.target.checked)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="font-medium">{persona.name}</span>
                            {persona.identity && (
                              <span className="text-xs text-muted">· {persona.identity}</span>
                            )}
                            {checked && <CheckCircle2 size={14} className="text-brand" />}
                          </span>
                          <span className="mt-1 line-clamp-2 block text-xs text-muted">{persona.description}</span>
                          {(persona.tags ?? []).length > 0 && (
                            <span className="mt-2 flex flex-wrap gap-1">
                              {persona.tags.map((tag) => (
                                <span key={tag} className="rounded bg-surface px-1.5 py-0.5 text-xs text-muted">
                                  {tag}
                                </span>
                              ))}
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </SectionCard>
        </div>

        <aside className="xl:sticky xl:top-4 xl:self-start">
          <SectionCard title={t("dashboard.preview.title")} icon={<CheckCircle2 size={14} />} tone="info">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="label">{t("dashboard.preview.recipe")}</dt>
                <dd className="mt-1 text-text">
                  {effectiveRecipe?.name ?? t("dashboard.preview.recipeNone")}
                </dd>
              </div>
              <div>
                <dt className="label">{t("dashboard.preview.format")}</dt>
                <dd className="mt-1 text-text">
                  {effectiveFormat?.name ?? t("common.unset")}
                </dd>
              </div>
              <div>
                <dt className="label">{t("dashboard.preview.phases")}</dt>
                <dd className="mt-1">
                  {formatPhaseSteps.length > 0 ? (
                    <PhaseStepper steps={formatPhaseSteps} size="sm" />
                  ) : (
                    <span className="text-xs text-muted">{t("common.unset")}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="label">{t("dashboard.preview.personas")}</dt>
                <dd className="mt-1">
                  {effectivePersonaIds.length === 0 ? (
                    <span className="text-xs text-muted">{t("dashboard.preview.personasEmpty")}</span>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {effectivePersonaIds.slice(0, 12).map((id) => {
                        const persona = personaById.get(id);
                        const initial = (persona?.name ?? "?").trim().slice(0, 2);
                        return (
                          <span
                            key={id}
                            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-xs"
                            title={persona ? `${persona.name}${persona.identity ? " · " + persona.identity : ""}` : id}
                          >
                            <span
                              aria-hidden
                              className="grid h-5 w-5 place-items-center rounded-full bg-brand/15 text-xs font-semibold text-brand"
                            >
                              {initial}
                            </span>
                            <span className="max-w-[8rem] truncate">
                              {persona?.name ?? id}
                              {persona?.identity && (
                                <span className="ml-1 text-muted">· {persona.identity}</span>
                              )}
                            </span>
                          </span>
                        );
                      })}
                      {effectivePersonaIds.length > 12 && (
                        <span className="text-xs text-muted">
                          +{effectivePersonaIds.length - 12}
                        </span>
                      )}
                    </div>
                  )}
                </dd>
              </div>
            </dl>
            <div className="mt-4 rounded-md border border-border bg-surface p-3 text-xs text-muted">
              {!canCreate
                ? title.trim()
                  ? t("dashboard.personaRequired")
                  : t("dashboard.titleRequired")
                : t("dashboard.createRoomReady")}
              {createRoom.error instanceof Error && (
                <span className="mt-2 block text-danger">{createRoom.error.message}</span>
              )}
            </div>
            <button
              type="submit"
              className="btn btn-primary mt-4 w-full justify-center rounded-md px-5"
              disabled={createRoom.isPending || !canCreate}
            >
              <Plus size={14} />
              {createRoom.isPending ? t("common.loading") : t("dashboard.createRoom")}
            </button>
          </SectionCard>
        </aside>
      </div>
    </form>
  );
}

function loadDraft(): Draft {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return blankDraft();
    const parsed = JSON.parse(raw) as Partial<Draft>;
    return {
      title: typeof parsed.title === "string" ? parsed.title : "",
      background: typeof parsed.background === "string" ? parsed.background : "",
      recipeId: typeof parsed.recipeId === "string" ? parsed.recipeId : DEFAULT_RECIPE,
      formatId: typeof parsed.formatId === "string" ? parsed.formatId : undefined,
      selectedPersonaIds: Array.isArray(parsed.selectedPersonaIds) ? parsed.selectedPersonaIds : [],
      personaTouched: Boolean(parsed.personaTouched)
    };
  } catch {
    return blankDraft();
  }
}

function blankDraft(): Draft {
  return {
    title: "",
    background: "",
    recipeId: DEFAULT_RECIPE,
    formatId: undefined,
    selectedPersonaIds: [],
    personaTouched: false
  };
}

function saveDraft(draft: Draft) {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* ignore quota / private mode */
  }
}

function clearDraft() {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}
