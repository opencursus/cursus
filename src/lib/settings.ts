import { getDb } from "@/lib/db";

export async function getSettings(
  keys: string[],
): Promise<Record<string, string | null>> {
  if (keys.length === 0) return {};
  const db = await getDb();
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await db.select<Array<{ key: string; value: string | null }>>(
    `SELECT key, value FROM settings WHERE key IN (${placeholders})`,
    keys,
  );
  const out: Record<string, string | null> = {};
  for (const k of keys) out[k] = null;
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function setSetting(key: string, value: string | null): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ($1, $2, unixepoch())
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()`,
    [key, value],
  );
}
