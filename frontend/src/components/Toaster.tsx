import { Toaster as SonnerToaster } from "sonner";
import { useUIStore } from "../store";

export { toast } from "sonner";

export function Toaster() {
  const dark = useUIStore((s) => s.dark);
  return (
    <SonnerToaster
      theme={dark ? "dark" : "light"}
      richColors
      closeButton
      position="top-right"
      toastOptions={{
        classNames: {
          toast: "border border-border bg-panel text-text shadow-soft",
          description: "text-muted text-sm"
        }
      }}
    />
  );
}
