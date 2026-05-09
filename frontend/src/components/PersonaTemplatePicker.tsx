import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Search, X } from "lucide-react";
import { PersonaIcon } from "./PersonaIcon";
import type { PersonaTemplate } from "../types";

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
  const {
    open,
    onOpenChange,
    templates,
    title = "选择 Persona 模板",
    description = "模板决定模型 + 基础人设；选定后可以再编辑角色细节。"
  } = props;
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
              <Dialog.Title className="text-base font-semibold text-text">{title}</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-muted">
                {description}
              </Dialog.Description>
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

          <div className="grid min-h-0 flex-1 grid-cols-[18rem,1fr] gap-0">
            {/* Left: search + list */}
            <div className="flex min-h-0 flex-col border-r border-border">
              <div className="border-b border-border p-2">
                <div className="relative">
                  <Search
                    size={14}
                    className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted"
                  />
                  <input
                    ref={searchRef}
                    className="input w-full pl-7"
                    placeholder="搜索名字 / 身份 / 描述 / 标签"
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
                              <span className="text-[10px] uppercase tracking-wide text-brand">
                                已选
                              </span>
                            )}
                          </div>
                          {tpl.identity && (
                            <div className="truncate text-xs text-muted">{tpl.identity}</div>
                          )}
                        </div>
                        {tpl.is_builtin && (
                          <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted">
                            内置
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
                        <div>还没有可用的人设模板。</div>
                        <div>到「模板 → 智能体」复制一个内置模板再回来选。</div>
                      </>
                    ) : (
                      <div>没有匹配的模板。</div>
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
                      <div className="mt-1 flex flex-wrap gap-1.5 text-[10px]">
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
                      <div className="text-xs font-medium text-muted">描述</div>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm text-text">
                        {highlighted.description}
                      </p>
                    </section>
                  )}

                  {highlighted.system_prompt && (
                    <section>
                      <div className="text-xs font-medium text-muted">System prompt</div>
                      <pre className="mai-scrollbar mt-0.5 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-border bg-surface p-2 text-xs text-text">
                        {highlighted.system_prompt}
                      </pre>
                    </section>
                  )}

                  <section className="grid grid-cols-2 gap-2 text-xs text-muted">
                    <div>
                      <div className="font-medium">模型</div>
                      <div className="text-text">{highlighted.backing_model || "（默认）"}</div>
                    </div>
                    <div>
                      <div className="font-medium">温度</div>
                      <div className="text-text">{highlighted.temperature.toFixed(2)}</div>
                    </div>
                  </section>
                </div>
              ) : (
                <div className="grid h-full place-items-center text-sm text-muted">
                  选择左侧任意模板查看详情
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
            {mode === "multi" ? (
              <span className="text-xs text-muted">
                已勾选 {multiSelected.size} 个
              </span>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Dialog.Close asChild>
                <button type="button" className="btn">
                  取消
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
                  添加 {multiSelected.size > 0 ? multiSelected.size : ""} 个角色
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!highlighted}
                  onClick={() => highlighted && onPickSingle?.(highlighted)}
                >
                  选中此模板
                </button>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
