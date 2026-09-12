import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import type { Recording, Skill } from './types';

const db = new DatabaseSync(path.join(process.cwd(), 'loop.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS recordings (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

interface Persisted {
  id: string;
}

/** Minimal JSON-blob table with a get/set/values/delete surface. */
function makeTable<T extends Persisted>(
  table: string,
  orderColumn: string,
  orderOf: (value: T) => number,
) {
  const upsert = db.prepare(
    `INSERT INTO ${table} (id, data, ${orderColumn}) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, ${orderColumn} = excluded.${orderColumn}`,
  );
  const select = db.prepare(`SELECT data FROM ${table} WHERE id = ?`);
  const selectAll = db.prepare(`SELECT data FROM ${table} ORDER BY ${orderColumn} DESC`);
  const remove = db.prepare(`DELETE FROM ${table} WHERE id = ?`);

  return {
    get(id: string): T | undefined {
      const row = select.get(id) as { data: string } | undefined;
      return row ? (JSON.parse(row.data) as T) : undefined;
    },
    set(id: string, value: T): void {
      upsert.run(id, JSON.stringify(value), orderOf(value));
    },
    values(): T[] {
      return (selectAll.all() as { data: string }[]).map((row) => JSON.parse(row.data) as T);
    },
    delete(id: string): void {
      remove.run(id);
    },
  };
}

export const store = {
  recordings: makeTable<Recording>('recordings', 'updated_at', (r) => r.stoppedAt ?? r.startedAt),
  skills: makeTable<Skill>('skills', 'created_at', (s) => s.createdAt),
};
