import { useEffect, useRef } from "react";
import {
  Archive,
  Trash2,
  Star,
  Flag,
  MailOpen,
  Mail,
  CornerUpLeft,
  Forward,
  FolderInput,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useThreadsStore } from "@/stores/threads";
import { useComposerStore } from "@/stores/composer";
import { useBodiesStore } from "@/stores/bodies";
import { useAccountsStore } from "@/stores/accounts";
import { useUiStore } from "@/stores/ui";
import type { Thread } from "@/types";

function currentSignature(accountId: number): string | null {
  const acc = useAccountsStore.getState().accounts.find((a) => a.id === accountId);
  return acc?.signatureHtml ?? null;
}

export interface ContextMenuState {
  thread: Thread;
  x: number;
  y: number;
}

export function RowContextMenu({
  state,
  onClose,
}: {
  state: ContextMenuState;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const toggleStar = useThreadsStore((s) => s.toggleStar);
  const toggleImportance = useThreadsStore((s) => s.toggleImportance);
  const archiveThread = useThreadsStore((s) => s.archiveThread);
  const trashThread = useThreadsStore((s) => s.trashThread);
  const markRead = useThreadsStore((s) => s.markRead);
  const openReply = useComposerStore((s) => s.openReply);
  const openForward = useComposerStore((s) => s.openForward);

  const { thread } = state;

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Clamp to viewport so the menu doesn't overflow off-screen.
  const menuWidth = 200;
  const menuHeight = 320;
  const x = Math.min(state.x, window.innerWidth - menuWidth - 8);
  const y = Math.min(state.y, window.innerHeight - menuHeight - 8);

  function run<T>(fn: () => T): void {
    onClose();
    try {
      const r = fn();
      if (r instanceof Promise) void r;
    } catch (err) {
      console.error("context-menu action failed:", err);
    }
  }

  return (
    <div
      ref={ref}
      role="menu"
      style={{
        left: x,
        top: y,
        background: "var(--bg-raised)",
        borderColor: "var(--border-strong)",
        boxShadow: "var(--shadow-md)",
      }}
      className={cn(
        "fixed z-[70] w-[200px] rounded-lg border p-1",
        "fade-in",
      )}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuItem
        icon={<CornerUpLeft size={14} />}
        label="Reply"
        onClick={() => {
          const body = useBodiesStore.getState().bodies[thread.id];
          const accounts = useUiStore.getState();
          void accounts; // silence unused warning if linter strict
          const sig = currentSignature(thread.accountId);
          run(() => openReply(thread, body?.html ?? null, body?.text ?? null, sig));
        }}
      />
      <MenuItem
        icon={<Forward size={14} />}
        label="Forward"
        onClick={() => {
          const body = useBodiesStore.getState().bodies[thread.id];
          const sig = currentSignature(thread.accountId);
          run(() => openForward(thread, body?.html ?? null, body?.text ?? null, sig));
        }}
      />
      <Divider />
      <MenuItem
        icon={<Archive size={14} />}
        label="Archive"
        onClick={() => run(() => archiveThread(thread.id))}
      />
      <MenuItem
        icon={<Trash2 size={14} />}
        label="Move to Trash"
        danger
        onClick={() => run(() => trashThread(thread.id))}
      />
      <MenuItem
        icon={<FolderInput size={14} />}
        label="Move to folder…"
        onClick={() => run(() => useUiStore.getState().openMove(thread.id))}
      />
      <Divider />
      <MenuItem
        icon={<Star size={14} />}
        label={thread.isPinned ? "Unstar" : "Star"}
        onClick={() => run(() => toggleStar(thread.id))}
      />
      <MenuItem
        icon={<Flag size={14} />}
        label={thread.isImportant ? "Remove flag" : "Flag as important"}
        onClick={() => run(() => toggleImportance(thread.id))}
      />
      <Divider />
      <MenuItem
        icon={thread.hasUnread ? <MailOpen size={14} /> : <Mail size={14} />}
        label={thread.hasUnread ? "Mark as read" : "Mark as unread"}
        disabled={!thread.hasUnread}
        onClick={() => {
          if (!thread.hasUnread) return;
          run(() => markRead(thread.id, { force: true }));
        }}
      />
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-2.5 w-full h-8 rounded-md px-2 text-[12.5px] text-left",
        "transition-colors",
        disabled
          ? "text-disabled cursor-not-allowed"
          : "text-secondary hover:bg-hover hover:text-primary",
        danger && !disabled && "hover:text-[color:var(--color-danger)]",
      )}
    >
      <span className={cn("flex items-center justify-center", disabled ? "" : "text-muted")}>
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}

function Divider() {
  return <div className="h-px my-1" style={{ background: "var(--border-soft)" }} />;
}
