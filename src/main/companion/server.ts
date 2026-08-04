import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { networkInterfaces } from 'os'
import { randomBytes } from 'crypto'
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

let server: Server | null = null
let listeningPort: number | null = null

export interface CompanionStatus {
  running: boolean
  port: number | null
  token: string
  urls: string[]
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'
  })
  res.end(payload)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function authorized(req: IncomingMessage, token: string): boolean {
  if (!token) return false
  const header = req.headers.authorization || ''
  if (header === `Bearer ${token}`) return true
  const url = new URL(req.url || '/', 'http://local')
  return url.searchParams.get('token') === token
}

function notifyDesktopChat(messages: CompanionChatMessage[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    for (const message of messages) {
      win.webContents.send('albert:chat:event', {
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
}

export function listLanUrls(port: number): string[] {
  const urls: string[] = [`http://127.0.0.1:${port}`]
  const nets = networkInterfaces()
  for (const entries of Object.values(nets)) {
    if (!entries) continue
    for (const entry of entries) {
      if (entry.internal) continue
      if (String(entry.family) !== 'IPv4') continue
      urls.push(`http://${entry.address}:${port}`)
    }
  }
  return [...new Set(urls)]
}

export function ensureCompanionToken(): string {
  const settings = getSettings()
  if (settings.companionToken?.trim()) return settings.companionToken.trim()
  const token = randomBytes(24).toString('hex')
  setSettings({ companionToken: token })
  return token
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const settings = getSettings()
  const token = settings.companionToken
  const url = new URL(req.url || '/', 'http://local')
  const path = url.pathname.replace(/\/+$/, '') || '/'

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {})
    return
  }

  if (path === '/v1/health' || path === '/health') {
    sendJson(res, 200, {
      ok: true,
      name: APP_NAME,
      version: '0.1.0',
      companion: true,
      chatCount: countCompanionChat(),
      memoryCount: listMemories().length
    })
    return
  }

  if (!authorized(req, token)) {
    sendJson(res, 401, { ok: false, error: 'Unauthorized — check companion token' })
    return
  }

  if (req.method === 'GET' && path === '/v1/chat') {
    sendJson(res, 200, { ok: true, messages: listCompanionChat(120) })
    return
  }

  if (req.method === 'POST' && path === '/v1/chat/sync') {
    const raw = await readBody(req)
    let incoming: CompanionChatMessage[] = []
    try {
      const parsed = JSON.parse(raw || '{}') as { messages?: CompanionChatMessage[] }
      incoming = Array.isArray(parsed.messages) ? parsed.messages : []
    } catch {
      sendJson(res, 400, { ok: false, error: 'Invalid JSON body' })
      return
    }
    const { messages, inserted } = syncMessagesFromCompanion(incoming)
    if (inserted.length) notifyDesktopChat(inserted)
    sendJson(res, 200, { ok: true, messages })
    return
  }

  if (req.method === 'POST' && path === '/v1/chat/clear') {
    clearMessages()
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('albert:chat:event', { type: 'chat_cleared' })
    }
    sendJson(res, 200, { ok: true, messages: [] })
    return
  }

  if (req.method === 'GET' && path === '/v1/memories') {
    sendJson(res, 200, { ok: true, memories: listMemories() })
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
      sendJson(res, 400, { ok: false, error: 'Invalid JSON body' })
      return
    }
    const merged = syncMemoriesFromCompanion(incoming, deletedIds)
    sendJson(res, 200, { ok: true, memories: merged })
    return
  }

  const memDelete = path.match(/^\/v1\/memories\/([^/]+)$/)
  if (req.method === 'DELETE' && memDelete) {
    const id = decodeURIComponent(memDelete[1]!)
    const ok = deleteMemory(id)
    sendJson(res, ok ? 200 : 404, {
      ok,
      error: ok ? undefined : 'Memory not found'
    })
    return
  }

  sendJson(res, 404, { ok: false, error: 'Not found' })
}

export function getCompanionStatus(): CompanionStatus {
  const settings = getSettings()
  return {
    running: Boolean(server?.listening),
    port: listeningPort,
    token: settings.companionToken || '',
    urls: listeningPort ? listLanUrls(listeningPort) : []
  }
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
        sendJson(res, 500, {
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        })
      })
    })
    server.once('error', reject)
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
