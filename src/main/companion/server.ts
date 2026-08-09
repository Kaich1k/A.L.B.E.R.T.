import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { hostname, networkInterfaces } from 'os'
import { randomBytes, timingSafeEqual } from 'crypto'
import { BrowserWindow } from 'electron'
import { getSettings, setSettings } from '../config'
import {
  clearMessages,
  countCompanionChat,
  deleteMemory,
  listCompanionChat,
  listMemories,
  syncMemoriesFromCompanion,
  syncMessagesFromCompanion,
  type CompanionChatMessage
} from '../memory/service'
import type { MemoryFact } from '../../shared/types'
import { APP_NAME } from '../../shared/brand'
import {
  authenticateCompanionDevice,
  COMPANION_PROTOCOL_VERSION,
  enrollCompanionDevice,
  listCompanionDevices,
  reconcileCompanionState,
  revokeCompanionDevice as revokeProtocolDevice,
  type CompanionSyncPayload
} from './protocol'

let server: Server | null = null
let listeningPort: number | null = null

export interface CompanionStatus {
  running: boolean
  port: number | null
  token: string
  urls: string[]
  protocolVersion: number
  devices: ReturnType<typeof listCompanionDevices>
}

const MAX_BODY_BYTES = 2 * 1024 * 1024
const rateWindows = new Map<string, { start: number; count: number }>()

function discardRequestBody(req: IncomingMessage): void {
  if (!req.readableEnded && !req.destroyed) req.resume()
}

function allowedOrigin(req?: IncomingMessage): string | undefined {
  const origin = req?.headers.origin
  if (!origin) return undefined
  try {
    const parsed = new URL(origin)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]') {
      return origin
    }
  } catch {
    return undefined
  }
  return undefined
}

function sendJson(res: ServerResponse, status: number, body: unknown, req?: IncomingMessage): void {
  const payload = JSON.stringify(body)
  const origin = allowedOrigin(req)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  })
  res.end(payload)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const contentLength = Number(req.headers['content-length'])
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      req.resume()
      reject(Object.assign(new Error('Request body exceeds 2 MB'), { statusCode: 413 }))
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false
    req.on('data', (c) => {
      if (tooLarge) return
      const chunk = Buffer.isBuffer(c) ? c : Buffer.from(c)
      size += chunk.byteLength
      if (size > MAX_BODY_BYTES) {
        tooLarge = true
        reject(Object.assign(new Error('Request body exceeds 2 MB'), { statusCode: 413 }))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!tooLarge) resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', reject)
    req.on('aborted', () => reject(Object.assign(new Error('Request aborted'), { statusCode: 400 })))
  })
}

function equalSecret(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function authorized(req: IncomingMessage, token: string): boolean {
  if (!token) return false
  const header = req.headers.authorization || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return Boolean(match?.[1] && equalSecret(match[1], token))
}

function rateAllowed(req: IncomingMessage): boolean {
  const key = req.socket.remoteAddress || 'unknown'
  const now = Date.now()
  const current = rateWindows.get(key)
  if (!current || now - current.start >= 60_000) {
    if (rateWindows.size > 1_024) {
      for (const [address, window] of rateWindows) {
        if (now - window.start >= 60_000) rateWindows.delete(address)
      }
    }
    rateWindows.set(key, { start: now, count: 1 })
    return true
  }
  current.count += 1
  return current.count <= 120
}

function parseJson<T>(raw: string): T {
  try {
    return JSON.parse(raw || '{}') as T
  } catch {
    throw Object.assign(new Error('Invalid JSON body'), { statusCode: 400 })
  }
}

function sendDesktopEvent(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (
        (typeof win.isDestroyed === 'function' && win.isDestroyed()) ||
        (typeof win.webContents.isDestroyed === 'function' && win.webContents.isDestroyed())
      ) continue
      win.webContents.send(channel, payload)
    } catch {
      // The renderer can disappear between getAllWindows() and send(). Sync has
      // already committed, so a window lifecycle race must not turn into HTTP 500.
    }
  }
}

function notifyDesktopChat(messages: CompanionChatMessage[]): void {
  for (const message of messages) {
    sendDesktopEvent('albert:chat:event', {
      type: 'message',
      message: {
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt
      }
    })
  }
}

function notifyDesktopChatSync(): void {
  sendDesktopEvent('albert:chat:event', { type: 'chat_synced' })
}

export function listLanUrls(port: number): string[] {
  const ipv4: string[] = []
  const nets = networkInterfaces()
  for (const entries of Object.values(nets)) {
    if (!entries) continue
    for (const entry of entries) {
      if (entry.internal) continue
      if (String(entry.family) !== 'IPv4') continue
      ipv4.push(`http://${entry.address}:${port}`)
    }
  }
  const host = hostname().trim().replace(/\.local$/i, '').replace(/[^a-zA-Z0-9-]/g, '-')
  const mdns = host ? [`http://${host}.local:${port}`] : []
  // IPv4 first so phones paste a reachable LAN address instead of flaky .local.
  return [...new Set([...ipv4, ...mdns, `http://127.0.0.1:${port}`])]
}

export function ensureCompanionToken(): string {
  const settings = getSettings()
  const existing = settings.companionToken?.trim()
  if (existing) {
    if (existing !== settings.companionToken) setSettings({ companionToken: existing })
    return existing
  }
  const token = randomBytes(24).toString('hex')
  setSettings({ companionToken: token })
  return token
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const settings = getSettings()
  const token = settings.companionToken
  const url = new URL(req.url || '/', 'http://local')
  const path = url.pathname.replace(/\/+$/, '') || '/'

  if (!rateAllowed(req)) {
    discardRequestBody(req)
    res.setHeader('Retry-After', '60')
    sendJson(res, 429, { ok: false, error: 'Too many requests — retry shortly' }, req)
    return
  }

  if (req.method === 'OPTIONS') {
    discardRequestBody(req)
    if (req.headers.origin && !allowedOrigin(req)) {
      sendJson(res, 403, { ok: false, error: 'Origin not allowed' }, req)
      return
    }
    sendJson(res, 204, {}, req)
    return
  }

  const mediaType = String(req.headers['content-type'] || '').split(';', 1)[0]!.trim().toLowerCase()
  if (req.method === 'POST' && mediaType !== 'application/json') {
    discardRequestBody(req)
    sendJson(res, 415, { ok: false, error: 'Content-Type must be application/json' }, req)
    return
  }

  if (req.method === 'POST' && path === '/v2/enroll') {
    if (!authorized(req, token)) {
      discardRequestBody(req)
      sendJson(res, 401, { ok: false, error: 'Enrollment token rejected' }, req)
      return
    }
    const parsed = parseJson<{ deviceId?: string; deviceName?: string }>(await readBody(req))
    const enrolled = enrollCompanionDevice({
      id: parsed.deviceId || '',
      name: parsed.deviceName || 'A.L.B.E.R.T. Mobile'
    })
    sendJson(res, 201, {
      ok: true,
      name: APP_NAME,
      protocolVersion: COMPANION_PROTOCOL_VERSION,
      credential: enrolled.credential,
      device: enrolled.device,
      capabilities: ['chat', 'memory', 'operations', 'approvals', 'activity', 'tombstones']
    }, req)
    return
  }

  const device = authenticateCompanionDevice(req.headers.authorization)

  if (req.method === 'GET' && (path === '/v2/health' || path === '/v2/info')) {
    if (!device) {
      sendJson(res, 401, { ok: false, error: 'Device credential rejected' }, req)
      return
    }
    sendJson(res, 200, {
      ok: true,
      name: APP_NAME,
      version: '0.1.0',
      protocolVersion: COMPANION_PROTOCOL_VERSION,
      companion: true,
      device: { id: device.id, name: device.name, scopes: device.scopes },
      capabilities: ['chat', 'memory', 'operations', 'approvals', 'activity', 'tombstones'],
      serverTime: Date.now()
    }, req)
    return
  }

  if (req.method === 'POST' && path === '/v2/sync') {
    if (!device || !device.scopes.includes('sync')) {
      discardRequestBody(req)
      sendJson(res, 401, { ok: false, error: 'Device credential rejected or missing sync scope' }, req)
      return
    }
    const parsed = parseJson<CompanionSyncPayload>(await readBody(req))
    const result = reconcileCompanionState(parsed, device.id)
    if (result.chatChanged) notifyDesktopChatSync()
    if (result.memoryChanged) {
      sendDesktopEvent('albert:memory:changed')
    }
    if (result.operationsChanged) {
      sendDesktopEvent('albert:operations:changed')
    }
    const {
      insertedMessages: _inserted,
      chatChanged: _chatChanged,
      memoryChanged: _memoryChanged,
      operationsChanged: _changed,
      ...publicResult
    } = result
    sendJson(res, 200, { ok: true, ...publicResult }, req)
    return
  }

  if (req.method === 'DELETE' && path === '/v2/devices/self') {
    if (!device) {
      sendJson(res, 401, { ok: false, error: 'Device credential rejected' }, req)
      return
    }
    revokeProtocolDevice(device.id)
    sendJson(res, 200, { ok: true }, req)
    return
  }

  if ((path === '/v1/health' || path === '/health') && req.method === 'GET') {
    if (!authorized(req, token)) {
      sendJson(res, 401, { ok: false, error: 'Unauthorized — check companion token' }, req)
      return
    }
    sendJson(res, 200, {
      ok: true,
      name: APP_NAME,
      version: '0.1.0',
      protocolVersion: COMPANION_PROTOCOL_VERSION,
      companion: true,
      chatCount: countCompanionChat(),
      memoryCount: listMemories().length
    }, req)
    return
  }

  if (!authorized(req, token)) {
    discardRequestBody(req)
    sendJson(res, 401, { ok: false, error: 'Unauthorized — check companion token' }, req)
    return
  }

  if (req.method === 'GET' && path === '/v1/chat') {
    sendJson(res, 200, { ok: true, messages: listCompanionChat(120) }, req)
    return
  }

  if (req.method === 'POST' && path === '/v1/chat/sync') {
    const raw = await readBody(req)
    let incoming: CompanionChatMessage[] = []
    try {
      const parsed = JSON.parse(raw || '{}') as { messages?: CompanionChatMessage[] }
      incoming = Array.isArray(parsed.messages) ? parsed.messages : []
    } catch {
      sendJson(res, 400, { ok: false, error: 'Invalid JSON body' }, req)
      return
    }
    const { messages, inserted } = syncMessagesFromCompanion(incoming)
    if (inserted.length) notifyDesktopChat(inserted)
    sendJson(res, 200, { ok: true, messages }, req)
    return
  }

  if (req.method === 'POST' && path === '/v1/chat/clear') {
    clearMessages()
    sendDesktopEvent('albert:chat:event', { type: 'chat_cleared' })
    sendJson(res, 200, { ok: true, messages: [] }, req)
    return
  }

  if (req.method === 'GET' && path === '/v1/memories') {
    sendJson(res, 200, { ok: true, memories: listMemories() }, req)
    return
  }

  if (req.method === 'POST' && path === '/v1/memories/sync') {
    const raw = await readBody(req)
    let incoming: MemoryFact[] = []
    let deletedIds: string[] = []
    try {
      const parsed = JSON.parse(raw || '{}') as {
        memories?: MemoryFact[]
        deletedIds?: string[]
      }
      incoming = Array.isArray(parsed.memories) ? parsed.memories : []
      deletedIds = Array.isArray(parsed.deletedIds) ? parsed.deletedIds : []
    } catch {
      sendJson(res, 400, { ok: false, error: 'Invalid JSON body' }, req)
      return
    }
    const merged = syncMemoriesFromCompanion(incoming, deletedIds)
    sendJson(res, 200, { ok: true, memories: merged }, req)
    return
  }

  const memDelete = path.match(/^\/v1\/memories\/([^/]+)$/)
  if (req.method === 'DELETE' && memDelete) {
    const id = decodeURIComponent(memDelete[1]!)
    const ok = deleteMemory(id)
    sendJson(res, ok ? 200 : 404, {
      ok,
      error: ok ? undefined : 'Memory not found'
    }, req)
    return
  }

  discardRequestBody(req)
  sendJson(res, 404, { ok: false, error: 'Not found' }, req)
}

export function getCompanionStatus(): CompanionStatus {
  const settings = getSettings()
  return {
    running: Boolean(server?.listening),
    port: listeningPort,
    token: settings.companionToken || '',
    urls: listeningPort ? listLanUrls(listeningPort) : [],
    protocolVersion: COMPANION_PROTOCOL_VERSION,
    devices: listCompanionDevices()
  }
}

export function revokeCompanionAccess(deviceId: string): boolean {
  return revokeProtocolDevice(deviceId)
}

export async function startCompanionServer(): Promise<CompanionStatus> {
  const settings = getSettings()
  if (!settings.companionEnabled) {
    await stopCompanionServer()
    return getCompanionStatus()
  }

  const token = ensureCompanionToken()
  const port = settings.companionPort || 47831

  if (server?.listening && listeningPort === port) {
    return getCompanionStatus()
  }

  await stopCompanionServer()

  await new Promise<void>((resolve, reject) => {
    server = createServer((req, res) => {
      void handleRequest(req, res).catch((err) => {
        const status = typeof (err as { statusCode?: unknown })?.statusCode === 'number'
          ? (err as { statusCode: number }).statusCode
          : 500
        sendJson(res, status, {
          ok: false,
          error: status >= 500 ? 'Companion server error' : err instanceof Error ? err.message : String(err)
        }, req)
      })
    })
    server.requestTimeout = 15_000
    server.headersTimeout = 10_000
    server.keepAliveTimeout = 5_000
    server.maxHeadersCount = 50
    server.maxRequestsPerSocket = 200
    server.once('error', (error) => {
      server = null
      listeningPort = null
      reject(error)
    })
    server.listen(port, '0.0.0.0', () => {
      listeningPort = port
      if (!settings.companionToken) setSettings({ companionToken: token })
      resolve()
    })
  })

  return getCompanionStatus()
}

export async function stopCompanionServer(): Promise<void> {
  const current = server
  server = null
  listeningPort = null
  if (!current) return
  await new Promise<void>((resolve) => {
    current.close(() => resolve())
  })
}

export async function applyCompanionSettings(): Promise<CompanionStatus> {
  const settings = getSettings()
  if (settings.companionEnabled) return startCompanionServer()
  await stopCompanionServer()
  return getCompanionStatus()
}
