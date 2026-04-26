import { create } from "zustand";
import type { Thread } from "@/types";
import type { OutgoingAttachment } from "@/lib/ipc";

export type ComposerMode = "new" | "reply" | "replyAll" | "forward";

export interface ComposerSnapshot {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  bodyHtml: string;
  attachments: OutgoingAttachment[];
  accountId: number;
  mode: ComposerMode;
  inReplyToThread: Thread | null;
}

interface ComposerState {
  open: boolean;
  mode: ComposerMode;
  inReplyToThread: Thread | null;
  prefillTo: string;
  prefillCc: string;
  prefillBcc: string;
  prefillSubject: string;
  prefillBodyHtml: string;
  prefillAttachments: OutgoingAttachment[];

  openCompose: (signatureHtml?: string | null) => void;
  openComposeWith: (prefill: {
    to?: string;
    cc?: string;
    bcc?: string;
    subject?: string;
    bodyHtml?: string;
  }) => void;
  openReply: (
    thread: Thread,
    originalHtml: string | null,
    originalText: string | null,
    signatureHtml?: string | null,
  ) => void;
  openReplyAll: (
    thread: Thread,
    originalHtml: string | null,
    originalText: string | null,
    currentAccountEmail: string,
    signatureHtml?: string | null,
  ) => void;
  openForward: (
    thread: Thread,
    originalHtml: string | null,
    originalText: string | null,
    signatureHtml?: string | null,
  ) => void;
  reopenFromSnapshot: (snap: ComposerSnapshot) => void;
  close: () => void;
}

export const useComposerStore = create<ComposerState>((set) => ({
  open: false,
  mode: "new",
  inReplyToThread: null,
  prefillTo: "",
  prefillCc: "",
  prefillBcc: "",
  prefillSubject: "",
  prefillBodyHtml: "",
  prefillAttachments: [],

  openCompose: (signatureHtml?: string | null) =>
    set({
      open: true,
      mode: "new",
      inReplyToThread: null,
      prefillTo: "",
      prefillCc: "",
      prefillBcc: "",
      prefillSubject: "",
      prefillBodyHtml: appendSignatureNew("<p></p>", signatureHtml),
      prefillAttachments: [],
    }),

  openComposeWith: (prefill) =>
    set({
      open: true,
      mode: "new",
      inReplyToThread: null,
      prefillTo: prefill.to ?? "",
      prefillCc: prefill.cc ?? "",
      prefillBcc: prefill.bcc ?? "",
      prefillSubject: prefill.subject ?? "",
      prefillBodyHtml: prefill.bodyHtml ?? "<p></p>",
      prefillAttachments: [],
    }),

  openReply: (thread, originalHtml, originalText, signatureHtml) =>
    set({
      open: true,
      mode: "reply",
      inReplyToThread: thread,
      prefillTo: extractEmail(thread.participants[0] ?? ""),
      prefillCc: "",
      prefillBcc: "",
      prefillSubject: withRePrefix(thread.subject),
      prefillBodyHtml: buildReplyQuote(thread, originalHtml, originalText, signatureHtml),
      prefillAttachments: [],
    }),

  openReplyAll: (thread, originalHtml, originalText, currentAccountEmail, signatureHtml) =>
    set({
      open: true,
      mode: "replyAll",
      inReplyToThread: thread,
      prefillTo: extractEmail(thread.participants[0] ?? ""),
      prefillCc: thread.participants
        .slice(1)
        .map(extractEmail)
        .filter((e) => e && e.toLowerCase() !== currentAccountEmail.toLowerCase())
        .join(", "),
      prefillBcc: "",
      prefillSubject: withRePrefix(thread.subject),
      prefillBodyHtml: buildReplyQuote(thread, originalHtml, originalText, signatureHtml),
      prefillAttachments: [],
    }),

  openForward: (thread, originalHtml, originalText, signatureHtml) =>
    set({
      open: true,
      mode: "forward",
      inReplyToThread: thread,
      prefillTo: "",
      prefillCc: "",
      prefillBcc: "",
      prefillSubject: withFwdPrefix(thread.subject),
      prefillBodyHtml: buildForwardQuote(thread, originalHtml, originalText, signatureHtml),
      prefillAttachments: [],
    }),

  reopenFromSnapshot: (snap) =>
    set({
      open: true,
      mode: snap.mode,
      inReplyToThread: snap.inReplyToThread,
      prefillTo: snap.to,
      prefillCc: snap.cc,
      prefillBcc: snap.bcc,
      prefillSubject: snap.subject,
      prefillBodyHtml: snap.bodyHtml,
      prefillAttachments: snap.attachments,
    }),

  close: () => set({ open: false }),
}));

function extractEmail(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  if (m && m[1]) return m[1].trim();
  return raw.trim();
}

function withRePrefix(subject: string): string {
  if (/^re:\s/i.test(subject)) return subject;
  return `Re: ${subject}`;
}

function withFwdPrefix(subject: string): string {
  if (/^(fwd?|re):\s/i.test(subject)) return subject;
  return `Fwd: ${subject}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function buildReplyQuote(
  thread: Thread,
  originalHtml: string | null,
  originalText: string | null,
  signatureHtml: string | null | undefined,
): string {
  const sender = escapeHtml(thread.participants[0] ?? "Unknown");
  const date = escapeHtml(formatDate(thread.lastMessageAt));
  const bodyHtml = originalHtml
    ? originalHtml
    : originalText
      ? `<p>${escapeHtml(originalText).replace(/\n/g, "<br>")}</p>`
      : `<p>${escapeHtml(thread.snippet)}</p>`;

  return [
    "<p></p>",
    "<p></p>",
    signatureBlock(signatureHtml),
    `<blockquote><p><em>On ${date}, ${sender} wrote:</em></p>${bodyHtml}</blockquote>`,
  ].join("");
}

function buildForwardQuote(
  thread: Thread,
  originalHtml: string | null,
  originalText: string | null,
  signatureHtml: string | null | undefined,
): string {
  const sender = escapeHtml(thread.participants[0] ?? "Unknown");
  const date = escapeHtml(formatDate(thread.lastMessageAt));
  const subject = escapeHtml(thread.subject);
  const bodyHtml = originalHtml
    ? originalHtml
    : originalText
      ? `<p>${escapeHtml(originalText).replace(/\n/g, "<br>")}</p>`
      : `<p>${escapeHtml(thread.snippet)}</p>`;

  return [
    "<p></p>",
    "<p></p>",
    signatureBlock(signatureHtml),
    "<p><strong>---------- Forwarded message ---------</strong></p>",
    `<p>From: ${sender}<br>`,
    `Date: ${date}<br>`,
    `Subject: ${subject}</p>`,
    bodyHtml,
  ].join("");
}

/**
 * Render the per-account signature as a paragraph block. We accept either
 * raw HTML (kept as-is) or plain text (escaped + newlines → <br>). A
 * pragmatic check: if it contains `<` we treat it as HTML.
 */
function signatureBlock(raw: string | null | undefined): string {
  if (!raw || !raw.trim()) return "";
  const trimmed = raw.trim();
  const isHtml = /<\w+/.test(trimmed);
  const inner = isHtml
    ? trimmed
    : escapeHtml(trimmed).replace(/\n/g, "<br>");
  return `<p>${inner}</p>`;
}

/**
 * For new compose: signature appears below the cursor area, separated by an
 * empty paragraph. Hand-cranking the markup keeps TipTap happy on insert.
 */
function appendSignatureNew(
  body: string,
  signatureHtml: string | null | undefined,
): string {
  const sig = signatureBlock(signatureHtml);
  if (!sig) return body;
  return `${body}<p></p>${sig}`;
}
