import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  X,
  Send,
  Loader2,
  AlertCircle,
  Bold,
  Italic,
  List,
  ListOrdered,
  Undo,
  Redo,
  Minus,
  Square,
  Paperclip,
  FileText,
  Clock,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { useComposerStore, type ComposerSnapshot } from "@/stores/composer";
import { useAccountsStore } from "@/stores/accounts";
import { useUiStore } from "@/stores/ui";
import {
  deleteDraft,
  findReplyDraft,
  getAccount,
  getAccountSecrets,
  insertDraft,
  insertScheduledSend,
  insertSentLog,
  parseNameEmail,
  updateDraft,
  upsertContact,
  type DraftMode,
} from "@/lib/db";
import { RecipientsField } from "@/components/composer/RecipientsField";
import {
  ipc,
  type OutgoingAttachment,
  type OutgoingMessage,
  type ResendTemplateSummary,
} from "@/lib/ipc";
import { toast } from "@/stores/toasts";

interface PendingAttachment {
  id: string;
  filename: string;
  path: string;
}

export function Composer() {
  const open = useComposerStore((s) => s.open);
  const mode = useComposerStore((s) => s.mode);
  const inReplyToThread = useComposerStore((s) => s.inReplyToThread);
  const prefillTo = useComposerStore((s) => s.prefillTo);
  const prefillCc = useComposerStore((s) => s.prefillCc);
  const prefillBcc = useComposerStore((s) => s.prefillBcc);
  const prefillSubject = useComposerStore((s) => s.prefillSubject);
  const prefillBodyHtml = useComposerStore((s) => s.prefillBodyHtml);
  const prefillAttachments = useComposerStore((s) => s.prefillAttachments);
  const close = useComposerStore((s) => s.close);

  const activeAccountId = useAccountsStore((s) => s.activeAccountId);
  const accounts = useAccountsStore((s) => s.accounts);
  const activeAccount = accounts.find((a) => a.id === activeAccountId);

  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [subject, setSubject] = useState("");
  const [minimized, setMinimized] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [draftId, setDraftId] = useState<number | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [editorVersion, setEditorVersion] = useState(0);
  const [templates, setTemplates] = useState<ResendTemplateSummary[]>([]);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor(
    {
      extensions: [StarterKit],
      content: "<p></p>",
      editorProps: {
        attributes: {
          class: "cursus-editor outline-none min-h-[220px] px-4 py-3 text-[13px] leading-relaxed",
        },
      },
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    setTo(prefillTo);
    setCc(prefillCc);
    setBcc(prefillBcc);
    setShowCcBcc(Boolean(prefillCc) || Boolean(prefillBcc));
    setSubject(prefillSubject);
    setError(null);
    setMinimized(false);
    setAttachments(
      prefillAttachments.map((a, i) => ({
        id: `${Date.now()}-${i}-${a.path}`,
        filename: a.filename,
        path: a.path,
      })),
    );
    setDraftId(null);
    setDraftReady(false);
    if (editor) {
      editor.commands.setContent(prefillBodyHtml || "<p></p>", { emitUpdate: false });
      setTimeout(() => editor.commands.focus("start"), 30);
    }
  }, [
    open,
    prefillTo,
    prefillCc,
    prefillBcc,
    prefillSubject,
    prefillBodyHtml,
    prefillAttachments,
    editor,
  ]);

  // Resume an existing draft for this (account, mode, replyUid). Runs once per open.
  useEffect(() => {
    if (!open || !editor || !activeAccountId) {
      setDraftReady(open ? false : true);
      return;
    }
    let cancelled = false;
    const replyUid = inReplyToThread?.id ?? null;
    const currentMode: DraftMode = mode;
    void findReplyDraft(activeAccountId, currentMode, replyUid)
      .then((draft) => {
        if (cancelled || !draft) return;
        setDraftId(draft.id);
        setTo(draft.to_addresses ?? "");
        setCc(draft.cc_addresses ?? "");
        setBcc(draft.bcc_addresses ?? "");
        setShowCcBcc(Boolean(draft.cc_addresses) || Boolean(draft.bcc_addresses));
        setSubject(draft.subject ?? "");
        if (draft.html_body) {
          editor.commands.setContent(draft.html_body, { emitUpdate: false });
        }
      })
      .catch(() => {
        // Best-effort; keep the prefilled composer as-is.
      })
      .finally(() => {
        if (!cancelled) setDraftReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, editor, activeAccountId, mode, inReplyToThread?.id]);

  // Load Resend templates when the composer opens on a Resend account.
  useEffect(() => {
    if (!open || !activeAccount || activeAccount.id == null) return;
    if (!activeAccountId) return;
    let cancelled = false;
    (async () => {
      try {
        const account = await getAccount(activeAccountId);
        if (!account || account.smtp_mode !== "resend") {
          if (!cancelled) setTemplates([]);
          return;
        }
        const secrets = await getAccountSecrets(activeAccountId);
        if (!secrets.resendApiKey) return;
        const list = await ipc.resendListTemplates(secrets.resendApiKey);
        if (!cancelled) setTemplates(list);
      } catch (err) {
        console.warn("resendListTemplates failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, activeAccountId, activeAccount]);

  // Bump a counter whenever the editor content changes so the debounced save sees it.
  useEffect(() => {
    if (!editor) return;
    const handler = () => setEditorVersion((v) => v + 1);
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
    };
  }, [editor]);

  // Debounced draft auto-save (3s).
  useEffect(() => {
    if (!open || !draftReady || !editor || !activeAccountId || sending) return;
    const html = editor.getHTML();
    const text = editor.getText();
    const hasContent =
      to.trim() || cc.trim() || bcc.trim() || subject.trim() || text.trim();
    if (!hasContent) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const input = {
        accountId: activeAccountId,
        mode,
        replyUid: inReplyToThread?.id ?? null,
        to,
        cc,
        bcc,
        subject,
        htmlBody: html,
        textBody: text,
      };
      (draftId == null
        ? insertDraft(input).then((id) => setDraftId(id))
        : updateDraft(draftId, input)
      ).catch(() => {
        // Non-fatal; next keystroke triggers another attempt.
      });
    }, 3000);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [
    open,
    draftReady,
    editor,
    activeAccountId,
    mode,
    inReplyToThread?.id,
    to,
    cc,
    bcc,
    subject,
    editorVersion,
    draftId,
    sending,
  ]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        void handleSend();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, to, cc, bcc, subject, editor]);

  const canSend = useMemo(
    () => to.trim().length > 0 && subject.trim().length > 0 && !sending,
    [to, subject, sending],
  );

  async function handlePickAttachment() {
    try {
      const picked = await openDialog({ multiple: true });
      if (!picked) return;
      const paths = Array.isArray(picked) ? picked : [picked];
      const next: PendingAttachment[] = paths.map((p, i) => ({
        id: `${Date.now()}-${i}-${p}`,
        filename: basename(p),
        path: p,
      }));
      setAttachments((cur) => [...cur, ...next]);
    } catch (e) {
      setError(String(e));
    }
  }

  function removeAttachment(id: string) {
    setAttachments((cur) => cur.filter((a) => a.id !== id));
  }

  async function handleDiscard() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (draftId != null) {
      await deleteDraft(draftId).catch(() => {});
    }
    close();
  }

  async function handleSend() {
    if (!activeAccount || !editor) return;
    setError(null);

    const toList = parseRecipients(to);
    const ccList = parseRecipients(cc);
    const bccList = parseRecipients(bcc);

    // --- Pre-send validation / confirmation ---
    const confirmEnabled = useUiStore.getState().confirmBeforeSend;
    if (confirmEnabled) {
      if (toList.length + ccList.length + bccList.length === 0) {
        setError("Add at least one recipient before sending.");
        return;
      }
      if (subject.trim() === "") {
        if (!window.confirm("Send with an empty subject?")) return;
      }
      const plain = editor.getText().toLowerCase();
      const mentionsAttachment = /\battach(?:ed|ing|ment|ments)?\b/.test(plain);
      if (mentionsAttachment && attachments.length === 0) {
        if (
          !window.confirm(
            "Your message mentions an attachment but none is attached. Send anyway?",
          )
        ) {
          return;
        }
      }
    } else if (toList.length + ccList.length + bccList.length === 0) {
      setError("Add at least one recipient before sending.");
      return;
    }

    // --- Capture snapshot of everything needed to send OR restore on undo ---
    const html = editor.getHTML();
    const text = editor.getText();
    const outgoingAttachments: OutgoingAttachment[] = attachments.map((a) => ({
      filename: a.filename,
      path: a.path,
    }));
    const snapshot: ComposerSnapshot = {
      to,
      cc,
      bcc,
      subject,
      bodyHtml: html,
      attachments: outgoingAttachments,
      accountId: activeAccount.id,
      mode,
      inReplyToThread,
    };

    const undoSec = useUiStore.getState().undoSendSeconds;
    close();

    if (undoSec === 0) {
      await performSend(snapshot, text, draftId);
      return;
    }

    const startedDraftId = draftId;
    let cancelled = false;
    const undoMs = undoSec * 1000;

    const timeoutId = setTimeout(() => {
      if (cancelled) return;
      void performSend(snapshot, text, startedDraftId);
    }, undoMs);

    // Visible per-second countdown so the user knows how long they have to
    // hit Undo. We push the toast first to capture its id, then tick it
    // down with a 1s interval until the timeout fires or Undo is hit.
    const startedAt = Date.now();
    const toastId = toast.push({
      kind: "info",
      message: `Sending… ${undoSec}s`,
      durationMs: undoMs,
      action: {
        label: "Undo",
        onClick: () => {
          cancelled = true;
          clearTimeout(timeoutId);
          clearInterval(tickId);
          useComposerStore.getState().reopenFromSnapshot(snapshot);
        },
      },
    });

    const tickId = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((undoMs - (Date.now() - startedAt)) / 1000));
      if (remaining <= 0 || cancelled) {
        clearInterval(tickId);
        return;
      }
      toast.update(toastId, { message: `Sending… ${remaining}s` });
    }, 1000);
  }

  async function handleSendLater(): Promise<void> {
    if (!activeAccount || !editor) return;
    const html = editor.getHTML();
    const text = editor.getText();
    const sample = new Date(Date.now() + 60 * 60 * 1000)
      .toISOString()
      .slice(0, 16)
      .replace("T", " ");
    const input = window.prompt(
      "Send at (YYYY-MM-DD HH:MM, local time):",
      sample,
    );
    if (!input) return;
    const target = new Date(input.trim().replace(" ", "T"));
    if (Number.isNaN(target.getTime())) {
      toast.error("Invalid date — expected YYYY-MM-DD HH:MM");
      return;
    }
    if (target.getTime() <= Date.now()) {
      toast.error("Send time must be in the future");
      return;
    }

    const payload = {
      to: parseRecipients(to),
      cc: parseRecipients(cc),
      bcc: parseRecipients(bcc),
      subject,
      html,
      text,
      attachments: attachments.map((a) => ({ filename: a.filename, path: a.path })),
    };

    try {
      await insertScheduledSend({
        accountId: activeAccount.id,
        payloadJson: JSON.stringify(payload),
        mode,
        replyUid: inReplyToThread?.id ?? null,
        draftId,
        scheduledAt: Math.floor(target.getTime() / 1000),
      });
      toast.success(
        `Scheduled for ${target.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`,
      );
      close();
    } catch (err) {
      toast.error(`Schedule failed: ${err}`);
    }
  }

  async function performSend(
    snap: ComposerSnapshot,
    text: string,
    snapshotDraftId: number | null,
  ): Promise<void> {
    setSending(true);
    try {
      const account = await getAccount(snap.accountId);
      if (!account) throw new Error("active account not found");
      const secrets = await getAccountSecrets(account.id);
      const from = buildFrom(account.display_name, account.email);

      const message: OutgoingMessage = {
        from,
        to: parseRecipients(snap.to),
        cc: parseRecipients(snap.cc),
        bcc: parseRecipients(snap.bcc),
        subject: snap.subject,
        html: snap.bodyHtml,
        text,
        attachments: snap.attachments,
      };

      // Resolve the IMAP Sent folder for this account so the Rust side can
      // APPEND a copy after the send. Without this, SMTP-sent mail never
      // shows up in Sent (SMTP only transmits). If the account has no Sent
      // folder detected, we skip the APPEND and the user gets no Sent copy —
      // that's a separate account-config issue, not a send failure.
      const sentFolder = useAccountsStore
        .getState()
        .folders.find(
          (f) => f.accountId === account.id && f.specialUse === "sent",
        );
      const saveToSent = sentFolder
        ? {
            imap: {
              host: account.imap_host,
              port: account.imap_port,
              username: account.imap_username ?? account.email,
              password: secrets.imapPassword,
              security: account.imap_security,
            },
            folder: sentFolder.path,
          }
        : null;

      let sendResult;
      if (account.smtp_mode === "resend") {
        if (!secrets.resendApiKey) throw new Error("Resend API key is missing");
        sendResult = await ipc.resendSend(
          secrets.resendApiKey,
          {
            ...message,
            from: account.resend_from_address ?? message.from,
          },
          saveToSent,
        );
      } else {
        if (!account.smtp_host || !account.smtp_port || !account.smtp_security) {
          throw new Error("SMTP configuration is incomplete");
        }
        if (!secrets.smtpPassword) throw new Error("SMTP password is missing");
        sendResult = await ipc.smtpSend(
          {
            host: account.smtp_host,
            port: account.smtp_port,
            username: account.smtp_username ?? account.email,
            password: secrets.smtpPassword,
            security: account.smtp_security,
          },
          message,
          saveToSent,
        );
      }

      // Local audit record — always written after a successful send, even
      // when the IMAP APPEND to Sent succeeded. If the server's Sent copy
      // ever disappears (re-installs, server issues, accidental delete),
      // this table is the fallback record of what actually left the app.
      await insertSentLog({
        accountId: snap.accountId,
        providerMessageId: sendResult.messageId ?? null,
        mode: snap.mode,
        replyUid: snap.inReplyToThread?.id ?? null,
        fromAddress: from,
        toAddresses: message.to.join(", "),
        ccAddresses:
          message.cc && message.cc.length > 0 ? message.cc.join(", ") : null,
        bccAddresses:
          message.bcc && message.bcc.length > 0 ? message.bcc.join(", ") : null,
        subject: snap.subject || null,
        htmlBody: snap.bodyHtml || null,
        textBody: text || null,
        attachmentsJson:
          snap.attachments.length > 0
            ? JSON.stringify(
                snap.attachments.map((a) => ({
                  filename: a.filename,
                  path: a.path,
                  contentType: a.contentType ?? null,
                })),
              )
            : null,
        imapAppended: sendResult.imapAppended === true,
        sentAt: Math.floor(Date.now() / 1000),
      }).catch((err) => {
        // Log-only: never propagate a sent_log failure to the user — the
        // mail itself is already out.
        console.warn("insertSentLog failed:", err);
      });

      // Rank the people we just emailed higher in the autocomplete pool.
      // Fire-and-forget — a contact-table write failing is not a send failure.
      const allRecipients = [
        ...message.to,
        ...(message.cc ?? []),
        ...(message.bcc ?? []),
      ];
      for (const raw of allRecipients) {
        const parsed = parseNameEmail(raw);
        if (parsed) {
          void upsertContact(parsed.email, parsed.name).catch(() => {});
        }
      }

      if (snapshotDraftId != null) {
        await deleteDraft(snapshotDraftId).catch(() => {});
      }
      toast.success("Message sent");
    } catch (err) {
      toast.error(`Send failed: ${err}`);
    } finally {
      setSending(false);
    }
  }

  if (!open) return null;

  return (
    <>
      {!minimized && <div className="fixed inset-0 bg-black/50 z-40 no-drag" onClick={close} />}
      <div
        className={cn(
          "fixed z-50 shadow-lift rounded-xl bg-raised border border-strong overflow-hidden no-drag",
          minimized
            ? "bottom-4 right-4 w-[320px]"
            : "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[720px] max-w-[95vw] h-[560px] max-h-[90vh]",
          "flex flex-col",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-2.5 border-b border-soft shrink-0 bg-sunken">
          <h2 className="text-[13px] font-semibold text-primary truncate">
            {subject || (prefillSubject ? "…" : "New message")}
          </h2>
          <div className="flex items-center gap-0.5">
            <HeaderIconButton onClick={() => setMinimized((m) => !m)} title="Minimize">
              {minimized ? <Square size={12} /> : <Minus size={13} />}
            </HeaderIconButton>
            <HeaderIconButton onClick={close} title="Close">
              <X size={14} />
            </HeaderIconButton>
          </div>
        </header>

        {!minimized && (
          <>
            <div className="flex flex-col gap-1 px-4 pt-3 pb-2 border-b border-soft shrink-0">
              <AddrRow label="From">
                <span className="text-[13px] text-secondary">
                  {activeAccount ? activeAccount.email : "No account selected"}
                </span>
              </AddrRow>
              <AddrRow
                label="To"
                trailing={
                  !showCcBcc && (
                    <button
                      type="button"
                      onClick={() => setShowCcBcc(true)}
                      className="text-[11.5px] text-muted hover:text-primary px-1.5"
                    >
                      Cc · Bcc
                    </button>
                  )
                }
              >
                <RecipientsField
                  value={to}
                  onChange={setTo}
                  placeholder="recipient@example.com, another@example.com"
                />
              </AddrRow>
              {showCcBcc && (
                <>
                  <AddrRow label="Cc">
                    <RecipientsField value={cc} onChange={setCc} />
                  </AddrRow>
                  <AddrRow label="Bcc">
                    <RecipientsField value={bcc} onChange={setBcc} />
                  </AddrRow>
                </>
              )}
              <AddrRow label="Subject">
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="flex-1 bg-transparent border-0 outline-none text-[13px] text-primary placeholder:text-disabled"
                  autoComplete="off"
                  spellCheck={false}
                />
              </AddrRow>
            </div>

            <Toolbar
              editor={editor}
              onAttach={handlePickAttachment}
              onOpenTemplates={
                templates.length > 0 ? () => setTemplatesOpen((v) => !v) : null
              }
              templatesActive={templatesOpen}
            />
            {templatesOpen && templates.length > 0 && (
              <div
                style={{
                  background: "var(--bg-raised)",
                  borderColor: "var(--border-strong)",
                  boxShadow: "var(--shadow-md)",
                }}
                className="absolute left-3 right-3 top-[140px] rounded-lg border p-1 z-10 max-h-[260px] overflow-y-auto"
              >
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      if (t.subject) setSubject(t.subject);
                      setTemplatesOpen(false);
                      toast.info(`Template applied: ${t.name}`);
                    }}
                    className="flex items-start gap-2 w-full rounded-md px-2 py-1.5 text-left text-[12.5px] text-secondary hover:bg-hover hover:text-primary"
                  >
                    <FileText size={13} className="text-muted mt-0.5 shrink-0" />
                    <span className="flex-1 min-w-0">
                      <div className="truncate text-primary">{t.name}</div>
                      {t.subject && (
                        <div className="truncate text-muted text-[11.5px]">
                          {t.subject}
                        </div>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 px-4 py-2 border-b border-soft shrink-0">
                {attachments.map((a) => (
                  <span
                    key={a.id}
                    className="flex items-center gap-2 h-7 rounded-md px-2.5 text-[12px] bg-sunken border border-soft text-secondary"
                    title={a.path}
                  >
                    <Paperclip size={12} className="text-muted" />
                    <span className="truncate max-w-[220px]">{a.filename}</span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(a.id)}
                      className="text-muted hover:text-primary"
                      aria-label={`Remove ${a.filename}`}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex-1 overflow-y-auto">
              <EditorContent editor={editor} />
            </div>

            {error && (
              <div className="mx-4 mb-2 rounded-lg border border-[color:var(--color-danger)] bg-[color:rgba(229,72,77,0.08)] px-3 py-2 flex items-start gap-2 shrink-0">
                <AlertCircle size={13} className="text-[color:var(--color-danger)] mt-0.5 shrink-0" />
                <p className="text-[12px] text-primary break-words">{error}</p>
              </div>
            )}

            <footer className="flex items-center justify-between px-4 py-3 border-t border-soft shrink-0 bg-sunken">
              <Button variant="ghost" onClick={() => void handleDiscard()} disabled={sending}>
                Discard
              </Button>
              <div className="flex items-center gap-2">
                <span className="text-[11.5px] text-muted tabular-nums">
                  {sending ? "Sending…" : canSend ? "Ready · Ctrl+Enter to send" : ""}
                </span>
                <Button
                  variant="secondary"
                  onClick={() => void handleSendLater()}
                  disabled={!canSend}
                  leading={<Clock size={14} />}
                >
                  Send later
                </Button>
                <Button
                  variant="primary"
                  onClick={handleSend}
                  disabled={!canSend}
                  leading={sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  className="min-w-[120px] px-6"
                >
                  Send
                </Button>
              </div>
            </footer>
          </>
        )}
      </div>

      <style>{`
        .cursus-editor p { margin: 0 0 0.6em 0; }
        .cursus-editor blockquote {
          border-left: 3px solid var(--border-strong);
          margin: 0.6em 0;
          padding: 0 0 0 12px;
          color: var(--fg-secondary);
        }
        .cursus-editor ul, .cursus-editor ol { margin: 0 0 0.6em 1.2em; padding: 0; }
        .cursus-editor h1, .cursus-editor h2, .cursus-editor h3 { margin: 0.8em 0 0.4em; font-weight: 600; }
        .cursus-editor a { color: var(--accent); text-decoration: none; }
        .cursus-editor a:hover { text-decoration: underline; }
        .cursus-editor code {
          background: rgba(128,128,128,0.12);
          padding: 1px 4px; border-radius: 3px; font-size: 0.92em;
        }
      `}</style>
    </>
  );
}

function Toolbar({
  editor,
  onAttach,
  onOpenTemplates,
  templatesActive,
}: {
  editor: Editor | null;
  onAttach: () => void;
  onOpenTemplates: (() => void) | null;
  templatesActive: boolean;
}) {
  if (!editor) return null;
  return (
    <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-soft shrink-0">
      <ToolButton active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold size={13} />
      </ToolButton>
      <ToolButton active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic size={13} />
      </ToolButton>
      <Divider />
      <ToolButton active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List size={14} />
      </ToolButton>
      <ToolButton active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered size={14} />
      </ToolButton>
      <Divider />
      <ToolButton onClick={() => editor.chain().focus().undo().run()}>
        <Undo size={13} />
      </ToolButton>
      <ToolButton onClick={() => editor.chain().focus().redo().run()}>
        <Redo size={13} />
      </ToolButton>
      <Divider />
      <ToolButton onClick={onAttach} title="Attach files">
        <Paperclip size={13} />
      </ToolButton>
      {onOpenTemplates && (
        <ToolButton
          active={templatesActive}
          onClick={onOpenTemplates}
          title="Resend templates"
        >
          <FileText size={13} />
        </ToolButton>
      )}
    </div>
  );
}

function ToolButton({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
        active
          ? "bg-accent-soft text-accent"
          : "text-muted hover:bg-hover hover:text-primary",
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="h-4 w-px mx-1 bg-[color:var(--border-strong)]" />;
}

function AddrRow({
  label,
  children,
  trailing,
}: {
  label: string;
  children: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 min-h-[28px]">
      <span className="w-[60px] shrink-0 text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">
        {label}
      </span>
      <div className="flex-1 min-w-0 flex items-center">{children}</div>
      {trailing}
    </div>
  );
}

function HeaderIconButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-primary"
    >
      {children}
    </button>
  );
}

function basename(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

function parseRecipients(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildFrom(displayName: string | null | undefined, email: string): string {
  const name = displayName?.trim();
  if (!name || name === email) return email;
  // Quote the display name if it contains characters that would break the
  // bare `Name <email>` form per RFC 5322 (`@ < > , ; : "`).
  if (/[@<>,;:"]/.test(name)) {
    const escaped = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${escaped}" <${email}>`;
  }
  return `${name} <${email}>`;
}
