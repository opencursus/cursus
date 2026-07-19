import { useEffect, useMemo, useRef, useState } from "react";
import {
  Reply,
  ReplyAll,
  Forward,
  Archive,
  Trash2,
  Star,
  Clock,
  ChevronUp,
  Inbox as InboxIcon,
  Loader2,
  AlertCircle,
  Paperclip,
  Download,
  Ban,
  ShieldCheck,
  BellOff,
  Printer,
  FileDown,
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
import {
  getThreadMessageSummaries,
  type ThreadMessageSummary,
} from "@/lib/threadMessages";
import { toast } from "@/stores/toasts";
import { SNOOZE_PRESETS } from "@/lib/snooze";
import type { MailFolder, Thread } from "@/types";

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
  const [exporting, setExporting] = useState(false);

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

  // memberUids can be empty for synthetic threads (search results) — those
  // render as a single message.
  const uids = thread.memberUids.length > 0 ? thread.memberUids : [thread.id];

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

  const handlePrint = () => {
    if (!thread) return;
    printThreadMessage(thread, body);
  };

  const handleDownloadEml = async () => {
    if (!thread || !activeAccountId || !activeFolder || exporting) return;
    try {
      const destPath = await save({
        defaultPath: `${sanitizeFilename(thread.subject) || "message"}.eml`,
        title: "Save message as .eml",
        filters: [{ name: "Email message", extensions: ["eml"] }],
      });
      if (!destPath) return;
      setExporting(true);
      const account = await getAccount(activeAccountId);
      if (!account) throw new Error(`account ${activeAccountId} not found`);
      const secrets = await getAccountSecrets(activeAccountId);
      await ipc.imapSaveRawMessage(
        {
          host: account.imap_host,
          port: account.imap_port,
          username: account.imap_username ?? account.email,
          password: secrets.imapPassword,
          security: account.imap_security,
        },
        activeFolder.path,
        thread.id,
        destPath,
      );
      toast.success("Message saved as .eml");
    } catch (e) {
      toast.error(`Could not save .eml: ${e}`);
    } finally {
      setExporting(false);
    }
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
          <ActionButton label="Print" onClick={handlePrint} disabled={isLoading}>
            <Printer size={15} />
          </ActionButton>
          <ActionButton
            label="Download .eml"
            onClick={() => void handleDownloadEml()}
            disabled={exporting || !activeAccountId || !activeFolder}
          >
            {exporting ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <FileDown size={15} />
            )}
          </ActionButton>
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
        </div>
      </header>

      {uids.length > 1 && activeAccountId != null && activeFolder ? (
        <ConversationStack
          key={thread.id}
          thread={thread}
          uids={uids}
          accountId={activeAccountId}
          folder={activeFolder}
        />
      ) : (
        <>
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
            ) : (
              <BodyContent uid={thread.id} fallbackSnippet={thread.snippet} />
            )}
          </div>
        </>
      )}

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

function extractEmailLabel(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  return m && m[1] ? `<${m[1]}>` : "";
}

/** Windows-reserved characters stripped so the subject can seed a filename. */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, "_")
    .trim()
    .slice(0, 120);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Standalone printable document: header block (subject / sender / date)
 *  followed by the message body — html verbatim, text in a <pre>, or the
 *  list snippet as a last resort. */
function buildPrintDocument(
  thread: Thread,
  body: { html: string | null; text: string | null } | undefined,
): string {
  const subject = escapeHtml(thread.subject || "(no subject)");
  const sender = escapeHtml(thread.participants[0] ?? "Unknown");
  const date = escapeHtml(new Date(thread.lastMessageAt).toLocaleString());
  const content = body?.html
    ? body.html
    : body?.text
      ? `<pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(body.text)}</pre>`
      : `<p>${escapeHtml(thread.snippet || "No content.")}</p>`;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${subject}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color: #111; margin: 24px; }
  .print-header { border-bottom: 1px solid #ccc; padding-bottom: 12px; margin-bottom: 16px; }
  .print-header h1 { font-size: 18px; margin: 0 0 6px; }
  .print-header p { font-size: 12px; margin: 2px 0; color: #444; }
</style>
</head>
<body>
<div class="print-header">
<h1>${subject}</h1>
<p>From: ${sender}</p>
<p>Date: ${date}</p>
</div>
${content}
</body>
</html>`;
}

/** Print via a hidden same-document iframe. Deliberately NOT sandboxed —
 *  WebView2 refuses print() inside sandboxed frames. The iframe is removed
 *  ~1s after print() returns so WebView2 has finished spooling. */
function printThreadMessage(
  thread: Thread,
  body: { html: string | null; text: string | null } | undefined,
): void {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.visibility = "hidden";
  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      window.setTimeout(() => iframe.remove(), 1000);
    }
  };
  iframe.srcdoc = buildPrintDocument(thread, body);
  document.body.appendChild(iframe);
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

/**
 * Body rendering shared by the single-message pane and the per-message
 * conversation stack. `sized` swaps the fill-height HtmlViewer for one whose
 * container grows with the document — required inside a scrolling stack,
 * where `h-full` has no height to fill.
 */
function BodyContent({
  uid,
  fallbackSnippet,
  sized,
}: {
  uid: number;
  fallbackSnippet: string;
  sized?: boolean;
}) {
  const body = useBodiesStore((s) => s.bodies[uid]);
  if (body?.html) {
    return sized ? (
      <SizedHtmlViewer html={body.html} uid={uid} />
    ) : (
      <HtmlViewer html={body.html} uid={uid} />
    );
  }
  if (body?.text) {
    return (
      <pre className="p-6 text-[13px] text-primary whitespace-pre-wrap font-sans leading-relaxed">
        {body.text}
      </pre>
    );
  }
  return (
    <div className="p-6 text-[13px] text-muted">
      {fallbackSnippet || "No content."}
    </div>
  );
}

/**
 * HtmlViewer's iframe fills its parent; in the conversation stack the parent
 * must instead grow to fit the document. The iframe is same-origin
 * (sandbox="allow-same-origin"), so poll its body height — a ResizeObserver
 * would detach every time HtmlViewer rewrites the document via doc.write,
 * and polling also tracks late image loads and the "Load images" rewrite.
 */
function SizedHtmlViewer({ html, uid }: { html: string; uid: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(120);

  useEffect(() => {
    const measure = () => {
      const wrap = wrapRef.current;
      const iframe = wrap?.querySelector("iframe");
      const doc = iframe?.contentDocument;
      if (!wrap || !iframe || !doc?.body) return;
      // The "images blocked" banner is a sibling of the iframe inside
      // HtmlViewer's root — include it in the container height.
      let extra = 0;
      const root = wrap.firstElementChild;
      if (root) {
        for (const child of Array.from(root.children)) {
          if (child !== iframe) extra += (child as HTMLElement).offsetHeight;
        }
      }
      // offsetHeight, not scrollHeight: the body's height is content-driven,
      // so this stays correct (and can shrink) even when the iframe viewport
      // is taller than the document.
      const next = Math.max(80, doc.body.offsetHeight + extra);
      setHeight((prev) => (Math.abs(prev - next) > 1 ? next : prev));
    };
    measure();
    const timer = window.setInterval(measure, 400);
    return () => window.clearInterval(timer);
  }, [html, uid]);

  return (
    <div ref={wrapRef} style={{ height }} className="overflow-hidden">
      <HtmlViewer html={html} uid={uid} />
    </div>
  );
}

/**
 * Multi-message reading pane: all messages of the conversation, oldest at
 * the top. The newest starts expanded; expand/collapse state is local and
 * resets per thread (the parent keys this component by thread.id).
 */
function ConversationStack({
  thread,
  uids,
  accountId,
  folder,
}: {
  thread: Thread;
  uids: number[];
  accountId: number;
  folder: MailFolder;
}) {
  const fetchBody = useBodiesStore((s) => s.fetchBody);
  const [expanded, setExpanded] = useState<Set<number>>(
    () => new Set([thread.id]),
  );
  const [summaries, setSummaries] = useState<Map<
    number,
    ThreadMessageSummary
  > | null>(null);
  const newestRef = useRef<HTMLDivElement>(null);

  // memberUids come newest-first from the grouper; the pane reads top-down.
  const ordered = useMemo(() => [...uids].reverse(), [uids]);

  useEffect(() => {
    let cancelled = false;
    getThreadMessageSummaries(thread.folderId, uids)
      .then((m) => {
        if (!cancelled) setSummaries(m);
      })
      .catch(() => {
        // Thread-level fallbacks (participants / snippet / lastMessageAt)
        // keep the stack usable without per-message summaries.
      });
    return () => {
      cancelled = true;
    };
  }, [thread.folderId, uids]);

  useEffect(() => {
    // Deferred one frame so the rows have laid out. Collapsed rows have a
    // fixed height, so a single scroll is stable.
    const t = window.setTimeout(() => {
      newestRef.current?.scrollIntoView({ block: "start" });
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  const toggle = (uid: number) => {
    const isOpen = expanded.has(uid);
    // Lazy body fetch — the store no-ops when the body is already cached.
    if (!isOpen) void fetchBody(accountId, folder.path, uid);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (isOpen) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {ordered.map((uid) => {
        const isNewest = uid === thread.id;
        const s = summaries?.get(uid);
        return (
          <ConversationMessage
            key={uid}
            uid={uid}
            sender={
              s?.fromAddress ??
              (isNewest ? thread.participants[0] ?? "Unknown" : "Unknown")
            }
            dateMs={
              s?.receivedAt != null
                ? s.receivedAt * 1000
                : isNewest
                  ? thread.lastMessageAt
                  : 0
            }
            snippet={s?.snippet ?? (isNewest ? thread.snippet : "")}
            unread={s?.isUnread ?? false}
            expanded={expanded.has(uid)}
            onToggle={() => toggle(uid)}
            onRetry={() => void fetchBody(accountId, folder.path, uid)}
            accountId={accountId}
            folderPath={folder.path}
            innerRef={isNewest ? newestRef : undefined}
          />
        );
      })}
    </div>
  );
}

/**
 * One message of a conversation. Collapsed: a compact sender / snippet /
 * date row. Expanded: full header plus the same rendering path the
 * single-message pane uses (unsubscribe banner, attachments, body).
 */
function ConversationMessage({
  uid,
  sender,
  dateMs,
  snippet,
  unread,
  expanded,
  onToggle,
  onRetry,
  accountId,
  folderPath,
  innerRef,
}: {
  uid: number;
  sender: string;
  dateMs: number;
  snippet: string;
  unread: boolean;
  expanded: boolean;
  onToggle: () => void;
  onRetry: () => void;
  accountId: number;
  folderPath: string;
  innerRef?: React.Ref<HTMLDivElement>;
}) {
  const body = useBodiesStore((s) => s.bodies[uid]);
  const err = useBodiesStore((s) => s.errors[uid]);
  const openComposeWith = useComposerStore((s) => s.openComposeWith);
  const senderName = addressName(sender) || sender;

  if (!expanded) {
    return (
      <div ref={innerRef} className="border-b border-soft">
        <button
          type="button"
          onClick={onToggle}
          title="Expand message"
          className="w-full flex items-center gap-3 px-6 py-2.5 text-left hover:bg-hover transition-colors"
        >
          <Avatar name={senderName} size={28} />
          <span
            className={cn(
              "shrink-0 max-w-[180px] truncate text-[12.5px]",
              unread ? "font-semibold text-primary" : "font-medium text-secondary",
            )}
          >
            {senderName}
          </span>
          <span className="flex-1 min-w-0 truncate text-[12px] text-muted">
            {snippet}
          </span>
          <span className="shrink-0 text-[11.5px] text-muted tabular-nums">
            {dateMs ? formatRelativeTime(dateMs) : ""}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div ref={innerRef} className="border-b border-soft">
      <button
        type="button"
        onClick={onToggle}
        title="Collapse message"
        className="w-full flex items-center gap-3 px-6 py-3 border-b border-soft text-left hover:bg-hover transition-colors"
      >
        <Avatar name={senderName} size={36} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13.5px] font-semibold text-primary truncate">
              {senderName}
            </span>
            <span className="text-[12px] text-muted truncate">
              {extractEmailLabel(sender)}
            </span>
          </div>
          <div className="text-[12px] text-muted">
            {dateMs ? formatRelativeTime(dateMs) : ""}
          </div>
        </div>
        <ChevronUp size={14} className="text-muted shrink-0" />
      </button>

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

      {body && body.attachments.length > 0 && (
        <AttachmentStrip
          attachments={body.attachments}
          accountId={accountId}
          folderPath={folderPath}
          uid={uid}
        />
      )}

      {body ? (
        <BodyContent uid={uid} fallbackSnippet={snippet} sized />
      ) : err ? (
        <div className="flex items-center gap-2 px-6 py-4">
          <AlertCircle
            size={14}
            className="text-[color:var(--color-danger)] shrink-0"
          />
          <span
            className="flex-1 min-w-0 truncate text-[12px] text-muted"
            title={err}
          >
            Could not load message
          </span>
          <button
            type="button"
            onClick={onRetry}
            style={{ color: "var(--accent)" }}
            className="shrink-0 text-[12px] font-medium hover:underline"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-6 py-4 text-[12.5px] text-muted">
          <Loader2 size={14} className="animate-spin" />
          Loading message…
        </div>
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
