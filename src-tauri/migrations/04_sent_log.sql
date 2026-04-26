-- Local-only record of every successfully-sent message. This is a safety net:
-- the IMAP APPEND to the Sent folder is best-effort, and when it fails
-- silently (server rejection, wrong folder name, network hiccup) there is
-- otherwise no trace of what was sent. sent_log is the trace.

CREATE TABLE IF NOT EXISTS sent_log (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id          INTEGER NOT NULL,
    provider_message_id TEXT,
    mode                TEXT    NOT NULL,
    reply_uid           INTEGER,
    from_address        TEXT    NOT NULL,
    to_addresses        TEXT    NOT NULL,
    cc_addresses        TEXT,
    bcc_addresses       TEXT,
    subject             TEXT,
    html_body           TEXT,
    text_body           TEXT,
    attachments_json    TEXT,
    imap_appended       INTEGER NOT NULL DEFAULT 0,
    sent_at             INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sent_log_account_date
    ON sent_log(account_id, sent_at DESC);
