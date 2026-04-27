use tauri_plugin_sql::{Migration, MigrationKind};

pub fn all() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "initial schema",
            sql: include_str!("../../migrations/01_initial.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "drafts meta (mode + reply_uid)",
            sql: include_str!("../../migrations/02_drafts_meta.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "search index + FTS5",
            sql: include_str!("../../migrations/03_search_index.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "sent_log local audit table",
            sql: include_str!("../../migrations/04_sent_log.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "messages persistence v2 (nullable thread_id + indices + FTS5)",
            sql: include_str!("../../migrations/05_messages_v2.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "scheduled_sends queue (send later)",
            sql: include_str!("../../migrations/06_scheduled_sends.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "rules / filters",
            sql: include_str!("../../migrations/07_rules.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "account sort order for sidebar drag-reorder",
            sql: include_str!("../../migrations/08_account_sort_order.sql"),
            kind: MigrationKind::Up,
        },
    ]
}
