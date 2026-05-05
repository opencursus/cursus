import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "@/lib/cn";

export function TitleBar() {
  const win = getCurrentWindow();

  return (
    <div
      onDoubleClick={() => win.toggleMaximize()}
      className="drag-region flex h-10 items-center justify-between border-b border-soft bg-sidebar select-none"
      style={{ paddingLeft: 16, paddingRight: 4 }}
    >
      <div className="flex items-center gap-2">
        <LogoMark />
        <span className="text-primary text-[13px] font-semibold tracking-tight">
          Cursus
        </span>
      </div>

      <div className="flex-1" />

      <div className="no-drag flex items-center">
        <WindowButton
          onClick={() => {
            win.minimize().catch((e) => console.error("minimize failed:", e));
          }}
        >
          <Minus size={13} />
        </WindowButton>
        <WindowButton
          onClick={() => {
            win
              .toggleMaximize()
              .catch((e) => console.error("toggleMaximize failed:", e));
          }}
        >
          <Square size={11} />
        </WindowButton>
        <WindowButton
          danger
          onClick={() => {
            // The title-bar X always hides to tray. Quitting goes through the
            // dedicated Quit button next to Settings (or the tray menu Quit
            // entry); calling win.close() here would route through the tray
            // setting and risk killing the process unintentionally.
            win.hide().catch((e) => console.error("hide failed:", e));
          }}
        >
          <X size={14} />
        </WindowButton>
      </div>
    </div>
  );
}

function WindowButton({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-10 w-11 items-center justify-center"
    >
      <span
        style={{ transition: "background-color 120ms, color 120ms" }}
        className={cn(
          "flex h-7 w-8 items-center justify-center rounded-md text-muted",
          danger
            ? "group-hover:bg-[color:var(--color-danger)] group-hover:text-white"
            : "group-hover:bg-[rgba(255,255,255,0.12)] group-hover:text-primary",
        )}
      >
        {children}
      </span>
    </button>
  );
}

function LogoMark() {
  return (
    <div
      className="flex h-6 w-6 items-center justify-center shrink-0"
      style={{
        borderRadius: 4,
        background:
          "linear-gradient(135deg, #6a97fb 0%, #4670d1 100%)",
      }}
      aria-hidden
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 64 64"
        fill="none"
        stroke="#ffffff"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M32 4 L56 54 L32 44 L14 50 Z" strokeWidth="6" />
        <path d="M14 50 L24 36 L32 44" strokeWidth="5" />
        <path d="M32 4 L32 44" strokeWidth="4" opacity="0.65" />
      </svg>
    </div>
  );
}
