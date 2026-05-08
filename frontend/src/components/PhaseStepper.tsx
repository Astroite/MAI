import { Check } from "lucide-react";

export type PhaseStep = {
  id: string;
  label: string;
  status: "done" | "current" | "upcoming";
};

export function PhaseStepper({
  steps,
  onSelect,
  size = "md"
}: {
  steps: PhaseStep[];
  onSelect?: (step: PhaseStep, index: number) => void;
  size?: "sm" | "md";
}) {
  if (steps.length === 0) return null;
  const dot = size === "sm" ? "h-5 w-5 text-[10px]" : "h-8 w-8 text-xs";
  const label = size === "sm" ? "text-[11px]" : "text-xs";
  return (
    <ol className="mai-scrollbar flex min-w-0 items-start overflow-x-auto py-1">
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        return (
          <li key={step.id} className="flex min-w-[6.5rem] flex-1 items-start">
            <button
              type="button"
              onClick={() => onSelect?.(step, index)}
              className={`group flex min-w-0 max-w-[10rem] flex-col items-center gap-1 rounded-md px-1 py-0.5 text-center transition ${
                onSelect ? "hover:bg-surface" : "cursor-default"
              }`}
              title={step.label}
              disabled={!onSelect}
            >
              <span
                className={`grid flex-shrink-0 place-items-center rounded-full font-semibold transition ${dot} ${
                  step.status === "done"
                    ? "bg-brand text-white"
                    : step.status === "current"
                      ? "border-2 border-info bg-panel text-info ring-4 ring-info/15"
                      : "border border-border bg-panel text-muted"
                }`}
                aria-hidden="true"
              >
                {step.status === "done" ? <Check size={size === "sm" ? 11 : 13} /> : index + 1}
              </span>
              <span
                className={`truncate font-medium ${label} ${
                  step.status === "current"
                    ? "text-info"
                    : step.status === "done"
                      ? "text-text"
                      : "text-muted"
                }`}
              >
                {step.label}
              </span>
            </button>
            {!isLast && (
              <span
                className={`${size === "sm" ? "mt-2.5" : "mt-4"} h-0.5 min-w-8 flex-1 rounded-full ${
                  step.status === "done" ? "bg-brand" : "bg-border"
                }`}
                aria-hidden="true"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
