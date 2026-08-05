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

    CREATE TABLE IF NOT EXISTS missions (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, outcome TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT 'draft', priority TEXT NOT NULL DEFAULT 'normal',
      progress INTEGER NOT NULL DEFAULT 0, deadline INTEGER, budget_cents INTEGER,
      risk TEXT NOT NULL DEFAULT 'prepare', source TEXT NOT NULL DEFAULT 'user',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mission_steps (
      id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, position INTEGER NOT NULL,
      title TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', tool_name TEXT,
      tool_args TEXT, result TEXT, verification TEXT, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, FOREIGN KEY(mission_id) REFERENCES missions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS routines (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, prompt TEXT NOT NULL, schedule TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, quiet_start TEXT, quiet_end TEXT,
      last_run_at INTEGER, next_run_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY, mission_id TEXT, title TEXT NOT NULL, description TEXT NOT NULL,
      action_label TEXT NOT NULL, risk TEXT NOT NULL, preview TEXT, state TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL, resolved_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS captures (
      id TEXT PRIMARY KEY, content TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'note',
      state TEXT NOT NULL DEFAULT 'inbox', created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS operation_events (
      id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      event_type TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_missions_updated ON missions(updated_at);
    CREATE INDEX IF NOT EXISTS idx_steps_mission ON mission_steps(mission_id, position);
    CREATE INDEX IF NOT EXISTS idx_routines_next ON routines(enabled, next_run_at);
    CREATE INDEX IF NOT EXISTS idx_approvals_state ON approvals(state, created_at);

    CREATE TABLE IF NOT EXISTS companion_devices (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, secret_hash TEXT NOT NULL,
      scopes TEXT NOT NULL DEFAULT 'sync,approvals', created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL, revoked_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS companion_mutations (
      id TEXT PRIMARY KEY, device_id TEXT NOT NULL, created_at INTEGER NOT NULL,
      applied_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_tombstones (
      entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, deleted_at INTEGER NOT NULL,
      PRIMARY KEY(entity_type, entity_id)
    );
    CREATE INDEX IF NOT EXISTS idx_companion_mutations_applied ON companion_mutations(applied_at);
    CREATE INDEX IF NOT EXISTS idx_sync_tombstones_deleted ON sync_tombstones(deleted_at);
  `)

  const cols = database.prepare(`PRAGMA table_info(messages)`).all() as Array<{ name: string }>
  if (!cols.some((c) => c.name === 'images')) {
    database.exec(`ALTER TABLE messages ADD COLUMN images TEXT`)
  }

  const memoryCols = database.prepare(`PRAGMA table_info(memories)`).all() as Array<{ name: string }>
  if (!memoryCols.some((c) => c.name === 'source')) database.exec(`ALTER TABLE memories ADD COLUMN source TEXT NOT NULL DEFAULT 'conversation'`)
  if (!memoryCols.some((c) => c.name === 'confidence')) database.exec(`ALTER TABLE memories ADD COLUMN confidence REAL NOT NULL DEFAULT 1`)
  if (!memoryCols.some((c) => c.name === 'last_used_at')) database.exec(`ALTER TABLE memories ADD COLUMN last_used_at INTEGER`)
  if (!memoryCols.some((c) => c.name === 'expires_at')) database.exec(`ALTER TABLE memories ADD COLUMN expires_at INTEGER`)

  const approvalCols = database.prepare(`PRAGMA table_info(approvals)`).all() as Array<{ name: string }>
  if (!approvalCols.some((c) => c.name === 'updated_at')) {
    database.exec(`ALTER TABLE approvals ADD COLUMN updated_at INTEGER`)
    database.exec(`UPDATE approvals SET updated_at = COALESCE(resolved_at, created_at) WHERE updated_at IS NULL`)
  }

  const captureCols = database.prepare(`PRAGMA table_info(captures)`).all() as Array<{ name: string }>
  if (!captureCols.some((c) => c.name === 'updated_at')) {
    database.exec(`ALTER TABLE captures ADD COLUMN updated_at INTEGER`)
    database.exec(`UPDATE captures SET updated_at = created_at WHERE updated_at IS NULL`)
  }

  // Deletion triggers make desktop-originated deletes durable for phones that are
  // offline at the time. The timestamp expression works across bundled SQLite versions.
  const deletedNow = `CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)`
  const triggers: Array<[string, string, string, string?]> = [
    ['messages', 'chat', 'id', `OLD.role IN ('user','assistant')`],
    ['memories', 'memory', 'id'],
    ['missions', 'mission', 'id'],
    ['mission_steps', 'step', 'id'],
    ['routines', 'routine', 'id'],
    ['approvals', 'approval', 'id'],
    ['captures', 'capture', 'id']
  ]
  for (const [table, entityType, idColumn, when] of triggers) {
    database.exec(`
      CREATE TRIGGER IF NOT EXISTS sync_${table}_delete
      AFTER DELETE ON ${table}${when ? ` WHEN ${when}` : ''}
      BEGIN
        INSERT INTO sync_tombstones(entity_type, entity_id, deleted_at)
        VALUES ('${entityType}', OLD.${idColumn}, ${deletedNow})
        ON CONFLICT(entity_type, entity_id) DO UPDATE SET
          deleted_at = MAX(sync_tombstones.deleted_at, excluded.deleted_at);
      END;
    `)
  }
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
