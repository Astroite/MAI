import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useI18n } from "../i18n";

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...options, resolve });
      }),
    []
  );

  const settle = (value: boolean) => {
    if (!pending) return;
    pending.resolve(value);
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog.Root open={pending !== null} onOpenChange={(open) => !open && settle(false)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-panel p-5 shadow-soft">
            <Dialog.Title className="text-base font-semibold text-text">
              {pending?.title}
            </Dialog.Title>
            {pending?.description && (
              <Dialog.Description className="mt-2 text-sm text-muted">
                {pending.description}
              </Dialog.Description>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => settle(false)}>
                {pending?.cancelLabel ?? t("common.cancel")}
              </button>
              <button
                type="button"
                className={pending?.danger ? "btn btn-danger" : "btn btn-primary"}
                onClick={() => settle(true)}
                autoFocus
              >
                {pending?.confirmLabel ?? t("common.confirm")}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}
