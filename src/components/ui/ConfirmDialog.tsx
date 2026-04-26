import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger,
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onConfirm, onCancel]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[60] no-drag"
        style={{ background: "rgba(0,0,0,0.55)" }}
        onClick={onCancel}
      />
      <div
        role="alertdialog"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        className="fixed left-1/2 top-1/2 z-[61] w-[420px] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-xl no-drag"
        style={{
          background: "var(--bg-raised)",
          border: "1px solid var(--border-strong)",
          boxShadow: "var(--shadow-md)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-5 pt-5 pb-3">
          {danger && (
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
              style={{
                background: "rgba(229, 72, 77, 0.12)",
                color: "var(--color-danger)",
              }}
            >
              <AlertTriangle size={18} />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2
              id="confirm-title"
              className="text-[14px] font-semibold text-primary"
            >
              {title}
            </h2>
            <p
              id="confirm-body"
              className="text-[12.5px] text-secondary mt-1 break-words"
            >
              {message}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 pb-4 pt-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            size="sm"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </>
  );
}
