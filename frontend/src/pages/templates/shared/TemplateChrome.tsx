import type { ReactNode } from "react";
import { Plus, Sparkles } from "lucide-react";
import { StatusPill } from "../../../components/StatusPill";
import { useI18n } from "../../../i18n";
export function TagFilterBar<T extends { tags?: string[] }>({
  items,
  selected,
  onChange
}: {
  items: T[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useI18n();
  const allTags = Array.from(new Set(items.flatMap((item) => item.tags ?? []))).sort();
  if (!allTags.length) return null;
  const toggle = (tag: string) =>
    onChange(selected.includes(tag) ? selected.filter((value) => value !== tag) : [...selected, tag]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted">{t("templates.filterTags")}</span>
      {allTags.map((tag) => {
        const active = selected.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
              active ? "border-brand bg-brand/10 text-brand" : "border-border text-muted hover:bg-surface"
            }`}
            onClick={() => toggle(tag)}
          >
            #{tag}
          </button>
        );
      })}
      {selected.length > 0 && (
        <button type="button" className="text-xs text-muted underline" onClick={() => onChange([])}>
          {t("common.clear")}
        </button>
      )}
    </div>
  );
}

export type BuiltinItem = {
  id: string;
  name: string;
  identity?: string;
  description: string;
  tags?: string[];
};

export function BuiltinLibrary<T extends BuiltinItem>({
  title,
  items,
  addingId,
  isAdding,
  onAdd,
  renderMeta
}: {
  title: string;
  items: T[];
  addingId?: string;
  isAdding: boolean;
  onAdd: (item: T) => void;
  renderMeta?: (item: T) => ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-lg border border-brand/30 bg-brand/5 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand">
          <Sparkles size={14} />
          {title}
        </h2>
        <StatusPill tone="brand">{t("templates.libraryCount", { count: items.length })}</StatusPill>
      </div>
      <div className="grid grid-cols-2 gap-2 max-lg:grid-cols-1">
        {items.map((item) => (
          <div key={item.id} className="rounded-md border border-border bg-panel p-3 shadow-card transition hover:border-brand">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-medium">
                  {item.name}
                  {item.identity && (
                    <span className="ml-1.5 text-xs font-normal text-muted">· {item.identity}</span>
                  )}
                </h3>
                <p className="mt-1 line-clamp-2 text-xs text-muted">{item.description}</p>
              </div>
              <button
                className="btn btn-primary h-8 shrink-0 px-2 text-xs"
                type="button"
                onClick={() => onAdd(item)}
                disabled={isAdding && addingId === item.id}
              >
                <Plus size={14} />
                {t("common.add")}
              </button>
            </div>
            {(renderMeta || (item.tags?.length ?? 0) > 0) && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                {renderMeta?.(item)}
                {(item.tags ?? []).slice(0, 4).map((tag) => (
                  <StatusPill key={tag}>{tag}</StatusPill>
                ))}
              </div>
            )}
          </div>
        ))}
        {items.length === 0 && <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted">{t("templates.libraryEmpty")}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ title, onAdd }: { title: string; onAdd: () => void }) {
  const { t } = useI18n();
  return (
    <div className="panel col-span-full p-6 text-sm text-muted">
      <div className="flex items-center justify-between gap-3">
        <span>{title}</span>
        <button className="btn h-8 px-2 text-xs" type="button" onClick={onAdd}>
          <Plus size={14} />
          {t("common.add")}
        </button>
      </div>
    </div>
  );
}

export function Placeholder({ title }: { title: string }) {
  const { t } = useI18n();
  return (
    <section className="panel p-6">
      <Header title={t("templates.placeholderTitle", { title })} />
      <p className="mt-3 text-sm text-muted">{t("templates.placeholderBody")}</p>
    </section>
  );
}

export function Header({
  title,
  subtitle,
  actionLabel,
  onAction,
  metrics
}: {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  metrics?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-normal">{title}</h1>
        <p className="mt-1 text-sm text-muted">{subtitle ?? t("templates.headerHelp")}</p>
        {metrics && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">{metrics}</div>}
      </div>
      {onAction && (
        <button className="btn btn-primary rounded-md px-4" type="button" onClick={onAction}>
          <Plus size={16} />
          {actionLabel ?? t("common.add")}
        </button>
      )}
    </div>
  );
}
