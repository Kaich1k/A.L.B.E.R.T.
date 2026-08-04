import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { getDataDir } from '../config'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db

  const dir = getDataDir()
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'albert.sqlite')
  db = new Database(path)
  db.pragma('journal_mode = WAL')
  migrate(db)
  return db
}

function migrate(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_name TEXT,
      tool_call_id TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      embedding TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY,
      tool_name TEXT NOT NULL,
      args TEXT NOT NULL,
      result TEXT NOT NULL,
      ok INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at);
    CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at);
  `)

  const cols = database.prepare(`PRAGMA table_info(messages)`).all() as Array<{ name: string }>
  if (!cols.some((c) => c.name === 'images')) {
    database.exec(`ALTER TABLE messages ADD COLUMN images TEXT`)
  }
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
