import { useEffect, useRef, useState } from "react";
import { Search as SearchIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { searchMessages, type SearchHit } from "@/lib/db";
import { useAccountsStore } from "@/stores/accounts";
import { useThreadsStore } from "@/stores/threads";
import { useUiStore } from "@/stores/ui";
import { addressName, formatDateStack } from "@/lib/time";
import type { Thread } from "@/types";

const DEBOUNCE_MS = 150;
const MAX_RESULTS = 50;

export function SearchOverlay() {
  const open = useUiStore((s) => s.searchOpen);
  const closeSearch = useUiStore((s) => s.closeSearch);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHits([]);
    setCursor(0);
    setTimeout(() => inputRef.current?.focus(), 20);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setHits([]);
      setCursor(0);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const results = await searchMessages(q, MAX_RESULTS);
        if (cancelled) return;
        setHits(results);
        setCursor(0);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-idx="${cursor}"]`,
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [cursor, open]);

  function onKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeSearch();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, Math.max(0, hits.length - 1)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const hit = hits[cursor];
      if (hit) openHit(hit);
    }
  }

  function openHit(hit: SearchHit) {
    const accounts = useAccountsStore.getState();
    const folder = accounts.folders.find(
      (f) => f.accountId === hit.accountId && f.path === hit.folderPath,
    );
    if (folder) {
      accounts.setActiveAccount(hit.accountId);
      accounts.setActiveFolder(folder.id);
      // Inject a synthetic thread so MessageView has header data even if the
      // message falls outside the latest-50 window being rendered in the list.
      const synthetic: Thread = {
        id: hit.imapUid,
        accountId: hit.accountId,
        folderId: folder.id,
        subject: hit.subject ?? "(no subject)",
        snippet: hit.snippet ?? "",
        participants: [hit.fromAddress ?? "Unknown"],
        messageCount: 1,
        hasUnread: false,
        isPinned: false,
        isImportant: false,
        hasAttachments: false,
        lastMessageAt: (hit.receivedAt ?? 0) * 1000,
        category: null,
      };
      useThreadsStore.getState().ensureThread(synthetic);
    } else {
      accounts.setActiveAccount(hit.accountId);
    }
    useUiStore.getState().selectThread(hit.imapUid);
    closeSearch();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[55] flex items-start justify-center pt-24 px-6"
      role="dialog"
      aria-modal="true"
      onKeyDown={onKey}
      onClick={closeSearch}
    >
      <div
        style={{ background: "rgba(0,0,0,0.55)" }}
        className="absolute inset-0 backdrop-blur-sm"
        aria-hidden
      />
      <div
        style={{
          background: "var(--bg-raised)",
          borderColor: "var(--border-strong)",
          boxShadow: "var(--shadow-md)",
        }}
        className="relative w-full max-w-[720px] rounded-xl border overflow-hidden flex flex-col max-h-[min(560px,80vh)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center gap-3 px-4 py-3 border-b"
          style={{ borderBottomColor: "var(--border-soft)" }}
        >
          <SearchIcon size={16} className="text-muted shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search mail — subject, sender, body…"
            className="flex-1 bg-transparent outline-none border-0 text-[14px] text-primary placeholder:text-disabled"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd
            className="rounded bg-sunken px-1.5 py-0.5 text-[10.5px] text-muted border border-soft"
            style={{ borderColor: "var(--border-soft)" }}
          >
            Esc
          </kbd>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto">
          {loading && hits.length === 0 && (
            <div className="px-4 py-6 text-[12.5px] text-muted text-center">
              Searching…
            </div>
          )}
          {!loading && query.trim() && hits.length === 0 && (
            <div className="px-4 py-6 text-[12.5px] text-muted text-center">
              No matches for "{query.trim()}"
            </div>
          )}
          {!query.trim() && hits.length === 0 && (
            <div className="px-4 py-6 text-[12px] text-muted text-center">
              Type to search conversations you've opened or synced. Results
              come from a local index — no cloud, no tracking.
            </div>
          )}
          {hits.map((hit, idx) => {
            const active = idx === cursor;
            return (
              <HitRow
                key={`${hit.accountId}-${hit.folderPath}-${hit.imapUid}`}
                hit={hit}
                active={active}
                index={idx}
                onMouseEnter={() => setCursor(idx)}
                onClick={() => openHit(hit)}
              />
            );
          })}
        </div>

        {hits.length > 0 && (
          <div
            className="flex items-center gap-3 px-4 py-2 border-t"
            style={{ borderTopColor: "var(--border-soft)" }}
          >
            <span className="text-[11px] text-muted">
              {hits.length} result{hits.length === 1 ? "" : "s"}
            </span>
            <div className="flex-1" />
            <ShortcutHint keys="↑ ↓" label="Navigate" />
            <ShortcutHint keys="↵" label="Open" />
            <ShortcutHint keys="Esc" label="Close" />
          </div>
        )}
      </div>
    </div>
  );
}

function HitRow({
  hit,
  active,
  index,
  onClick,
  onMouseEnter,
}: {
  hit: SearchHit;
  active: boolean;
  index: number;
  onClick: () => void;
  onMouseEnter: () => void;
}) {
  const sender = addressName(hit.fromAddress ?? "") || hit.fromAddress || "Unknown";
  const when = hit.receivedAt ? formatDateStack(hit.receivedAt * 1000) : null;
  return (
    <button
      type="button"
      data-idx={index}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      style={active ? { background: "var(--bg-selected)" } : undefined}
      className={cn(
        "flex items-start gap-3 w-full px-4 py-2.5 text-left",
        "border-b transition-colors",
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[13px] font-semibold text-primary truncate">
            {sender}
          </span>
          {when && (
            <span className="text-[11px] text-muted tabular-nums shrink-0">
              {when.primary}
            </span>
          )}
        </div>
        <div className="text-[12.5px] text-primary truncate font-medium">
          {hit.subject || "(no subject)"}
        </div>
        {hit.snippet && (
          <div className="text-[11.5px] text-muted truncate mt-0.5">
            {hit.snippet}
          </div>
        )}
      </div>
    </button>
  );
}

function ShortcutHint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1 text-[10.5px] text-muted">
      <kbd
        className="rounded bg-sunken px-1.5 py-0.5 border border-soft font-mono"
        style={{ borderColor: "var(--border-soft)" }}
      >
        {keys}
      </kbd>
      <span>{label}</span>
    </span>
  );
}
