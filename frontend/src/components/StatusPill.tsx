import type { ReactNode } from "react";

export function StatusPill({ tone = "neutral", children }: { tone?: "neutral" | "brand" | "accent" | "danger"; children: ReactNode }) {
  const color = {
    neutral: "border-border text-muted",
    brand: "border-brand text-brand",
    accent: "border-accent text-accent",
    danger: "border-danger text-danger"
  }[tone];
  return <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs ${color}`}>{children}</span>;
}
