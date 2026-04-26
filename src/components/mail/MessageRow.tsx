import { Paperclip, Star, Flag, Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { addressName, formatDateStack } from "@/lib/time";
import { Avatar } from "@/components/mail/Avatar";
import { useThreadsStore } from "@/stores/threads";
import type { Thread } from "@/types";

export function MessageRow({
  thread,
  selected,
  checked,
  onClick,
  onToggleCheck,
  onContextMenu,
}: {
  thread: Thread;
  selected: boolean;
  checked: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onToggleCheck: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const senderRaw = thread.participants[0] ?? "Unknown";
  const senderName = addressName(senderRaw) || senderRaw;
  const extraCount = thread.participants.length - 1;

  const toggleStar = useThreadsStore((s) => s.toggleStar);
  const toggleImportance = useThreadsStore((s) => s.toggleImportance);

  const unread = thread.hasUnread;

  return (
    <div
      onContextMenu={onContextMenu}
      className={cn(
        "relative flex items-center gap-3 w-full h-[72px] border-b border-strong transition-colors",
        selected
          ? "bg-selected"
          : unread
            ? "bg-accent-soft hover:bg-hover"
            : "hover:bg-hover",
      )}
    >
      {unread && (
        <span
          className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r"
          style={{ backgroundColor: "var(--accent)" }}
          aria-hidden
        />
      )}

      {/* Left cluster: checkbox + star + importance */}
      <div className="flex items-center gap-0.5 pl-4 shrink-0">
        <CheckBox checked={checked} onClick={onToggleCheck} />
        <IconToggle
          label={thread.isPinned ? "Unstar" : "Star"}
          active={thread.isPinned}
          accent={thread.isPinned}
          onClick={() => void toggleStar(thread.id)}
        >
          <Star
            size={15}
            fill={thread.isPinned ? "currentColor" : "none"}
            strokeWidth={thread.isPinned ? 1.5 : 2}
          />
        </IconToggle>
        <IconToggle
          label={thread.isImportant ? "Remove flag" : "Flag as important"}
          active={thread.isImportant}
          accent={thread.isImportant}
          onClick={() => void toggleImportance(thread.id)}
        >
          <Flag
            size={14}
            fill={thread.isImportant ? "currentColor" : "none"}
            strokeWidth={1.75}
          />
        </IconToggle>
      </div>

      {/* Main clickable area */}
      <button
        type="button"
        onClick={onClick}
        style={{ paddingRight: 28 }}
        className="flex items-center gap-3 flex-1 min-w-0 h-full text-left"
      >
        <Avatar name={senderName} size={36} />

        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <div className="flex items-center gap-2 mb-0.5">
            <span
              className={cn(
                "truncate text-[13px] flex-1 min-w-0",
                unread ? "text-primary font-semibold" : "text-secondary font-medium",
              )}
            >
              {senderName}
              {extraCount > 0 && (
                <span className="text-muted font-normal"> +{extraCount}</span>
              )}
            </span>
            {thread.messageCount > 1 && (
              <span className="text-[11px] text-muted tabular-nums shrink-0">
                {thread.messageCount}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "truncate text-[12.5px] flex-1 min-w-0",
                unread ? "text-primary" : "text-muted",
              )}
            >
              <span className={unread ? "font-medium" : ""}>{thread.subject}</span>
              {thread.snippet && (
                <span className="text-muted font-normal"> — {thread.snippet}</span>
              )}
            </span>
            {thread.hasAttachments && (
              <Paperclip size={12} className="text-muted shrink-0" />
            )}
          </div>
        </div>

        <DateStack timestamp={thread.lastMessageAt} unread={unread} />
      </button>
    </div>
  );
}

function DateStack({
  timestamp,
  unread,
}: {
  timestamp: number;
  unread: boolean;
}) {
  const { primary, secondary } = formatDateStack(timestamp);
  return (
    <div
      className={cn(
        "flex flex-col items-end justify-center shrink-0 tabular-nums leading-tight",
        "w-[52px]",
        unread ? "text-primary" : "text-muted",
      )}
    >
      <span className="text-[11.5px] font-medium">{primary}</span>
      {secondary && (
        <span className="text-[10.5px] text-disabled mt-0.5">{secondary}</span>
      )}
    </div>
  );
}

function CheckBox({
  checked,
  onClick,
}: {
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      title={checked ? "Deselect" : "Select"}
      aria-label={checked ? "Deselect" : "Select"}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover transition-colors"
    >
      <span
        style={
          checked
            ? {
                background: "var(--accent)",
                borderColor: "var(--accent)",
                color: "#fff",
              }
            : {
                background: "transparent",
                borderColor: "var(--border-strong)",
              }
        }
        className="flex h-[15px] w-[15px] items-center justify-center rounded-[3px] border transition-colors"
      >
        {checked && <Check size={11} strokeWidth={3} />}
      </span>
    </button>
  );
}

function IconToggle({
  children,
  label,
  active,
  accent,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  active?: boolean;
  accent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
        accent ? "text-accent" : "text-muted hover:text-primary",
        "hover:bg-hover",
      )}
    >
      {children}
    </button>
  );
}
