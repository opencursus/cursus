-- T12 Send-later: queue of pending outgoing messages with a future
-- timestamp. A frontend worker polls this table once a minute, fires the
-- send when the deadline passes, and deletes the row.

CREATE TABLE scheduled_sends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    -- JSON payload mirroring OutgoingMessage on the Rust side: from, to,
    -- cc, bcc, subject, html, text, attachments[]. Held opaque so the
    -- worker can pass it straight through to the IPC layer.
    payload_json TEXT NOT NULL,
    -- ComposerSnapshot fields that aren't in the payload but matter for
    -- bookkeeping: mode + reply_uid for sent_log, draftId for cleanup.
    mode TEXT NOT NULL DEFAULT 'new',
    reply_uid INTEGER,
    draft_id INTEGER,
    -- The scheduled deadline (unix seconds, UTC).
    scheduled_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_scheduled_sends_due ON scheduled_sends(scheduled_at);
