import type {
  ChatMessage,
  ChatImagePayload,
  CompanionConfig,
  LocalData,
  MemoryFact,
  OperationsSnapshot,
  SyncTombstone
} from '../types'
import { normalizeMacUrl } from './pairInfo'
import {
  mergeSyncedData,
  SyncCoordinator,
  syncBackoffMs,
  SYNC_PROTOCOL_VERSION,
  type SyncResponseLike
} from './syncLogic'

export { mergeSyncedData, SyncCoordinator, syncBackoffMs, SYNC_PROTOCOL_VERSION } from './syncLogic'

const TIMEOUT_MS = 12_000
/** Per-request JSON budget. Must stay below Mac `MAX_BODY_BYTES` (8 MiB). */
export const SYNC_REQUEST_MAX_BYTES = 7_500_000
const SYNC_UPLOAD_TIMEOUT_MS = 45_000

/** Mirrors the desktop v2 sanitization ceilings; byte size alone is not enough. */
export const SYNC_SERVER_ARRAY_LIMITS = {
  mutationIds: 5_000,
  messages: 300,
  memories: 5_000,
  tombstones: 10_000,
  missions: 1_000,
  routines: 1_000,
  approvals: 2_000,
  captures: 5_000
} as const

export type SyncPayloadBatch = {
  protocolVersion: typeof SYNC_PROTOCOL_VERSION
  deviceId: string
  mutationIds?: string[]
  messages?: ChatMessage[]
  memories?: MemoryFact[]
  operations?: Partial<OperationsSnapshot>
  tombstones?: SyncTombstone[]
}

type TopLevelArrays = Pick<
  SyncPayloadBatch,
  'mutationIds' | 'messages' | 'memories' | 'tombstones'
>
type OperationArrays = Pick<
  OperationsSnapshot,
  'missions' | 'routines' | 'approvals' | 'captures'
>
type ArrayItem<T> = T extends Array<infer Item> ? Item : never

function utf8ByteLength(value: string): number {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x7f) bytes += 1
    else if (code <= 0x7ff) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else bytes += 3
    } else bytes += 3
  }
  return bytes
}

export function syncPayloadBytes(payload: SyncPayloadBatch): number {
  return utf8ByteLength(JSON.stringify(payload))
}

/** Desktop sanitizeMessages caps content at 80k and drops image blobs. */
const SYNC_MESSAGE_CONTENT_MAX_CHARS = 80_000
const SYNC_MEMORY_CONTENT_MAX_CHARS = 20_000
const SYNC_TEXT_FIELD_MAX_CHARS = 8_000

function truncateForSync(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const marker = '\n…[truncated for sync]'
  return `${text.slice(0, Math.max(0, maxChars - marker.length))}${marker}`
}

/**
 * Prepare a chat message for the Mac uplink. The companion never persists phone
 * image bytes, so shipping multi‑MB dataUrls only blows the body ceiling
 * and wedges the whole queue.
 */
export function slimMessageForSync(message: ChatMessage): ChatMessage {
  const images = message.images?.length
    ? message.images.map(({ dataUrl: _drop, ...rest }) => rest)
    : undefined
  return {
    ...message,
    content: truncateForSync(String(message.content || ''), SYNC_MESSAGE_CONTENT_MAX_CHARS),
    error: message.error ? truncateForSync(message.error, 2_000) : message.error,
    images: images?.length ? images : undefined
  }
}

function slimMemoryForSync(memory: MemoryFact): MemoryFact {
  return {
    ...memory,
    content: truncateForSync(String(memory.content || ''), SYNC_MEMORY_CONTENT_MAX_CHARS)
  }
}

function slimMissionFragmentForSync(
  mission: OperationsSnapshot['missions'][number]
): OperationsSnapshot['missions'][number] {
  return {
    ...mission,
    title: truncateForSync(String(mission.title || ''), SYNC_TEXT_FIELD_MAX_CHARS),
    outcome: truncateForSync(String(mission.outcome || ''), SYNC_TEXT_FIELD_MAX_CHARS),
    steps: (mission.steps || []).map((step) => ({
      ...step,
      title: truncateForSync(String(step.title || ''), SYNC_TEXT_FIELD_MAX_CHARS)
    }))
  }
}

function hasBatchContent(payload: SyncPayloadBatch): boolean {
  return Boolean(
    payload.mutationIds?.length ||
    payload.messages?.length ||
    payload.memories?.length ||
    payload.tombstones?.length ||
    payload.operations?.missions?.length ||
    payload.operations?.routines?.length ||
    payload.operations?.approvals?.length ||
    payload.operations?.captures?.length
  )
}

export type SyncBatchBuildResult = {
  batches: SyncPayloadBatch[]
  /** Entities that still could not fit alone after slimming — skipped so the queue can move. */
  skipped: string[]
}

/**
 * Build deletion-first, bounded sync requests. A mission is repeated in small
 * fragments when necessary so even unusually detailed step histories stay
 * below the desktop's request limit without dropping a step.
 *
 * Oversized chat photos are stubbed (no dataUrl). Anything still too large after
 * truncation is skipped instead of failing the entire uplink.
 */
export function buildSyncPayloadBatches(
  data: LocalData,
  deviceId: string,
  maxBytes = SYNC_REQUEST_MAX_BYTES
): SyncBatchBuildResult {
  if (!deviceId.trim()) throw new MacSyncError('A stable device identity is required for sync', 0, 'protocol')
  if (!Number.isFinite(maxBytes) || maxBytes < 1_024) {
    throw new MacSyncError('Sync request limit is invalid', 0, 'protocol')
  }

  const base = (): SyncPayloadBatch => ({
    protocolVersion: SYNC_PROTOCOL_VERSION,
    deviceId
  })
  const batches: SyncPayloadBatch[] = []
  const skipped: string[] = []
  let current = base()

  const commit = (): void => {
    if (hasBatchContent(current)) batches.push(current)
    current = base()
  }
  const append = (
    createCandidate: (payload: SyncPayloadBatch) => SyncPayloadBatch,
    description: string
  ): void => {
    let candidate = createCandidate(current)
    if (syncPayloadBytes(candidate) > maxBytes) {
      commit()
      candidate = createCandidate(current)
    }
    if (syncPayloadBytes(candidate) > maxBytes) {
      // Never wedge the whole queue on one pathological row.
      skipped.push(description)
      return
    }
    current = candidate
  }
  const appendTopLevel = <Key extends keyof TopLevelArrays>(
    key: Key,
    item: ArrayItem<NonNullable<TopLevelArrays[Key]>>,
    description: string
  ): void => {
    if ((current[key]?.length || 0) >= SYNC_SERVER_ARRAY_LIMITS[key]) commit()
    append((payload) => ({
      ...payload,
      [key]: [
        ...((payload[key] || []) as NonNullable<TopLevelArrays[Key]>),
        item
      ]
    }) as SyncPayloadBatch, description)
  }
  const appendOperation = <Key extends keyof OperationArrays>(
    key: Key,
    item: ArrayItem<OperationArrays[Key]>,
    description: string
  ): void => {
    if ((current.operations?.[key]?.length || 0) >= SYNC_SERVER_ARRAY_LIMITS[key]) commit()
    append((payload) => ({
      ...payload,
      operations: {
        ...payload.operations,
        generatedAt: data.operations.generatedAt,
        [key]: [
          ...((payload.operations?.[key] || []) as OperationArrays[Key]),
          item
        ]
      }
    }), description)
  }

  // Acknowledgement IDs and deletes lead the stream. If a later request is
  // interrupted, retrying is idempotent and no stale entity can be resurrected.
  for (const mutation of data.sync.outbox) {
    appendTopLevel('mutationIds', mutation.id, `Mutation ${mutation.id}`)
  }
  for (const tombstone of data.sync.tombstones) {
    appendTopLevel('tombstones', tombstone, `Deletion record ${tombstone.entityId}`)
  }
  for (const message of data.messages) {
    appendTopLevel('messages', slimMessageForSync(message), `Message ${message.id}`)
  }
  for (const memory of data.memories) {
    appendTopLevel('memories', slimMemoryForSync(memory), `Memory ${memory.id}`)
  }
  for (const mission of data.operations.missions) {
    const steps = Array.isArray(mission.steps) ? mission.steps : []
    if (!steps.length) {
      appendOperation(
        'missions',
        slimMissionFragmentForSync({ ...mission, steps: [] }),
        `Mission ${mission.id}`
      )
      continue
    }
    // A server-accepted step can contain ~42 KB of text; 20-step fragments
    // remain bounded while avoiding one request per step in ordinary use.
    for (let offset = 0; offset < steps.length; offset += 20) {
      appendOperation(
        'missions',
        slimMissionFragmentForSync({ ...mission, steps: steps.slice(offset, offset + 20) }),
        `Mission ${mission.id}`
      )
    }
  }
  for (const routine of data.operations.routines) {
    appendOperation('routines', {
      ...routine,
      name: truncateForSync(String(routine.name || ''), SYNC_TEXT_FIELD_MAX_CHARS),
      prompt: truncateForSync(String(routine.prompt || ''), SYNC_TEXT_FIELD_MAX_CHARS)
    }, `Routine ${routine.id}`)
  }
  for (const approval of data.operations.approvals) {
    appendOperation('approvals', {
      ...approval,
      title: truncateForSync(String(approval.title || ''), SYNC_TEXT_FIELD_MAX_CHARS),
      description: truncateForSync(String(approval.description || ''), SYNC_TEXT_FIELD_MAX_CHARS),
      preview: approval.preview
        ? truncateForSync(approval.preview, SYNC_TEXT_FIELD_MAX_CHARS)
        : approval.preview
    }, `Approval ${approval.id}`)
  }
  for (const capture of data.operations.captures) {
    appendOperation('captures', {
      ...capture,
      content: truncateForSync(String(capture.content || ''), SYNC_MEMORY_CONTENT_MAX_CHARS)
    }, `Capture ${capture.id}`)
  }
  commit()
  return {
    batches: batches.length ? batches : [base()],
    skipped
  }
}

export type MacHealth = {
  ok: boolean
  authenticated?: boolean
  protocolVersion?: number
  name?: string
  serverTime?: number
  capabilities?: string[]
  error?: string
}

export type EnrollmentResult = {
  credential: string
  device: { id: string; name: string; scopes: string[] }
  name: string
  protocolVersion: number
  capabilities: string[]
}

type SyncResponse = SyncResponseLike & {
  ok?: boolean
  error?: string
  protocolVersion?: number
  serverTime?: number
  acknowledgedMutationIds?: string[]
}

export class MacSyncError extends Error {
  readonly status: number
  readonly kind: 'auth' | 'offline' | 'timeout' | 'protocol' | 'server'

  constructor(message: string, status = 0, kind: MacSyncError['kind'] = 'server') {
    super(message)
    this.name = 'MacSyncError'
    this.status = status
    this.kind = kind
  }
}

export function normalizeBase(url: string): string {
  return normalizeMacUrl(url)
}

export async function chatWithMac(opts: {
  config: CompanionConfig
  text: string
  images?: ChatImagePayload[]
  userMessageId: string
}): Promise<import('./prompt').ProviderReply> {
  const base = normalizeBase(opts.config.macBaseUrl)
  if (!base || !opts.config.macCredential.trim()) {
    throw new MacSyncError('Enroll this phone under Systems → Mac Link first', 0, 'auth')
  }
  const startedAt = Date.now()
  const response = await fetchWithTimeout(
    `${base}/v2/chat/complete`,
    {
      method: 'POST',
      headers: authHeaders(opts.config.macCredential),
      body: JSON.stringify({
        text: opts.text,
        images: opts.images || [],
        userMessageId: opts.userMessageId
      })
    },
    90_000
  )
  const parsed = await responseJson<{
    ok?: boolean
    error?: string
    provider?: string
    model?: string
    message?: { content?: string }
  }>(response)
  if (!parsed.ok || !parsed.message?.content) {
    throw new MacSyncError(parsed.error || 'Mac brain returned an incomplete response', response.status, 'protocol')
  }
  return {
    reply: parsed.message.content,
    newMemories: [],
    provider: 'mac',
    model: parsed.model || 'ChatGPT / Codex',
    latencyMs: Math.max(0, Date.now() - startedAt)
  }
}

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  ms = TIMEOUT_MS
): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new MacSyncError(`Mac did not respond within ${Math.round(ms / 1000)} seconds`, 0, 'timeout')
    }
    throw new MacSyncError(
      'Mac companion is unreachable — changes remain safely queued on this phone',
      0,
      'offline'
    )
  } finally {
    clearTimeout(timer)
  }
}

async function responseJson<T extends { error?: string }>(response: Response): Promise<T> {
  let data: T
  try {
    data = await response.json() as T
  } catch {
    throw new MacSyncError(`Mac returned an unreadable response (${response.status})`, response.status, 'protocol')
  }
  if (!response.ok) {
    const kind = response.status === 401 || response.status === 403
      ? 'auth'
      : response.status === 404 || response.status === 409 || response.status === 426
        ? 'protocol'
        : 'server'
    throw new MacSyncError(
      data.error || (kind === 'auth' ? 'Mac rejected this device credential' : `Mac request failed (${response.status})`),
      response.status,
      kind
    )
  }
  return data
}

function authHeaders(credential: string): Record<string, string> {
  return {
    Authorization: `Bearer ${credential.trim()}`,
    'Content-Type': 'application/json',
    Accept: 'application/json'
  }
}

export async function enrollWithMac(opts: {
  baseUrl: string
  enrollmentToken: string
  deviceId: string
  deviceName: string
}): Promise<EnrollmentResult> {
  const base = normalizeBase(opts.baseUrl)
  if (!base) throw new MacSyncError('Enter the Mac companion URL', 0, 'protocol')
  if (!opts.enrollmentToken.trim()) throw new MacSyncError('Enter the pairing token from Mac Systems', 0, 'auth')
  const response = await fetchWithTimeout(`${base}/v2/enroll`, {
    method: 'POST',
    headers: authHeaders(opts.enrollmentToken),
    body: JSON.stringify({ deviceId: opts.deviceId, deviceName: opts.deviceName })
  })
  const data = await responseJson<{
    ok?: boolean
    error?: string
    name?: string
    protocolVersion?: number
    credential?: string
    device?: EnrollmentResult['device']
    capabilities?: string[]
  }>(response)
  if (!data.ok || !data.credential || !data.device) {
    throw new MacSyncError('Mac enrollment response was incomplete', response.status, 'protocol')
  }
  return {
    credential: data.credential,
    device: data.device,
    name: data.name || 'A.L.B.E.R.T. Mac',
    protocolVersion: data.protocolVersion || SYNC_PROTOCOL_VERSION,
    capabilities: Array.isArray(data.capabilities) ? data.capabilities : []
  }
}

export async function checkMacHealth(
  baseUrl: string,
  credential: string
): Promise<MacHealth> {
  const base = normalizeBase(baseUrl)
  if (!base || !credential.trim()) return { ok: false, authenticated: false, error: 'Mac link is not enrolled' }
  try {
    const response = await fetchWithTimeout(`${base}/v2/health`, {
      method: 'GET',
      headers: authHeaders(credential)
    }, 7_000)
    const data = await responseJson<MacHealth & { error?: string }>(response)
    return {
      ok: Boolean(data.ok),
      authenticated: Boolean(data.ok),
      protocolVersion: data.protocolVersion,
      name: data.name,
      serverTime: data.serverTime,
      capabilities: data.capabilities
    }
  } catch (error) {
    if (error instanceof MacSyncError) {
      return { ok: false, authenticated: error.kind !== 'auth' ? undefined : false, error: error.message }
    }
    return { ok: false, error: String(error) }
  }
}

export async function syncAllWithMac(opts: {
  config: CompanionConfig
  data: LocalData
  /** Re-read state after the network response so in-flight local edits survive. */
  getLatestData?: () => LocalData
  /** Override the per-request JSON budget (tests). */
  maxBytes?: number
}): Promise<LocalData> {
  const { config, data } = opts
  const base = normalizeBase(config.macBaseUrl)
  if (!base || !config.macCredential.trim()) {
    throw new MacSyncError('Enroll this phone under Systems → Mac Link first', 0, 'auth')
  }
  const sentOutbox = [...data.sync.outbox]
  const { batches, skipped } = buildSyncPayloadBatches(data, config.deviceId, opts.maxBytes)
  const acknowledgedMutationIds = new Set<string>()
  const tombstones = new Map<string, SyncTombstone>()
  let finalResponse: SyncResponse | null = null

  for (const batch of batches) {
    const response = await fetchWithTimeout(`${base}/v2/sync`, {
      method: 'POST',
      headers: authHeaders(config.macCredential),
      body: JSON.stringify(batch)
    }, SYNC_UPLOAD_TIMEOUT_MS)
    const parsed = await responseJson<SyncResponse>(response)
    if (!parsed.ok) throw new MacSyncError(parsed.error || 'Mac sync failed', response.status)
    if (parsed.protocolVersion !== SYNC_PROTOCOL_VERSION) {
      throw new MacSyncError(
        `Mac uses sync protocol ${parsed.protocolVersion ?? 'unknown'}; version ${SYNC_PROTOCOL_VERSION} is required`,
        response.status,
        'protocol'
      )
    }
    for (const id of parsed.acknowledgedMutationIds || []) acknowledgedMutationIds.add(id)
    for (const row of parsed.tombstones || []) {
      if (!row?.entityType || !row.entityId) continue
      const key = `${row.entityType}:${row.entityId}`
      const before = tombstones.get(key)
      if (!before || row.deletedAt > before.deletedAt) tombstones.set(key, row)
    }
    finalResponse = parsed
  }

  if (!finalResponse) throw new MacSyncError('Mac sync produced no response', 0, 'protocol')
  const merged = mergeSyncedData(opts.getLatestData?.() || data, {
    ...finalResponse,
    acknowledgedMutationIds: [...acknowledgedMutationIds],
    tombstones: [...tombstones.values()]
  }, sentOutbox)
  if (!skipped.length) return merged
  return {
    ...merged,
    sync: {
      ...merged.sync,
      lastError: skipped.length === 1
        ? `${skipped[0]} was too large even after trimming; left on phone only`
        : `${skipped.length} items were too large even after trimming; left on phone only`
    }
  }
}

export async function revokeThisDevice(config: CompanionConfig): Promise<void> {
  const base = normalizeBase(config.macBaseUrl)
  if (!base || !config.macCredential) return
  const response = await fetchWithTimeout(`${base}/v2/devices/self`, {
    method: 'DELETE',
    headers: authHeaders(config.macCredential)
  }, 7_000)
  await responseJson<{ ok?: boolean; error?: string }>(response)
}
