import { useEffect, useMemo, useRef, useState } from "react";
import { Folder as FolderIcon } from "lucide-react";
import { useUiStore } from "@/stores/ui";
import { useAccountsStore } from "@/stores/accounts";
import { useThreadsStore } from "@/stores/threads";
import type { MailFolder } from "@/types";

/**
 * Modal picker for "Move to folder…". Triggered from the keyboard ("m"),
 * the row context menu, or the MessageView toolbar. Lists every folder
 * for the thread's account except its current folder. Fuzzy-substring
 * filter as the user types.
 */
export function MoveToFolderPicker() {
  const targetId = useUiStore((s) => s.moveTargetThreadId);
  const close = useUiStore((s) => s.closeMove);
  const folders = useAccountsStore((s) => s.folders);
  const threads = useThreadsStore((s) => s.threads);
  const moveToFolder = useThreadsStore((s) => s.moveToFolder);

  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const thread = targetId != null ? threads.find((t) => t.id === targetId) : null;

  const candidates = useMemo<MailFolder[]>(() => {
    if (!thread) return [];
    const list = folders.filter(
      (f) => f.accountId === thread.accountId && f.id !== thread.folderId,
    );
    if (!query.trim()) return list;
    const q = query.toLowerCase();
    return list.filter(
      (f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q),
    );
  }, [folders, thread, query]);

  // Reset query / highlight whenever the modal reopens for a different thread.
  useEffect(() => {
    if (targetId == null) return;
    setQuery("");
    setHighlighted(0);
    // Defer focus so the input exists in the DOM before we grab it.
    queueMicrotask(() => inputRef.current?.focus());
  }, [targetId]);

  // Keep highlight in range as the filter narrows.
  useEffect(() => {
    if (highlighted >= candidates.length) setHighlighted(Math.max(0, candidates.length - 1));
  }, [candidates.length, highlighted]);

  if (targetId == null || !thread) return null;

  function commit(folder: MailFolder | undefined) {
    if (!folder) return;
    void moveToFolder(thread!.id, folder.path);
    close();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => Math.min(i + 1, candidates.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit(candidates[highlighted]);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center pt-[10vh]"
      style={{ background: "rgba(0,0,0,0.4)" }}
      onMouseDown={close}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-[440px] max-w-[90vw] rounded-xl border overflow-hidden fade-in"
        style={{
          background: "var(--bg-raised)",
          borderColor: "var(--border-strong)",
          boxShadow: "var(--shadow-md)",
        }}
      >
        <div className="px-3 py-2.5 border-b" style={{ borderColor: "var(--border-soft)" }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlighted(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Move to folder…"
            className="w-full bg-transparent outline-none text-[13px] text-primary placeholder:text-muted"
          />
        </div>
        <div className="max-h-[320px] overflow-y-auto py-1">
          {candidates.length === 0 ? (
            <div className="px-3 py-6 text-center text-[12px] text-muted">
              No matching folders.
            </div>
          ) : (
            candidates.map((f, idx) => (
              <button
                key={f.id}
                type="button"
                onMouseEnter={() => setHighlighted(idx)}
                onClick={() => commit(f)}
                className="flex items-center gap-2.5 w-full h-8 px-3 text-[12.5px] text-left transition-colors"
                style={{
                  background: idx === highlighted ? "var(--bg-hover)" : "transparent",
                }}
              >
                <FolderIcon size={13} className="text-muted shrink-0" />
                <span className="flex-1 truncate text-primary">{f.name}</span>
                {f.path !== f.name && (
                  <span className="text-[11px] text-muted truncate max-w-[120px]">
                    {f.path}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
        <div
          className="px-3 py-2 text-[11px] text-muted border-t flex justify-between"
          style={{ borderColor: "var(--border-soft)" }}
        >
          <span>↑↓ to navigate</span>
          <span>Enter to move · Esc to cancel</span>
        </div>
      </div>
    </div>
  );
}
