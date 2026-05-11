import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Search, X } from "lucide-react";
import { PersonaIcon } from "./PersonaIcon";
import type { PersonaTemplate } from "../types";
import { useI18n } from "../i18n";

/**
 * Modal picker for PersonaTemplate. Two-column layout:
 *   left  = filterable list (search by name/identity/description/tags)
 *   right = preview pane with color/icon/identity/description/prompt/model
 *
 * Why a dialog instead of a <select>: with 25+ built-in personas (and user
 * forks on top) the native dropdown becomes a wall of text with no way to
 * scan identity or read the system prompt before committing. The detail
 * pane lets the user verify "this archetype is what I want" before binding
 * to a World character.
 *
 * Two modes:
 *   - mode="single" (default): single-pick, returns the chosen template via
 *     `onPick`. Used by the World character editor when binding a single
 *     persona template.
 *   - mode="multi": checkbox-driven multi-select. Returns the selection set
 *     via `onPickMany`. Used to bulk-add World characters from N templates
 *     in one shot.
 */
type PickerMode = "single" | "multi";

type PickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: PersonaTemplate[];
  title?: string;
  description?: string;
} & (
  | {
      mode?: "single";
      selectedId: string | null;
      onPick: (template: PersonaTemplate) => void;
      onPickMany?: undefined;
    }
  | {
      mode: "multi";
      selectedId?: undefined;
      onPick?: undefined;
      onPickMany: (templates: PersonaTemplate[]) => void;
    }
);

export function PersonaTemplatePicker(props: PickerProps) {
  const { t } = useI18n();
  const {
    open,
    onOpenChange,
    templates,
    title,
    description
  } = props;
  const dialogTitle = title ?? t("personaPicker.defaultTitle");
  const dialogDescription = description ?? t("personaPicker.defaultDescription");
  const mode: PickerMode = props.mode ?? "single";
  const selectedId: string | null = mode === "single" ? props.selectedId ?? null : null;
  // Pull the callbacks out so TS doesn't lose narrowing inside JSX handlers.
  const onPickSingle = mode === "single" ? props.onPick : undefined;
  const onPickMany = mode === "multi" ? props.onPickMany : undefined;

  const [query, setQuery] = useState("");
  const [highlightId, setHighlightId] = useState<string | null>(selectedId);
  const [multiSelected, setMultiSelected] = useState<Set<string>>(() => new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  // Reset preview when opening, and follow externally-changed selection.
  useEffect(() => {
    if (open) {
      setHighlightId(selectedId ?? templates[0]?.id ?? null);
      setQuery("");
      if (mode === "multi") setMultiSelected(new Set());
      // Slight delay so the dialog is mounted before we steal focus.
      const timer = setTimeout(() => searchRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [open, selectedId, templates, mode]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return templates;
    return templates.filter((tpl) => {
      const haystack = [
        tpl.name,
        tpl.identity,
        tpl.description,
        ...(tpl.tags ?? [])
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [query, templates]);

  // If the highlighted item filters out, snap to the first visible row so
  // the preview pane never goes blank while the user types.
  useEffect(() => {
    if (!filtered.find((tpl) => tpl.id === highlightId)) {
      setHighlightId(filtered[0]?.id ?? null);
    }
  }, [filtered, highlightId]);

  const highlighted = filtered.find((tpl) => tpl.id === highlightId) ?? null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex h-[80vh] w-[92vw] max-w-4xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-panel shadow-soft">
          <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <Dialog.Title className="text-base font-semibold text-text">{dialogTitle}</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-muted">
                {dialogDescription}
              </Dialog.Description>
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

          <div className="grid min-h-0 flex-1 grid-cols-[18rem,1fr] gap-0">
            {/* Left: search + list */}
            <div className="flex min-h-0 flex-col border-r border-border">
              <div className="border-b border-border p-2">
                <div className="relative">
                  <Search
                    size={14}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                  />
                  <input
                    ref={searchRef}
                    className="input w-full pl-9"
                    placeholder={t("personaPicker.searchPlaceholder")}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </div>
              </div>
              <ul className="mai-scrollbar min-h-0 flex-1 divide-y divide-border overflow-auto">
                {filtered.map((tpl) => {
                  const isHighlighted = tpl.id === highlightId;
                  const isSelected = tpl.id === selectedId;
                  const isChecked = mode === "multi" && multiSelected.has(tpl.id);
                  const handleRowClick = () => {
                    setHighlightId(tpl.id);
                    if (mode === "multi") {
                      const next = new Set(multiSelected);
                      if (next.has(tpl.id)) next.delete(tpl.id);
                      else next.add(tpl.id);
                      setMultiSelected(next);
                    }
                  };
                  return (
                    <li key={tpl.id}>
                      <button
                        type="button"
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left transition ${
                          isHighlighted ? "bg-brand/10" : "hover:bg-surface"
                        }`}
                        onClick={handleRowClick}
                        onDoubleClick={() => onPickSingle?.(tpl)}
                      >
                        {mode === "multi" && (
                          <span
                            className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${
                              isChecked ? "border-brand bg-brand text-white" : "border-border"
                            }`}
                            aria-hidden
                          >
                            {isChecked && <Check size={12} />}
                          </span>
                        )}
                        <PersonaIcon icon={tpl.icon} color={tpl.color} size={28} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1">
                            <span className="truncate text-sm font-medium">{tpl.name}</span>
                            {isSelected && (
                              <span className="text-xs uppercase tracking-wide text-brand">
                                {t("personaPicker.selected")}
                              </span>
                            )}
                          </div>
                          {tpl.identity && (
                            <div className="truncate text-xs text-muted">{tpl.identity}</div>
                          )}
                        </div>
                        {tpl.is_builtin && (
                          <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-xs text-muted">
                            {t("personaPicker.builtin")}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
                {filtered.length === 0 && (
                  <li className="space-y-2 px-3 py-6 text-center text-xs text-muted">
                    {templates.length === 0 ? (
                      <>
                        <div>{t("personaPicker.emptyTemplates")}</div>
                        <div>{t("personaPicker.emptyTemplatesHelp")}</div>
                      </>
                    ) : (
                      <div>{t("personaPicker.noMatches")}</div>
                    )}
                  </li>
                )}
              </ul>
            </div>

            {/* Right: detail preview */}
            <div className="mai-scrollbar min-h-0 overflow-auto p-4">
              {highlighted ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <PersonaIcon icon={highlighted.icon} color={highlighted.color} size={48} />
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-lg font-semibold">{highlighted.name}</h3>
                      {highlighted.identity && (
                        <div className="text-sm text-muted">{highlighted.identity}</div>
                      )}
                      <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                        {highlighted.tags?.map((tag) => (
                          <span key={tag} className="rounded bg-surface px-1.5 py-0.5 text-muted">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {highlighted.description && (
                    <section>
                      <div className="text-xs font-medium text-muted">{t("personaPicker.description")}</div>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm text-text">
                        {highlighted.description}
                      </p>
                    </section>
                  )}

                  {highlighted.system_prompt && (
                    <section>
                      <div className="text-xs font-medium text-muted">{t("personaPicker.systemPrompt")}</div>
                      <pre className="mai-scrollbar mt-0.5 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-border bg-surface p-2 text-xs text-text">
                        {highlighted.system_prompt}
                      </pre>
                    </section>
                  )}

                  <section className="grid grid-cols-2 gap-2 text-xs text-muted">
                    <div>
                      <div className="font-medium">{t("personaPicker.model")}</div>
                      <div className="text-text">{highlighted.backing_model || t("personaPicker.defaultModel")}</div>
                    </div>
                    <div>
                      <div className="font-medium">{t("personaPicker.temperature")}</div>
                      <div className="text-text">{highlighted.temperature.toFixed(2)}</div>
                    </div>
                  </section>
                </div>
              ) : (
                <div className="grid h-full place-items-center text-sm text-muted">
                  {t("personaPicker.previewPrompt")}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
            {mode === "multi" ? (
              <span className="text-xs text-muted">
                {t("personaPicker.selectedCount", { count: multiSelected.size })}
              </span>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Dialog.Close asChild>
                <button type="button" className="btn">
                  {t("common.cancel")}
                </button>
              </Dialog.Close>
              {mode === "multi" ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={multiSelected.size === 0}
                  onClick={() => {
                    const picked = templates.filter((tpl) => multiSelected.has(tpl.id));
                    onPickMany?.(picked);
                  }}
                >
                  {t("personaPicker.addCharacters", { count: multiSelected.size })}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!highlighted}
                  onClick={() => highlighted && onPickSingle?.(highlighted)}
                >
                  {t("personaPicker.selectTemplate")}
                </button>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
