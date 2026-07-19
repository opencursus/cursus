import { getDb } from "@/lib/db";

export interface ThreadMessageSummary {
  uid: number;
  fromAddress: string | null;
  snippet: string | null;
  /** Unix seconds, as persisted by the sync. */
  receivedAt: number | null;
  isUnread: boolean;
}

/**
 * Per-message summaries for a conversation, straight from the local cache.
 * Synthetic folder ids (negative — never resolved against the DB) have no
 * rows; callers get an empty map and should fall back to thread-level data.
 */
export async function getThreadMessageSummaries(
  folderId: number,
  uids: number[],
): Promise<Map<number, ThreadMessageSummary>> {
  const out = new Map<number, ThreadMessageSummary>();
  if (folderId <= 0 || uids.length === 0) return out;

  const db = await getDb();
  const placeholders = uids.map((_, i) => `$${i + 2}`).join(", ");
  const rows = await db.select<
    Array<{
      uid: number;
      fromAddress: string | null;
      snippet: string | null;
      receivedAt: number | null;
      isUnread: number;
    }>
  >(
    `SELECT imap_uid AS uid, from_address AS fromAddress, snippet,
            received_at AS receivedAt, is_unread AS isUnread
       FROM messages
      WHERE folder_id = $1 AND imap_uid IN (${placeholders})`,
    [folderId, ...uids],
  );
  for (const r of rows) {
    out.set(r.uid, {
      uid: r.uid,
      fromAddress: r.fromAddress,
      snippet: r.snippet,
      receivedAt: r.receivedAt,
      isUnread: r.isUnread === 1,
    });
  }
  return out;
}
