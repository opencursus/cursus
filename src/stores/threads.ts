import { create } from "zustand";
import type { MailCategory, Thread } from "@/types";
import { ipc, type ImapConfig, type MessageSummary } from "@/lib/ipc";
import {
  deleteMessage,
  getAccount,
  getAccountSecrets,
  listMessagesForFolder,
  listRules,
  parseNameEmail,
  seedContact,
  updateMessageFlags,
  upsertMessageSummary,
  upsertSearchIndex,
  type StoredAccount,
  type StoredMessage,
  type StoredRule,
} from "@/lib/db";
import { isSnoozedNow, snoozeKeyword, SNOOZE_REMOVE_GLOBS } from "@/lib/snooze";
import { ruleMatches, type RuleAction, type RuleSpec } from "@/lib/rules";
import { useAccountsStore } from "@/stores/accounts";
import { useUiStore } from "@/stores/ui";
import { toast } from "@/stores/toasts";
import { notifyNewMail } from "@/lib/notifications";

export interface FetchFolderOptions {
  /**
   * Silent refreshes skip the `loading: true` flip so the UI doesn't flash
   * its header subtitle / refresh spinner. Use for background sync ticks
   * and visibility/online triggers — anything the user didn't explicitly
   * ask for. Manual refreshes and folder-change loads stay non-silent.
   */
  silent?: boolean;
}

interface ThreadsState {
  threads: Thread[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  fetchFolder: (
    accountId: number,
    folderPath: string,
    folderId: number,
    options?: FetchFolderOptions,
  ) => Promise<void>;
  loadMore: (
    accountId: number,
    folderPath: string,
    folderId: number,
  ) => Promise<void>;
  /**
   * Server-side IMAP UID SEARCH UNSEEN + a single UID FETCH. Faster and
   * smoother than paginating chronologically because we never load and
   * discard read messages just to find the few unread mixed in.
   */
  fetchAllUnread: (
    accountId: number,
    folderPath: string,
    folderId: number,
  ) => Promise<void>;
  setThreads: (threads: Thread[]) => void;
  togglePin: (id: number) => void;
  /**
   * Marks the thread read on the server. When `force` is false (default)
   * the call respects the user's `dontMarkReadOnOpen` setting and is a
   * no-op — used by the auto-mark on open. The keyboard "s" / context menu
   * paths pass `force: true` so manual marks always go through.
   */
  markRead: (id: number, opts?: { force?: boolean }) => Promise<void>;
  toggleStar: (id: number) => Promise<void>;
  toggleImportance: (id: number) => Promise<void>;
  moveToFolder: (id: number, destPath: string) => Promise<void>;
  snoozeThread: (id: number, untilUnixSeconds: number) => Promise<void>;
  unsnoozeThread: (id: number) => Promise<void>;
  archiveThread: (id: number) => Promise<void>;
  trashThread: (id: number) => Promise<void>;
  markAsSpam: (id: number) => Promise<void>;
  markAsNotSpam: (id: number) => Promise<void>;
  archiveMany: (ids: number[]) => Promise<void>;
  trashMany: (ids: number[]) => Promise<void>;
  toggleStarMany: (ids: number[]) => Promise<void>;
  markManyRead: (ids: number[]) => Promise<void>;
  ensureThread: (thread: Thread) => void;
}

const PAGE_SIZE = 50;
// Per (account, folder) page counter. fetchFolder resets to 1; loadMore
// increments. The next IMAP fetch uses (pageCount - 1) * PAGE_SIZE as offset.
const pageCountByFolder = new Map<string, number>();

const IMPORTANT_KEYWORD = "Cursus-Important";
/** Pre-rename keyword. We never write it, but we still recognise it on
 *  fetch (so messages flagged in older builds keep showing as important)
 *  and we strip it on toggle-off. */
const LEGACY_IMPORTANT_KEYWORD = "Flow-Important";

function flagsHaveImportant(flags: string[]): boolean {
  return (
    flags.includes(IMPORTANT_KEYWORD) ||
    flags.includes(LEGACY_IMPORTANT_KEYWORD)
  );
}

// In-memory map of max UID already seen per (account, folder), used to fire
// a notification when fetchFolder surfaces a genuinely new unread message.
// Resets on app reload, which is fine: first fetch after launch is silent.
const highestKnownUid = new Map<string, number>();

// ── Conversation threading (Union-Find over Message-ID / In-Reply-To /
// References) ────────────────────────────────────────────────────────────

interface ThreadMember {
  uid: number;
  date: number; // unix seconds
  subject: string;
  from: string;
  to: string[];
  flags: string[];
  hasAttachments: boolean;
  isBulk: boolean;
  isAuto: boolean;
}

class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      return x;
    }
    let cur = x;
    while (true) {
      const p = this.parent.get(cur)!;
      if (p === cur) break;
      cur = p;
    }
    // Path compression: walk again, repointing each node to the root.
    let node = x;
    while (this.parent.get(node) !== cur) {
      const next = this.parent.get(node)!;
      this.parent.set(node, cur);
      node = next;
    }
    return cur;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/**
 * Group an array of items by Message-ID family (RFC 5322). Each item
 * supplies its own messageId, inReplyTo and references. Items lacking
 * any header still get their own singleton group keyed by `uid:${uid}`.
 *
 * Returns a Map of group root → items, with items inside each group
 * sorted newest-first by `date`.
 */
function groupByMessageIdFamily<T extends ThreadMember & {
  messageId: string;
  inReplyTo: string;
  references: string[];
}>(items: T[]): Map<string, T[]> {
  const uf = new UnionFind();

  // Build the equivalence classes. The defensive `?? []` keeps us safe when
  // the Rust binary is older than the frontend (i.e. the IPC payload lacks
  // the threading headers entirely) — those messages just don't get unioned.
  for (const m of items) {
    const own = (m.messageId || "") || `uid:${m.uid}`;
    uf.find(own); // ensure node exists
    if (m.inReplyTo) uf.union(own, m.inReplyTo);
    for (const r of m.references ?? []) {
      if (r) uf.union(own, r);
    }
  }

  // Bucket by root.
  const groups = new Map<string, T[]>();
  for (const m of items) {
    const own = (m.messageId || "") || `uid:${m.uid}`;
    const root = uf.find(own);
    const list = groups.get(root) ?? [];
    list.push(m);
    groups.set(root, list);
  }

  // Sort each group newest-first.
  for (const list of groups.values()) {
    list.sort((a, b) => b.date - a.date);
  }
  return groups;
}

function dedupeAddresses(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/**
 * Build a Thread for a group of messages. The newest message is the
 * representative — its UID becomes the Thread.id and the click-target.
 * `messageCount` reflects the real conversation size.
 */
function threadFromGroup(
  members: ThreadMember[],
  accountId: number,
  folderId: number,
): Thread {
  // Sorted newest-first by groupByMessageIdFamily.
  const newest = members[0]!;
  const allParticipants = members.flatMap((m) => [m.from, ...m.to]);
  const participants = dedupeAddresses(allParticipants).slice(0, 10);

  // Thread is unread if ANY member is unread (Gmail/Spark behaviour).
  const hasUnread = members.some((m) => !m.flags.includes("Seen"));
  // Star / important roll up the same way — any flagged member counts.
  const isPinned = members.some((m) => m.flags.includes("Flagged"));
  const isImportant = members.some((m) => flagsHaveImportant(m.flags));
  const hasAttachments = members.some((m) => m.hasAttachments);

  return {
    id: newest.uid,
    accountId,
    folderId,
    subject: newest.subject,
    snippet: "",
    participants,
    messageCount: members.length,
    hasUnread,
    isPinned,
    isImportant,
    hasAttachments,
    lastMessageAt: newest.date * 1000,
    category: inferCategoryFromFlags(newest.isBulk, newest.isAuto, newest.from),
  };
}

function groupSummariesIntoThreads(
  summaries: MessageSummary[],
  accountId: number,
  folderId: number,
): Thread[] {
  // Hide messages whose Cursus-SnoozedUntil deadline is still in the future.
  const visible = summaries.filter((s) => !isSnoozedNow(s.flags));
  const items = visible.map((s) => ({
    uid: s.uid,
    date: s.date ?? 0,
    subject: s.subject ?? "(no subject)",
    from: s.from ?? "Unknown",
    to: s.to,
    flags: s.flags,
    hasAttachments: s.hasAttachments,
    isBulk: s.isBulk,
    isAuto: s.isAuto,
    messageId: s.messageId ?? "",
    inReplyTo: s.inReplyTo ?? "",
    references: s.references ?? [],
  }));
  const groups = groupByMessageIdFamily(items);
  const threads = Array.from(groups.values()).map((g) =>
    threadFromGroup(g, accountId, folderId),
  );
  // Newest thread first.
  threads.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  // Snippet from the newest member is the user-visible preview.
  for (const t of threads) {
    const newest = summaries.find((s) => s.uid === t.id);
    if (newest) t.snippet = newest.snippet ?? "";
  }
  return threads;
}

function groupMessagesIntoThreads(
  rows: StoredMessage[],
  accountId: number,
  folderId: number,
): Thread[] {
  const visible = rows.filter((r) => {
    if (!r.flags) return true;
    const parsed = safeParseFlags(r.flags);
    return !isSnoozedNow(parsed);
  });
  const items = visible.map((r) => ({
    uid: r.imap_uid,
    date: r.received_at ?? 0,
    subject: r.subject ?? "(no subject)",
    from: r.from_address ?? "Unknown",
    to: (r.to_addresses ?? "").split(", ").filter(Boolean),
    flags: r.flags ? safeParseFlags(r.flags) : [],
    hasAttachments: r.has_attachments === 1,
    isBulk: r.is_bulk === 1,
    isAuto: r.is_auto === 1,
    messageId: r.message_id_header ?? "",
    inReplyTo: r.in_reply_to ?? "",
    references: r.references_header
      ? r.references_header.split(/\s+/).filter(Boolean)
      : [],
    snippet: r.snippet ?? "",
  }));
  const groups = groupByMessageIdFamily(items);
  const threads = Array.from(groups.values()).map((g) =>
    threadFromGroup(g, accountId, folderId),
  );
  threads.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  for (const t of threads) {
    const newest = items.find((i) => i.uid === t.id);
    if (newest) t.snippet = newest.snippet;
  }
  return threads;
}

function safeParseFlags(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function rulesFromStored(rows: StoredRule[]): RuleSpec[] {
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    name: r.name,
    enabled: r.enabled === 1,
    sortOrder: r.sort_order,
    conditions: safeParseJson(r.conditions_json) as RuleSpec["conditions"],
    actions: safeParseJson(r.actions_json) as RuleSpec["actions"],
  }));
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return [];
  }
}

async function applyRulesToFresh(
  accountId: number,
  folderId: number,
  folderPath: string,
  fresh: MessageSummary[],
): Promise<void> {
  const stored = await listRules(accountId).catch(() => [] as StoredRule[]);
  const rules = rulesFromStored(stored);
  if (rules.length === 0) return;

  // Build a single config / session per pass so we don't re-LOGIN per message.
  // (Underlying IPC still does, but the call sites stay legible.)
  const account = await getAccount(accountId);
  if (!account) return;
  const secrets = await getAccountSecrets(accountId);
  const config = imapConfigFor(account, secrets.imapPassword);

  for (const s of fresh) {
    let moved = false;
    for (const rule of rules) {
      if (!ruleMatches(s, rule)) continue;
      for (const action of rule.actions) {
        try {
          moved = await runRuleAction(config, folderPath, folderId, accountId, s.uid, action);
        } catch (err) {
          console.warn(`rule "${rule.name}" action failed:`, err);
        }
        if (moved) break; // message no longer in source folder
      }
      if (moved) break; // stop trying further rules on a moved message
    }
  }
}

async function runRuleAction(
  config: ImapConfig,
  folderPath: string,
  folderId: number,
  accountId: number,
  uid: number,
  action: RuleAction,
): Promise<boolean> {
  switch (action.type) {
    case "move_to": {
      await ipc.imapMoveUid(config, folderPath, action.folderPath, uid);
      void deleteMessage(folderId, uid).catch(() => {});
      return true;
    }
    case "mark_read": {
      await ipc.imapSetFlags(config, folderPath, uid, ["\\Seen"], "add");
      void updateMessageFlags(folderId, uid, { isUnread: false }).catch(() => {});
      return false;
    }
    case "star": {
      await ipc.imapSetFlags(config, folderPath, uid, ["\\Flagged"], "add");
      void updateMessageFlags(folderId, uid, { isStarred: true }).catch(() => {});
      return false;
    }
    case "important": {
      await ipc.imapSetFlags(config, folderPath, uid, [IMPORTANT_KEYWORD], "add");
      void updateMessageFlags(folderId, uid, { isImportant: true }).catch(() => {});
      return false;
    }
    case "trash": {
      const trashPath = findFolderPath(accountId, "trash") ?? "Trash";
      await ipc.imapMoveUid(config, folderPath, trashPath, uid);
      void deleteMessage(folderId, uid).catch(() => {});
      return true;
    }
  }
}

export const useThreadsStore = create<ThreadsState>((set, get) => ({
  threads: [],
  loading: false,
  loadingMore: false,
  hasMore: false,
  error: null,

  fetchFolder: async (accountId, folderPath, folderId, options) => {
    const silent = options?.silent === true;
    // Reset paging — refresh always re-fetches the freshest page.
    pageCountByFolder.set(`${accountId}:${folderId}`, 1);

    // ── Phase 1: cold-start from DB ────────────────────────────────────────
    // Show whatever we previously persisted for this folder immediately, so
    // opening a folder feels instant even on a slow IMAP server. Skipped for
    // synthetic folder ids (negative) — those are placeholders that have
    // never been resolved against the DB.
    if (folderId > 0) {
      try {
        const cached = await listMessagesForFolder(folderId, 200);
        if (cached.length > 0) {
          set({
            threads: groupMessagesIntoThreads(cached, accountId, folderId),
            error: null,
          });
        }
      } catch (err) {
        console.warn("fetchFolder: cache load failed", err);
      }
    }

    // ── Phase 2: refresh from IMAP ─────────────────────────────────────────
    set((state) => (silent ? { ...state, error: null } : { ...state, loading: true, error: null }));
    try {
      const account = await getAccount(accountId);
      if (!account) throw new Error(`account ${accountId} not found`);
      const secrets = await getAccountSecrets(accountId);
      const config = imapConfigFor(account, secrets.imapPassword);

      const summaries = await ipc.imapFetchMessages(config, folderPath, PAGE_SIZE, 0);

      const threads = groupSummariesIntoThreads(summaries, accountId, folderId);

      // Whether a "Load more" button makes sense: if the page came back
      // full (50), there's likely more behind it.
      set({ hasMore: summaries.length >= PAGE_SIZE });

      const key = `${accountId}:${folderId}`;
      const prev = highestKnownUid.get(key);
      const maxUid = threads.reduce((m, t) => (t.id > m ? t.id : m), 0);
      if (prev !== undefined) {
        const fresh = threads.filter((t) => t.id > prev && t.hasUnread);
        if (fresh.length > 0) {
          const newest = fresh[0];
          if (newest) {
            void notifyNewMail(
              newest.subject,
              newest.participants[0] ?? "Unknown",
              fresh.length,
            );
          }
        }
      }
      if (maxUid > 0) highestKnownUid.set(key, maxUid);

      // ── Phase 3: persist to DB ──────────────────────────────────────────
      // Skip if we still have a synthetic folder id — would violate the FK.
      // Should only happen on the very first sync of a brand-new account.
      if (folderId > 0) {
        for (const s of summaries) {
          void upsertMessageSummary({
            accountId,
            folderId,
            imapUid: s.uid,
            messageIdHeader: s.messageId || null,
            inReplyTo: s.inReplyTo || null,
            referencesHeader: (s.references ?? []).length > 0 ? (s.references ?? []).join(" ") : null,
            fromAddress: s.from,
            toAddresses: s.to.join(", "),
            subject: s.subject,
            snippet: s.snippet,
            receivedAt: s.date,
            flags: s.flags,
            isUnread: !s.flags.includes("Seen"),
            isStarred: s.flags.includes("Flagged"),
            isImportant: flagsHaveImportant(s.flags),
            hasAttachments: s.hasAttachments,
            isBulk: s.isBulk,
            isAuto: s.isAuto,
          }).catch((err) => console.warn("upsertMessageSummary failed", err));
        }
      }

      // ── Apply rules to genuinely new messages ──────────────────────────
      // `prev` (set further up) is the high-water UID we'd seen before.
      // Anything above that is fresh — eligible for rule actions. We apply
      // rules *after* the DB upsert so move_to actions naturally invalidate
      // the local row by deleting from this folder.
      if (folderId > 0 && prev !== undefined) {
        const fresh = summaries.filter((s) => s.uid > prev);
        if (fresh.length > 0) {
          void applyRulesToFresh(accountId, folderId, folderPath, fresh).catch(
            (err) => console.warn("rules engine failed", err),
          );
        }
      }

      // Keep the existing search_index in lockstep so the search overlay
      // continues to work without a code change. This duplicates the data
      // until search migrates to messages_fts, which is acceptable for now.
      for (const s of summaries) {
        void upsertSearchIndex({
          accountId,
          folderPath,
          imapUid: s.uid,
          subject: s.subject,
          fromAddress: s.from,
          toAddresses: s.to.join(", "),
          snippet: s.snippet,
          receivedAt: s.date,
        }).catch(() => {});

        // Seed the composer autocomplete with real senders — skip newsletters
        // and automated transactional mail so the pool stays clean. seedContact
        // only adds new entries; it never bumps interaction_count.
        if (!s.isBulk && !s.isAuto && s.from) {
          const parsed = parseNameEmail(s.from);
          if (parsed) {
            void seedContact(parsed.email, parsed.name).catch(() => {});
          }
        }
      }

      set({ threads, loading: false });
    } catch (err) {
      // On a silent (background) refresh failure we keep the previous
      // threads visible — a transient network blip during sync should not
      // wipe the inbox the user is looking at.
      if (silent) {
        set({ error: String(err), loading: false });
      } else {
        // Non-silent failure with cached threads still visible? Keep them
        // and surface only the error banner. Less destructive than wiping
        // the list whenever the server hiccups.
        set((state) =>
          state.threads.length > 0
            ? { ...state, error: String(err), loading: false }
            : { ...state, error: String(err), loading: false, threads: [] },
        );
      }
    }
  },

  fetchAllUnread: async (accountId, folderPath, folderId) => {
    if (get().loadingMore) return;
    set({ loadingMore: true });
    try {
      const account = await getAccount(accountId);
      if (!account) throw new Error(`account ${accountId} not found`);
      const secrets = await getAccountSecrets(accountId);
      const config = imapConfigFor(account, secrets.imapPassword);

      const summaries = await ipc.imapFetchUnread(config, folderPath, 500);

      // Persist into the same messages table so the cache picks them up on
      // next cold-start. Same shape as fetchFolder's persist branch.
      if (folderId > 0) {
        for (const s of summaries) {
          void upsertMessageSummary({
            accountId,
            folderId,
            imapUid: s.uid,
            messageIdHeader: s.messageId || null,
            inReplyTo: s.inReplyTo || null,
            referencesHeader:
              (s.references ?? []).length > 0 ? (s.references ?? []).join(" ") : null,
            fromAddress: s.from,
            toAddresses: s.to.join(", "),
            subject: s.subject,
            snippet: s.snippet,
            receivedAt: s.date,
            flags: s.flags,
            isUnread: !s.flags.includes("Seen"),
            isStarred: s.flags.includes("Flagged"),
            isImportant: flagsHaveImportant(s.flags),
            hasAttachments: s.hasAttachments,
            isBulk: s.isBulk,
            isAuto: s.isAuto,
          }).catch(() => {});

          void upsertSearchIndex({
            accountId,
            folderPath,
            imapUid: s.uid,
            subject: s.subject,
            fromAddress: s.from,
            toAddresses: s.to.join(", "),
            snippet: s.snippet,
            receivedAt: s.date,
          }).catch(() => {});
        }
      }

      // Re-cohort the merged set (cached + just-fetched) so threading is
      // consistent across the boundary. The DB read covers everything.
      if (folderId > 0) {
        const all = await listMessagesForFolder(folderId, 1000);
        set({
          threads: groupMessagesIntoThreads(all, accountId, folderId),
          loadingMore: false,
        });
      } else {
        // Synthetic folder: just merge into RAM.
        const newThreads = groupSummariesIntoThreads(summaries, accountId, folderId);
        const knownIds = new Set(get().threads.map((t) => t.id));
        const append = newThreads.filter((t) => !knownIds.has(t.id));
        set((state) => ({
          threads: [...state.threads, ...append].sort(
            (a, b) => b.lastMessageAt - a.lastMessageAt,
          ),
          loadingMore: false,
        }));
      }
    } catch (err) {
      console.error("fetchAllUnread failed", err);
      set({ loadingMore: false });
      toast.error(`Load unread failed: ${err}`);
    }
  },

  loadMore: async (accountId, folderPath, folderId) => {
    const { loadingMore, hasMore } = get();
    if (loadingMore || !hasMore) return;

    const key = `${accountId}:${folderId}`;
    const currentPage = pageCountByFolder.get(key) ?? 1;
    const offset = currentPage * PAGE_SIZE;

    set({ loadingMore: true });
    try {
      const account = await getAccount(accountId);
      if (!account) throw new Error(`account ${accountId} not found`);
      const secrets = await getAccountSecrets(accountId);
      const config = imapConfigFor(account, secrets.imapPassword);

      const summaries = await ipc.imapFetchMessages(
        config,
        folderPath,
        PAGE_SIZE,
        offset,
      );

      // Persist the new page so the merged view + future cold-start include it.
      if (folderId > 0) {
        for (const s of summaries) {
          void upsertMessageSummary({
            accountId,
            folderId,
            imapUid: s.uid,
            messageIdHeader: s.messageId || null,
            inReplyTo: s.inReplyTo || null,
            referencesHeader: (s.references ?? []).length > 0 ? (s.references ?? []).join(" ") : null,
            fromAddress: s.from,
            toAddresses: s.to.join(", "),
            subject: s.subject,
            snippet: s.snippet,
            receivedAt: s.date,
            flags: s.flags,
            isUnread: !s.flags.includes("Seen"),
            isStarred: s.flags.includes("Flagged"),
            isImportant: flagsHaveImportant(s.flags),
            hasAttachments: s.hasAttachments,
            isBulk: s.isBulk,
            isAuto: s.isAuto,
          }).catch(() => {});

          void upsertSearchIndex({
            accountId,
            folderPath,
            imapUid: s.uid,
            subject: s.subject,
            fromAddress: s.from,
            toAddresses: s.to.join(", "),
            snippet: s.snippet,
            receivedAt: s.date,
          }).catch(() => {});
        }
      }

      // Re-cohort everything we have on disk so threading stays correct
      // when an old reply belongs to an already-loaded family. Limit doubles
      // each page so we don't truncate older threads.
      if (folderId > 0) {
        const all = await listMessagesForFolder(folderId, (currentPage + 1) * PAGE_SIZE * 4);
        set({
          threads: groupMessagesIntoThreads(all, accountId, folderId),
          loadingMore: false,
          hasMore: summaries.length >= PAGE_SIZE,
        });
      } else {
        // Synthetic folder — no DB to re-read. Append to existing threads
        // (no re-cohorting; threading might be slightly off but acceptable
        // for the very first sync of a brand-new account).
        const newThreads = groupSummariesIntoThreads(summaries, accountId, folderId);
        const knownIds = new Set(get().threads.map((t) => t.id));
        const append = newThreads.filter((t) => !knownIds.has(t.id));
        set((state) => ({
          threads: [...state.threads, ...append].sort(
            (a, b) => b.lastMessageAt - a.lastMessageAt,
          ),
          loadingMore: false,
          hasMore: summaries.length >= PAGE_SIZE,
        }));
      }

      pageCountByFolder.set(key, currentPage + 1);
    } catch (err) {
      console.error("loadMore failed", err);
      set({ loadingMore: false });
      toast.error(`Load more failed: ${err}`);
    }
  },

  setThreads: (threads) => set({ threads }),

  ensureThread: (thread) =>
    set((state) => {
      if (state.threads.some((t) => t.id === thread.id)) return state;
      return { threads: [thread, ...state.threads] };
    }),

  togglePin: (id) =>
    set((state) => ({
      threads: state.threads.map((t) =>
        t.id === id ? { ...t, isPinned: !t.isPinned } : t,
      ),
    })),

  markRead: async (id, opts) => {
    const thread = get().threads.find((t) => t.id === id);
    if (!thread || !thread.hasUnread) return;
    // Read-only browsing mode: skip the +Seen unless the caller forced it.
    const force = opts?.force === true;
    if (!force && useUiStore.getState().dontMarkReadOnOpen) return;
    // Optimistic local update (thread flag + sidebar badge count).
    set((state) => ({
      threads: state.threads.map((t) => (t.id === id ? { ...t, hasUnread: false } : t)),
    }));
    useAccountsStore.getState().adjustFolderUnread(thread.folderId, -1);
    if (thread.folderId > 0) {
      void updateMessageFlags(thread.folderId, thread.id, { isUnread: false }).catch(() => {});
    }
    try {
      const { config, folderPath } = await sessionFor(thread);
      await ipc.imapSetFlags(config, folderPath, thread.id, ["\\Seen"], "add");
    } catch (err) {
      console.error("markRead failed on server:", err);
      // Revert the local count so the sidebar stays truthful.
      useAccountsStore.getState().adjustFolderUnread(thread.folderId, +1);
      set((state) => ({
        threads: state.threads.map((t) =>
          t.id === id ? { ...t, hasUnread: true } : t,
        ),
      }));
      if (thread.folderId > 0) {
        void updateMessageFlags(thread.folderId, thread.id, { isUnread: true }).catch(() => {});
      }
    }
  },

  toggleStar: async (id) => {
    const thread = get().threads.find((t) => t.id === id);
    if (!thread) return;
    const nextPinned = !thread.isPinned;
    set((state) => ({
      threads: state.threads.map((t) => (t.id === id ? { ...t, isPinned: nextPinned } : t)),
    }));
    if (thread.folderId > 0) {
      void updateMessageFlags(thread.folderId, thread.id, { isStarred: nextPinned }).catch(() => {});
    }
    try {
      const { config, folderPath } = await sessionFor(thread);
      await ipc.imapSetFlags(
        config,
        folderPath,
        thread.id,
        ["\\Flagged"],
        nextPinned ? "add" : "remove",
      );
    } catch (err) {
      // Revert on failure.
      set((state) => ({
        threads: state.threads.map((t) =>
          t.id === id ? { ...t, isPinned: !nextPinned } : t,
        ),
      }));
      if (thread.folderId > 0) {
        void updateMessageFlags(thread.folderId, thread.id, { isStarred: !nextPinned }).catch(() => {});
      }
      console.error("toggleStar failed:", err);
      throw err;
    }
  },

  toggleImportance: async (id) => {
    const thread = get().threads.find((t) => t.id === id);
    if (!thread) return;
    const nextImportant = !thread.isImportant;
    set((state) => ({
      threads: state.threads.map((t) =>
        t.id === id ? { ...t, isImportant: nextImportant } : t,
      ),
    }));
    if (thread.folderId > 0) {
      void updateMessageFlags(thread.folderId, thread.id, { isImportant: nextImportant }).catch(() => {});
    }
    try {
      const { config, folderPath } = await sessionFor(thread);
      await ipc.imapSetFlags(
        config,
        folderPath,
        thread.id,
        nextImportant
          ? [IMPORTANT_KEYWORD]
          : [IMPORTANT_KEYWORD, LEGACY_IMPORTANT_KEYWORD],
        nextImportant ? "add" : "remove",
      );
    } catch (err) {
      set((state) => ({
        threads: state.threads.map((t) =>
          t.id === id ? { ...t, isImportant: !nextImportant } : t,
        ),
      }));
      if (thread.folderId > 0) {
        void updateMessageFlags(thread.folderId, thread.id, { isImportant: !nextImportant }).catch(() => {});
      }
      console.error("toggleImportance failed:", err);
      throw err;
    }
  },

  snoozeThread: async (id, untilUnixSeconds) => {
    const thread = get().threads.find((t) => t.id === id);
    if (!thread) return;
    const keyword = snoozeKeyword(untilUnixSeconds);
    // Optimistic: vanish from the visible list (the cohort filter will keep
    // it hidden on subsequent renders too).
    set((state) => ({ threads: state.threads.filter((t) => t.id !== id) }));
    try {
      const { config, folderPath } = await sessionFor(thread);
      await ipc.imapSetFlags(config, folderPath, thread.id, [keyword], "add");
      toast.success("Snoozed");
    } catch (err) {
      restoreThread(set, get, thread);
      console.error("snoozeThread failed:", err);
      toast.error(`Snooze failed: ${err}`);
      throw err;
    }
  },

  unsnoozeThread: async (id) => {
    const thread = get().threads.find((t) => t.id === id);
    if (!thread) return;
    // Find any snooze keyword on the message — could be one or more.
    // (Caller usually just dropped the message back into the visible list,
    // so we don't optimistic-update here.)
    try {
      const { config, folderPath } = await sessionFor(thread);
      // Without persisted flags we don't know the exact keyword string;
      // remove the family with a wildcard send. async-imap accepts any
      // flag string in -FLAGS so we send `Cursus-SnoozedUntil:*` (and the
      // most servers accept as a literal — failing that the keyword
      // simply stays and gets cleared by the periodic checker once we
      // have flags.
      await ipc.imapSetFlags(config, folderPath, thread.id, SNOOZE_REMOVE_GLOBS, "remove").catch(() => {});
    } catch (err) {
      console.warn("unsnoozeThread failed:", err);
    }
  },

  moveToFolder: async (id: number, destPath: string) => {
    const thread = get().threads.find((t) => t.id === id);
    if (!thread) return;
    const sourceFolder = useAccountsStore
      .getState()
      .folders.find((f) => f.id === thread.folderId);
    if (sourceFolder && sourceFolder.path === destPath) return; // no-op
    set((state) => ({ threads: state.threads.filter((t) => t.id !== id) }));
    if (thread.hasUnread) {
      useAccountsStore.getState().adjustFolderUnread(thread.folderId, -1);
    }
    try {
      const { config, folderPath } = await sessionFor(thread);
      await ipc.imapMoveUid(config, folderPath, destPath, thread.id);
      if (thread.folderId > 0) {
        void deleteMessage(thread.folderId, thread.id).catch(() => {});
      }
      toast.success(`Moved to ${displayPathName(destPath)}`);
    } catch (err) {
      restoreThread(set, get, thread);
      if (thread.hasUnread) {
        useAccountsStore.getState().adjustFolderUnread(thread.folderId, +1);
      }
      console.error("moveToFolder failed:", err);
      toast.error(`Move failed: ${err}`);
      throw err;
    }
  },

  archiveThread: async (id) => {
    const thread = get().threads.find((t) => t.id === id);
    if (!thread) return;
    const dest = findFolderPath(thread.accountId, "archive") ?? "Archive";
    set((state) => ({ threads: state.threads.filter((t) => t.id !== id) }));
    // Moving an unread message out of the current folder drops the badge.
    if (thread.hasUnread) {
      useAccountsStore.getState().adjustFolderUnread(thread.folderId, -1);
    }
    try {
      const { config, folderPath } = await sessionFor(thread);
      await ipc.imapMoveUid(config, folderPath, dest, thread.id);
      // Removed from the source folder on the server — drop the cached row
      // here too so cold-start doesn't show a phantom thread.
      if (thread.folderId > 0) {
        void deleteMessage(thread.folderId, thread.id).catch(() => {});
      }
      toast.success("Archived");
    } catch (err) {
      restoreThread(set, get, thread);
      if (thread.hasUnread) {
        useAccountsStore.getState().adjustFolderUnread(thread.folderId, +1);
      }
      console.error("archiveThread failed:", err);
      toast.error(`Archive failed: ${err}`);
      throw err;
    }
  },

  trashThread: async (id) => {
    const thread = get().threads.find((t) => t.id === id);
    if (!thread) return;
    const dest = findFolderPath(thread.accountId, "trash") ?? "Trash";
    set((state) => ({ threads: state.threads.filter((t) => t.id !== id) }));
    if (thread.hasUnread) {
      useAccountsStore.getState().adjustFolderUnread(thread.folderId, -1);
    }
    try {
      const { config, folderPath } = await sessionFor(thread);
      await ipc.imapMoveUid(config, folderPath, dest, thread.id);
      if (thread.folderId > 0) {
        void deleteMessage(thread.folderId, thread.id).catch(() => {});
      }
      toast.success("Moved to Trash");
    } catch (err) {
      restoreThread(set, get, thread);
      if (thread.hasUnread) {
        useAccountsStore.getState().adjustFolderUnread(thread.folderId, +1);
      }
      console.error("trashThread failed:", err);
      toast.error(`Trash failed: ${err}`);
      throw err;
    }
  },

  markAsSpam: async (id) => {
    const thread = get().threads.find((t) => t.id === id);
    if (!thread) return;
    const dest = findFolderPath(thread.accountId, "spam");
    if (!dest) {
      toast.error("No Spam folder found for this account");
      return;
    }
    // Optimistic: remove from list.
    set((state) => ({ threads: state.threads.filter((t) => t.id !== id) }));
    if (thread.hasUnread) {
      useAccountsStore.getState().adjustFolderUnread(thread.folderId, -1);
    }
    try {
      const { config, folderPath } = await sessionFor(thread);
      // Keyword contract per IANA: set $Junk, remove $NotJunk, then move.
      // Two calls because imap_set_flags takes a single mode; the extra
      // round-trip isn't noticeable in practice.
      await ipc.imapSetFlags(config, folderPath, thread.id, ["$Junk"], "add");
      await ipc
        .imapSetFlags(config, folderPath, thread.id, ["$NotJunk"], "remove")
        .catch(() => {});
      await ipc.imapMoveUid(config, folderPath, dest, thread.id);
      if (thread.folderId > 0) {
        void deleteMessage(thread.folderId, thread.id).catch(() => {});
      }
      toast.success("Moved to Spam");
    } catch (err) {
      restoreThread(set, get, thread);
      if (thread.hasUnread) {
        useAccountsStore.getState().adjustFolderUnread(thread.folderId, +1);
      }
      console.error("markAsSpam failed:", err);
      toast.error(`Mark as spam failed: ${err}`);
      throw err;
    }
  },

  markAsNotSpam: async (id) => {
    const thread = get().threads.find((t) => t.id === id);
    if (!thread) return;
    const dest = findFolderPath(thread.accountId, "inbox") ?? "INBOX";
    // Optimistic: remove from Junk list.
    set((state) => ({ threads: state.threads.filter((t) => t.id !== id) }));
    if (thread.hasUnread) {
      useAccountsStore.getState().adjustFolderUnread(thread.folderId, -1);
    }
    try {
      const { config, folderPath } = await sessionFor(thread);
      // Correction before the move so server-side filters can pick up the
      // $NotJunk signal while the message is still in the Junk folder.
      await ipc.imapSetFlags(config, folderPath, thread.id, ["$NotJunk"], "add");
      await ipc
        .imapSetFlags(config, folderPath, thread.id, ["$Junk"], "remove")
        .catch(() => {});
      await ipc.imapMoveUid(config, folderPath, dest, thread.id);
      if (thread.folderId > 0) {
        void deleteMessage(thread.folderId, thread.id).catch(() => {});
      }
      toast.success("Moved to Inbox");
    } catch (err) {
      restoreThread(set, get, thread);
      if (thread.hasUnread) {
        useAccountsStore.getState().adjustFolderUnread(thread.folderId, +1);
      }
      console.error("markAsNotSpam failed:", err);
      toast.error(`Mark as not spam failed: ${err}`);
      throw err;
    }
  },

  archiveMany: async (ids) => {
    const idSet = new Set(ids);
    const targets = get().threads.filter((t) => idSet.has(t.id));
    if (targets.length === 0) return;
    set((state) => ({ threads: state.threads.filter((t) => !idSet.has(t.id)) }));
    const perFolder = new Map<number, number>();
    for (const t of targets) {
      if (t.hasUnread)
        perFolder.set(t.folderId, (perFolder.get(t.folderId) ?? 0) + 1);
    }
    const accounts = useAccountsStore.getState();
    for (const [f, n] of perFolder) accounts.adjustFolderUnread(f, -n);

    const failed: Thread[] = [];
    await runBulk(targets, async (thread) => {
      try {
        const dest = findFolderPath(thread.accountId, "archive") ?? "Archive";
        const { config, folderPath } = await sessionFor(thread);
        await ipc.imapMoveUid(config, folderPath, dest, thread.id);
        if (thread.folderId > 0) {
          void deleteMessage(thread.folderId, thread.id).catch(() => {});
        }
      } catch (err) {
        failed.push(thread);
        console.error("archiveMany: thread failed:", err);
      }
    });
    if (failed.length > 0) {
      restoreThreads(set, get, failed);
      const failedPer = new Map<number, number>();
      for (const t of failed) {
        if (t.hasUnread)
          failedPer.set(t.folderId, (failedPer.get(t.folderId) ?? 0) + 1);
      }
      for (const [f, n] of failedPer) accounts.adjustFolderUnread(f, +n);
      toast.error(`Archive failed for ${failed.length} of ${targets.length}`);
    } else {
      toast.success(
        targets.length === 1 ? "Archived" : `Archived ${targets.length} conversations`,
      );
    }
  },

  trashMany: async (ids) => {
    const idSet = new Set(ids);
    const targets = get().threads.filter((t) => idSet.has(t.id));
    if (targets.length === 0) return;
    set((state) => ({ threads: state.threads.filter((t) => !idSet.has(t.id)) }));
    const perFolder = new Map<number, number>();
    for (const t of targets) {
      if (t.hasUnread)
        perFolder.set(t.folderId, (perFolder.get(t.folderId) ?? 0) + 1);
    }
    const accounts = useAccountsStore.getState();
    for (const [f, n] of perFolder) accounts.adjustFolderUnread(f, -n);

    const failed: Thread[] = [];
    await runBulk(targets, async (thread) => {
      try {
        const dest = findFolderPath(thread.accountId, "trash") ?? "Trash";
        const { config, folderPath } = await sessionFor(thread);
        await ipc.imapMoveUid(config, folderPath, dest, thread.id);
        if (thread.folderId > 0) {
          void deleteMessage(thread.folderId, thread.id).catch(() => {});
        }
      } catch (err) {
        failed.push(thread);
        console.error("trashMany: thread failed:", err);
      }
    });
    if (failed.length > 0) {
      restoreThreads(set, get, failed);
      const failedPer = new Map<number, number>();
      for (const t of failed) {
        if (t.hasUnread)
          failedPer.set(t.folderId, (failedPer.get(t.folderId) ?? 0) + 1);
      }
      for (const [f, n] of failedPer) accounts.adjustFolderUnread(f, +n);
      toast.error(`Trash failed for ${failed.length} of ${targets.length}`);
    } else {
      toast.success(
        targets.length === 1
          ? "Moved to Trash"
          : `Moved ${targets.length} conversations to Trash`,
      );
    }
  },

  markManyRead: async (ids) => {
    const idSet = new Set(ids);
    const targets = get().threads.filter((t) => idSet.has(t.id) && t.hasUnread);
    if (targets.length === 0) return;
    // Optimistic local update — thread flags + sidebar badge totals.
    set((state) => ({
      threads: state.threads.map((t) =>
        idSet.has(t.id) ? { ...t, hasUnread: false } : t,
      ),
    }));
    const perFolder = new Map<number, number>();
    for (const t of targets) {
      perFolder.set(t.folderId, (perFolder.get(t.folderId) ?? 0) + 1);
    }
    const accounts = useAccountsStore.getState();
    for (const [folderId, n] of perFolder) accounts.adjustFolderUnread(folderId, -n);

    const failed: Thread[] = [];
    await runBulk(targets, async (thread) => {
      try {
        const { config, folderPath } = await sessionFor(thread);
        await ipc.imapSetFlags(config, folderPath, thread.id, ["\\Seen"], "add");
        if (thread.folderId > 0) {
          void updateMessageFlags(thread.folderId, thread.id, { isUnread: false }).catch(() => {});
        }
      } catch (err) {
        failed.push(thread);
        console.error("markManyRead: thread failed:", err);
      }
    });
    if (failed.length > 0) {
      const failedIds = new Set(failed.map((t) => t.id));
      set((state) => ({
        threads: state.threads.map((t) =>
          failedIds.has(t.id) ? { ...t, hasUnread: true } : t,
        ),
      }));
      // Restore the failed ones in the sidebar badge too.
      const failedPerFolder = new Map<number, number>();
      for (const t of failed) {
        failedPerFolder.set(
          t.folderId,
          (failedPerFolder.get(t.folderId) ?? 0) + 1,
        );
      }
      for (const [folderId, n] of failedPerFolder) {
        accounts.adjustFolderUnread(folderId, +n);
      }
      toast.error(`Mark read failed for ${failed.length} of ${targets.length}`);
    } else {
      toast.success(
        targets.length === 1
          ? "Marked as read"
          : `Marked ${targets.length} as read`,
      );
    }
  },

  toggleStarMany: async (ids) => {
    const idSet = new Set(ids);
    const targets = get().threads.filter((t) => idSet.has(t.id));
    if (targets.length === 0) return;
    // If any are unstarred, star them all; otherwise unstar all. Matches
    // Gmail/Spark behaviour for the bulk "toggle" action.
    const anyUnstarred = targets.some((t) => !t.isPinned);
    const nextPinned = anyUnstarred;
    set((state) => ({
      threads: state.threads.map((t) =>
        idSet.has(t.id) ? { ...t, isPinned: nextPinned } : t,
      ),
    }));
    await runBulk(targets, async (thread) => {
      const { config, folderPath } = await sessionFor(thread);
      await ipc.imapSetFlags(
        config,
        folderPath,
        thread.id,
        ["\\Flagged"],
        nextPinned ? "add" : "remove",
      );
      if (thread.folderId > 0) {
        void updateMessageFlags(thread.folderId, thread.id, { isStarred: nextPinned }).catch(() => {});
      }
    });
  },
}));

function restoreThread(_set: unknown, _get: unknown, thread: Thread): void {
  useThreadsStore.setState((state) => {
    if (state.threads.some((t) => t.id === thread.id)) return {};
    return {
      threads: [...state.threads, thread].sort(
        (a, b) => b.lastMessageAt - a.lastMessageAt,
      ),
    };
  });
}

function restoreThreads(_set: unknown, _get: unknown, threads: Thread[]): void {
  useThreadsStore.setState((state) => {
    const existing = new Set(state.threads.map((t) => t.id));
    const missing = threads.filter((t) => !existing.has(t.id));
    if (missing.length === 0) return {};
    return {
      threads: [...state.threads, ...missing].sort(
        (a, b) => b.lastMessageAt - a.lastMessageAt,
      ),
    };
  });
}

async function runBulk<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  const limit = 3;
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      const item = items[idx];
      if (item === undefined) return;
      try {
        await worker(item);
      } catch (err) {
        console.error("bulk worker failed:", err);
      }
    }
  });
  await Promise.all(runners);
}

function imapConfigFor(account: StoredAccount, password: string): ImapConfig {
  return {
    host: account.imap_host,
    port: account.imap_port,
    username: account.imap_username ?? account.email,
    password,
    security: account.imap_security,
  };
}

async function sessionFor(thread: Thread): Promise<{
  config: ImapConfig;
  folderPath: string;
}> {
  const account = await getAccount(thread.accountId);
  if (!account) throw new Error(`account ${thread.accountId} not found`);
  const secrets = await getAccountSecrets(thread.accountId);
  const folder = useAccountsStore
    .getState()
    .folders.find((f) => f.id === thread.folderId);
  if (!folder) throw new Error(`folder ${thread.folderId} not found`);
  return {
    config: imapConfigFor(account, secrets.imapPassword),
    folderPath: folder.path,
  };
}

// Automated local-parts found in `user@domain`. Case-insensitive, matches
// the common conventions (noreply, notifications, alerts, automated, etc.).
const AUTO_LOCAL_PART =
  /^(no[-._]?reply|do[-._]?not[-._]?reply|notifications?|alerts?|automated?|auto|system|support|updates?|mailer|postmaster|bounces?|news)$/i;

function extractEmailAddress(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  return (m && m[1] ? m[1] : raw).trim();
}

function inferCategoryFromFlags(
  isBulk: boolean,
  isAuto: boolean,
  fromHeader: string,
): MailCategory | null {
  if (isBulk) return "newsletters";
  if (isAuto) return "notifications";
  const addr = extractEmailAddress(fromHeader);
  const local = addr.split("@")[0] ?? "";
  if (local && AUTO_LOCAL_PART.test(local)) return "notifications";
  return "people";
}

function findFolderPath(
  accountId: number,
  specialUse: "archive" | "trash" | "sent" | "drafts" | "inbox" | "spam",
): string | null {
  const folders = useAccountsStore.getState().folders;
  const match = folders.find(
    (f) => f.accountId === accountId && f.specialUse === specialUse,
  );
  return match?.path ?? null;
}

function displayPathName(path: string): string {
  // Take leaf after `/` or `.` separator. Fallback to full path.
  const parts = path.split(/[\/.]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}
