import type {
  ActivityEntry,
  ChatMessage,
  LocalData,
  MemoryFact,
  OperationsSnapshot,
  PendingMutation,
  SyncEntityType,
  SyncState,
  SyncTombstone
} from '../types'
import { EMPTY_OPERATIONS } from '../types'
import { newId } from './id'

export const SYNC_PROTOCOL_VERSION = 2

export interface SyncResponseLike {
  protocolVersion?: number
  serverTime?: number
  acknowledgedMutationIds?: string[]
  messages?: ChatMessage[]
  memories?: MemoryFact[]
  operations?: OperationsSnapshot
  activity?: ActivityEntry[]
  tombstones?: SyncTombstone[]
}

function mergeAllTombstones(current: SyncTombstone[], incoming: SyncTombstone[]): SyncTombstone[] {
  const byKey = new Map<string, SyncTombstone>()
  for (const row of [...current, ...incoming]) {
    if (!row?.entityType || !row.entityId) continue
    const key = `${row.entityType}:${row.entityId}`
    const before = byKey.get(key)
    if (!before || row.deletedAt > before.deletedAt) byKey.set(key, row)
  }
  return [...byKey.values()].sort((a, b) => a.deletedAt - b.deletedAt)
}

export function mergeTombstones(current: SyncTombstone[], incoming: SyncTombstone[]): SyncTombstone[] {
  return mergeAllTombstones(current, incoming).slice(-10_000)
}

/**
 * Retain the normal replication window plus every delete created since the
 * last successful sync. Pending offline deletes must never be discarded just
 * because a phone crosses the steady-state 10k history window.
 */
export function retainLocalTombstones(
  current: SyncTombstone[],
  incoming: SyncTombstone[],
  lastSyncAt?: number,
  pendingMutations: PendingMutation[] = []
): SyncTombstone[] {
  const all = mergeAllTombstones(current, incoming)
  const byKey = new Map<string, SyncTombstone>()
  const pendingDeletes = new Set(
    pendingMutations
      .filter((mutation) => mutation.action === 'delete')
      .map((mutation) => `${mutation.entityType}:${mutation.entityId}`)
  )
  for (const row of all.slice(-10_000)) byKey.set(`${row.entityType}:${row.entityId}`, row)
  for (const row of all) {
    const key = `${row.entityType}:${row.entityId}`
    if (row.deletedAt >= (lastSyncAt || 0) || pendingDeletes.has(key)) byKey.set(key, row)
  }
  return [...byKey.values()].sort((left, right) => left.deletedAt - right.deletedAt)
}

export function recordLocalMutation(
  sync: SyncState,
  entityType: SyncEntityType,
  entityId: string,
  action: PendingMutation['action'],
  at = Date.now()
): SyncState {
  const mutation: PendingMutation = {
    id: `mut_${newId()}`,
    entityType,
    entityId,
    action,
    createdAt: at
  }
  const outbox = [...sync.outbox, mutation]
  const tombstones = action === 'delete'
    ? retainLocalTombstones(
        sync.tombstones,
        [{ entityType, entityId, deletedAt: at }],
        sync.lastSyncAt,
        outbox
      )
    : sync.tombstones
  return { ...sync, tombstones, outbox }
}

function entityVersion(row: { createdAt?: number; updatedAt?: number; resolvedAt?: number }): number {
  return row.updatedAt ?? row.resolvedAt ?? row.createdAt ?? 0
}

function mergeById<T extends { id: string; createdAt?: number; updatedAt?: number; resolvedAt?: number }>(
  local: T[],
  remote: T[]
): T[] {
  const byId = new Map<string, T>()
  for (const row of [...remote, ...local]) {
    if (!row?.id) continue
    const existing = byId.get(row.id)
    if (!existing) {
      byId.set(row.id, row)
      continue
    }
    const nextVersion = entityVersion(row)
    const beforeVersion = entityVersion(existing)
    if (
      nextVersion > beforeVersion ||
      (nextVersion === beforeVersion && JSON.stringify(row).localeCompare(JSON.stringify(existing)) > 0)
    ) {
      byId.set(row.id, row)
    }
  }
  return [...byId.values()]
}

function deletedSet(tombstones: SyncTombstone[]): Set<string> {
  return new Set(tombstones.map((row) => `${row.entityType}:${row.entityId}`))
}

function filterDeleted<T extends { id: string }>(
  rows: T[],
  entityType: SyncTombstone['entityType'],
  deleted: Set<string>
): T[] {
  return rows.filter((row) => !deleted.has(`${entityType}:${row.id}`))
}

function mergeMissions(
  local: OperationsSnapshot['missions'],
  remote: OperationsSnapshot['missions'],
  deleted: Set<string>
): OperationsSnapshot['missions'] {
  return filterDeleted(mergeById(local, remote), 'mission', deleted).map((mission) => ({
    ...mission,
    steps: filterDeleted(
      mergeById(
        local.find((item) => item.id === mission.id)?.steps || [],
        remote.find((item) => item.id === mission.id)?.steps || mission.steps || []
      ),
      'step',
      deleted
    ).sort((a, b) => a.position - b.position)
  }))
}

export function mergeSyncedData(
  latest: LocalData,
  response: SyncResponseLike,
  sentOutbox: PendingMutation[]
): LocalData {
  if (response.protocolVersion !== SYNC_PROTOCOL_VERSION) {
    throw new Error(
      `Mac uses sync protocol ${response.protocolVersion ?? 'unknown'}; version ${SYNC_PROTOCOL_VERSION} is required`
    )
  }
  // Apply every tombstone in this response before pruning retained history. This
  // matters when the Mac returns an old, payload-relevant delete beyond its
  // normal recent-tombstone window.
  const applicableTombstones = mergeAllTombstones(latest.sync.tombstones, response.tombstones || [])
  const deleted = deletedSet(applicableTombstones)
  const remoteMessageIds = new Set((response.messages || []).map((row) => row.id))
  const messages = filterDeleted(
    mergeById(latest.messages, response.messages || []).map((message) => ({
      ...message,
      delivery: remoteMessageIds.has(message.id) && message.delivery !== 'failed'
        ? 'synced' as const
        : message.delivery
    })),
    'chat',
    deleted
  ).sort((a, b) => a.createdAt - b.createdAt).slice(-300)
  const memories = filterDeleted(mergeById(latest.memories, response.memories || []), 'memory', deleted)
    .sort((a, b) => b.updatedAt - a.updatedAt)
  const remoteOps = response.operations || EMPTY_OPERATIONS
  const operations: OperationsSnapshot = {
    missions: mergeMissions(latest.operations.missions, remoteOps.missions || [], deleted)
      .sort((a, b) => b.updatedAt - a.updatedAt),
    routines: filterDeleted(mergeById(latest.operations.routines, remoteOps.routines || []), 'routine', deleted)
      .sort((a, b) => Number(b.enabled) - Number(a.enabled) || b.updatedAt - a.updatedAt),
    approvals: filterDeleted(mergeById(latest.operations.approvals, remoteOps.approvals || []), 'approval', deleted)
      .sort((a, b) => Number(b.state === 'pending') - Number(a.state === 'pending') || b.createdAt - a.createdAt),
    captures: filterDeleted(mergeById(latest.operations.captures, remoteOps.captures || []), 'capture', deleted)
      .sort((a, b) => b.createdAt - a.createdAt),
    generatedAt: Math.max(latest.operations.generatedAt, remoteOps.generatedAt || 0, response.serverTime || 0)
  }
  const ack = new Set(response.acknowledgedMutationIds || [])
  const sentIds = new Set(sentOutbox.map((row) => row.id))
  const outbox = latest.sync.outbox.filter((row) => !(sentIds.has(row.id) && ack.has(row.id)))
  const now = Date.now()
  const tombstones = retainLocalTombstones(applicableTombstones, [], now, outbox)
  return {
    messages,
    memories,
    operations,
    activity: Array.isArray(response.activity) ? response.activity.slice(0, 100) : latest.activity,
    sync: {
      ...latest.sync,
      tombstones,
      outbox,
      lastAttemptAt: now,
      lastSyncAt: now,
      consecutiveFailures: 0,
      lastError: undefined,
      protocolVersion: SYNC_PROTOCOL_VERSION
    }
  }
}

export function syncBackoffMs(failures: number): number {
  if (failures <= 0) return 20_000
  return Math.min(5 * 60_000, 2_500 * 2 ** Math.min(7, failures - 1))
}

export class SyncCoordinator {
  private active: Promise<LocalData> | null = null

  run(task: () => Promise<LocalData>): Promise<LocalData> {
    if (this.active) return this.active
    this.active = task().finally(() => {
      this.active = null
    })
    return this.active
  }

  get inFlight(): boolean {
    return this.active !== null
  }
}
