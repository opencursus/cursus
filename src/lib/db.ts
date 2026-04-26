import Database from "@tauri-apps/plugin-sql";
import { ipc } from "@/lib/ipc";

let cached: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!cached) {
    // The DB lives in a portable folder next to the executable
    // (`<exe_dir>/cursus-files/flow.db`). The Rust side computes the absolute
    // SQLite URL at startup and registers migrations against it; we have to
    // load with the exact same string, hence the IPC round-trip.
    const url = await ipc.getDatabaseUrl();
    cached = await Database.load(url);
  }
  return cached;
}

export interface StoredAccount {
  id: number;
  email: string;
  display_name: string | null;
  color: string | null;
  imap_host: string;
  imap_port: number;
  imap_security: "ssl" | "starttls" | "none";
  imap_username: string | null;
  smtp_mode: "smtp" | "resend";
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_security: "ssl" | "starttls" | "none" | null;
  smtp_username: string | null;
  resend_from_address: string | null;
  signature_html: string | null;
  created_at: number;
}

export interface AccountInput {
  email: string;
  displayName: string;
  color: string;
  imap: {
    host: string;
    port: number;
    security: "ssl" | "starttls" | "none";
    username: string;
    password: string;
  };
  sendingMode: "smtp" | "resend";
  smtp?: {
    host: string;
    port: number;
    security: "ssl" | "starttls" | "none";
    username: string;
    password: string;
  };
  resend?: {
    apiKey: string;
    fromAddress: string;
  };
  signatureHtml?: string;
}

// Secrets are stored in the OS keychain (Windows Credential Manager / macOS
// Keychain / libsecret on Linux) via the `keyring` crate. The BLOB columns
// are kept for backwards compatibility: legacy plaintext passwords there are
// still readable on first load and migrated into the keychain on next save.
//
// Keychain key layout: `imap.{accountId}`, `smtp.{accountId}`, `resend.{accountId}`.
const KEYCHAIN_PLACEHOLDER = "__keychain__";

function encodeSecret(_text: string): string {
  // Insert into the BLOB column as a marker; the real value lives in the
  // keychain and is written separately after the account row is created.
  return KEYCHAIN_PLACEHOLDER;
}

async function loadSecret(
  keychainKey: string,
  blobValue: string | null,
): Promise<string> {
  if (blobValue === KEYCHAIN_PLACEHOLDER) {
    const v = await ipc.secretsLoad(keychainKey).catch(() => null);
    return v ?? "";
  }
  // Legacy plaintext fallback. The value stays readable; the next save path
  // will promote it to the keychain and overwrite the BLOB with the marker.
  return blobValue ?? "";
}

async function writeSecret(keychainKey: string, value: string): Promise<void> {
  if (value === "") {
    await ipc.secretsDelete(keychainKey).catch(() => {});
    return;
  }
  await ipc.secretsSave(keychainKey, value);
}

function secretKeyImap(id: number): string { return `imap.${id}`; }
function secretKeySmtp(id: number): string { return `smtp.${id}`; }
function secretKeyResend(id: number): string { return `resend.${id}`; }

export async function listAccounts(): Promise<StoredAccount[]> {
  const db = await getDb();
  return db.select<StoredAccount[]>(
    `SELECT id, email, display_name, color, imap_host, imap_port, imap_security,
            imap_username, smtp_mode, smtp_host, smtp_port, smtp_security,
            smtp_username, resend_from_address, signature_html, created_at
       FROM accounts
       ORDER BY id ASC`,
  );
}

export async function getAccount(id: number): Promise<StoredAccount | null> {
  const db = await getDb();
  const rows = await db.select<StoredAccount[]>(
    `SELECT id, email, display_name, color, imap_host, imap_port, imap_security,
            imap_username, smtp_mode, smtp_host, smtp_port, smtp_security,
            smtp_username, resend_from_address, signature_html, created_at
       FROM accounts WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function insertAccount(input: AccountInput): Promise<number> {
  const db = await getDb();
  const imapMarker = encodeSecret(input.imap.password);
  const smtpMarker = input.smtp ? encodeSecret(input.smtp.password) : null;
  const resendMarker = input.resend ? encodeSecret(input.resend.apiKey) : null;

  const result = await db.execute(
    `INSERT INTO accounts (
       email, display_name, color,
       imap_host, imap_port, imap_security, imap_username, imap_password_enc,
       smtp_mode, smtp_host, smtp_port, smtp_security, smtp_username, smtp_password_enc,
       resend_api_key_enc, resend_from_address, signature_html
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
    [
      input.email,
      input.displayName || null,
      input.color || null,
      input.imap.host,
      input.imap.port,
      input.imap.security,
      input.imap.username || null,
      imapMarker,
      input.sendingMode,
      input.smtp?.host ?? null,
      input.smtp?.port ?? null,
      input.smtp?.security ?? null,
      input.smtp?.username ?? null,
      smtpMarker,
      resendMarker,
      input.resend?.fromAddress ?? null,
      input.signatureHtml?.trim() || null,
    ],
  );
  const id = Number(result.lastInsertId);

  await writeSecret(secretKeyImap(id), input.imap.password);
  if (input.smtp) await writeSecret(secretKeySmtp(id), input.smtp.password);
  if (input.resend) await writeSecret(secretKeyResend(id), input.resend.apiKey);
  return id;
}

export async function updateAccount(id: number, input: AccountInput): Promise<void> {
  const db = await getDb();
  const imapMarker = encodeSecret(input.imap.password);
  const smtpMarker = input.smtp ? encodeSecret(input.smtp.password) : null;
  const resendMarker = input.resend ? encodeSecret(input.resend.apiKey) : null;

  await db.execute(
    `UPDATE accounts SET
       email = $1, display_name = $2, color = $3,
       imap_host = $4, imap_port = $5, imap_security = $6,
       imap_username = $7, imap_password_enc = $8,
       smtp_mode = $9, smtp_host = $10, smtp_port = $11,
       smtp_security = $12, smtp_username = $13, smtp_password_enc = $14,
       resend_api_key_enc = $15, resend_from_address = $16,
       signature_html = $17,
       updated_at = unixepoch()
     WHERE id = $18`,
    [
      input.email,
      input.displayName || null,
      input.color || null,
      input.imap.host,
      input.imap.port,
      input.imap.security,
      input.imap.username || null,
      imapMarker,
      input.sendingMode,
      input.smtp?.host ?? null,
      input.smtp?.port ?? null,
      input.smtp?.security ?? null,
      input.smtp?.username ?? null,
      smtpMarker,
      resendMarker,
      input.resend?.fromAddress ?? null,
      input.signatureHtml?.trim() || null,
      id,
    ],
  );

  await writeSecret(secretKeyImap(id), input.imap.password);
  if (input.smtp) {
    await writeSecret(secretKeySmtp(id), input.smtp.password);
  } else {
    await ipc.secretsDelete(secretKeySmtp(id)).catch(() => {});
  }
  if (input.resend) {
    await writeSecret(secretKeyResend(id), input.resend.apiKey);
  } else {
    await ipc.secretsDelete(secretKeyResend(id)).catch(() => {});
  }
}

export async function deleteAccount(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM accounts WHERE id = $1", [id]);
  await ipc.secretsDelete(secretKeyImap(id)).catch(() => {});
  await ipc.secretsDelete(secretKeySmtp(id)).catch(() => {});
  await ipc.secretsDelete(secretKeyResend(id)).catch(() => {});
}

export type DraftMode = "new" | "reply" | "replyAll" | "forward";

export interface StoredDraft {
  id: number;
  account_id: number;
  mode: DraftMode;
  reply_uid: number | null;
  to_addresses: string | null;
  cc_addresses: string | null;
  bcc_addresses: string | null;
  subject: string | null;
  html_body: string | null;
  text_body: string | null;
  updated_at: number;
}

export interface DraftInput {
  accountId: number;
  mode: DraftMode;
  replyUid: number | null;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  htmlBody: string;
  textBody: string;
}

export async function getDraft(id: number): Promise<StoredDraft | null> {
  const db = await getDb();
  const rows = await db.select<StoredDraft[]>(
    `SELECT id, account_id, mode, reply_uid, to_addresses, cc_addresses,
            bcc_addresses, subject, html_body, text_body, updated_at
       FROM drafts WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function findReplyDraft(
  accountId: number,
  mode: DraftMode,
  replyUid: number | null,
): Promise<StoredDraft | null> {
  const db = await getDb();
  const rows =
    replyUid == null
      ? await db.select<StoredDraft[]>(
          `SELECT id, account_id, mode, reply_uid, to_addresses, cc_addresses,
                  bcc_addresses, subject, html_body, text_body, updated_at
             FROM drafts
            WHERE account_id = $1 AND mode = $2 AND reply_uid IS NULL
            ORDER BY updated_at DESC LIMIT 1`,
          [accountId, mode],
        )
      : await db.select<StoredDraft[]>(
          `SELECT id, account_id, mode, reply_uid, to_addresses, cc_addresses,
                  bcc_addresses, subject, html_body, text_body, updated_at
             FROM drafts
            WHERE account_id = $1 AND mode = $2 AND reply_uid = $3
            ORDER BY updated_at DESC LIMIT 1`,
          [accountId, mode, replyUid],
        );
  return rows[0] ?? null;
}

export async function insertDraft(input: DraftInput): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO drafts (
       account_id, mode, reply_uid,
       to_addresses, cc_addresses, bcc_addresses,
       subject, html_body, text_body, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, unixepoch())`,
    [
      input.accountId,
      input.mode,
      input.replyUid,
      input.to || null,
      input.cc || null,
      input.bcc || null,
      input.subject || null,
      input.htmlBody || null,
      input.textBody || null,
    ],
  );
  return Number(result.lastInsertId);
}

export async function updateDraft(id: number, input: DraftInput): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE drafts SET
       to_addresses = $1, cc_addresses = $2, bcc_addresses = $3,
       subject = $4, html_body = $5, text_body = $6,
       updated_at = unixepoch()
     WHERE id = $7`,
    [
      input.to || null,
      input.cc || null,
      input.bcc || null,
      input.subject || null,
      input.htmlBody || null,
      input.textBody || null,
      id,
    ],
  );
}

export async function deleteDraft(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM drafts WHERE id = $1", [id]);
}

// --- Contacts (for composer autocomplete) ----------------------------------

export interface ContactRow {
  id: number;
  email: string;
  display_name: string | null;
  interaction_count: number;
  last_interaction_at: number | null;
}

// Heuristic for automated / transactional local-parts that should not be
// auto-suggested when the user composes. Mirrors the regex in threads.ts
// (inferCategory) so the two stay in sync.
const AUTO_LOCAL_PART =
  /^(no[-._]?reply|do[-._]?not[-._]?reply|notifications?|alerts?|automated?|auto|system|support|updates?|mailer|postmaster|bounces?|news)$/i;

export function parseNameEmail(
  raw: string,
): { name: string | null; email: string } | null {
  const s = raw.trim();
  if (!s) return null;
  const m = s.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (m && m[2]) {
    const rawName = m[1]?.trim() ?? "";
    const unquoted = rawName.replace(/^"(.*)"$/, "$1").trim();
    return { name: unquoted || null, email: m[2].trim() };
  }
  if (s.includes("@")) return { name: null, email: s };
  return null;
}

export function isAutomatedEmail(email: string): boolean {
  const local = email.split("@")[0] ?? "";
  return AUTO_LOCAL_PART.test(local);
}

/** Upsert bumping interaction_count. Use on outgoing sends and on replies
 *  to senders — anywhere the user actively interacts with the address. */
export async function upsertContact(
  email: string,
  displayName: string | null,
): Promise<void> {
  const addr = email.trim().toLowerCase();
  if (!addr || !addr.includes("@")) return;
  if (isAutomatedEmail(addr)) return;
  const name = displayName?.trim() || null;
  const db = await getDb();
  await db.execute(
    `INSERT INTO contacts (email, display_name, interaction_count, last_interaction_at)
     VALUES ($1, $2, 1, unixepoch())
     ON CONFLICT(email) DO UPDATE SET
       display_name = COALESCE(NULLIF(excluded.display_name, ''), contacts.display_name),
       interaction_count = contacts.interaction_count + 1,
       last_interaction_at = unixepoch()`,
    [addr, name],
  );
}

/** Add to the pool without bumping. Use on fetched senders so the user
 *  gets useful autocomplete on day one without those senders outranking
 *  the people they actually email. */
export async function seedContact(
  email: string,
  displayName: string | null,
): Promise<void> {
  const addr = email.trim().toLowerCase();
  if (!addr || !addr.includes("@")) return;
  if (isAutomatedEmail(addr)) return;
  const name = displayName?.trim() || null;
  const db = await getDb();
  await db.execute(
    `INSERT INTO contacts (email, display_name, interaction_count, last_interaction_at)
     VALUES ($1, $2, 0, NULL)
     ON CONFLICT(email) DO UPDATE SET
       display_name = COALESCE(NULLIF(excluded.display_name, ''), contacts.display_name)`,
    [addr, name],
  );
}

export async function searchContacts(
  query: string,
  limit = 8,
): Promise<ContactRow[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  // Escape LIKE metacharacters so a `_` in the user's typing matches a
  // literal underscore, not a wildcard.
  const escaped = q.replace(/[\\%_]/g, "\\$&");
  const like = `%${escaped}%`;
  const db = await getDb();
  return db.select<ContactRow[]>(
    `SELECT id, email, display_name, interaction_count, last_interaction_at
       FROM contacts
      WHERE email LIKE $1 ESCAPE '\\'
         OR (display_name IS NOT NULL AND lower(display_name) LIKE $1 ESCAPE '\\')
      ORDER BY interaction_count DESC,
               COALESCE(last_interaction_at, 0) DESC,
               email ASC
      LIMIT $2`,
    [like, limit],
  );
}

/** One-shot: seed the contacts table from previously-indexed senders in
 *  `search_index`. Idempotent — safe to run every boot. */
export async function backfillContactsFromSearchIndex(): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ from_address: string | null }[]>(
    `SELECT DISTINCT from_address FROM search_index WHERE from_address IS NOT NULL`,
  );
  for (const r of rows) {
    if (!r.from_address) continue;
    const parsed = parseNameEmail(r.from_address);
    if (!parsed) continue;
    try {
      await seedContact(parsed.email, parsed.name);
    } catch {
      // Keep going on per-row errors.
    }
  }
}

export interface SentLogInput {
  accountId: number;
  providerMessageId: string | null;
  mode: DraftMode;
  replyUid: number | null;
  fromAddress: string;
  toAddresses: string;
  ccAddresses: string | null;
  bccAddresses: string | null;
  subject: string | null;
  htmlBody: string | null;
  textBody: string | null;
  attachmentsJson: string | null;
  imapAppended: boolean;
  sentAt: number;
}

export async function insertSentLog(input: SentLogInput): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO sent_log (
       account_id, provider_message_id, mode, reply_uid,
       from_address, to_addresses, cc_addresses, bcc_addresses,
       subject, html_body, text_body, attachments_json,
       imap_appended, sent_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      input.accountId,
      input.providerMessageId,
      input.mode,
      input.replyUid,
      input.fromAddress,
      input.toAddresses,
      input.ccAddresses,
      input.bccAddresses,
      input.subject,
      input.htmlBody,
      input.textBody,
      input.attachmentsJson,
      input.imapAppended ? 1 : 0,
      input.sentAt,
    ],
  );
  return Number(result.lastInsertId);
}

export interface StoredSentLogEntry {
  id: number;
  account_id: number;
  provider_message_id: string | null;
  mode: DraftMode;
  reply_uid: number | null;
  from_address: string;
  to_addresses: string;
  cc_addresses: string | null;
  bcc_addresses: string | null;
  subject: string | null;
  html_body: string | null;
  text_body: string | null;
  attachments_json: string | null;
  imap_appended: number;
  sent_at: number;
}

export async function listSentLog(
  accountId: number | null,
  limit = 100,
): Promise<StoredSentLogEntry[]> {
  const db = await getDb();
  if (accountId == null) {
    return db.select<StoredSentLogEntry[]>(
      `SELECT * FROM sent_log ORDER BY sent_at DESC LIMIT $1`,
      [limit],
    );
  }
  return db.select<StoredSentLogEntry[]>(
    `SELECT * FROM sent_log WHERE account_id = $1 ORDER BY sent_at DESC LIMIT $2`,
    [accountId, limit],
  );
}

export interface SearchIndexEntry {
  accountId: number;
  folderPath: string;
  imapUid: number;
  subject: string | null;
  fromAddress: string | null;
  toAddresses: string | null;
  snippet: string | null;
  receivedAt: number | null;
}

export async function upsertSearchIndex(e: SearchIndexEntry): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO search_index (
       account_id, folder_path, imap_uid,
       subject, from_address, to_addresses, snippet, received_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT(account_id, folder_path, imap_uid) DO UPDATE SET
       subject = excluded.subject,
       from_address = excluded.from_address,
       to_addresses = excluded.to_addresses,
       snippet = excluded.snippet,
       received_at = excluded.received_at`,
    [
      e.accountId,
      e.folderPath,
      e.imapUid,
      e.subject,
      e.fromAddress,
      e.toAddresses,
      e.snippet,
      e.receivedAt,
    ],
  );
}

export async function upsertSearchBody(
  accountId: number,
  folderPath: string,
  imapUid: number,
  textBody: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE search_index SET text_body = $4
      WHERE account_id = $1 AND folder_path = $2 AND imap_uid = $3`,
    [accountId, folderPath, imapUid, textBody],
  );
}

export interface SearchHit {
  accountId: number;
  folderPath: string;
  imapUid: number;
  subject: string | null;
  fromAddress: string | null;
  snippet: string | null;
  receivedAt: number | null;
  rank: number;
}

export async function searchMessages(
  query: string,
  limit = 50,
): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  // Quote the whole query to avoid FTS5 syntax errors on punctuation,
  // then escape embedded quotes per FTS5 rules (double quote = one quote).
  const escaped = `"${q.replace(/"/g, '""')}"`;
  const db = await getDb();
  try {
    return await db.select<SearchHit[]>(
      `SELECT
         si.account_id AS accountId,
         si.folder_path AS folderPath,
         si.imap_uid AS imapUid,
         si.subject,
         si.from_address AS fromAddress,
         si.snippet,
         si.received_at AS receivedAt,
         bm25(search_fts) AS rank
       FROM search_fts
       JOIN search_index si ON si.id = search_fts.rowid
       WHERE search_fts MATCH $1
       ORDER BY rank, si.received_at DESC
       LIMIT $2`,
      [escaped, limit],
    );
  } catch (err) {
    console.warn("searchMessages failed:", err);
    return [];
  }
}

// --- Folders -------------------------------------------------------------

export interface StoredFolder {
  id: number;
  account_id: number;
  path: string;
  name: string;
  delimiter: string | null;
  special_use: string | null;
  uid_validity: number | null;
  last_uid: number | null;
  unread_count: number;
  total_count: number;
}

export async function listFoldersForAccount(
  accountId: number,
): Promise<StoredFolder[]> {
  const db = await getDb();
  return db.select<StoredFolder[]>(
    `SELECT id, account_id, path, name, delimiter, special_use,
            uid_validity, last_uid, unread_count, total_count
       FROM folders
      WHERE account_id = $1`,
    [accountId],
  );
}

export interface UpsertFolderInput {
  accountId: number;
  path: string;
  name: string;
  delimiter: string | null;
  specialUse: string | null;
  uidValidity?: number | null;
}

/**
 * Insert-or-update by (account_id, path). Returns the row id.
 * Does not touch unread_count / last_uid — those are maintained separately.
 */
export async function upsertFolder(input: UpsertFolderInput): Promise<number> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO folders (account_id, path, name, delimiter, special_use, uid_validity)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT(account_id, path) DO UPDATE SET
       name = excluded.name,
       delimiter = excluded.delimiter,
       special_use = excluded.special_use,
       uid_validity = COALESCE(excluded.uid_validity, folders.uid_validity)`,
    [
      input.accountId,
      input.path,
      input.name,
      input.delimiter,
      input.specialUse,
      input.uidValidity ?? null,
    ],
  );
  const rows = await db.select<{ id: number }[]>(
    `SELECT id FROM folders WHERE account_id = $1 AND path = $2`,
    [input.accountId, input.path],
  );
  if (!rows[0]) throw new Error(`upsertFolder: row missing after insert`);
  return rows[0].id;
}

/**
 * Remove folders that the IMAP server no longer advertises. Cascades into
 * messages via the FK. Pass the full set of paths the server still has.
 */
export async function pruneFolders(
  accountId: number,
  keepPaths: string[],
): Promise<void> {
  const db = await getDb();
  if (keepPaths.length === 0) {
    await db.execute(`DELETE FROM folders WHERE account_id = $1`, [accountId]);
    return;
  }
  // Build a parameter list ($2, $3, ...) for the NOT IN clause.
  const placeholders = keepPaths.map((_, i) => `$${i + 2}`).join(", ");
  await db.execute(
    `DELETE FROM folders
       WHERE account_id = $1 AND path NOT IN (${placeholders})`,
    [accountId, ...keepPaths],
  );
}

export async function setFolderUnreadCount(
  folderId: number,
  unread: number,
): Promise<void> {
  const db = await getDb();
  await db.execute(`UPDATE folders SET unread_count = $1 WHERE id = $2`, [
    Math.max(0, unread),
    folderId,
  ]);
}

// --- Messages ------------------------------------------------------------

export interface StoredMessage {
  id: number;
  thread_id: number | null;
  account_id: number;
  folder_id: number;
  imap_uid: number;
  message_id_header: string | null;
  in_reply_to: string | null;
  references_header: string | null;
  from_address: string | null;
  to_addresses: string | null;
  cc_addresses: string | null;
  bcc_addresses: string | null;
  subject: string | null;
  snippet: string | null;
  html_body: string | null;
  text_body: string | null;
  received_at: number | null;
  flags: string | null;
  is_unread: number;
  is_starred: number;
  is_important: number;
  has_attachments: number;
  is_bulk: number;
  is_auto: number;
  attachments_json: string | null;
  body_fetched_at: number | null;
}

export interface UpsertMessageInput {
  accountId: number;
  folderId: number;
  imapUid: number;
  messageIdHeader?: string | null;
  inReplyTo?: string | null;
  referencesHeader?: string | null;
  fromAddress: string | null;
  toAddresses: string | null;
  ccAddresses?: string | null;
  bccAddresses?: string | null;
  subject: string | null;
  snippet: string | null;
  receivedAt: number | null;
  flags: string[];
  isUnread: boolean;
  isStarred: boolean;
  isImportant: boolean;
  hasAttachments: boolean;
  isBulk: boolean;
  isAuto: boolean;
}

/**
 * Insert summary fields. Body fields (html_body / text_body / attachments)
 * are filled later by setMessageBody when the user opens the message.
 * Star / unread / important are updated on conflict so server-side flag
 * changes are reflected locally on the next sync.
 */
export async function upsertMessageSummary(input: UpsertMessageInput): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO messages (
       account_id, folder_id, imap_uid,
       message_id_header, in_reply_to, references_header,
       from_address, to_addresses, cc_addresses, bcc_addresses,
       subject, snippet, received_at, flags,
       is_unread, is_starred, is_important, has_attachments, is_bulk, is_auto
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
       $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
     )
     ON CONFLICT(account_id, folder_id, imap_uid) DO UPDATE SET
       message_id_header = COALESCE(excluded.message_id_header, messages.message_id_header),
       in_reply_to = COALESCE(excluded.in_reply_to, messages.in_reply_to),
       references_header = COALESCE(excluded.references_header, messages.references_header),
       from_address = excluded.from_address,
       to_addresses = excluded.to_addresses,
       cc_addresses = excluded.cc_addresses,
       bcc_addresses = excluded.bcc_addresses,
       subject = excluded.subject,
       snippet = excluded.snippet,
       received_at = excluded.received_at,
       flags = excluded.flags,
       is_unread = excluded.is_unread,
       is_starred = excluded.is_starred,
       is_important = excluded.is_important,
       has_attachments = excluded.has_attachments,
       is_bulk = excluded.is_bulk,
       is_auto = excluded.is_auto`,
    [
      input.accountId,
      input.folderId,
      input.imapUid,
      input.messageIdHeader ?? null,
      input.inReplyTo ?? null,
      input.referencesHeader ?? null,
      input.fromAddress,
      input.toAddresses,
      input.ccAddresses ?? null,
      input.bccAddresses ?? null,
      input.subject,
      input.snippet,
      input.receivedAt,
      JSON.stringify(input.flags),
      input.isUnread ? 1 : 0,
      input.isStarred ? 1 : 0,
      input.isImportant ? 1 : 0,
      input.hasAttachments ? 1 : 0,
      input.isBulk ? 1 : 0,
      input.isAuto ? 1 : 0,
    ],
  );
}

export async function listMessagesForFolder(
  folderId: number,
  limit = 50,
): Promise<StoredMessage[]> {
  const db = await getDb();
  return db.select<StoredMessage[]>(
    `SELECT * FROM messages
      WHERE folder_id = $1
      ORDER BY received_at DESC, imap_uid DESC
      LIMIT $2`,
    [folderId, limit],
  );
}

export async function deleteMessage(
  folderId: number,
  imapUid: number,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `DELETE FROM messages WHERE folder_id = $1 AND imap_uid = $2`,
    [folderId, imapUid],
  );
}

export async function updateMessageFlags(
  folderId: number,
  imapUid: number,
  patch: { isUnread?: boolean; isStarred?: boolean; isImportant?: boolean },
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const params: (string | number)[] = [];
  let i = 1;
  if (patch.isUnread !== undefined) {
    sets.push(`is_unread = $${i++}`);
    params.push(patch.isUnread ? 1 : 0);
  }
  if (patch.isStarred !== undefined) {
    sets.push(`is_starred = $${i++}`);
    params.push(patch.isStarred ? 1 : 0);
  }
  if (patch.isImportant !== undefined) {
    sets.push(`is_important = $${i++}`);
    params.push(patch.isImportant ? 1 : 0);
  }
  if (sets.length === 0) return;
  params.push(folderId, imapUid);
  await db.execute(
    `UPDATE messages SET ${sets.join(", ")}
      WHERE folder_id = $${i++} AND imap_uid = $${i++}`,
    params,
  );
}

export interface StoredMessageBody {
  html: string | null;
  text: string | null;
  attachments: string | null; // JSON
}

export async function getMessageBody(
  folderId: number,
  imapUid: number,
): Promise<StoredMessageBody | null> {
  const db = await getDb();
  const rows = await db.select<StoredMessageBody[]>(
    `SELECT html_body AS html, text_body AS text, attachments_json AS attachments
       FROM messages
      WHERE folder_id = $1 AND imap_uid = $2 AND body_fetched_at IS NOT NULL`,
    [folderId, imapUid],
  );
  return rows[0] ?? null;
}

export async function setMessageBody(
  folderId: number,
  imapUid: number,
  html: string | null,
  text: string | null,
  attachmentsJson: string | null,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE messages SET
       html_body = $1, text_body = $2, attachments_json = $3,
       body_fetched_at = unixepoch()
      WHERE folder_id = $4 AND imap_uid = $5`,
    [html, text, attachmentsJson, folderId, imapUid],
  );
}

// --- Rules ----------------------------------------------------------------

export interface StoredRule {
  id: number;
  account_id: number | null;
  name: string;
  enabled: number;
  sort_order: number;
  conditions_json: string;
  actions_json: string;
  created_at: number;
  updated_at: number;
}

export interface RuleInput {
  id?: number | null;
  accountId: number | null;
  name: string;
  enabled: boolean;
  sortOrder: number;
  conditionsJson: string;
  actionsJson: string;
}

export async function listRules(accountId: number | null): Promise<StoredRule[]> {
  const db = await getDb();
  if (accountId == null) {
    return db.select<StoredRule[]>(
      `SELECT * FROM rules ORDER BY sort_order ASC, id ASC`,
    );
  }
  // Account-scoped rules + global (account_id IS NULL) rules apply.
  return db.select<StoredRule[]>(
    `SELECT * FROM rules WHERE account_id = $1 OR account_id IS NULL
     ORDER BY sort_order ASC, id ASC`,
    [accountId],
  );
}

export async function upsertRule(input: RuleInput): Promise<number> {
  const db = await getDb();
  if (input.id != null) {
    await db.execute(
      `UPDATE rules SET account_id = $1, name = $2, enabled = $3,
         sort_order = $4, conditions_json = $5, actions_json = $6,
         updated_at = unixepoch()
       WHERE id = $7`,
      [
        input.accountId,
        input.name,
        input.enabled ? 1 : 0,
        input.sortOrder,
        input.conditionsJson,
        input.actionsJson,
        input.id,
      ],
    );
    return input.id;
  }
  const result = await db.execute(
    `INSERT INTO rules (
       account_id, name, enabled, sort_order, conditions_json, actions_json
     ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      input.accountId,
      input.name,
      input.enabled ? 1 : 0,
      input.sortOrder,
      input.conditionsJson,
      input.actionsJson,
    ],
  );
  return Number(result.lastInsertId);
}

export async function deleteRule(id: number): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM rules WHERE id = $1`, [id]);
}

// --- Scheduled sends -----------------------------------------------------

export interface ScheduledSendInput {
  accountId: number;
  payloadJson: string;
  mode: string;
  replyUid: number | null;
  draftId: number | null;
  scheduledAt: number;
}

export interface StoredScheduledSend {
  id: number;
  account_id: number;
  payload_json: string;
  mode: string;
  reply_uid: number | null;
  draft_id: number | null;
  scheduled_at: number;
  created_at: number;
}

export async function insertScheduledSend(input: ScheduledSendInput): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO scheduled_sends (
       account_id, payload_json, mode, reply_uid, draft_id, scheduled_at
     ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      input.accountId,
      input.payloadJson,
      input.mode,
      input.replyUid,
      input.draftId,
      input.scheduledAt,
    ],
  );
  return Number(result.lastInsertId);
}

export async function listDueScheduledSends(now: number): Promise<StoredScheduledSend[]> {
  const db = await getDb();
  return db.select<StoredScheduledSend[]>(
    `SELECT * FROM scheduled_sends WHERE scheduled_at <= $1 ORDER BY scheduled_at ASC`,
    [now],
  );
}

export async function deleteScheduledSend(id: number): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM scheduled_sends WHERE id = $1`, [id]);
}

export async function getAccountSecrets(id: number): Promise<{
  imapPassword: string;
  smtpPassword: string | null;
  resendApiKey: string | null;
}> {
  const db = await getDb();
  const rows = await db.select<
    Array<{
      imap_password_enc: string | null;
      smtp_password_enc: string | null;
      resend_api_key_enc: string | null;
    }>
  >(
    "SELECT imap_password_enc, smtp_password_enc, resend_api_key_enc FROM accounts WHERE id = $1",
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error(`account ${id} not found`);
  const imapPassword = await loadSecret(secretKeyImap(id), row.imap_password_enc);
  const smtpPassword = row.smtp_password_enc
    ? await loadSecret(secretKeySmtp(id), row.smtp_password_enc)
    : null;
  const resendApiKey = row.resend_api_key_enc
    ? await loadSecret(secretKeyResend(id), row.resend_api_key_enc)
    : null;
  return { imapPassword, smtpPassword, resendApiKey };
}
