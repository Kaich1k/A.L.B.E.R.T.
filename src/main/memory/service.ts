import { v4 as uuid } from 'uuid'
import { getDb } from './db'
import { createOpenAI, hasOpenAIKey } from '../openai/client'
import type { ActivityEntry, ChatMessage, MemoryFact } from '../../shared/types'

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

async function embed(text: string): Promise<number[] | null> {
  if (!hasOpenAIKey()) return null
  try {
    const openai = createOpenAI()
    const res = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text
    })
    return res.data[0].embedding
  } catch {
    return null
  }
}

export function addMessage(message: Omit<ChatMessage, 'id' | 'createdAt'> & { id?: string; createdAt?: number }): ChatMessage {
  const row: ChatMessage = {
    id: message.id ?? uuid(),
    role: message.role,
    content: message.content,
    createdAt: message.createdAt ?? Date.now(),
    toolName: message.toolName,
    toolCallId: message.toolCallId,
    images: message.images
  }
  getDb()
    .prepare(
      `INSERT INTO messages (id, role, content, tool_name, tool_call_id, created_at, images)
       VALUES (@id, @role, @content, @toolName, @toolCallId, @createdAt, @images)`
    )
    .run({
      id: row.id,
      role: row.role,
      content: row.content,
      toolName: row.toolName ?? null,
      toolCallId: row.toolCallId ?? null,
      createdAt: row.createdAt,
      images: row.images?.length
        ? JSON.stringify(
            row.images.map(({ id, mediaType, fileName }) => ({ id, mediaType, fileName }))
          )
        : null
    })
  return row
}

function parseImages(raw: unknown): ChatMessage['images'] {
  if (!raw || typeof raw !== 'string') return undefined
  try {
    const parsed = JSON.parse(raw) as ChatMessage['images']
    return Array.isArray(parsed) && parsed.length ? parsed : undefined
  } catch {
    return undefined
  }
}

export function getRecentMessages(limit = 80): ChatMessage[] {
  const rows = getDb()
    .prepare(
      `SELECT id, role, content, tool_name as toolName, tool_call_id as toolCallId,
              created_at as createdAt, images as imagesJson
       FROM messages ORDER BY created_at DESC LIMIT ?`
    )
    .all(limit) as Array<ChatMessage & { imagesJson?: string | null }>

  return rows
    .reverse()
    .map(({ imagesJson, ...rest }) => ({
      ...rest,
      images: parseImages(imagesJson)
    }))
}

export function clearMessages(): void {
  getDb().prepare('DELETE FROM messages').run()
}

/** Phone-facing chat row (no tool messages / images). */
export type CompanionChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
}

export function listCompanionChat(limit = 120): CompanionChatMessage[] {
  return getRecentMessages(limit)
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
      createdAt: m.createdAt
    }))
}

export function countCompanionChat(): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) as n FROM messages WHERE role IN ('user', 'assistant')`)
    .get() as { n: number }
  return row?.n ?? 0
}

function getMessageById(id: string): CompanionChatMessage | null {
  const row = getDb()
    .prepare(
      `SELECT id, role, content, created_at as createdAt FROM messages WHERE id = ?`
    )
    .get(id) as CompanionChatMessage | undefined
  if (!row) return null
  if (row.role !== 'user' && row.role !== 'assistant') return null
  return row
}

/** Upsert a phone/Mac chat message by id (LWW by createdAt). */
export function upsertCompanionMessage(msg: CompanionChatMessage): boolean {
  if (!msg?.id || !msg.content?.trim()) return false
  if (msg.role !== 'user' && msg.role !== 'assistant') return false
  const content = msg.content.trim()
  const createdAt = msg.createdAt || Date.now()
  const existing = getMessageById(msg.id)
  if (!existing) {
    getDb()
      .prepare(
        `INSERT INTO messages (id, role, content, tool_name, tool_call_id, created_at, images)
         VALUES (?, ?, ?, NULL, NULL, ?, NULL)`
      )
      .run(msg.id, msg.role, content, createdAt)
    return true
  }
  if (createdAt >= existing.createdAt && content !== existing.content) {
    getDb()
      .prepare(`UPDATE messages SET content = ?, created_at = ?, role = ? WHERE id = ?`)
      .run(content, createdAt, msg.role, msg.id)
    return true
  }
  return false
}

/**
 * Merge phone chat into Mac DB and return the shared user/assistant transcript.
 * Returns { messages, inserted } so the companion server can notify the desktop UI.
 */
export function syncMessagesFromCompanion(incoming: CompanionChatMessage[]): {
  messages: CompanionChatMessage[]
  inserted: CompanionChatMessage[]
} {
  const inserted: CompanionChatMessage[] = []
  for (const raw of incoming || []) {
    if (!raw?.id || !raw.content?.trim()) continue
    if (raw.role !== 'user' && raw.role !== 'assistant') continue
    const msg: CompanionChatMessage = {
      id: raw.id,
      role: raw.role,
      content: raw.content.trim(),
      createdAt: raw.createdAt || Date.now()
    }
    const before = getMessageById(msg.id)
    const changed = upsertCompanionMessage(msg)
    if (changed && !before) inserted.push(msg)
  }
  return { messages: listCompanionChat(120), inserted }
}

export async function rememberFact(content: string, category = 'general'): Promise<MemoryFact> {
  const now = Date.now()
  const id = uuid()
  const embedding = await embed(content)

  getDb()
    .prepare(
      `INSERT INTO memories (id, content, category, embedding, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, content, category, embedding ? JSON.stringify(embedding) : null, now, now)

  return { id, content, category, createdAt: now, updatedAt: now }
}

export function listMemories(): MemoryFact[] {
  return getDb()
    .prepare(
      `SELECT id, content, category, source, confidence, last_used_at as lastUsedAt,
              expires_at as expiresAt, created_at as createdAt, updated_at as updatedAt
       FROM memories ORDER BY updated_at DESC`
    )
    .all() as MemoryFact[]
}

export function deleteMemory(id: string): boolean {
  const result = getDb().prepare('DELETE FROM memories WHERE id = ?').run(id)
  return result.changes > 0
}

/** Insert or replace a memory row (used by phone ↔ Mac sync). */
export function upsertMemoryFact(fact: MemoryFact): MemoryFact {
  const db = getDb()
  const existing = db
    .prepare(
      `SELECT id, content, category, created_at as createdAt, updated_at as updatedAt
       FROM memories WHERE id = ?`
    )
    .get(fact.id) as MemoryFact | undefined

  if (!existing) {
    db.prepare(
      `INSERT INTO memories (id, content, category, embedding, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?)`
    ).run(fact.id, fact.content, fact.category || 'general', fact.createdAt, fact.updatedAt)
    return {
      id: fact.id,
      content: fact.content,
      category: fact.category || 'general',
      createdAt: fact.createdAt,
      updatedAt: fact.updatedAt
    }
  }

  if (fact.updatedAt >= existing.updatedAt) {
    db.prepare(
      `UPDATE memories SET content = ?, category = ?, embedding = NULL, updated_at = ?, created_at = ?
       WHERE id = ?`
    ).run(
      fact.content,
      fact.category || existing.category,
      fact.updatedAt,
      Math.min(existing.createdAt, fact.createdAt),
      fact.id
    )
    return {
      id: fact.id,
      content: fact.content,
      category: fact.category || existing.category,
      createdAt: Math.min(existing.createdAt, fact.createdAt),
      updatedAt: fact.updatedAt
    }
  }

  return existing
}

/**
 * Merge phone memories into Mac DB (last-write-wins by updatedAt / id),
 * then return the full Mac memory set for the phone to adopt.
 * Optional deletedIds are removed first so phone deletes propagate.
 */
export function syncMemoriesFromCompanion(
  incoming: MemoryFact[],
  deletedIds?: string[]
): MemoryFact[] {
  for (const id of deletedIds || []) {
    if (id?.trim()) deleteMemory(id.trim())
  }

  const byContent = new Map<string, MemoryFact>()
  for (const local of listMemories()) {
    byContent.set(local.content.trim().toLowerCase(), local)
  }

  for (const fact of incoming) {
    if (!fact?.id || !fact.content?.trim()) continue
    const normalized: MemoryFact = {
      id: fact.id,
      content: fact.content.trim(),
      category: fact.category || 'general',
      createdAt: fact.createdAt || Date.now(),
      updatedAt: fact.updatedAt || fact.createdAt || Date.now()
    }

    const sameContent = byContent.get(normalized.content.toLowerCase())
    if (sameContent && sameContent.id !== normalized.id) {
      // Same text, different ids — keep the newer timestamp under the Mac id
      if (normalized.updatedAt > sameContent.updatedAt) {
        updateMemory(sameContent.id, normalized.content, normalized.category)
      }
      continue
    }

    const saved = upsertMemoryFact(normalized)
    byContent.set(saved.content.toLowerCase(), saved)
  }

  return listMemories()
}

export function updateMemory(id: string, content: string, category?: string): MemoryFact | null {
  const existing = getDb()
    .prepare(
      `SELECT id, content, category, created_at as createdAt, updated_at as updatedAt
       FROM memories WHERE id = ?`
    )
    .get(id) as MemoryFact | undefined
  if (!existing) return null

  const now = Date.now()
  getDb()
    .prepare(
      `UPDATE memories SET content = ?, category = ?, embedding = NULL, updated_at = ? WHERE id = ?`
    )
    .run(content, category ?? existing.category, now, id)

  // Re-embed async best-effort when OpenAI key is available
  void embed(content).then((vector) => {
    if (!vector) return
    getDb().prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(JSON.stringify(vector), id)
  })

  return { ...existing, content, category: category ?? existing.category, updatedAt: now }
}

function lexicalRecall(
  rows: Array<MemoryFact & { embedding: string | null }>,
  query: string,
  limit: number
): MemoryFact[] {
  const stop = new Set([
    'about', 'after', 'again', 'also', 'and', 'are', 'but', 'can', 'could', 'for',
    'from', 'have', 'just', 'like', 'not', 'please', 'that', 'the', 'then', 'this',
    'was', 'what', 'when', 'with', 'would', 'you', 'your'
  ])
  const tokens = [...new Set(
    query.toLowerCase().match(/[a-z0-9']{3,}/g)?.filter((token) => !stop.has(token)) || []
  )]
  if (!tokens.length) return []

  return rows
    .map((row) => {
      const haystack = row.content.toLowerCase()
      const hits = tokens.reduce((count, token) => count + (haystack.includes(token) ? 1 : 0), 0)
      const exactBonus = haystack.includes(query.toLowerCase().trim()) ? 2 : 0
      return { row, score: hits + exactBonus }
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.row.updatedAt - a.row.updatedAt)
    .slice(0, limit)
    .map(({ row: { embedding: _embedding, ...memory } }) => memory)
}

export async function recallMemories(
  query: string,
  limit = 6,
  options?: { semantic?: boolean }
): Promise<MemoryFact[]> {
  const rows = getDb()
    .prepare(
      `SELECT id, content, category, embedding, source, confidence, last_used_at as lastUsedAt,
              expires_at as expiresAt, created_at as createdAt, updated_at as updatedAt
       FROM memories WHERE expires_at IS NULL OR expires_at > ?`
    )
    .all(Date.now()) as Array<MemoryFact & { embedding: string | null }>

  if (rows.length === 0) return []

  if (options?.semantic === false) {
    const matches = lexicalRecall(rows, query, limit)
    if (matches.length) getDb().prepare(`UPDATE memories SET last_used_at=? WHERE id IN (${matches.map(() => '?').join(',')})`).run(Date.now(), ...matches.map((m) => m.id))
    return matches
  }

  const queryVec = await embed(query)

  if (!queryVec) {
    const matches = lexicalRecall(rows, query, limit)
    if (matches.length) getDb().prepare(`UPDATE memories SET last_used_at=? WHERE id IN (${matches.map(() => '?').join(',')})`).run(Date.now(), ...matches.map((m) => m.id))
    return matches
  }

  const scored = rows
    .map((row) => {
      const vec = row.embedding ? (JSON.parse(row.embedding) as number[]) : null
      const score = vec ? cosineSimilarity(queryVec!, vec) : 0
      const { embedding: _e, ...rest } = row
      return { ...rest, score }
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

  const matches = scored.filter((s) => (s.score ?? 0) > 0.25).slice(0, limit)
  if (matches.length) getDb().prepare(`UPDATE memories SET last_used_at=? WHERE id IN (${matches.map(() => '?').join(',')})`).run(Date.now(), ...matches.map((m) => m.id))
  return matches
}

export function logActivity(
  entry: Omit<ActivityEntry, 'id' | 'createdAt'> & { id?: string; createdAt?: number }
): ActivityEntry {
  const row: ActivityEntry = {
    id: entry.id ?? uuid(),
    toolName: entry.toolName,
    args: entry.args,
    result: entry.result,
    ok: entry.ok,
    createdAt: entry.createdAt ?? Date.now()
  }
  getDb()
    .prepare(
      `INSERT INTO activity (id, tool_name, args, result, ok, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(row.id, row.toolName, JSON.stringify(row.args), row.result, row.ok ? 1 : 0, row.createdAt)
  return row
}

export function listActivity(limit = 100): ActivityEntry[] {
  const rows = getDb()
    .prepare(
      `SELECT id, tool_name as toolName, args, result, ok, created_at as createdAt
       FROM activity ORDER BY created_at DESC LIMIT ?`
    )
    .all(limit) as Array<Omit<ActivityEntry, 'args' | 'ok'> & { args: string; ok: number }>

  return rows.map((r) => ({
    id: r.id,
    toolName: r.toolName,
    args: JSON.parse(r.args) as Record<string, unknown>,
    result: r.result,
    ok: !!r.ok,
    createdAt: r.createdAt
  }))
}

export function clearActivity(): void {
  getDb().prepare('DELETE FROM activity').run()
}
