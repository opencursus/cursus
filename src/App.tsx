import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { Shell } from "@/components/layout/Shell";
import { useAccountsStore } from "@/stores/accounts";
import { useThreadsStore } from "@/stores/threads";
import { useUiStore } from "@/stores/ui";
import { useComposerStore } from "@/stores/composer";
import { useKeyboardShortcuts } from "@/lib/keyboard";
import { ipc, type ImapUpdateEvent } from "@/lib/ipc";
import {
  deleteScheduledSend,
  getAccount,
  getAccountSecrets,
  listDueScheduledSends,
  listMessagesForFolder,
  replaceMessageFlags,
  type DraftMode,
} from "@/lib/db";
import { getSnoozeUntil, isSnoozeFlag } from "@/lib/snooze";
import { executeOutgoingSend, type SendPayload } from "@/lib/sender";
import { registerOutboxDrain } from "@/lib/outbox";
import { fetchAvailableUpdate } from "@/lib/updates";
import { toast } from "@/stores/toasts";

export default function App() {
  useKeyboardShortcuts();
  const syncIntervalMs = useUiStore((s) => s.syncIntervalMs);
  const activeAccountId = useAccountsStore((s) => s.activeAccountId);
  const activeFolderId = useAccountsStore((s) => s.activeFolderId);
  const selectedThreadId = useUiStore((s) => s.selectedThreadId);

  // Auto mark-as-read on selection — covers click, j/k, Enter, and any other
  // path that flips selectedThreadId. markRead is a no-op if the thread is
  // already read or if the user has dontMarkReadOnOpen on, so calling here
  // unconditionally is safe.
  useEffect(() => {
    if (selectedThreadId == null) return;
    void useThreadsStore.getState().markRead(selectedThreadId).catch(() => {});
  }, [selectedThreadId]);

  // ── IMAP IDLE wiring ────────────────────────────────────────────────────
  // 1) When the active (account, folder) changes, stop any prior IDLE and
  //    start a new one for the new pair. The Rust task pushes a single
  //    `imap-update` event whenever the server signals EXISTS / EXPUNGE.
  // 2) A single global listener calls fetchFolder(silent) on every event
  //    that matches the user's current view. For events targeting other
  //    folders we still want eventual delivery, but the visible inbox is
  //    the priority — the regular sync interval will mop up the rest.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listen<ImapUpdateEvent>("imap-update", (event) => {
      const ui = useUiStore.getState();
      if (useComposerStore.getState().open || ui.settingsOpen) return;
      const accounts = useAccountsStore.getState();
      const folder = accounts.folders.find(
        (f) => f.accountId === event.payload.accountId && f.path === event.payload.folder,
      );
      if (!folder) return;
      // Only refresh the visible folder. New mail in other folders bumps
      // unreadCount on the next folder_status / poll tick.
      if (
        accounts.activeAccountId !== event.payload.accountId ||
        accounts.activeFolderId !== folder.id
      )
        return;
      void useThreadsStore
        .getState()
        .fetchFolder(event.payload.accountId, folder.path, folder.id, { silent: true });
    }).then((u) => {
      unlisten = u;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (activeAccountId == null || activeFolderId == null) return;
    const folder = useAccountsStore.getState().folders.find((f) => f.id === activeFolderId);
    if (!folder) return;
    let cancelled = false;

    void (async () => {
      try {
        const account = await getAccount(activeAccountId);
        if (!account || cancelled) return;
        const secrets = await getAccountSecrets(activeAccountId);
        if (cancelled) return;
        await ipc.imapIdleStart(activeAccountId, {
          host: account.imap_host,
          port: account.imap_port,
          username: account.imap_username ?? account.email,
          password: secrets.imapPassword,
          security: account.imap_security,
        }, folder.path);
      } catch (err) {
        // Push-receive is a nice-to-have; silent failure (we still poll).
        console.warn("imap_idle_start failed:", err);
      }
    })();

    return () => {
      cancelled = true;
      void ipc.imapIdleStop(activeAccountId, folder.path).catch(() => {});
    };
  }, [activeAccountId, activeFolderId]);

  useEffect(() => {
    function refresh() {
      // Never run a background refresh while the user is in a modal
      // (writing an email, tweaking settings, searching). The interval
      // tick that follows the modal closing will catch everything up, and
      // avoiding the re-render here keeps the composer editor from losing
      // focus mid-sentence.
      const ui = useUiStore.getState();
      if (useComposerStore.getState().open) return;
      if (ui.settingsOpen) return;
      if (ui.searchOpen) return;

      const { activeAccountId, activeFolderId, folders } = useAccountsStore.getState();
      if (!activeAccountId || !activeFolderId) return;
      const folder = folders.find((f) => f.id === activeFolderId);
      if (!folder) return;
      void useThreadsStore
        .getState()
        .fetchFolder(activeAccountId, folder.path, folder.id, { silent: true });
    }

    // syncIntervalMs === 0 means Manual — skip the setInterval but keep
    // the focus / online triggers active so refresh still fires on resume.
    const intervalId =
      syncIntervalMs > 0
        ? window.setInterval(() => {
            if (document.visibilityState === "visible") refresh();
          }, syncIntervalMs)
        : null;

    function onVisibility() {
      if (document.visibilityState === "visible") refresh();
    }
    function onOnline() {
      refresh();
    }

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);

    return () => {
      if (intervalId != null) window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [syncIntervalMs]);

  // ── Periodic badge resync ───────────────────────────────────────────────
  // Optimistic adjustFolderUnread keeps the taskbar badge close to reality,
  // but a dropped IDLE event or a server-side flag change made elsewhere
  // (webmail, other client) leaves it drifting. Every 30s — and on every
  // visibility / online flip — we re-pull IMAP STATUS UNSEEN for each inbox
  // folder and apply the authoritative count. Cheap one-line round-trip
  // per inbox and self-corrects within a tick when the user reads on another
  // device.
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      if (cancelled) return;
      const accountsState = useAccountsStore.getState();
      const inboxes = accountsState.folders.filter(
        (f) => f.specialUse === "inbox" && f.id > 0,
      );
      if (inboxes.length === 0) return;
      // Avoid disturbing the active view while the user is composing or
      // configuring; the next visibility-change tick will catch up.
      if (useComposerStore.getState().open) return;
      if (useUiStore.getState().settingsOpen) return;
      await Promise.all(
        inboxes.map(async (folder) => {
          try {
            const account = await getAccount(folder.accountId);
            if (!account) return;
            const secrets = await getAccountSecrets(folder.accountId);
            const config = {
              host: account.imap_host,
              port: account.imap_port,
              username: account.imap_username ?? account.email,
              password: secrets.imapPassword,
              security: account.imap_security,
            } as const;
            const status = await ipc.imapFolderStatus(config, folder.path);
            if (cancelled) return;
            useAccountsStore.setState((state) => ({
              folders: state.folders.map((f) =>
                f.id === folder.id ? { ...f, unreadCount: status.unseen } : f,
              ),
            }));
          } catch {
            // Network blip, expired session, server hiccup — ignore. The
            // next tick / IDLE round will resync.
          }
        }),
      );
    }
    function visTick() {
      if (document.visibilityState === "visible") void tick();
    }
    const id = window.setInterval(visTick, 30_000);
    document.addEventListener("visibilitychange", visTick);
    window.addEventListener("online", visTick);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", visTick);
      window.removeEventListener("online", visTick);
    };
  }, []);

  // ── Snooze checker ──────────────────────────────────────────────────────
  // Every minute: walk persisted messages in every folder, find ones whose
  // Cursus-SnoozedUntil deadline has passed, and remove the keyword on the
  // server. The next IMAP sync (or IDLE event) brings the message back into
  // the visible thread list automatically because the snooze filter then
  // returns false.
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      if (cancelled) return;
      try {
        const accounts = useAccountsStore.getState();
        for (const folder of accounts.folders) {
          if (folder.id <= 0) continue; // synthetic
          if (folder.specialUse !== "inbox") continue; // only check Inbox to keep this cheap
          const rows = await listMessagesForFolder(folder.id, 500);
          for (const r of rows) {
            if (!r.flags) continue;
            let parsed: string[] = [];
            try {
              parsed = JSON.parse(r.flags) as string[];
            } catch {
              continue;
            }
            const until = getSnoozeUntil(parsed);
            if (until == null) continue;
            if (until * 1000 > Date.now()) continue;
            // Deadline passed — strip every snooze keyword we find. The
            // local DB row gets cleared on the next sync; for now we just
            // tell the server.
            try {
              const account = await getAccount(folder.accountId);
              if (!account) continue;
              const secrets = await getAccountSecrets(folder.accountId);
              const config = {
                host: account.imap_host,
                port: account.imap_port,
                username: account.imap_username ?? account.email,
                password: secrets.imapPassword,
                security: account.imap_security,
              } as const;
              const snoozeFlags = parsed.filter(isSnoozeFlag);
              await ipc.imapSetFlagsBulk(
                config,
                folder.path,
                [r.imap_uid],
                snoozeFlags,
                "remove",
              );
              // Clear them from the local row too so the UI re-surfaces the
              // thread on the next re-cohort instead of waiting for a full
              // sync round-trip to confirm.
              const remaining = parsed.filter((f) => !isSnoozeFlag(f));
              await replaceMessageFlags(folder.id, r.imap_uid, remaining).catch(
                (err) => console.warn("snooze checker: local flag clear failed", err),
              );
            } catch (err) {
              console.warn("snooze checker: IMAP unset failed", err);
            }
          }
        }
      } catch (err) {
        console.warn("snooze checker tick failed", err);
      }
    }
    const id = window.setInterval(tick, 60_000);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // ── Scheduled-sends / outbox worker ─────────────────────────────────────
  // Once a minute — plus immediately when connectivity returns or a send
  // path calls drainOutboxNow() — drain the scheduled_sends table for
  // entries whose deadline has passed and dispatch them through the same
  // sender.ts pipeline as a normal send. Successful sends delete the row;
  // failures keep it so the next tick retries rather than losing mail.
  // Failure toasts are throttled per row (first attempt, then every 10th)
  // so an offline hour doesn't produce sixty error toasts.
  useEffect(() => {
    let cancelled = false;
    let running = false;
    let rerun = false;
    const attempts = new Map<number, number>();
    async function tick() {
      if (cancelled) return;
      // A drain request landing mid-run (two undo-sends back to back) marks
      // rerun so the fresh row goes out right after, not on the next tick.
      if (running) {
        rerun = true;
        return;
      }
      running = true;
      try {
        const due = await listDueScheduledSends(Math.floor(Date.now() / 1000));
        for (const entry of due) {
          let payload: SendPayload;
          try {
            payload = JSON.parse(entry.payload_json) as SendPayload;
          } catch (err) {
            console.warn("scheduled send: bad payload, dropping", err);
            await deleteScheduledSend(entry.id).catch(() => {});
            continue;
          }
          try {
            await executeOutgoingSend(payload, {
              accountId: entry.account_id,
              mode: (entry.mode as DraftMode) ?? "new",
              replyUid: entry.reply_uid,
              draftId: entry.draft_id,
            });
            await deleteScheduledSend(entry.id);
            attempts.delete(entry.id);
            toast.success("Message sent");
          } catch (err) {
            const n = (attempts.get(entry.id) ?? 0) + 1;
            attempts.set(entry.id, n);
            console.error(`outbox send failed (attempt ${n})`, err);
            if (n === 1) {
              toast.error(`Send failed — kept in Outbox, will retry: ${err}`);
            } else if (n % 10 === 0) {
              toast.error(`Still can't send (${n} attempts): ${err}`);
            }
            // Row stays; Settings → Outbox offers manual cancel/edit.
          }
        }
      } catch (err) {
        console.warn("scheduled sends worker tick failed", err);
      } finally {
        running = false;
        if (rerun && !cancelled) {
          rerun = false;
          void tick();
        }
      }
    }
    const id = window.setInterval(tick, 60_000);
    const onOnline = () => void tick();
    window.addEventListener("online", onOnline);
    registerOutboxDrain(() => void tick());
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("online", onOnline);
      registerOutboxDrain(null);
    };
  }, []);

  // ── Startup update check ────────────────────────────────────────────────
  // Portable-exe distribution has no installer-driven updater, so once per
  // launch (delayed so it never competes with the first sync) we compare the
  // newest GitHub release against the running version and offer the download
  // page. Failures are silent — the About section has a manual check.
  useEffect(() => {
    const id = window.setTimeout(async () => {
      try {
        const update = await fetchAvailableUpdate();
        if (!update) return;
        toast.push({
          kind: "info",
          message: `Cursus ${update.latest} is available (you have ${update.current}).`,
          durationMs: 15000,
          action: {
            label: "Download",
            onClick: () => {
              void import("@tauri-apps/plugin-opener").then(({ openUrl }) =>
                openUrl(update.url),
              );
            },
          },
        });
      } catch {
        // Offline or rate-limited — try again next launch.
      }
    }, 15_000);
    return () => window.clearTimeout(id);
  }, []);

  return <Shell />;
}
