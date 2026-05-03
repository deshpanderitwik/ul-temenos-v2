import Database, { type Database as DatabaseType } from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

const DB_PATH = join(homedir(), '.temenos', 'temenos.db')

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS narratives (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT 'Untitled',
  tags_json   TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS narratives_updated_at_idx
  ON narratives (updated_at DESC);

CREATE TABLE IF NOT EXISTS narrative_updates (
  narrative_id  TEXT NOT NULL,
  seq           INTEGER NOT NULL,
  update_blob   BLOB NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (narrative_id, seq),
  FOREIGN KEY (narrative_id) REFERENCES narratives(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS narrative_updates_narrative_id_idx
  ON narrative_updates (narrative_id, seq);

CREATE TABLE IF NOT EXISTS sync_state (
  narrative_id            TEXT PRIMARY KEY,
  last_pushed_seq         INTEGER NOT NULL DEFAULT 0,
  last_pulled_remote_id   INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (narrative_id) REFERENCES narratives(id) ON DELETE CASCADE
);
`

let db: DatabaseType | null = null

export function openDb(path: string = DB_PATH): DatabaseType {
  if (db) return db
  mkdirSync(dirname(path), { recursive: true })
  const handle = new Database(path)
  handle.pragma('journal_mode = WAL')
  handle.pragma('foreign_keys = ON')
  handle.pragma('synchronous = NORMAL')
  db = handle
  return db
}

export function applySchema(database: DatabaseType): void {
  database.exec(SCHEMA_SQL)
}

export function initDb(path: string = DB_PATH): DatabaseType {
  const handle = openDb(path)
  applySchema(handle)
  return handle
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

export function getDbPath(): string {
  return DB_PATH
}
