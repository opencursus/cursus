-- Adds mode + reply_uid to drafts so the composer can look up an existing
-- draft by (account_id, mode, reply_uid) when reopening a reply/forward.
-- reply_uid holds the IMAP UID of the message being replied to/forwarded
-- (matches Thread.id in the frontend, which is derived from the IMAP UID).
-- For brand-new compose drafts both mode='new' and reply_uid IS NULL.

ALTER TABLE drafts ADD COLUMN mode TEXT NOT NULL DEFAULT 'new';
ALTER TABLE drafts ADD COLUMN reply_uid INTEGER;

CREATE INDEX IF NOT EXISTS idx_drafts_lookup
  ON drafts(account_id, mode, reply_uid);
