import { MessageSquare, Play, Plus } from "lucide-react";
import { useI18n } from "../../i18n";

export function PhaseExitBanner({
  matched,
  onNext,
  onContinue,
  onExtend,
  disabled
}: {
  matched: Array<Record<string, unknown>>;
  onNext: () => void;
  onContinue: () => void;
  onExtend: () => void;
  disabled: boolean;
}) {
  const { t, display } = useI18n();
  const label = matched.map((item) => display("exitCondition", String(item.type ?? "condition"))).join(", ");
  return (
    <div className="flex-shrink-0 border-b border-accent bg-accent/10 px-5 py-3">
      <div className="mx-auto flex max-w-4xl items-start justify-between gap-3 max-md:flex-col max-md:items-stretch">
        <div>
          <div className="text-sm font-semibold text-accent">{t("phaseExit.title")}</div>
          <div className="mt-0.5 text-xs text-muted">{label || t("phaseExit.reasonFallback")}</div>
        </div>
        <div className="grid grid-cols-3 gap-2 max-md:grid-cols-1">
          <ActionButton
            tone="primary"
            disabled={disabled}
            onClick={onNext}
            label={t("phaseExit.next")}
            hint={t("phaseExit.nextHint")}
            icon={<Play size={14} />}
          />
          <ActionButton
            tone="default"
            disabled={disabled}
            onClick={onContinue}
            label={t("phaseExit.continue")}
            hint={t("phaseExit.continueHint")}
            icon={<MessageSquare size={14} />}
          />
          <ActionButton
            tone="default"
            disabled={disabled}
            onClick={onExtend}
            label={t("phaseExit.extend")}
            hint={t("phaseExit.extendHint")}
            icon={<Plus size={14} />}
          />
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  tone,
  disabled,
  onClick,
  label,
  hint,
  icon
}: {
  tone: "primary" | "default";
  disabled: boolean;
  onClick: () => void;
  label: string;
  hint: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left text-xs transition disabled:cursor-not-allowed disabled:opacity-45 ${
        tone === "primary"
          ? "border-brand bg-brand text-white hover:bg-brand/90"
          : "border-border bg-panel hover:border-brand"
      }`}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="flex items-center gap-1.5 text-sm font-medium">
        {icon}
        {label}
      </span>
      <span className={`text-xs ${tone === "primary" ? "text-white/80" : "text-muted"}`}>{hint}</span>
    </button>
  );
}
