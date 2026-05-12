import * as Dialog from "@radix-ui/react-dialog";
import { CheckCircle2, CircleDot, X, XCircle } from "lucide-react";
import { useI18n } from "../../i18n";
import type { SceneSealResult, SceneMemoryScribeResult } from "../../types";

export function SealResultsDialog({
  result,
  onClose
}: {
  result: SceneSealResult | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const results = result?.scribe_results ?? [];
  return (
    <Dialog.Root open={Boolean(result)} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[78vh] w-[92vw] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-panel shadow-soft">
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold text-text">
                {t("sealResults.title")}
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-muted">
                {t("sealResults.description")}
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
          <div className="mai-scrollbar min-h-0 flex-1 overflow-auto p-4">
            {results.length === 0 ? (
              <div className="rounded-md bg-surface px-3 py-2 text-sm text-muted">
                {t("sealResults.empty")}
              </div>
            ) : (
              <ul className="space-y-2">
                {results.map((item) => (
                  <SealResultRow key={item.character_id} item={item} />
                ))}
              </ul>
            )}
          </div>
          <div className="flex justify-end border-t border-border px-4 py-3">
            <Dialog.Close asChild>
              <button type="button" className="btn">
                {t("common.close")}
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SealResultRow({ item }: { item: SceneMemoryScribeResult }) {
  const { t } = useI18n();
  const tone =
    item.status === "success"
      ? "text-success"
      : item.status === "failed"
        ? "text-danger"
        : "text-muted";
  const Icon =
    item.status === "success"
      ? CheckCircle2
      : item.status === "failed"
        ? XCircle
        : CircleDot;
  return (
    <li className="rounded-md border border-border px-3 py-2 text-sm">
      <div className="flex items-start gap-2">
        <Icon size={16} className={`mt-0.5 shrink-0 ${tone}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-text">{item.character_name || item.character_id}</span>
            <span className={`text-xs uppercase tracking-wide ${tone}`}>
              {t(`sealResults.status.${item.status}`)}
            </span>
          </div>
          <div className="mt-1 text-xs text-muted">
            {t("sealResults.counts", {
              episodes: item.episodes_count,
              vows: item.vows_count,
              impressions: item.impressions_count
            })}
          </div>
          {item.error && (
            <div className="mt-1 break-words rounded bg-surface px-2 py-1 text-xs text-muted">
              {item.error}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
