-- T13 Filters / rules. The frontend evaluates these against each newly
-- arrived message after a sync. Conditions and actions are stored as JSON
-- to keep the schema flexible — the lib/rules.ts contract is the source of
-- truth for shape.
--
-- conditions_json: [{ field: "from"|"to"|"subject"|"body"|"hasAttachment",
--                     op: "contains"|"equals"|"regex"|"is",
--                     value: string|boolean }]
-- actions_json:    [{ type: "move_to"|"mark_read"|"star"|"important",
--                     folderPath?: string }]
--
-- account_id NULL means the rule applies to every account.

CREATE TABLE rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    conditions_json TEXT NOT NULL,
    actions_json TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_rules_account ON rules(account_id, sort_order);
