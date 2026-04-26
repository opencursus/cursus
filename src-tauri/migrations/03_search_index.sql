-- Search infrastructure. `search_index` is a flat row per (account, folder,
-- uid) with the searchable columns we can populate from IMAP summaries; the
-- body is filled lazily when the user opens the message. `search_fts` is the
-- FTS5 mirror with trigram tokenizer for substring matching across
-- subject / from / to / snippet / body.

CREATE TABLE IF NOT EXISTS search_index (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    folder_path TEXT NOT NULL,
    imap_uid INTEGER NOT NULL,
    subject TEXT,
    from_address TEXT,
    to_addresses TEXT,
    snippet TEXT,
    text_body TEXT,
    received_at INTEGER,
    indexed_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(account_id, folder_path, imap_uid)
);

CREATE INDEX IF NOT EXISTS idx_search_account_folder
  ON search_index(account_id, folder_path);
CREATE INDEX IF NOT EXISTS idx_search_received
  ON search_index(received_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
    subject, from_address, to_addresses, snippet, text_body,
    content='search_index',
    content_rowid='id',
    tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS search_index_ai AFTER INSERT ON search_index BEGIN
    INSERT INTO search_fts(rowid, subject, from_address, to_addresses, snippet, text_body)
    VALUES (new.id, new.subject, new.from_address, new.to_addresses, new.snippet, new.text_body);
END;

CREATE TRIGGER IF NOT EXISTS search_index_ad AFTER DELETE ON search_index BEGIN
    INSERT INTO search_fts(search_fts, rowid, subject, from_address, to_addresses, snippet, text_body)
    VALUES ('delete', old.id, old.subject, old.from_address, old.to_addresses, old.snippet, old.text_body);
END;

CREATE TRIGGER IF NOT EXISTS search_index_au AFTER UPDATE ON search_index BEGIN
    INSERT INTO search_fts(search_fts, rowid, subject, from_address, to_addresses, snippet, text_body)
    VALUES ('delete', old.id, old.subject, old.from_address, old.to_addresses, old.snippet, old.text_body);
    INSERT INTO search_fts(rowid, subject, from_address, to_addresses, snippet, text_body)
    VALUES (new.id, new.subject, new.from_address, new.to_addresses, new.snippet, new.text_body);
END;
