import type { ReactNode } from "react";
import type { PillTone } from "./StatusPill";

const TONE_ACCENT: Record<PillTone, string> = {
  neutral: "border-border",
  brand: "border-brand/30",
  info: "border-info/30",
  success: "border-success/30",
  warning: "border-warning/40",
  danger: "border-danger/40",
  accent: "border-accent/40"
};

const DOT: Record<PillTone, string> = {
  neutral: "bg-muted",
  brand: "bg-brand",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  accent: "bg-accent"
};

export function SectionCard({
  title,
  icon,
  actions,
  tone = "neutral",
  bodyClassName,
  className,
  children
}: {
  title?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  tone?: PillTone;
  bodyClassName?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section
      className={`section overflow-hidden ${TONE_ACCENT[tone]} ${className ?? ""}`.trim()}
    >
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-border bg-panel px-3 py-2">
          <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-text">
            {tone !== "neutral" && (
              <span className={`h-2 w-2 flex-shrink-0 rounded-full ${DOT[tone]}`} aria-hidden="true" />
            )}
            {icon && <span className="flex-shrink-0 text-muted">{icon}</span>}
            <span className="truncate">{title}</span>
          </div>
          {actions && <div className="flex flex-shrink-0 items-center gap-1">{actions}</div>}
        </header>
      )}
      {children !== undefined && (
        <div className={bodyClassName ?? "px-3 py-2"}>{children}</div>
      )}
    </section>
  );
}
