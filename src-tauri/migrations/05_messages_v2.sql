-- T2 Persistence: rebuild `messages` (and its FTS5 mirror) so message rows
-- can be inserted without belonging to a thread yet. T3 (conversation
-- threading) will populate `thread_id` later by grouping on Message-ID /
-- References / In-Reply-To headers.
--
-- The original messages table was never populated (in-memory only), so the
-- DROP is data-loss-free.

DROP TABLE IF EXISTS messages_fts;
DROP TABLE IF EXISTS messages;

CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER REFERENCES threads(id) ON DELETE SET NULL,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    imap_uid INTEGER NOT NULL,
    message_id_header TEXT,
    in_reply_to TEXT,
    references_header TEXT,
    from_address TEXT,
    to_addresses TEXT,
    cc_addresses TEXT,
    bcc_addresses TEXT,
    subject TEXT,
    snippet TEXT,
    html_body TEXT,
    text_body TEXT,
    received_at INTEGER,
    flags TEXT,
    is_unread INTEGER NOT NULL DEFAULT 1,
    is_starred INTEGER NOT NULL DEFAULT 0,
    is_important INTEGER NOT NULL DEFAULT 0,
    has_attachments INTEGER NOT NULL DEFAULT 0,
    is_bulk INTEGER NOT NULL DEFAULT 0,
    is_auto INTEGER NOT NULL DEFAULT 0,
    attachments_json TEXT,
    body_fetched_at INTEGER,
    UNIQUE(account_id, folder_id, imap_uid)
);

CREATE INDEX idx_messages_folder_date
    ON messages(folder_id, received_at DESC);

CREATE INDEX idx_messages_account
    ON messages(account_id);

CREATE INDEX idx_messages_message_id
    ON messages(message_id_header);

CREATE INDEX idx_messages_in_reply_to
    ON messages(in_reply_to);

CREATE INDEX idx_messages_thread
    ON messages(thread_id);

-- FTS5 mirror over the persistent body. T11 (bulk-index all bodies) will use
-- this to query directly without round-tripping search_index.
CREATE VIRTUAL TABLE messages_fts USING fts5(
    subject,
    from_address,
    to_addresses,
    snippet,
    text_body,
    content='messages',
    content_rowid='id',
    tokenize='trigram'
);

CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, subject, from_address, to_addresses, snippet, text_body)
    VALUES (new.id, new.subject, new.from_address, new.to_addresses, new.snippet, new.text_body);
END;

CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, subject, from_address, to_addresses, snippet, text_body)
    VALUES ('delete', old.id, old.subject, old.from_address, old.to_addresses, old.snippet, old.text_body);
END;

CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, subject, from_address, to_addresses, snippet, text_body)
    VALUES ('delete', old.id, old.subject, old.from_address, old.to_addresses, old.snippet, old.text_body);
    INSERT INTO messages_fts(rowid, subject, from_address, to_addresses, snippet, text_body)
    VALUES (new.id, new.subject, new.from_address, new.to_addresses, new.snippet, new.text_body);
END;
