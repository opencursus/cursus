import { CheckCircle2, AlertCircle, Info, X as XIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { useToastsStore, type Toast } from "@/stores/toasts";

export function Toaster() {
  const toasts = useToastsStore((s) => s.toasts);
  const dismiss = useToastsStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 pointer-events-none"
      aria-live="polite"
      aria-atomic="true"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const Icon = toast.kind === "success" ? CheckCircle2 : toast.kind === "error" ? AlertCircle : Info;
  const accent =
    toast.kind === "success"
      ? "var(--color-success)"
      : toast.kind === "error"
        ? "var(--color-danger)"
        : "var(--accent)";

  return (
    <div
      style={{
        background: "var(--bg-raised)",
        borderColor: "var(--border-strong)",
        boxShadow: "var(--shadow-md)",
      }}
      className={cn(
        "pointer-events-auto flex items-center gap-2 rounded-lg border",
        "px-3 py-2 min-w-[260px] max-w-md fade-in",
      )}
    >
      <Icon size={15} style={{ color: accent }} className="shrink-0" />
      <span className="text-[12.5px] text-primary flex-1 min-w-0 break-words">
        {toast.message}
      </span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick();
            onDismiss();
          }}
          style={{ color: accent }}
          className="text-[12.5px] font-medium hover:underline shrink-0"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        className="flex h-6 w-6 items-center justify-center rounded-md text-muted hover:text-primary hover:bg-hover shrink-0"
        aria-label="Dismiss"
      >
        <XIcon size={13} />
      </button>
    </div>
  );
}
