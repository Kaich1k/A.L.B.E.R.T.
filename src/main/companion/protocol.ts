import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import type {
  ActivityEntry,
  ApprovalRequest,
  CaptureItem,
  MemoryFact,
  Mission,
  MissionStep,
  OperationsSnapshot,
  Routine
} from '../../shared/types'
import { getDb } from '../memory/db'
import {
  listActivity,
  listCompanionChat,
  listMemories,
  type CompanionChatMessage
} from '../memory/service'
import { getOperationsSnapshot } from '../operations/service'

export const COMPANION_PROTOCOL_VERSION = 2

export type SyncEntityType =
  | 'chat'
  | 'memory'
  | 'mission'
  | 'step'
  | 'routine'
  | 'approval'
  | 'capture'

export interface SyncTombstone {
  entityType: SyncEntityType
  entityId: string
  deletedAt: number
}

export interface CompanionDeviceSummary {
  id: string
  name: string
  scopes: string[]
  createdAt: number
  lastSeenAt: number
  revokedAt?: number
}

export interface CompanionDeviceAuth extends CompanionDeviceSummary {
  secretHash: string
}

export interface CompanionSyncPayload {
  protocolVersion: 2
  deviceId: string
  mutationIds?: string[]
  messages?: CompanionChatMessage[]
  memories?: MemoryFact[]
  operations?: Partial<OperationsSnapshot>
  tombstones?: SyncTombstone[]
}

export interface CompanionSyncResult {
  protocolVersion: 2
  serverTime: number
  acknowledgedMutationIds: string[]
  messages: CompanionChatMessage[]
  memories: MemoryFact[]
  operations: OperationsSnapshot
  activity: ActivityEntry[]
  tombstones: SyncTombstone[]
  insertedMessages: CompanionChatMessage[]
  chatChanged: boolean
  memoryChanged: boolean
  operationsChanged: boolean
}

export class CompanionProtocolError extends Error {
  readonly statusCode: number

  constructor(message: string, statusCode: number) {
    super(message)
    this.name = 'CompanionProtocolError'
    this.statusCode = statusCode
  }
}

const VALID_ENTITIES = new Set<SyncEntityType>([
  'chat',
  'memory',
  'mission',
  'step',
  'routine',
  'approval',
  'capture'
])
const ID = /^[a-zA-Z0-9._:-]{1,160}$/
const DEVICE_ID = /^[a-zA-Z0-9_-]{8,96}$/
const SECRET = /^[a-f0-9]{64}$/
const MAX_FUTURE_SKEW = 5 * 60_000
const MAX_SCHEDULE_TIME = Date.UTC(2200, 0, 1)

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function safeEqualHex(a: string, b: string): boolean {
  if (!/^[a-f0-9]+$/i.test(a) || !/^[a-f0-9]+$/i.test(b) || a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}

function safeText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function validTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function validVersionTimestamp(value: unknown): value is number {
  return validTimestamp(value) && value <= Date.now() + MAX_FUTURE_SKEW
}

/** Conflict/version timestamps may only lead the Mac clock by a small skew. */
function safeTime(value: unknown, fallback = Date.now()): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.max(1, Math.min(n, Date.now() + MAX_FUTURE_SKEW))
}

/** Deadlines and next-run dates are allowed to be meaningfully in the future. */
function safeScheduleTime(value: unknown): number | undefined {
  if (!validTimestamp(value)) return undefined
  return Math.min(Math.floor(value), MAX_SCHEDULE_TIME)
}

function versionOf(value: { updatedAt?: number; resolvedAt?: number; createdAt: number }): number {
  return safeTime(value.updatedAt ?? value.resolvedAt ?? value.createdAt)
}

function shouldReplace(
  existingVersion: number,
  incomingVersion: number,
  existingFingerprint: string,
  incomingFingerprint: string
): boolean {
  if (incomingVersion !== existingVersion) return incomingVersion > existingVersion
  // Stable tie-breaker avoids different outcomes when clocks collide.
  return incomingFingerprint.localeCompare(existingFingerprint) > 0
}

function rowFingerprint(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize)
    if (!item || typeof item !== 'object') return item
    return Object.fromEntries(
      Object.entries(item as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalize(entry)])
    )
  }
  return JSON.stringify(normalize(value))
}

function parseScopes(raw: string): string[] {
  return raw.split(',').map((scope) => scope.trim()).filter(Boolean)
}

export function listCompanionDevices(): CompanionDeviceSummary[] {
  const rows = getDb().prepare(
    `SELECT id,name,scopes,created_at as createdAt,last_seen_at as lastSeenAt,revoked_at as revokedAt
     FROM companion_devices ORDER BY revoked_at IS NULL DESC,last_seen_at DESC`
  ).all() as Array<Omit<CompanionDeviceSummary, 'scopes'> & { scopes: string }>
  return rows.map((row) => ({
    ...row,
    scopes: parseScopes(row.scopes),
    revokedAt: row.revokedAt || undefined
  }))
}

export function enrollCompanionDevice(input: { id: string; name: string }): {
  device: CompanionDeviceSummary
  credential: string
} {
  const id = safeText(input.id, 96)
  if (!DEVICE_ID.test(id)) throw new CompanionProtocolError('Invalid device identifier', 400)
  const name = safeText(input.name, 80) || 'A.L.B.E.R.T. Mobile'
  const secret = randomBytes(32).toString('hex')
  const now = Date.now()
  getDb().prepare(
    `INSERT INTO companion_devices(id,name,secret_hash,scopes,created_at,last_seen_at,revoked_at)
     VALUES (?,?,?,'sync,approvals',?,?,NULL)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name,secret_hash=excluded.secret_hash,
       scopes=excluded.scopes,last_seen_at=excluded.last_seen_at,revoked_at=NULL`
  ).run(id, name, sha256(secret), now, now)
  const device = listCompanionDevices().find((item) => item.id === id)!
  return { device, credential: `v2.${id}.${secret}` }
}

export function authenticateCompanionDevice(authorization: string | undefined): CompanionDeviceAuth | null {
  const match = authorization?.match(/^Bearer\s+v2\.([a-zA-Z0-9_-]{8,96})\.([a-f0-9]{64})$/i)
  if (!match || !DEVICE_ID.test(match[1]!) || !SECRET.test(match[2]!)) return null
  const row = getDb().prepare(
    `SELECT id,name,secret_hash as secretHash,scopes,created_at as createdAt,
            last_seen_at as lastSeenAt,revoked_at as revokedAt
     FROM companion_devices WHERE id=?`
  ).get(match[1]) as (Omit<CompanionDeviceAuth, 'scopes'> & { scopes: string }) | undefined
  if (!row || row.revokedAt || !safeEqualHex(row.secretHash, sha256(match[2]!))) return null
  const now = Date.now()
  getDb().prepare(`UPDATE companion_devices SET last_seen_at=? WHERE id=?`).run(now, row.id)
  return { ...row, scopes: parseScopes(row.scopes), lastSeenAt: now, revokedAt: undefined }
}

export function revokeCompanionDevice(id: string): boolean {
  if (!DEVICE_ID.test(id)) return false
  return getDb().prepare(`UPDATE companion_devices SET revoked_at=? WHERE id=? AND revoked_at IS NULL`)
    .run(Date.now(), id).changes > 0
}

function sanitizeTombstones(values: unknown): SyncTombstone[] {
  if (!Array.isArray(values)) return []
  const dedup = new Map<string, SyncTombstone>()
  for (const raw of values.slice(0, 10_000)) {
    if (!raw || typeof raw !== 'object') continue
    const value = raw as Partial<SyncTombstone>
    if (!VALID_ENTITIES.has(value.entityType as SyncEntityType)) continue
    const entityId = safeText(value.entityId, 160)
    if (!ID.test(entityId) || !validVersionTimestamp(value.deletedAt)) continue
    const row: SyncTombstone = {
      entityType: value.entityType as SyncEntityType,
      entityId,
      deletedAt: safeTime(value.deletedAt)
    }
    const key = `${row.entityType}:${row.entityId}`
    const before = dedup.get(key)
    if (!before || row.deletedAt > before.deletedAt) dedup.set(key, row)
  }
  return [...dedup.values()]
}

export function listSyncTombstones(limit = 10_000): SyncTombstone[] {
  return getDb().prepare(
    `SELECT entity_type as entityType,entity_id as entityId,deleted_at as deletedAt
     FROM sync_tombstones ORDER BY deleted_at DESC LIMIT ?`
  ).all(Math.max(1, Math.min(limit, 20_000))) as SyncTombstone[]
}

function payloadEntityIds(payload: CompanionSyncPayload): Map<SyncEntityType, Set<string>> {
  const ids = new Map<SyncEntityType, Set<string>>()
  const add = (entityType: SyncEntityType, value: unknown): void => {
    const id = safeText(value, 160)
    if (!ID.test(id)) return
    const bucket = ids.get(entityType) || new Set<string>()
    bucket.add(id)
    ids.set(entityType, bucket)
  }
  const addRows = (entityType: SyncEntityType, values: unknown): void => {
    if (!Array.isArray(values)) return
    for (const value of values) {
      if (value && typeof value === 'object') add(entityType, (value as { id?: unknown }).id)
    }
  }

  addRows('chat', payload.messages)
  addRows('memory', payload.memories)
  addRows('routine', payload.operations?.routines)
  addRows('approval', payload.operations?.approvals)
  addRows('capture', payload.operations?.captures)
  if (Array.isArray(payload.operations?.missions)) {
    for (const value of payload.operations.missions) {
      if (!value || typeof value !== 'object') continue
      add('mission', value.id)
      addRows('step', value.steps)
    }
  }
  if (Array.isArray(payload.tombstones)) {
    for (const value of payload.tombstones) {
      if (!value || typeof value !== 'object' || !VALID_ENTITIES.has(value.entityType)) continue
      add(value.entityType, value.entityId)
    }
  }
  return ids
}

/**
 * Always return the recent replication window, plus deletion records for IDs
 * the caller still carries. This lets a long-offline phone discard stale local
 * state even when the matching tombstone is older than the 10k normal window.
 */
function listResponseTombstones(payload: CompanionSyncPayload): SyncTombstone[] {
  const byKey = new Map(
    listSyncTombstones().map((row) => [`${row.entityType}:${row.entityId}`, row] as const)
  )
  const db = getDb()
  for (const [entityType, values] of payloadEntityIds(payload)) {
    const entityIds = [...values]
    for (let offset = 0; offset < entityIds.length; offset += 400) {
      const chunk = entityIds.slice(offset, offset + 400)
      const placeholders = chunk.map(() => '?').join(',')
      const rows = db.prepare(
        `SELECT entity_type as entityType,entity_id as entityId,deleted_at as deletedAt
         FROM sync_tombstones WHERE entity_type=? AND entity_id IN (${placeholders})`
      ).all(entityType, ...chunk) as SyncTombstone[]
      for (const row of rows) byKey.set(`${row.entityType}:${row.entityId}`, row)
    }
  }
  return [...byKey.values()].sort((left, right) => right.deletedAt - left.deletedAt)
}

function storeTombstone(row: SyncTombstone): boolean {
  return getDb().prepare(
    `INSERT INTO sync_tombstones(entity_type,entity_id,deleted_at) VALUES (?,?,?)
     ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=MAX(sync_tombstones.deleted_at,excluded.deleted_at)`
  ).run(row.entityType, row.entityId, row.deletedAt).changes > 0
}

function applyTombstone(row: SyncTombstone): {
  chatChanged: boolean
  memoryChanged: boolean
  operationsChanged: boolean
} {
  const db = getDb()
  let changed = 0
  if (row.entityType === 'chat') {
    changed = db.prepare(`DELETE FROM messages WHERE id=? AND role IN ('user','assistant')`).run(row.entityId).changes
  } else if (row.entityType === 'memory') {
    changed = db.prepare(`DELETE FROM memories WHERE id=?`).run(row.entityId).changes
  }
  else if (row.entityType === 'mission') {
    changed += db.prepare(`DELETE FROM mission_steps WHERE mission_id=?`).run(row.entityId).changes
    changed += db.prepare(`DELETE FROM approvals WHERE mission_id=?`).run(row.entityId).changes
    changed += db.prepare(`DELETE FROM missions WHERE id=?`).run(row.entityId).changes
  } else if (row.entityType === 'step') changed = db.prepare(`DELETE FROM mission_steps WHERE id=?`).run(row.entityId).changes
  else if (row.entityType === 'routine') changed = db.prepare(`DELETE FROM routines WHERE id=?`).run(row.entityId).changes
  else if (row.entityType === 'approval') changed = db.prepare(`DELETE FROM approvals WHERE id=?`).run(row.entityId).changes
  else if (row.entityType === 'capture') changed = db.prepare(`DELETE FROM captures WHERE id=?`).run(row.entityId).changes
  storeTombstone(row)
  return {
    chatChanged: row.entityType === 'chat' && changed > 0,
    memoryChanged: row.entityType === 'memory' && changed > 0,
    operationsChanged: row.entityType !== 'chat' && row.entityType !== 'memory' && changed > 0
  }
}

function tombstoneKeys(): Set<string> {
  const rows = getDb().prepare(
    `SELECT entity_type as entityType,entity_id as entityId FROM sync_tombstones`
  ).all() as Array<Pick<SyncTombstone, 'entityType' | 'entityId'>>
  return new Set(rows.map((row) => `${row.entityType}:${row.entityId}`))
}

function sanitizeMessages(values: unknown): CompanionChatMessage[] {
  if (!Array.isArray(values)) return []
  const out: CompanionChatMessage[] = []
  for (const raw of values.slice(-300)) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Partial<CompanionChatMessage>
    const id = safeText(row.id, 160)
    const content = safeText(row.content, 80_000)
    if (
      !ID.test(id) ||
      !content ||
      !validVersionTimestamp(row.createdAt) ||
      (row.role !== 'user' && row.role !== 'assistant')
    ) continue
    out.push({ id, role: row.role, content, createdAt: safeTime(row.createdAt) })
  }
  return out
}

function upsertMessages(values: unknown, deleted: Set<string>): {
  inserted: CompanionChatMessage[]
  changed: boolean
} {
  const inserted: CompanionChatMessage[] = []
  let changed = false
  const db = getDb()
  for (const row of sanitizeMessages(values)) {
    if (deleted.has(`chat:${row.id}`)) continue
    const existing = db.prepare(
      `SELECT id,role,content,created_at as createdAt FROM messages WHERE id=? AND role IN ('user','assistant')`
    ).get(row.id) as CompanionChatMessage | undefined
    if (!existing) {
      db.prepare(
        `INSERT INTO messages(id,role,content,tool_name,tool_call_id,created_at,images)
         VALUES (?,?,?,NULL,NULL,?,NULL)`
      ).run(row.id, row.role, row.content, row.createdAt)
      inserted.push(row)
      changed = true
      continue
    }
    if (shouldReplace(existing.createdAt, row.createdAt, rowFingerprint(existing), rowFingerprint(row))) {
      db.prepare(`UPDATE messages SET role=?,content=?,created_at=? WHERE id=?`)
        .run(row.role, row.content, row.createdAt, row.id)
      changed = true
    }
  }
  return { inserted, changed }
}

function sanitizeMemories(values: unknown): MemoryFact[] {
  if (!Array.isArray(values)) return []
  const out: MemoryFact[] = []
  for (const raw of values.slice(0, 5_000)) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Partial<MemoryFact>
    const id = safeText(row.id, 160)
    const content = safeText(row.content, 20_000)
    if (
      !ID.test(id) ||
      !content ||
      !validVersionTimestamp(row.createdAt) ||
      !validVersionTimestamp(row.updatedAt)
    ) continue
    const createdAt = safeTime(row.createdAt)
    out.push({
      id,
      content,
      category: safeText(row.category, 80) || 'general',
      source: safeText(row.source, 80) || 'companion',
      confidence: typeof row.confidence === 'number' && Number.isFinite(row.confidence)
        ? Math.max(0, Math.min(1, row.confidence))
        : 1,
      lastUsedAt: validVersionTimestamp(row.lastUsedAt) ? safeTime(row.lastUsedAt) : undefined,
      expiresAt: safeScheduleTime(row.expiresAt),
      createdAt,
      updatedAt: safeTime(row.updatedAt, createdAt)
    })
  }
  return out
}

function upsertMemories(values: unknown, deleted: Set<string>): boolean {
  const db = getDb()
  let changed = false
  for (const row of sanitizeMemories(values)) {
    if (deleted.has(`memory:${row.id}`)) continue
    const existing = db.prepare(
      `SELECT id,content,category,source,confidence,last_used_at as lastUsedAt,
              expires_at as expiresAt,created_at as createdAt,updated_at as updatedAt
       FROM memories WHERE id=?`
    ).get(row.id) as MemoryFact | undefined
    const normalizedExisting = existing ? {
      ...existing,
      lastUsedAt: existing.lastUsedAt || undefined,
      expiresAt: existing.expiresAt || undefined
    } : undefined
    if (!normalizedExisting) {
      db.prepare(
        `INSERT INTO memories(id,content,category,embedding,source,confidence,last_used_at,expires_at,created_at,updated_at)
         VALUES (?,?,?,NULL,?,?,?,?,?,?)`
      ).run(row.id, row.content, row.category, row.source || 'companion', row.confidence ?? 1,
        row.lastUsedAt ?? null, row.expiresAt ?? null, row.createdAt, row.updatedAt)
      changed = true
      continue
    }
    if (shouldReplace(normalizedExisting.updatedAt, row.updatedAt, rowFingerprint(normalizedExisting), rowFingerprint(row))) {
      db.prepare(
        `UPDATE memories SET content=?,category=?,embedding=NULL,source=?,confidence=?,last_used_at=?,expires_at=?,
           created_at=?,updated_at=? WHERE id=?`
      ).run(row.content, row.category, row.source || normalizedExisting.source || 'companion',
        row.confidence ?? normalizedExisting.confidence ?? 1, row.lastUsedAt ?? null, row.expiresAt ?? null,
        Math.min(normalizedExisting.createdAt, row.createdAt), row.updatedAt, row.id)
      changed = true
    }
  }
  return changed
}

const MISSION_STATES = new Set(['draft', 'queued', 'active', 'waiting', 'approval', 'blocked', 'complete', 'cancelled'])
const STEP_STATES = new Set(['pending', 'active', 'approval', 'complete', 'failed', 'skipped'])
const PRIORITIES = new Set(['low', 'normal', 'high', 'critical'])
const RISKS = new Set(['observe', 'prepare', 'approve', 'restricted'])
const SOURCES = new Set(['user', 'chat', 'routine', 'system'])

function upsertStep(raw: Partial<MissionStep>, missionId: string, deleted: Set<string>): boolean {
  const id = safeText(raw.id, 160)
  const title = safeText(raw.title, 2_000)
  if (
    !ID.test(id) ||
    !title ||
    !validVersionTimestamp(raw.createdAt) ||
    !validVersionTimestamp(raw.updatedAt) ||
    deleted.has(`step:${id}`)
  ) return false
  const now = safeTime(raw.updatedAt)
  const createdAt = safeTime(raw.createdAt, now)
  const row: MissionStep = {
    id,
    missionId,
    position: Math.max(0, Math.min(999, Math.floor(raw.position || 0))),
    title,
    state: STEP_STATES.has(raw.state || '') ? raw.state! : 'pending',
    toolName: safeText(raw.toolName, 160) || undefined,
    result: safeText(raw.result, 20_000) || undefined,
    verification: safeText(raw.verification, 20_000) || undefined,
    createdAt,
    updatedAt: now
  }
  const db = getDb()
  const existingRaw = db.prepare(
    `SELECT id,mission_id as missionId,position,title,state,tool_name as toolName,result,verification,
            created_at as createdAt,updated_at as updatedAt FROM mission_steps WHERE id=?`
  ).get(id) as MissionStep | undefined
  const existing = existingRaw ? {
    ...existingRaw,
    toolName: existingRaw.toolName || undefined,
    result: existingRaw.result || undefined,
    verification: existingRaw.verification || undefined
  } : undefined
  if (existing && !shouldReplace(existing.updatedAt, row.updatedAt, rowFingerprint(existing), rowFingerprint(row))) return false
  db.prepare(
    `INSERT INTO mission_steps(id,mission_id,position,title,state,tool_name,tool_args,result,verification,created_at,updated_at)
     VALUES (?,?,?,?,?,?,NULL,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
       mission_id=excluded.mission_id,position=excluded.position,title=excluded.title,state=excluded.state,
       tool_name=excluded.tool_name,result=excluded.result,verification=excluded.verification,
       created_at=MIN(mission_steps.created_at,excluded.created_at),updated_at=excluded.updated_at`
  ).run(row.id, row.missionId, row.position, row.title, row.state, row.toolName ?? null,
    row.result ?? null, row.verification ?? null, row.createdAt, row.updatedAt)
  return true
}

function upsertMissions(values: unknown, deleted: Set<string>): boolean {
  if (!Array.isArray(values)) return false
  const db = getDb()
  let changed = false
  for (const rawValue of values.slice(0, 1_000)) {
    if (!rawValue || typeof rawValue !== 'object') continue
    const raw = rawValue as Partial<Mission>
    const id = safeText(raw.id, 160)
    const title = safeText(raw.title, 2_000)
    if (
      !ID.test(id) ||
      !title ||
      !validVersionTimestamp(raw.createdAt) ||
      !validVersionTimestamp(raw.updatedAt) ||
      deleted.has(`mission:${id}`)
    ) continue
    const updatedAt = safeTime(raw.updatedAt)
    const createdAt = safeTime(raw.createdAt, updatedAt)
    const row: Mission = {
      id,
      title,
      outcome: safeText(raw.outcome, 8_000) || title,
      state: MISSION_STATES.has(raw.state || '') ? raw.state! : 'draft',
      priority: PRIORITIES.has(raw.priority || '') ? raw.priority! : 'normal',
      progress: Math.max(0, Math.min(100, Math.round(raw.progress || 0))),
      deadline: safeScheduleTime(raw.deadline),
      budgetCents: typeof raw.budgetCents === 'number' && Number.isFinite(raw.budgetCents)
        ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(raw.budgetCents)))
        : undefined,
      risk: RISKS.has(raw.risk || '') ? raw.risk! : 'prepare',
      source: SOURCES.has(raw.source || '') ? raw.source! : 'user',
      createdAt,
      updatedAt,
      steps: []
    }
    const existingRaw = db.prepare(
      `SELECT id,title,outcome,state,priority,progress,deadline,budget_cents as budgetCents,risk,source,
              created_at as createdAt,updated_at as updatedAt FROM missions WHERE id=?`
    ).get(id) as Mission | undefined
    const existing = existingRaw ? {
      ...existingRaw,
      deadline: existingRaw.deadline ?? undefined,
      budgetCents: existingRaw.budgetCents ?? undefined,
      steps: []
    } : undefined
    if (!existing || shouldReplace(existing.updatedAt, row.updatedAt, rowFingerprint(existing), rowFingerprint(row))) {
      db.prepare(
        `INSERT INTO missions(id,title,outcome,state,priority,progress,deadline,budget_cents,risk,source,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
           title=excluded.title,outcome=excluded.outcome,state=excluded.state,priority=excluded.priority,
           progress=excluded.progress,deadline=excluded.deadline,budget_cents=excluded.budget_cents,
           risk=excluded.risk,source=excluded.source,created_at=MIN(missions.created_at,excluded.created_at),
           updated_at=excluded.updated_at`
      ).run(row.id, row.title, row.outcome, row.state, row.priority, row.progress, row.deadline ?? null,
        row.budgetCents ?? null, row.risk, row.source, row.createdAt, row.updatedAt)
      changed = true
    }
    if (Array.isArray(raw.steps)) {
      for (const step of raw.steps.slice(0, 100)) changed = upsertStep(step, id, deleted) || changed
    }
  }
  return changed
}

function upsertRoutines(values: unknown, deleted: Set<string>): boolean {
  if (!Array.isArray(values)) return false
  const db = getDb()
  let changed = false
  for (const rawValue of values.slice(0, 1_000)) {
    if (!rawValue || typeof rawValue !== 'object') continue
    const raw = rawValue as Partial<Routine>
    const id = safeText(raw.id, 160)
    const name = safeText(raw.name, 2_000)
    const prompt = safeText(raw.prompt, 20_000)
    const schedule = safeText(raw.schedule, 160)
    if (
      !ID.test(id) ||
      !name ||
      !prompt ||
      !schedule ||
      !validVersionTimestamp(raw.createdAt) ||
      !validVersionTimestamp(raw.updatedAt) ||
      deleted.has(`routine:${id}`)
    ) continue
    const updatedAt = safeTime(raw.updatedAt)
    const createdAt = safeTime(raw.createdAt, updatedAt)
    const row: Routine = {
      id, name, prompt, schedule, enabled: raw.enabled !== false,
      quietStart: safeText(raw.quietStart, 16) || undefined,
      quietEnd: safeText(raw.quietEnd, 16) || undefined,
      lastRunAt: validVersionTimestamp(raw.lastRunAt) ? safeTime(raw.lastRunAt) : undefined,
      nextRunAt: safeScheduleTime(raw.nextRunAt),
      createdAt, updatedAt
    }
    const existingRaw = db.prepare(
      `SELECT id,name,prompt,schedule,enabled,quiet_start as quietStart,quiet_end as quietEnd,
              last_run_at as lastRunAt,next_run_at as nextRunAt,created_at as createdAt,updated_at as updatedAt
       FROM routines WHERE id=?`
    ).get(id) as (Omit<Routine, 'enabled'> & { enabled: number }) | undefined
    const existing: Routine | undefined = existingRaw ? {
      ...existingRaw,
      enabled: Boolean(existingRaw.enabled),
      quietStart: existingRaw.quietStart || undefined,
      quietEnd: existingRaw.quietEnd || undefined,
      lastRunAt: existingRaw.lastRunAt || undefined,
      nextRunAt: existingRaw.nextRunAt || undefined
    } : undefined
    if (existing && !shouldReplace(existing.updatedAt, row.updatedAt, rowFingerprint(existing), rowFingerprint(row))) continue
    db.prepare(
      `INSERT INTO routines(id,name,prompt,schedule,enabled,quiet_start,quiet_end,last_run_at,next_run_at,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
         name=excluded.name,prompt=excluded.prompt,schedule=excluded.schedule,enabled=excluded.enabled,
         quiet_start=excluded.quiet_start,quiet_end=excluded.quiet_end,last_run_at=excluded.last_run_at,
         next_run_at=excluded.next_run_at,created_at=MIN(routines.created_at,excluded.created_at),updated_at=excluded.updated_at`
    ).run(row.id, row.name, row.prompt, row.schedule, row.enabled ? 1 : 0, row.quietStart ?? null,
      row.quietEnd ?? null, row.lastRunAt ?? null, row.nextRunAt ?? null, row.createdAt, row.updatedAt)
    changed = true
  }
  return changed
}

function upsertApprovals(values: unknown, deleted: Set<string>): boolean {
  if (!Array.isArray(values)) return false
  const db = getDb()
  let changed = false
  const validStates = new Set(['pending', 'approved', 'declined', 'expired'])
  for (const rawValue of values.slice(0, 2_000)) {
    if (!rawValue || typeof rawValue !== 'object') continue
    const raw = rawValue as Partial<ApprovalRequest>
    const id = safeText(raw.id, 160)
    const title = safeText(raw.title, 2_000)
    if (
      !ID.test(id) ||
      !title ||
      !validVersionTimestamp(raw.createdAt) ||
      (raw.updatedAt !== undefined && !validVersionTimestamp(raw.updatedAt)) ||
      (raw.resolvedAt !== undefined && !validVersionTimestamp(raw.resolvedAt)) ||
      deleted.has(`approval:${id}`)
    ) continue
    const createdAt = safeTime(raw.createdAt)
    const updatedAt = versionOf({ ...raw, createdAt })
    const row: ApprovalRequest = {
      id,
      missionId: ID.test(safeText(raw.missionId, 160)) ? safeText(raw.missionId, 160) : undefined,
      title,
      description: safeText(raw.description, 20_000),
      actionLabel: safeText(raw.actionLabel, 500) || 'Approve',
      risk: safeText(raw.risk, 500) || 'Review required',
      preview: safeText(raw.preview, 40_000) || undefined,
      state: validStates.has(raw.state || '') ? raw.state! : 'pending',
      createdAt,
      updatedAt,
      resolvedAt: raw.state && raw.state !== 'pending' ? safeTime(raw.resolvedAt, updatedAt) : undefined
    }
    const existingRaw = db.prepare(
      `SELECT id,mission_id as missionId,title,description,action_label as actionLabel,risk,preview,state,
              created_at as createdAt,COALESCE(updated_at,resolved_at,created_at) as updatedAt,resolved_at as resolvedAt
       FROM approvals WHERE id=?`
    ).get(id) as ApprovalRequest | undefined
    const existing: ApprovalRequest | undefined = existingRaw ? {
      ...existingRaw,
      missionId: existingRaw.missionId || undefined,
      preview: existingRaw.preview || undefined,
      resolvedAt: existingRaw.resolvedAt || undefined
    } : undefined
    if (existing && !shouldReplace(versionOf(existing), updatedAt, rowFingerprint(existing), rowFingerprint(row))) continue
    db.prepare(
      `INSERT INTO approvals(id,mission_id,title,description,action_label,risk,preview,state,created_at,updated_at,resolved_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
         mission_id=excluded.mission_id,title=excluded.title,description=excluded.description,
         action_label=excluded.action_label,risk=excluded.risk,preview=excluded.preview,state=excluded.state,
         created_at=MIN(approvals.created_at,excluded.created_at),updated_at=excluded.updated_at,resolved_at=excluded.resolved_at`
    ).run(row.id, row.missionId ?? null, row.title, row.description, row.actionLabel, row.risk,
      row.preview ?? null, row.state, row.createdAt, updatedAt, row.resolvedAt ?? null)
    changed = true
  }
  return changed
}

function upsertCaptures(values: unknown, deleted: Set<string>): boolean {
  if (!Array.isArray(values)) return false
  const db = getDb()
  let changed = false
  const kinds = new Set(['note', 'task', 'idea', 'url', 'receipt', 'reference'])
  const states = new Set(['inbox', 'filed', 'archived'])
  for (const rawValue of values.slice(0, 5_000)) {
    if (!rawValue || typeof rawValue !== 'object') continue
    const raw = rawValue as Partial<CaptureItem>
    const id = safeText(raw.id, 160)
    const content = safeText(raw.content, 20_000)
    if (
      !ID.test(id) ||
      !content ||
      !validVersionTimestamp(raw.createdAt) ||
      (raw.updatedAt !== undefined && !validVersionTimestamp(raw.updatedAt)) ||
      deleted.has(`capture:${id}`)
    ) continue
    const createdAt = safeTime(raw.createdAt)
    const updatedAt = versionOf({ ...raw, createdAt })
    const row: CaptureItem = {
      id, content,
      kind: kinds.has(raw.kind || '') ? raw.kind! : 'note',
      state: states.has(raw.state || '') ? raw.state! : 'inbox',
      createdAt, updatedAt
    }
    const existing = db.prepare(
      `SELECT id,content,kind,state,created_at as createdAt,COALESCE(updated_at,created_at) as updatedAt
       FROM captures WHERE id=?`
    ).get(id) as CaptureItem | undefined
    if (existing && !shouldReplace(versionOf(existing), updatedAt, rowFingerprint(existing), rowFingerprint(row))) continue
    db.prepare(
      `INSERT INTO captures(id,content,kind,state,created_at,updated_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET content=excluded.content,kind=excluded.kind,state=excluded.state,
         created_at=MIN(captures.created_at,excluded.created_at),updated_at=excluded.updated_at`
    ).run(row.id, row.content, row.kind, row.state, row.createdAt, updatedAt)
    changed = true
  }
  return changed
}

function cleanMutationIds(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return [...new Set(values.slice(0, 5_000).map((value) => safeText(value, 160)).filter((value) => ID.test(value)))]
}

export function reconcileCompanionState(payload: CompanionSyncPayload, deviceId: string): CompanionSyncResult {
  if (!payload || typeof payload !== 'object') {
    throw new CompanionProtocolError('Sync payload must be a JSON object', 400)
  }
  if (payload.protocolVersion !== COMPANION_PROTOCOL_VERSION) {
    throw new CompanionProtocolError('Unsupported sync protocol', 409)
  }
  if (payload.deviceId !== deviceId) {
    throw new CompanionProtocolError('Device identity mismatch', 403)
  }
  const db = getDb()
  const mutationIds = cleanMutationIds(payload.mutationIds)
  let insertedMessages: CompanionChatMessage[] = []
  let chatChanged = false
  let memoryChanged = false
  let operationsChanged = false

  db.transaction(() => {
    const incomingTombstones = sanitizeTombstones(payload.tombstones)
    for (const row of incomingTombstones) {
      const result = applyTombstone(row)
      chatChanged = result.chatChanged || chatChanged
      memoryChanged = result.memoryChanged || memoryChanged
      operationsChanged = result.operationsChanged || operationsChanged
    }
    const deleted = tombstoneKeys()
    const messageResult = upsertMessages(payload.messages, deleted)
    insertedMessages = messageResult.inserted
    chatChanged = messageResult.changed || chatChanged
    memoryChanged = upsertMemories(payload.memories, deleted) || memoryChanged
    operationsChanged = upsertMissions(payload.operations?.missions, deleted) || operationsChanged
    operationsChanged = upsertRoutines(payload.operations?.routines, deleted) || operationsChanged
    operationsChanged = upsertApprovals(payload.operations?.approvals, deleted) || operationsChanged
    operationsChanged = upsertCaptures(payload.operations?.captures, deleted) || operationsChanged
    const now = Date.now()
    const insertMutation = db.prepare(
      `INSERT OR IGNORE INTO companion_mutations(id,device_id,created_at,applied_at) VALUES (?,?,?,?)`
    )
    for (const id of mutationIds) insertMutation.run(id, deviceId, now, now)
    // The idempotency ledger is bounded while tombstones remain durable.
    db.prepare(`DELETE FROM companion_mutations WHERE applied_at < ?`).run(now - 180 * 24 * 60 * 60_000)
  })()

  return {
    protocolVersion: COMPANION_PROTOCOL_VERSION,
    serverTime: Date.now(),
    acknowledgedMutationIds: mutationIds,
    messages: listCompanionChat(300),
    memories: listMemories().slice(0, 5_000),
    operations: getOperationsSnapshot(),
    activity: listActivity(80),
    tombstones: listResponseTombstones(payload),
    insertedMessages,
    chatChanged,
    memoryChanged,
    operationsChanged
  }
}
