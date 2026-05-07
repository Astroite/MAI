import { Play, Plus } from "lucide-react";
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
    <div className="border-b border-accent bg-accent/10 px-4 py-3">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 max-md:flex-col max-md:items-stretch">
        <div>
          <div className="text-sm font-semibold text-accent">{t("phaseExit.title")}</div>
          <div className="mt-0.5 text-xs text-muted">{label || "phase exit suggested"}</div>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-primary" disabled={disabled} onClick={onNext}>
            <Play size={16} />
            {t("phaseExit.next")}
          </button>
          <button className="btn" disabled={disabled} onClick={onExtend} title={t("phaseExit.extendTitle")}>
            <Plus size={16} />
            {t("phaseExit.extend")}
          </button>
          <button className="btn" disabled={disabled} onClick={onContinue} title={t("phaseExit.continueTitle")}>
            {t("phaseExit.continue")}
          </button>
        </div>
      </div>
    </div>
  );
}
