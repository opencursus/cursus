ALTER TABLE accounts ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

UPDATE accounts SET sort_order = id;
