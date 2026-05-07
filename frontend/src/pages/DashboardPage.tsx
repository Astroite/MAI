import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Plus, RefreshCw, Search, Users, X } from "lucide-react";
import { api } from "../api";
import type { DebateFormat, PersonaTemplate, Recipe } from "../types";
import { StatusPill } from "../components/StatusPill";
import { useI18n } from "../i18n";

const DEFAULT_RECIPE = "__default__";
const NO_RECIPE = "__none__";

export function DashboardPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { t, display } = useI18n();
  const rooms = useQuery({ queryKey: ["rooms"], queryFn: api.rooms });
  const formats = useQuery({ queryKey: ["formats"], queryFn: () => api.formats() });
  const recipes = useQuery({ queryKey: ["recipes"], queryFn: () => api.recipes() });
  const personas = useQuery({
    queryKey: ["persona-templates", "discussant", "editable"],
    queryFn: () => api.personaTemplates("discussant", false)
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState(() => t("dashboard.defaultTitle"));
  const [recipeId, setRecipeId] = useState(DEFAULT_RECIPE);
  const [formatId, setFormatId] = useState<string | undefined>(undefined);
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<string[]>([]);
  const [personaTouched, setPersonaTouched] = useState(false);
  const [personaSearch, setPersonaSearch] = useState("");
  const [selectedPersonaTags, setSelectedPersonaTags] = useState<string[]>([]);

  const solutionReview = formats.data?.find((item) => item.name === "方案评审")?.id;
  const defaultRecipe = recipes.data?.find((item) => item.name === "方案评审默认配方")?.id;
  const effectiveRecipeId = recipeId === NO_RECIPE ? undefined : recipeId === DEFAULT_RECIPE ? defaultRecipe : recipeId;
  const effectiveRecipe = recipes.data?.find((item) => item.id === effectiveRecipeId);

  const editablePersonaIds = useMemo(() => new Set((personas.data ?? []).map((persona) => persona.id)), [personas.data]);
  const recipePersonaIds = useMemo(
    () => (effectiveRecipe?.persona_ids ?? []).filter((id) => editablePersonaIds.has(id)),
    [effectiveRecipe?.persona_ids, editablePersonaIds]
  );
  const effectivePersonaIds = personaTouched ? selectedPersonaIds : recipePersonaIds;
  const canCreate = Boolean(title.trim()) && effectivePersonaIds.length > 0;

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
      const matchesTags = selectedPersonaTags.length === 0 || selectedPersonaTags.every((tag) => (persona.tags ?? []).includes(tag));
      return matchesQuery && matchesTags;
    });
  }, [personaSearch, personas.data, selectedPersonaTags]);

  const createRoom = useMutation({
    mutationFn: () => {
      if (!canCreate) throw new Error(t("dashboard.personaRequired"));
      return api.createRoom({
        title,
        recipe_id: effectiveRecipeId,
        format_id: effectiveRecipeId ? undefined : formatId ?? solutionReview ?? formats.data?.[0]?.id,
        persona_ids: effectivePersonaIds
      });
    },
    onSuccess: (state) => {
      void queryClient.invalidateQueries({ queryKey: ["rooms"] });
      setDialogOpen(false);
      navigate(`/rooms/${state.room.id}`);
    }
  });

  const setRecipe = (nextRecipeId: string) => {
    setRecipeId(nextRecipeId);
    setPersonaTouched(false);
    setSelectedPersonaIds([]);
  };

  const togglePersona = (personaId: string, checked: boolean) => {
    const base = personaTouched ? selectedPersonaIds : effectivePersonaIds;
    const next = checked ? Array.from(new Set([...base, personaId])) : base.filter((id) => id !== personaId);
    setPersonaTouched(true);
    setSelectedPersonaIds(next);
  };

  const togglePersonaTag = (tag: string) => {
    setSelectedPersonaTags((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]));
  };

  const clearPersonaFilters = () => {
    setPersonaSearch("");
    setSelectedPersonaTags([]);
  };

  return (
    <div className="space-y-4">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{t("dashboard.title")}</h1>
            <p className="mt-1 text-sm text-muted">{t("dashboard.subtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn" onClick={() => void rooms.refetch()}>
              <RefreshCw size={16} />
              {t("common.refresh")}
            </button>
            <button className="btn btn-primary" onClick={() => setDialogOpen(true)}>
              <Plus size={16} />
              {t("dashboard.newRoom")}
            </button>
          </div>
        </div>
        <div className="panel divide-y divide-border">
          {(rooms.data ?? []).map((room) => (
            <Link key={room.id} to={`/rooms/${room.id}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-surface">
              <div>
                <div className="font-medium">{room.title}</div>
                <div className="mt-1 text-xs text-muted">{new Date(room.created_at).toLocaleString()}</div>
              </div>
              <StatusPill tone={room.status === "frozen" ? "danger" : "brand"}>
                {display("roomStatus", room.status)}
              </StatusPill>
            </Link>
          ))}
          {!rooms.data?.length && <div className="px-4 py-10 text-center text-sm text-muted">{t("dashboard.emptyRooms")}</div>}
        </div>
      </section>

      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form
            className="flex max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-soft"
            onSubmit={(event) => {
              event.preventDefault();
              if (canCreate && !createRoom.isPending) createRoom.mutate();
            }}
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">{t("dashboard.newRoom")}</h2>
                <p className="mt-1 text-sm text-muted">{t("dashboard.newRoomSubtitle")}</p>
              </div>
              <button className="btn h-9 w-9 px-0" type="button" onClick={() => setDialogOpen(false)} title={t("common.close")}>
                <X size={16} />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] gap-0 overflow-hidden max-lg:grid-cols-1">
              <div className="space-y-4 overflow-auto border-r border-border p-5 max-lg:border-b max-lg:border-r-0">
                <label className="block">
                  <span className="label">{t("dashboard.roomTitle")}</span>
                  <input name="room-title" className="input mt-1 w-full" value={title} onChange={(event) => setTitle(event.target.value)} />
                </label>
                <label className="block">
                  <span className="label">{t("dashboard.recipe")}</span>
                  <select name="room-recipe" className="input mt-1 w-full" value={recipeId} onChange={(event) => setRecipe(event.target.value)}>
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
                </label>
                <div className="rounded-md border border-border bg-surface p-3 text-sm">
                  <div className="flex items-center gap-2 font-medium">
                    <Users size={16} />
                    {t("dashboard.selectedPersonas", { count: effectivePersonaIds.length })}
                  </div>
                  <p className="mt-1 text-xs text-muted">{t("dashboard.personaSelectionHelp")}</p>
                </div>
              </div>

              <div className="flex min-h-0 flex-col overflow-hidden">
                <div className="border-b border-border p-5">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <label className="block min-w-[16rem] flex-1">
                      <span className="label">{t("dashboard.personaSearch")}</span>
                      <span className="relative mt-1 block">
                        <Search className="pointer-events-none absolute left-3 top-2.5 text-muted" size={15} />
                        <input
                          name="persona-search"
                          className="input w-full pl-9"
                          value={personaSearch}
                          onChange={(event) => setPersonaSearch(event.target.value)}
                          placeholder={t("dashboard.personaSearchPlaceholder")}
                        />
                      </span>
                    </label>
                    {(personaSearch || selectedPersonaTags.length > 0) && (
                      <button className="btn" type="button" onClick={clearPersonaFilters}>
                        {t("dashboard.clearPersonaFilters")}
                      </button>
                    )}
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
                </div>

                <div className="min-h-0 flex-1 overflow-auto p-5">
                  {(personas.data?.length ?? 0) === 0 ? (
                    <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted">
                      <div>{t("dashboard.noEditablePersonas")}</div>
                      <Link className="mt-2 inline-flex text-brand underline" to="/templates/personas" onClick={() => setDialogOpen(false)}>
                        {t("dashboard.addPersonaTemplates")}
                      </Link>
                    </div>
                  ) : filteredPersonas.length === 0 ? (
                    <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted">{t("dashboard.noPersonaMatches")}</div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 max-xl:grid-cols-1">
                      {filteredPersonas.map((persona: PersonaTemplate) => {
                        const checked = effectivePersonaIds.includes(persona.id);
                        return (
                          <label
                            key={persona.id}
                            className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm ${
                              checked ? "border-brand bg-brand/10" : "border-border hover:bg-surface"
                            }`}
                          >
                            <input
                              name={`room-persona-${persona.id}`}
                              type="checkbox"
                              className="mt-1"
                              checked={checked}
                              onChange={(event) => togglePersona(persona.id, event.target.checked)}
                            />
                            <span>
                              <span className="font-medium">{persona.name}</span>
                              <span className="mt-1 line-clamp-2 block text-xs text-muted">{persona.description}</span>
                              {(persona.tags ?? []).length > 0 && (
                                <span className="mt-2 flex flex-wrap gap-1">
                                  {persona.tags.map((tag) => (
                                    <span key={tag} className="rounded bg-surface px-1.5 py-0.5 text-[11px] text-muted">
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
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4">
              <div className="text-sm text-muted">
                {!canCreate && title.trim() ? t("dashboard.personaRequired") : t("dashboard.createRoomReady")}
                {createRoom.error instanceof Error && <span className="ml-2 text-danger">{createRoom.error.message}</span>}
              </div>
              <div className="flex items-center gap-2">
                <button className="btn" type="button" onClick={() => setDialogOpen(false)}>
                  {t("common.cancel")}
                </button>
                <button className="btn btn-primary" type="submit" disabled={createRoom.isPending || !canCreate}>
                  <Plus size={16} />
                  {createRoom.isPending ? t("common.loading") : t("dashboard.createRoom")}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
