// Standalone outgoing-send pipeline. Both the Composer (synchronous send /
// undo-send) and the scheduled-sends worker call this. Anything that
// duplicated logic between the two would diverge over time — keep it here.

import {
  ipc,
  type OutgoingAttachment,
  type OutgoingMessage,
  type SaveToSent,
} from "@/lib/ipc";
import {
  deleteDraft,
  getAccount,
  getAccountSecrets,
  insertSentLog,
  upsertContact,
  parseNameEmail,
  type DraftMode,
} from "@/lib/db";
import { useAccountsStore } from "@/stores/accounts";

export interface SendPayload {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html: string;
  text: string;
  attachments: OutgoingAttachment[];
}

export interface SendOptions {
  accountId: number;
  mode: DraftMode;
  replyUid: number | null;
  /** When set, deleted on success — allows the worker to drop the source draft. */
  draftId: number | null;
}

/**
 * Build the From header per the same rules as Composer.buildFrom — kept in
 * sync by being a single function used by both call sites.
 */
function buildFrom(displayName: string | null, email: string): string {
  const name = displayName?.trim();
  if (!name || name === email) return email;
  if (/[@<>,;:\\"]/.test(name)) {
    const escaped = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${escaped}" <${email}>`;
  }
  return `${name} <${email}>`;
}

export async function executeOutgoingSend(
  payload: SendPayload,
  opts: SendOptions,
): Promise<void> {
  const account = await getAccount(opts.accountId);
  if (!account) throw new Error("account not found");
  const secrets = await getAccountSecrets(account.id);

  const from = buildFrom(account.display_name, account.email);
  const message: OutgoingMessage = {
    from,
    to: payload.to,
    cc: payload.cc,
    bcc: payload.bcc,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
    attachments: payload.attachments,
  };

  const sentFolder = useAccountsStore
    .getState()
    .folders.find((f) => f.accountId === account.id && f.specialUse === "sent");
  const saveToSent: SaveToSent | null = sentFolder
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
      { ...message, from: account.resend_from_address ?? message.from },
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

  // Local audit + contact bookkeeping. Both are best-effort — a failure here
  // shouldn't surface to the user, who already saw the send succeed.
  const ccList = message.cc ?? [];
  const bccList = message.bcc ?? [];
  const attachList = message.attachments ?? [];
  void insertSentLog({
    accountId: opts.accountId,
    providerMessageId: sendResult.messageId ?? null,
    mode: opts.mode,
    replyUid: opts.replyUid,
    fromAddress: from,
    toAddresses: message.to.join(", "),
    ccAddresses: ccList.length > 0 ? ccList.join(", ") : null,
    bccAddresses: bccList.length > 0 ? bccList.join(", ") : null,
    subject: message.subject || null,
    htmlBody: message.html || null,
    textBody: message.text || null,
    attachmentsJson:
      attachList.length > 0 ? JSON.stringify(attachList) : null,
    imapAppended: saveToSent != null,
    sentAt: Math.floor(Date.now() / 1000),
  }).catch(() => {});

  for (const recipient of [...message.to, ...ccList, ...bccList]) {
    const parsed = parseNameEmail(recipient);
    if (parsed) void upsertContact(parsed.email, parsed.name).catch(() => {});
  }

  if (opts.draftId != null) {
    void deleteDraft(opts.draftId).catch(() => {});
  }
}
