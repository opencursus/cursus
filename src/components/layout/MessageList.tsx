import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  RefreshCw,
  SlidersHorizontal,
  AlertCircle,
  Archive,
  Trash2,
  Star,
  X as XIcon,
  Check,
  CheckCheck,
  Search as SearchIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useAccountsStore } from "@/stores/accounts";
import { useThreadsStore } from "@/stores/threads";
import { useUiStore, type ListFilter, type ListSort } from "@/stores/ui";
import { CategoryTabs } from "@/components/mail/CategoryTabs";
import { MessageRow } from "@/components/mail/MessageRow";
import {
  RowContextMenu,
  type ContextMenuState,
} from "@/components/mail/RowContextMenu";
import type { Thread } from "@/types";

export function MessageList() {
  const activeAccountId = useAccountsStore((s) => s.activeAccountId);
  const activeFolderId = useAccountsStore((s) => s.activeFolderId);
  const folders = useAccountsStore((s) => s.folders);
  const threads = useThreadsStore((s) => s.threads);
  const loading = useThreadsStore((s) => s.loading);
  const error = useThreadsStore((s) => s.error);
  const fetchFolder = useThreadsStore((s) => s.fetchFolder);
  const loadMore = useThreadsStore((s) => s.loadMore);
  const fetchAllUnread = useThreadsStore((s) => s.fetchAllUnread);
  const loadingMore = useThreadsStore((s) => s.loadingMore);
  const hasMore = useThreadsStore((s) => s.hasMore);
  const markManyRead = useThreadsStore((s) => s.markManyRead);
  const selectedThreadId = useUiStore((s) => s.selectedThreadId);
  const selectThread = useUiStore((s) => s.selectThread);
  const markRead = useThreadsStore((s) => s.markRead);
  const activeCategory = useUiStore((s) => s.activeCategory);
  const starredView = useUiStore((s) => s.starredView);
  const selectedIds = useUiStore((s) => s.selectedIds);
  const toggleSelection = useUiStore((s) => s.toggleSelection);
  const selectRange = useUiStore((s) => s.selectRange);
  const clearSelection = useUiStore((s) => s.clearSelection);
  const listFilter = useUiStore((s) => s.listFilter);
  const listSort = useUiStore((s) => s.listSort);
  const listQuery = useUiStore((s) => s.listQuery);
  const setListFilter = useUiStore((s) => s.setListFilter);
  const setListSort = useUiStore((s) => s.setListSort);
  const setListQuery = useUiStore((s) => s.setListQuery);
  const searchRef = useRef<HTMLInputElement>(null);

  const activeFolder = folders.find((f) => f.id === activeFolderId);

  useEffect(() => {
    if (activeAccountId && activeFolder) {
      fetchFolder(activeAccountId, activeFolder.path, activeFolder.id);
    }
    // Changing folder should drop any bulk selection from the previous folder.
    clearSelection();
  }, [activeAccountId, activeFolder?.id, activeFolder?.path, fetchFolder, clearSelection]);

  // The Unread tab uses IMAP UID SEARCH UNSEEN under the hood — one round-
  // trip pulls every server-side unread message in the folder, no matter
  // how far back it sits. Re-run guard: only fire when we entered the tab
  // and the visible list is below the server-side unread count (otherwise
  // we'd thrash the inbox on every render).
  const unreadFetchedRef = useRef(false);
  useEffect(() => {
    unreadFetchedRef.current = false;
  }, [activeAccountId, activeFolderId, activeCategory]);

  const scopedThreads = useMemo(() => {
    let list = starredView ? threads.filter((t) => t.isPinned) : threads;
    if (listFilter === "unread") list = list.filter((t) => t.hasUnread);
    else if (listFilter === "attachments")
      list = list.filter((t) => t.hasAttachments);
    const q = listQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((t) => {
        if (t.subject && t.subject.toLowerCase().includes(q)) return true;
        if (t.snippet && t.snippet.toLowerCase().includes(q)) return true;
        return t.participants.some((p) => p.toLowerCase().includes(q));
      });
    }
    const sorted = [...list].sort((a, b) =>
      listSort === "oldest"
        ? a.lastMessageAt - b.lastMessageAt
        : b.lastMessageAt - a.lastMessageAt,
    );
    return sorted;
  }, [threads, starredView, listFilter, listSort, listQuery]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, people: 0, newsletters: 0, notifications: 0 };
    for (const t of scopedThreads) {
      if (!t.hasUnread) continue;
      c.all = (c.all ?? 0) + 1;
      if (t.category && c[t.category] !== undefined) {
        c[t.category] = (c[t.category] ?? 0) + 1;
      }
    }
    return c;
  }, [scopedThreads]);

  const pinned = starredView ? [] : scopedThreads.filter((t) => t.isPinned);
  const visible = scopedThreads.filter((t) => {
    if (!starredView && t.isPinned) return false;
    if (activeCategory === "all") return true;
    if (activeCategory === "unread") return t.hasUnread;
    return t.category === activeCategory;
  });

  const orderedIds = useMemo(
    () => [...pinned.map((t) => t.id), ...visible.map((t) => t.id)],
    [pinned, visible],
  );

  // Single-shot pull of all server-side unread mail when the user lands on
  // the Unread tab. We only do this if the cached unread count is lower than
  // what the IMAP STATUS UNSEEN reports (i.e. the server has more unread
  // than we currently know about). Otherwise the cache already has them all.
  useEffect(() => {
    if (
      activeCategory !== "unread" ||
      unreadFetchedRef.current ||
      loadingMore ||
      loading ||
      activeAccountId == null ||
      activeFolder == null
    ) {
      return;
    }
    const serverUnread = activeFolder.unreadCount ?? 0;
    const cachedUnread = scopedThreads.filter((t) => t.hasUnread).length;
    if (serverUnread === 0 || cachedUnread >= serverUnread) {
      // Nothing to pull (no server unread, or our cache already covers it).
      unreadFetchedRef.current = true;
      return;
    }
    unreadFetchedRef.current = true;
    void fetchAllUnread(activeAccountId, activeFolder.path, activeFolder.id);
  }, [
    activeCategory,
    activeFolder,
    activeAccountId,
    loading,
    loadingMore,
    scopedThreads,
    fetchAllUnread,
  ]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  function handleContextMenu(thread: Thread, event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    setMenu({ thread, x: event.clientX, y: event.clientY });
  }

  function handleRowClick(thread: Thread, event: React.MouseEvent<HTMLButtonElement>) {
    if (event.shiftKey) {
      event.preventDefault();
      selectRange(thread.id, orderedIds);
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      toggleSelection(thread.id);
      return;
    }
    clearSelection();
    selectThread(thread.id);
    markRead(thread.id);
  }

  function refresh() {
    if (activeAccountId && activeFolder) {
      fetchFolder(activeAccountId, activeFolder.path, activeFolder.id);
    }
  }

  // Marks every UNREAD thread that's currently visible (respects category
  // tab, starred view, and the Filters dropdown). Threads hidden by the
  // current filter are left alone.
  const visibleUnreadIds = useMemo(() => {
    return scopedThreads
      .filter((t) => {
        if (!t.hasUnread) return false;
        if (activeCategory === "all" || activeCategory === "unread") return true;
        return t.category === activeCategory;
      })
      .map((t) => t.id);
  }, [scopedThreads, activeCategory]);

  function markAllVisibleAsRead() {
    if (visibleUnreadIds.length === 0) return;
    void markManyRead(visibleUnreadIds);
  }

  return (
    <section
      className="relative flex flex-col bg-raised border-r border-soft overflow-hidden"
      aria-label="Message list"
    >
      <header className="flex items-center gap-4 pl-7 pr-4 pt-3 pb-2 shrink-0">
        <div className="min-w-0 shrink-0">
          <h1 className="text-[16px] font-semibold text-primary truncate">
            {starredView ? "Starred" : activeFolder?.name ?? "Inbox"}
          </h1>
          <p className="text-[11.5px] text-muted tabular-nums">
            {loading
              ? "Loading…"
              : `${scopedThreads.length} conversations${counts.all ? ` · ${counts.all} unread` : ""}`}
          </p>
        </div>

        <div
          className="flex h-8 flex-1 min-w-0 max-w-xl items-center gap-2 rounded-full px-3 transition-colors"
          style={{
            background: "var(--bg-raised)",
            border: `1px solid ${
              listQuery ? "var(--accent)" : "var(--border-soft)"
            }`,
          }}
          onClick={() => searchRef.current?.focus()}
        >
          <SearchIcon size={13} className="text-muted shrink-0" />
          <input
            id="cursus-titlebar-search"
            ref={searchRef}
            value={listQuery}
            onChange={(e) => setListQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setListQuery("");
                searchRef.current?.blur();
              }
            }}
            placeholder="Search this folder"
            spellCheck={false}
            autoComplete="off"
            className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[12.5px] text-primary placeholder:text-muted"
          />
          {listQuery ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setListQuery("");
                searchRef.current?.focus();
              }}
              aria-label="Clear search"
              className="text-muted hover:text-primary shrink-0"
            >
              <XIcon size={13} />
            </button>
          ) : (
            <kbd className="rounded bg-sunken px-1.5 py-px text-[10.5px] text-disabled shrink-0">
              Ctrl K
            </kbd>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <HeaderButton onClick={refresh} disabled={loading} title="Refresh">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </HeaderButton>
          <HeaderButton
            onClick={markAllVisibleAsRead}
            disabled={visibleUnreadIds.length === 0}
            title={
              visibleUnreadIds.length === 0
                ? "Nothing unread in view"
                : `Mark ${visibleUnreadIds.length} as read`
            }
          >
            <CheckCheck size={14} />
          </HeaderButton>
          <FilterMenu value={listFilter} onChange={setListFilter} />
          <SortMenu value={listSort} onChange={setListSort} />
        </div>
      </header>

      <CategoryTabs counts={counts} />

      <div className="flex-1 overflow-y-auto">
        {error ? (
          <ErrorBanner message={error} onRetry={refresh} />
        ) : null}

        {pinned.length > 0 && (
          <>
            <ListSectionHeader>Pinned</ListSectionHeader>
            {pinned.map((thread) => (
              <MessageRow
                key={thread.id}
                thread={thread}
                selected={thread.id === selectedThreadId}
                checked={selectedSet.has(thread.id)}
                onClick={(e) => handleRowClick(thread, e)}
                onToggleCheck={() => toggleSelection(thread.id)}
                onContextMenu={(e) => handleContextMenu(thread, e)}
              />
            ))}
          </>
        )}

        {visible.length > 0 ? (
          <>
            {pinned.length > 0 && <ListSectionHeader>Inbox</ListSectionHeader>}
            {visible.map((thread) => (
              <MessageRow
                key={thread.id}
                thread={thread}
                selected={thread.id === selectedThreadId}
                checked={selectedSet.has(thread.id)}
                onClick={(e) => handleRowClick(thread, e)}
                onToggleCheck={() => toggleSelection(thread.id)}
                onContextMenu={(e) => handleContextMenu(thread, e)}
              />
            ))}
          </>
        ) : !loading && !error ? (
          <div className="flex flex-col items-center justify-center pt-16 gap-3 text-muted text-[12.5px]">
            {activeCategory === "unread" && loadingMore ? (
              <span>Loading unread messages…</span>
            ) : (
              <span>
                {activeCategory === "unread"
                  ? "No unread conversations found."
                  : "No conversations in this folder."}
              </span>
            )}
          </div>
        ) : null}

        {/* Always offer Load more when the server has more — even if the
            current category filter shows nothing. Without this the user
            gets stuck on an empty Unread tab while older unread mail still
            sits on the server. */}
        {hasMore && activeAccountId != null && activeFolder && !loading && (
          <div className="flex items-center justify-center py-4">
            <button
              type="button"
              disabled={loadingMore}
              onClick={() =>
                void loadMore(activeAccountId, activeFolder.path, activeFolder.id)
              }
              className="px-3 py-1.5 text-[12px] text-secondary hover:text-primary hover:bg-hover rounded-md transition-colors disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : "Load older messages"}
            </button>
          </div>
        )}
      </div>

      {selectedIds.length > 0 && <BulkActionBar count={selectedIds.length} />}
      {menu && <RowContextMenu state={menu} onClose={() => setMenu(null)} />}
    </section>
  );
}

function BulkActionBar({ count }: { count: number }) {
  const selectedIds = useUiStore((s) => s.selectedIds);
  const clearSelection = useUiStore((s) => s.clearSelection);
  const archiveMany = useThreadsStore((s) => s.archiveMany);
  const trashMany = useThreadsStore((s) => s.trashMany);
  const toggleStarMany = useThreadsStore((s) => s.toggleStarMany);

  async function runArchive() {
    const ids = [...selectedIds];
    clearSelection();
    await archiveMany(ids);
  }
  async function runTrash() {
    const ids = [...selectedIds];
    clearSelection();
    await trashMany(ids);
  }
  async function runStar() {
    const ids = [...selectedIds];
    await toggleStarMany(ids);
  }

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      style={{
        background: "var(--bg-raised)",
        borderColor: "var(--border-strong)",
        boxShadow: "var(--shadow-md)",
      }}
      className="absolute left-3 right-3 bottom-3 flex items-center gap-1 rounded-xl border px-3 py-2"
    >
      <span className="text-[12.5px] text-primary font-medium mr-2 tabular-nums">
        {count} selected
      </span>
      <BulkButton label="Star / unstar" onClick={runStar}>
        <Star size={14} />
      </BulkButton>
      <BulkButton label="Archive" onClick={runArchive}>
        <Archive size={14} />
      </BulkButton>
      <BulkButton label="Trash" onClick={runTrash} danger>
        <Trash2 size={14} />
      </BulkButton>
      <div className="flex-1" />
      <BulkButton label="Clear selection" onClick={clearSelection}>
        <XIcon size={14} />
      </BulkButton>
    </div>
  );
}

function BulkButton({
  children,
  label,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
        "text-secondary hover:bg-hover hover:text-primary",
        danger && "hover:text-[color:var(--color-danger)]",
      )}
    >
      {children}
    </button>
  );
}

function HeaderButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "flex h-7 items-center gap-1 rounded-md px-2 text-muted",
        "hover:bg-hover hover:text-primary transition-colors",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent",
      )}
    >
      {children}
    </button>
  );
}

function ListSectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="pl-7 pr-4 pt-3 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-disabled">
      {children}
    </div>
  );
}

function FilterMenu({
  value,
  onChange,
}: {
  value: ListFilter;
  onChange: (v: ListFilter) => void;
}) {
  const options: ReadonlyArray<{ value: ListFilter; label: string }> = [
    { value: "all", label: "All" },
    { value: "unread", label: "Unread only" },
    { value: "attachments", label: "Has attachments" },
  ];
  const active = value !== "all";
  return (
    <HeaderPopover
      trigger={
        <HeaderButton title="Filters">
          <SlidersHorizontal
            size={14}
            style={active ? { color: "var(--accent)" } : undefined}
          />
        </HeaderButton>
      }
    >
      {(close) => (
        <>
          {options.map((o) => (
            <MenuRow
              key={o.value}
              selected={o.value === value}
              onClick={() => {
                onChange(o.value);
                close();
              }}
            >
              {o.label}
            </MenuRow>
          ))}
        </>
      )}
    </HeaderPopover>
  );
}

function SortMenu({
  value,
  onChange,
}: {
  value: ListSort;
  onChange: (v: ListSort) => void;
}) {
  const options: ReadonlyArray<{ value: ListSort; label: string }> = [
    { value: "newest", label: "Newest" },
    { value: "oldest", label: "Oldest" },
  ];
  const label = options.find((o) => o.value === value)?.label ?? "Newest";
  return (
    <HeaderPopover
      trigger={
        <HeaderButton title="Sort">
          <span className="text-[12px] mr-1">{label}</span>
          <ChevronDown size={13} />
        </HeaderButton>
      }
    >
      {(close) => (
        <>
          {options.map((o) => (
            <MenuRow
              key={o.value}
              selected={o.value === value}
              onClick={() => {
                onChange(o.value);
                close();
              }}
            >
              {o.label}
            </MenuRow>
          ))}
        </>
      )}
    </HeaderPopover>
  );
}

function HeaderPopover({
  trigger,
  children,
}: {
  trigger: React.ReactElement<{ onClick?: () => void }>;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      )
        setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const triggerWithHandler = {
    ...trigger,
    props: {
      ...trigger.props,
      onClick: () => setOpen((v) => !v),
    },
  } as React.ReactElement;

  return (
    <div ref={wrapperRef} className="relative">
      {triggerWithHandler}
      {open && (
        <div
          role="menu"
          style={{
            background: "var(--bg-raised)",
            borderColor: "var(--border-strong)",
            boxShadow: "var(--shadow-md)",
          }}
          className="absolute right-0 top-full mt-1 z-40 min-w-[180px] rounded-lg border py-1"
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function MenuRow({
  children,
  selected,
  onClick,
}: {
  children: React.ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px] text-primary hover:bg-hover"
    >
      <span className="flex h-3.5 w-3.5 items-center justify-center shrink-0">
        {selected && <Check size={13} style={{ color: "var(--accent)" }} />}
      </span>
      <span className="flex-1">{children}</span>
    </button>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-4 my-3 rounded-lg border border-[color:var(--color-danger)] bg-[color:rgba(229,72,77,0.08)] px-3 py-2 flex items-start gap-2">
      <AlertCircle size={14} className="text-[color:var(--color-danger)] mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] text-primary font-medium">Could not load messages</p>
        <p className="text-[11.5px] text-muted mt-0.5 break-words">{message}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="text-[12px] text-accent hover:underline shrink-0"
      >
        Retry
      </button>
    </div>
  );
}
