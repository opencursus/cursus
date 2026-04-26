import { useEffect, useRef } from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { MailFolder } from "@/types";

export interface FolderContextMenuState {
  folder: MailFolder;
  x: number;
  y: number;
}

const PROTECTED_SPECIAL: ReadonlyArray<MailFolder["specialUse"]> = [
  "inbox",
];

export function FolderContextMenu({
  state,
  onClose,
  onRequestRename,
  onRequestDelete,
}: {
  state: FolderContextMenuState;
  onClose: () => void;
  onRequestRename: (folder: MailFolder) => void;
  onRequestDelete: (folder: MailFolder) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("mousedown", onDocDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDocDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const { folder } = state;
  const isProtected = folder.specialUse
    ? PROTECTED_SPECIAL.includes(folder.specialUse)
    : false;

  return (
    <div
      ref={ref}
      role="menu"
      style={{
        left: state.x,
        top: state.y,
        background: "var(--bg-raised)",
        borderColor: "var(--border-strong)",
        boxShadow: "var(--shadow-md)",
      }}
      className="fixed z-50 min-w-[180px] rounded-lg border py-1 text-[12.5px] text-primary"
    >
      <MenuButton
        icon={<Pencil size={13} />}
        onClick={() => {
          onClose();
          onRequestRename(folder);
        }}
      >
        Rename…
      </MenuButton>
      <MenuButton
        icon={<Trash2 size={13} />}
        onClick={() => {
          onClose();
          onRequestDelete(folder);
        }}
        disabled={isProtected}
        danger
        hint={isProtected ? "Inbox cannot be deleted" : undefined}
      >
        Delete…
      </MenuButton>
    </div>
  );
}

function MenuButton({
  icon,
  children,
  onClick,
  disabled,
  danger,
  hint,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={hint}
      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-hover disabled:opacity-50 disabled:cursor-not-allowed"
      style={danger && !disabled ? { color: "var(--color-danger)" } : undefined}
    >
      <span className="text-muted">{icon}</span>
      <span className="flex-1">{children}</span>
    </button>
  );
}
