import { useMemo, useState, type MouseEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Pencil, Plus, Save, ScrollText, Trash2 } from "lucide-react";
import { api } from "../../api";
import type { Recipe } from "../../types";
import { StatusPill } from "../../components/StatusPill";
import { toast } from "../../components/Toaster";
import { useConfirm } from "../../components/ConfirmDialog";
import { useI18n } from "../../i18n";
import { queryKeys } from "../../queryKeys";
import { filterByTags, parseJsonObject, splitTags } from "./shared/templateUtils";
import { BuiltinLibrary, EmptyState, Header, TagFilterBar } from "./shared/TemplateChrome";
export function RecipesTab() {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const confirm = useConfirm();
  const recipes = useQuery({ queryKey: queryKeys.recipes.editable, queryFn: () => api.recipes(false) });
  const builtinRecipes = useQuery({ queryKey: queryKeys.recipes.builtin, queryFn: () => api.recipes(true) });
  const formats = useQuery({ queryKey: queryKeys.formats.all, queryFn: () => api.formats() });
  const personas = useQuery({
    queryKey: queryKeys.personaTemplates.discussant,
    queryFn: () => api.personaTemplates("discussant")
  });
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);
  const items = filterByTags(recipes.data, selectedTags);
  const [name, setName] = useState(() => t("templates.defaultRecipeName"));
  const [description, setDescription] = useState(() => t("templates.defaultRecipeDescription"));
  const [tags, setTags] = useState("custom");
  const [formatId, setFormatId] = useState("");
  const [personaIds, setPersonaIds] = useState<string[]>([]);
  const [initialSettingsText, setInitialSettingsText] = useState(
    JSON.stringify({ max_message_tokens: 900, max_room_tokens: 120000, auto_transition: false }, null, 2)
  );
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null);
  const settingsValue = parseJsonObject(initialSettingsText);
  const formatById = useMemo(() => new Map((formats.data ?? []).map((format) => [format.id, format])), [formats.data]);
  const personaById = useMemo(() => new Map((personas.data ?? []).map((persona) => [persona.id, persona])), [personas.data]);
  const recipePayload = () => {
    const selectedFormatId = formatId || formats.data?.[0]?.id || null;
    return {
      name,
      description,
      persona_ids: personaIds,
      format_id: selectedFormatId,
      format_version: selectedFormatId ? (formatById.get(selectedFormatId)?.version ?? 1) : null,
      initial_settings: settingsValue.value,
      tags: splitTags(tags)
    };
  };
  const loadRecipe = (recipe: Recipe) => {
    setEditingRecipeId(recipe.id);
    setName(recipe.name);
    setDescription(recipe.description);
    setTags(recipe.tags.join(","));
    setFormatId(recipe.format_id ?? "");
    setPersonaIds(recipe.persona_ids);
    setInitialSettingsText(JSON.stringify(recipe.initial_settings ?? {}, null, 2));
  };
  const resetRecipeForm = () => {
    setEditingRecipeId(null);
    setName(t("templates.defaultRecipeName"));
    setDescription(t("templates.defaultRecipeDescription"));
    setTags("custom");
    setFormatId("");
    setPersonaIds([]);
    setInitialSettingsText(JSON.stringify({ max_message_tokens: 900, max_room_tokens: 120000, auto_transition: false }, null, 2));
  };
  const save = useMutation({
    mutationFn: () => (editingRecipeId ? api.updateRecipe(editingRecipeId, recipePayload()) : api.createRecipe(recipePayload())),
    onSuccess: (saved) => {
      loadRecipe(saved);
      void queryClient.invalidateQueries({ queryKey: queryKeys.recipes.all });
    }
  });
  const addFromBuiltin = useMutation({
    mutationFn: (recipeId: string) => api.duplicateRecipe(recipeId),
    onSuccess: (copy) => {
      loadRecipe(copy);
      setShowLibrary(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.recipes.all });
    }
  });
  const remove = useMutation({
    mutationFn: (recipeId: string) => api.deleteRecipe(recipeId),
    onSuccess: () => {
      resetRecipeForm();
      void queryClient.invalidateQueries({ queryKey: queryKeys.recipes.all });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("api.deleteFailed"))
  });
  const deleteRecipe = async (recipe: Recipe, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (await confirm({
      title: t("templates.deleteRecipeConfirm", { name: recipe.name }),
      danger: true,
      confirmLabel: t("common.delete")
    })) {
      remove.mutate(recipe.id);
    }
  };
  return (
    <section className="grid grid-cols-[minmax(0,1fr)_360px] gap-4 max-xl:grid-cols-1">
      <div className="space-y-3">
        <Header
          title={t("templates.recipes")}
          subtitle={t("templates.recipeHelp")}
          actionLabel={t("templates.fromBuiltin")}
          onAction={() => setShowLibrary((value) => !value)}
          metrics={<StatusPill tone="info">{t("templates.recipeCount", { count: items.length })}</StatusPill>}
        />
        {showLibrary && (
          <BuiltinLibrary
            title={t("templates.recipeBuiltin")}
            items={builtinRecipes.data ?? []}
            addingId={addFromBuiltin.variables}
            isAdding={addFromBuiltin.isPending}
            onAdd={(recipe) => addFromBuiltin.mutate(recipe.id)}
            renderMeta={(recipe) => <StatusPill tone="brand">{t("common.personaCount", { count: recipe.persona_ids.length })}</StatusPill>}
          />
        )}
        <TagFilterBar items={recipes.data ?? []} selected={selectedTags} onChange={setSelectedTags} />
        <div className="space-y-3">
          {items.map((recipe: Recipe) => {
            const active = editingRecipeId === recipe.id;
            const personaSample = recipe.persona_ids
              .map((id) => personaById.get(id))
              .filter(Boolean)
              .slice(0, 5);
            return (
              <div
                key={recipe.id}
                className={`group relative cursor-pointer overflow-hidden rounded-lg border bg-panel p-4 shadow-card transition hover:border-brand ${
                  active ? "border-brand ring-1 ring-brand" : "border-border"
                }`}
                role="button"
                tabIndex={0}
                onClick={() => loadRecipe(recipe)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    loadRecipe(recipe);
                  }
                }}
              >
                <span
                  aria-hidden
                  className={`absolute left-0 top-3 h-8 w-1 rounded-r-full ${active ? "bg-brand" : "bg-accent/50"}`}
                />
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-accent/10 text-accent">
                      <ScrollText size={16} />
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold">{recipe.name}</h2>
                      <p className="mt-1 line-clamp-2 text-xs text-muted">{recipe.description}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      className="btn h-9 w-9 px-0"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        loadRecipe(recipe);
                      }}
                      title={t("common.edit")}
                      aria-label={t("common.edit")}
                    >
                      <Pencil size={16} />
                    </button>
                    <a
                      className="btn h-9 w-9 px-0"
                      href={`/api/templates/recipes/${recipe.id}/export`}
                      onClick={(event) => event.stopPropagation()}
                      title={t("common.export")}
                      aria-label={t("common.export")}
                    >
                      <Download size={16} />
                    </a>
                    <button
                      className="btn btn-danger h-9 w-9 px-0"
                      type="button"
                      onClick={(event) => deleteRecipe(recipe, event)}
                      disabled={remove.isPending && remove.variables === recipe.id}
                      title={t("common.delete")}
                      aria-label={t("common.delete")}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <StatusPill tone="brand">{t("common.personaCount", { count: recipe.persona_ids.length })}</StatusPill>
                  {recipe.format_id && (
                    <StatusPill tone="info">
                      {formatById.get(recipe.format_id)?.name ?? t("templates.formatFallback")}
                    </StatusPill>
                  )}
                  {recipe.tags.slice(0, 4).map((tag) => (
                    <span key={tag} className="rounded-md bg-surface px-1.5 py-0.5 text-xs text-muted">
                      #{tag}
                    </span>
                  ))}
                </div>
                {personaSample.length > 0 && (
                  <div className="mt-3 flex items-center gap-1.5">
                    {personaSample.map((persona) => (
                      <span
                        key={persona!.id}
                        className="grid h-7 w-7 place-items-center rounded-full bg-brand/10 text-xs font-semibold text-brand"
                        title={persona!.name}
                      >
                        {persona!.name.trim().slice(0, 2) || "?"}
                      </span>
                    ))}
                    {recipe.persona_ids.length > personaSample.length && (
                      <span className="text-xs text-muted">+{recipe.persona_ids.length - personaSample.length}</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {items.length === 0 && <EmptyState title={t("templates.emptyEditableRecipe")} onAdd={() => setShowLibrary(true)} />}
        </div>
      </div>
      <aside className="panel p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">{editingRecipeId ? t("templates.editRecipe") : t("templates.blankRecipe")}</h2>
          {editingRecipeId && (
            <button className="btn h-8 px-2 text-xs" type="button" onClick={resetRecipeForm}>
              <Plus size={14} />
              {t("templates.blankRecipe")}
            </button>
          )}
        </div>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="label">{t("common.name")}</span>
            <input name="recipe-name" className="input mt-1 w-full" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="block">
            <span className="label">{t("common.description")}</span>
            <textarea name="recipe-description" className="textarea mt-1 w-full" value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <label className="block">
            <span className="label">{t("dashboard.format")}</span>
            <select name="recipe-format" className="input mt-1 w-full" value={formatId} onChange={(event) => setFormatId(event.target.value)}>
              <option value="">{t("templates.defaultFirstFormat")}</option>
              {(formats.data ?? []).map((format) => (
                <option key={format.id} value={format.id}>
                  {format.name}
                </option>
              ))}
            </select>
          </label>
          <div>
            <div className="label">{t("templates.personaList")}</div>
            <div className="mt-2 max-h-64 space-y-2 overflow-auto">
              {(personas.data ?? []).map((persona) => (
                <label key={persona.id} className="flex items-center gap-2 rounded-md border border-border p-2 text-sm">
                  <input
                    name={`recipe-persona-${persona.id}`}
                    type="checkbox"
                    checked={personaIds.includes(persona.id)}
                    onChange={(event) =>
                      setPersonaIds(event.target.checked ? [...personaIds, persona.id] : personaIds.filter((id) => id !== persona.id))
                    }
                  />
                  {persona.name}
                </label>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="label">{t("common.tags")}</span>
            <input name="recipe-tags" className="input mt-1 w-full" value={tags} onChange={(event) => setTags(event.target.value)} />
          </label>
          <label className="block">
            <span className="label">{t("templates.initialSettings")}</span>
            <textarea name="recipe-settings-json" className="textarea mt-1 w-full font-mono" value={initialSettingsText} onChange={(event) => setInitialSettingsText(event.target.value)} />
          </label>
          {!settingsValue.ok && <div className="text-xs text-danger">{t("templates.initialSettingsInvalid")}</div>}
          <button className="btn btn-primary w-full" onClick={() => save.mutate()} disabled={!name.trim() || !settingsValue.ok || save.isPending}>
            <Save size={16} />
            {editingRecipeId ? t("common.saveChanges") : t("templates.saveRecipe")}
          </button>
        </div>
      </aside>
    </section>
  );
}

// Sentinel id for the "new provider" draft state. Lets us reuse the
// expand/collapse logic without a parallel `creating` flag.
