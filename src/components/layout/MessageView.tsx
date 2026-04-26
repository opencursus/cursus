import { useEffect, useState } from "react";
import {
  Reply,
  ReplyAll,
  Forward,
  Archive,
  Trash2,
  Star,
  Clock,
  MoreHorizontal,
  Inbox as InboxIcon,
  Loader2,
  AlertCircle,
  Paperclip,
  Download,
  Ban,
  ShieldCheck,
  BellOff,
} from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cn } from "@/lib/cn";
import { useAccountsStore } from "@/stores/accounts";
import { useThreadsStore } from "@/stores/threads";
import { useUiStore } from "@/stores/ui";
import { useBodiesStore } from "@/stores/bodies";
import { useComposerStore } from "@/stores/composer";
import { Avatar } from "@/components/mail/Avatar";
import { HtmlViewer } from "@/components/mail/HtmlViewer";
import { addressName, formatRelativeTime } from "@/lib/time";
import { getAccount, getAccountSecrets } from "@/lib/db";
import { ipc, type Attachment, type UnsubscribeInfo } from "@/lib/ipc";
import { toast } from "@/stores/toasts";
import { SNOOZE_PRESETS } from "@/lib/snooze";
import type { Thread } from "@/types";

export function MessageView() {
  const selectedThreadId = useUiStore((s) => s.selectedThreadId);
  const threads = useThreadsStore((s) => s.threads);
  const activeAccountId = useAccountsStore((s) => s.activeAccountId);
  const accounts = useAccountsStore((s) => s.accounts);
  const activeFolderId = useAccountsStore((s) => s.activeFolderId);
  const folders = useAccountsStore((s) => s.folders);
  const fetchBody = useBodiesStore((s) => s.fetchBody);
  const bodies = useBodiesStore((s) => s.bodies);
  const loading = useBodiesStore((s) => s.loading);
  const errors = useBodiesStore((s) => s.errors);
  const openReply = useComposerStore((s) => s.openReply);
  const openReplyAll = useComposerStore((s) => s.openReplyAll);
  const openForward = useComposerStore((s) => s.openForward);
  const toggleStar = useThreadsStore((s) => s.toggleStar);
  const archiveThread = useThreadsStore((s) => s.archiveThread);
  const trashThread = useThreadsStore((s) => s.trashThread);
  const markAsSpam = useThreadsStore((s) => s.markAsSpam);
  const markAsNotSpam = useThreadsStore((s) => s.markAsNotSpam);
  const openComposeWith = useComposerStore((s) => s.openComposeWith);
  const selectThread = useUiStore((s) => s.selectThread);

  const thread = threads.find((t) => t.id === selectedThreadId);
  const activeFolder = folders.find((f) => f.id === activeFolderId);
  const activeAccount = accounts.find((a) => a.id === activeAccountId);

  useEffect(() => {
    if (selectedThreadId && activeAccountId && activeFolder) {
      fetchBody(activeAccountId, activeFolder.path, selectedThreadId);
    }
  }, [selectedThreadId, activeAccountId, activeFolder?.path, fetchBody]);

  if (!thread) {
    return <EmptyReadingPane />;
  }

  const senderRaw = thread.participants[0] ?? "Unknown";
  const senderName = addressName(senderRaw) || senderRaw;
  const body = bodies[thread.id];
  const isLoading = loading[thread.id];
  const err = errors[thread.id];

  const canReply = Boolean(activeAccount && !isLoading);
  const handleReply = () => {
    if (!thread) return;
    openReply(thread, body?.html ?? null, body?.text ?? null, activeAccount?.signatureHtml ?? null);
  };
  const handleReplyAll = () => {
    if (!thread || !activeAccount) return;
    openReplyAll(
      thread,
      body?.html ?? null,
      body?.text ?? null,
      activeAccount.email,
      activeAccount.signatureHtml,
    );
  };
  const handleForward = () => {
    if (!thread) return;
    openForward(thread, body?.html ?? null, body?.text ?? null, activeAccount?.signatureHtml ?? null);
  };

  return (
    <section className="flex flex-col bg-raised overflow-hidden fade-in" aria-label="Reading pane">
      <header className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-soft shrink-0">
        <div className="flex-1 min-w-0">
          <h2 className="text-[18px] font-semibold text-primary leading-snug">
            {thread.subject}
          </h2>
          <p className="text-[12px] text-muted mt-0.5">
            {thread.messageCount} {thread.messageCount === 1 ? "message" : "messages"}
            {" · "}
            {thread.participants.map((p) => addressName(p) || p).join(", ")}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-4">
          <ActionButton
            label={thread.isPinned ? "Unstar" : "Star"}
            active={thread.isPinned}
            onClick={() => void toggleStar(thread.id)}
          >
            <Star size={15} fill={thread.isPinned ? "currentColor" : "none"} />
          </ActionButton>
          <SnoozeMenu thread={thread} />
          {/* Replaced the disabled placeholder; SnoozeMenu wraps an
              ActionButton with the same Clock icon and opens a dropdown. */}
          <ActionButton
            label="Archive"
            onClick={() => {
              const id = thread.id;
              selectThread(null);
              void archiveThread(id);
            }}
          >
            <Archive size={15} />
          </ActionButton>
          <ActionButton
            label="Trash"
            onClick={() => {
              const id = thread.id;
              selectThread(null);
              void trashThread(id);
            }}
          >
            <Trash2 size={15} />
          </ActionButton>
          {activeFolder?.specialUse === "spam" ? (
            <ActionButton
              label="Not spam"
              onClick={() => {
                const id = thread.id;
                selectThread(null);
                void markAsNotSpam(id);
              }}
            >
              <ShieldCheck size={15} />
            </ActionButton>
          ) : (
            <ActionButton
              label="Mark as spam"
              onClick={() => {
                const id = thread.id;
                selectThread(null);
                void markAsSpam(id);
              }}
            >
              <Ban size={15} />
            </ActionButton>
          )}
          <Divider />
          <ActionButton label="More"><MoreHorizontal size={15} /></ActionButton>
        </div>
      </header>

      <div className="flex items-center gap-3 px-6 py-3 border-b border-soft shrink-0">
        <Avatar name={senderName} size={40} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13.5px] font-semibold text-primary truncate">
              {senderName}
            </span>
            <span className="text-[12px] text-muted truncate">
              {extractEmailLabel(senderRaw)}
            </span>
          </div>
          <div className="text-[12px] text-muted">
            {formatRelativeTime(thread.lastMessageAt)}
          </div>
        </div>
      </div>

      {body?.unsubscribe && (
        <UnsubscribeBanner
          info={body.unsubscribe}
          senderLabel={senderName}
          onMailto={(to, subject, bodyText) =>
            openComposeWith({
              to,
              subject,
              bodyHtml: bodyText
                ? `<p>${bodyText.replace(/</g, "&lt;")}</p>`
                : "<p></p>",
            })
          }
        />
      )}

      {body?.attachments && body.attachments.length > 0 && activeAccountId && activeFolder && (
        <AttachmentStrip
          attachments={body.attachments}
          accountId={activeAccountId}
          folderPath={activeFolder.path}
          uid={thread.id}
        />
      )}

      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="h-full flex items-center justify-center text-muted text-[12.5px]">
            <Loader2 size={16} className="animate-spin mr-2" />
            Loading message…
          </div>
        ) : err ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6">
            <AlertCircle size={20} className="text-[color:var(--color-danger)] mb-2" />
            <p className="text-[13px] text-primary font-medium">Could not load message</p>
            <p className="text-[12px] text-muted mt-1 max-w-sm break-words">{err}</p>
          </div>
        ) : body?.html ? (
          <HtmlViewer html={body.html} uid={thread.id} />
        ) : body?.text ? (
          <pre className="p-6 text-[13px] text-primary whitespace-pre-wrap font-sans leading-relaxed">
            {body.text}
          </pre>
        ) : (
          <div className="p-6 text-[13px] text-muted">
            {thread.snippet || "No content."}
          </div>
        )}
      </div>

      <footer className="flex items-center gap-2 px-6 py-3 border-t border-soft shrink-0">
        <ReplyButton onClick={handleReply} disabled={!canReply}>
          <Reply size={14} /> Reply
        </ReplyButton>
        <ReplyButton onClick={handleReplyAll} disabled={!canReply}>
          <ReplyAll size={14} /> Reply all
        </ReplyButton>
        <ReplyButton onClick={handleForward} disabled={!canReply}>
          <Forward size={14} /> Forward
        </ReplyButton>
      </footer>
    </section>
  );
}

function EmptyReadingPane() {
  return (
    <section className="flex items-center justify-center bg-raised">
      <div className="flex flex-col items-center text-center max-w-xs">
        <div
          className="h-14 w-14 rounded-full flex items-center justify-center mb-4"
          style={{ background: "var(--accent-soft)" }}
        >
          <InboxIcon size={20} className="text-accent" />
        </div>
        <h3 className="text-[14px] font-semibold text-primary">Nothing selected</h3>
        <p className="text-[12.5px] text-muted mt-1">
          Pick a conversation from the list to read it here.
        </p>
      </div>
    </section>
  );
}

function ActionButton({
  children,
  label,
  onClick,
  disabled,
  active,
}: {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
        active ? "text-accent" : "text-muted",
        !disabled && "hover:bg-hover hover:text-primary",
        disabled && "opacity-40 cursor-not-allowed",
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="h-5 w-px mx-1 bg-[color:var(--border-strong)]" />;
}

function extractEmailLabel(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  return m && m[1] ? `<${m[1]}>` : "";
}

function AttachmentStrip({
  attachments,
  accountId,
  folderPath,
  uid,
}: {
  attachments: Attachment[];
  accountId: number;
  folderPath: string;
  uid: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-6 py-3 border-b border-soft shrink-0">
      <Paperclip size={13} className="text-muted" />
      {attachments.map((a) => (
        <AttachmentChip
          key={a.index}
          attachment={a}
          accountId={accountId}
          folderPath={folderPath}
          uid={uid}
        />
      ))}
    </div>
  );
}

function AttachmentChip({
  attachment,
  accountId,
  folderPath,
  uid,
}: {
  attachment: Attachment;
  accountId: number;
  folderPath: string;
  uid: number;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const display = attachment.filename || `attachment-${attachment.index + 1}`;

  async function handleDownload() {
    if (busy) return;
    setErr(null);
    try {
      const destPath = await save({
        defaultPath: display,
        title: "Save attachment",
      });
      if (!destPath) return;
      setBusy(true);
      const account = await getAccount(accountId);
      if (!account) throw new Error(`account ${accountId} not found`);
      const secrets = await getAccountSecrets(accountId);
      await ipc.imapSaveAttachment(
        {
          host: account.imap_host,
          port: account.imap_port,
          username: account.imap_username ?? account.email,
          password: secrets.imapPassword,
          security: account.imap_security,
        },
        folderPath,
        uid,
        attachment.index,
        destPath,
      );
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={busy}
      title={err ?? `Download ${display}`}
      className={cn(
        "flex items-center gap-2 h-7 rounded-md px-2.5 text-[12px]",
        "bg-sunken border border-soft text-secondary",
        "hover:bg-hover hover:text-primary transition-colors",
        "disabled:opacity-60 disabled:cursor-wait",
        err && "border-[color:var(--color-danger)] text-[color:var(--color-danger)]",
      )}
    >
      <span className="truncate max-w-[220px]">{display}</span>
      <span className="text-muted tabular-nums">{formatSize(attachment.size)}</span>
      {busy ? (
        <Loader2 size={12} className="animate-spin" />
      ) : (
        <Download size={12} />
      )}
    </button>
  );
}

function parseMailto(uri: string): {
  to: string;
  subject: string;
  body: string;
} {
  // RFC 6068: `mailto:<to>?subject=...&body=...&cc=...`
  const withoutScheme = uri.replace(/^mailto:/i, "");
  const [toPart, queryPart] = withoutScheme.split("?", 2);
  const to = decodeURIComponent(toPart ?? "").trim();
  const params = new URLSearchParams(queryPart ?? "");
  const subject = params.get("subject") ?? "unsubscribe";
  const body = params.get("body") ?? "unsubscribe";
  return { to, subject, body };
}

function UnsubscribeBanner({
  info,
  senderLabel,
  onMailto,
}: {
  info: UnsubscribeInfo;
  senderLabel: string;
  onMailto: (to: string, subject: string, body: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handle() {
    if (busy || done) return;
    setErr(null);

    // Prefer RFC 8058 one-click: silent POST, no user interaction. This is
    // what Gmail's one-click button does when the sender opts in.
    if (info.oneClick && info.http) {
      setBusy(true);
      try {
        await ipc.unsubscribeOneClick(info.http);
        setDone(true);
        toast.success(`Unsubscribed from ${senderLabel}`);
      } catch (e) {
        setErr(String(e));
        toast.error(`Unsubscribe failed: ${e}`);
      } finally {
        setBusy(false);
      }
      return;
    }

    // Fallback 1: mailto URI — pre-fill the composer. Sender usually just
    // wants any reply to their dedicated unsub address; subject/body from
    // the URI are honoured per RFC 6068.
    if (info.mailto) {
      const { to, subject, body } = parseMailto(info.mailto);
      onMailto(to, subject, body);
      return;
    }

    // Fallback 2: https URI — open in the system browser, user finishes
    // the unsub flow on the sender's web page.
    if (info.http) {
      try {
        await openUrl(info.http);
      } catch (e) {
        setErr(String(e));
        toast.error(`Could not open browser: ${e}`);
      }
      return;
    }
  }

  return (
    <div
      style={{
        background: "var(--bg-sunken)",
        borderBottomColor: "var(--border-soft)",
      }}
      className="flex items-center gap-3 px-6 py-2 border-b shrink-0"
    >
      <BellOff size={14} className="text-muted shrink-0" />
      <span className="text-[12.5px] text-secondary flex-1 min-w-0 truncate">
        {done
          ? `You're unsubscribed from ${senderLabel}.`
          : `This is a mailing list. You can stop receiving messages from ${senderLabel}.`}
      </span>
      {!done && (
        <button
          type="button"
          onClick={() => void handle()}
          disabled={busy}
          style={{ color: "var(--accent)" }}
          className="text-[12.5px] font-medium hover:underline disabled:opacity-60 disabled:cursor-wait shrink-0"
        >
          {busy
            ? "Unsubscribing…"
            : info.oneClick
              ? "Unsubscribe"
              : info.mailto
                ? "Unsubscribe by email"
                : "Unsubscribe in browser"}
        </button>
      )}
      {err && (
        <span
          className="text-[11.5px] shrink-0"
          style={{ color: "var(--color-danger)" }}
          title={err}
        >
          failed
        </span>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SnoozeMenu({ thread }: { thread: Thread }) {
  const [open, setOpen] = useState(false);
  const snoozeThread = useThreadsStore((s) => s.snoozeThread);
  const selectThread = useUiStore((s) => s.selectThread);

  function pick(unix: number) {
    setOpen(false);
    selectThread(null);
    void snoozeThread(thread.id, unix);
  }

  function pickCustom() {
    setOpen(false);
    // Native datetime-local prompt — keeps the dependency surface small.
    const now = new Date();
    const sample = new Date(now.getTime() + 60 * 60 * 1000)
      .toISOString()
      .slice(0, 16); // YYYY-MM-DDTHH:MM
    const input = window.prompt(
      "Snooze until (YYYY-MM-DD HH:MM, local time):",
      sample.replace("T", " "),
    );
    if (!input) return;
    const trimmed = input.trim().replace(" ", "T");
    const target = new Date(trimmed);
    if (Number.isNaN(target.getTime())) {
      toast.error("Invalid date — expected YYYY-MM-DD HH:MM");
      return;
    }
    if (target.getTime() <= Date.now()) {
      toast.error("Snooze time must be in the future");
      return;
    }
    selectThread(null);
    void snoozeThread(thread.id, Math.floor(target.getTime() / 1000));
  }

  return (
    <div className="relative">
      <ActionButton label="Snooze" onClick={() => setOpen((o) => !o)}>
        <Clock size={15} />
      </ActionButton>
      {open && (
        <>
          {/* Click-outside catcher */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-full mt-1 z-50 w-[200px] rounded-lg border p-1 fade-in"
            style={{
              background: "var(--bg-raised)",
              borderColor: "var(--border-strong)",
              boxShadow: "var(--shadow-md)",
            }}
          >
            {SNOOZE_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => pick(p.computeUnix())}
                className="flex items-center w-full h-8 rounded-md px-3 text-[12.5px] text-secondary hover:bg-hover hover:text-primary transition-colors text-left"
              >
                {p.label}
              </button>
            ))}
            <div className="h-px my-1" style={{ background: "var(--border-soft)" }} />
            <button
              type="button"
              onClick={pickCustom}
              className="flex items-center w-full h-8 rounded-md px-3 text-[12.5px] text-secondary hover:bg-hover hover:text-primary transition-colors text-left"
            >
              Pick a date and time…
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ReplyButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-1.5 h-8 rounded-md px-3 text-[12.5px] font-medium",
        "text-secondary bg-sunken border border-soft",
        "hover:bg-hover hover:text-primary transition-colors",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-sunken disabled:hover:text-secondary",
      )}
    >
      {children}
    </button>
  );
}
