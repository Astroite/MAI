import type { ReactNode } from "react";

export type PillTone = "neutral" | "brand" | "info" | "success" | "warning" | "danger" | "accent";

const OUTLINE: Record<PillTone, string> = {
  neutral: "border-border text-muted bg-panel",
  brand: "border-brand/40 text-brand bg-brand/5",
  info: "border-info/40 text-info bg-info/5",
  success: "border-success/40 text-success bg-success/5",
  warning: "border-warning/50 text-warning bg-warning/5",
  danger: "border-danger/40 text-danger bg-danger/5",
  accent: "border-accent/40 text-accent bg-accent/5"
};

const SOLID: Record<PillTone, string> = {
  neutral: "border-border bg-surface text-text",
  brand: "border-brand bg-brand text-white",
  info: "border-info bg-info text-white",
  success: "border-success bg-success text-white",
  warning: "border-warning bg-warning text-white",
  danger: "border-danger bg-danger text-white",
  accent: "border-accent bg-accent text-white"
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

export function StatusPill({
  tone = "neutral",
  variant = "outline",
  dot = false,
  children
}: {
  tone?: PillTone;
  variant?: "outline" | "solid";
  dot?: boolean;
  children: ReactNode;
}) {
  const palette = variant === "solid" ? SOLID[tone] : OUTLINE[tone];
  return (
    <span className={`inline-flex min-w-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium leading-5 ${palette}`}>
      {dot && (
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${variant === "solid" ? "bg-white/85" : DOT[tone]}`}
        />
      )}
      <span className="truncate">{children}</span>
    </span>
  );
}
