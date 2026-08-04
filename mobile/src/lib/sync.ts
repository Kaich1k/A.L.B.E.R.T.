import type { ChatMessage, MemoryFact } from '../types'
import { normalizeMacUrl } from './pairInfo'

function normalizeBase(url: string): string {
  return normalizeMacUrl(url)
}

const TIMEOUT_MS = 10_000

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  ms = TIMEOUT_MS
): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Timed out reaching Mac (${ms / 1000}s) — check URL / Wi‑Fi / companion online`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export type MacHealth = {
  ok: boolean
  chatCount?: number
  memoryCount?: number
  name?: string
}

export async function checkMacHealth(baseUrl: string): Promise<MacHealth> {
  const base = normalizeBase(baseUrl)
  if (!base) return { ok: false }
  try {
    const res = await fetchWithTimeout(`${base}/v1/health`, { method: 'GET' })
    if (!res.ok) return { ok: false }
    const data = (await res.json()) as MacHealth & { ok?: boolean }
    return {
      ok: Boolean(data.ok),
      chatCount: data.chatCount,
      memoryCount: data.memoryCount,
      name: data.name
    }
  } catch {
    return { ok: false }
  }
}

async function authFetch(
  baseUrl: string,
  token: string,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const base = normalizeBase(baseUrl)
  if (!base || !token.trim()) {
    throw new Error('Set Mac URL and pairing token first')
  }
  return fetchWithTimeout(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token.trim()}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {})
    }
  })
}

function syncHint(status: number, error?: string): string {
  if (status === 401) return 'Unauthorized — pairing token does not match Mac'
  if (status === 404) {
    return 'Mac app is outdated — run npm run update:app on the Mac, then reopen A.L.B.E.R.T.'
  }
  return error || `Request failed (${status})`
}

export async function fetchChatFromMac(opts: {
  baseUrl: string
  token: string
}): Promise<ChatMessage[]> {
  const res = await authFetch(opts.baseUrl, opts.token, '/v1/chat')
  const data = (await res.json()) as {
    ok?: boolean
    error?: string
    messages?: ChatMessage[]
  }
  if (!res.ok || !data.ok) {
    throw new Error(syncHint(res.status, data.error))
  }
  return Array.isArray(data.messages) ? data.messages : []
}

export async function syncChatWithMac(opts: {
  baseUrl: string
  token: string
  messages: ChatMessage[]
}): Promise<ChatMessage[]> {
  const res = await authFetch(opts.baseUrl, opts.token, '/v1/chat/sync', {
    method: 'POST',
    body: JSON.stringify({ messages: opts.messages })
  })
  const data = (await res.json()) as {
    ok?: boolean
    error?: string
    messages?: ChatMessage[]
  }
  if (!res.ok || !data.ok) {
    throw new Error(syncHint(res.status, data.error || 'Chat sync failed'))
  }
  return Array.isArray(data.messages) ? data.messages : []
}

export async function clearChatOnMac(opts: {
  baseUrl: string
  token: string
}): Promise<void> {
  const res = await authFetch(opts.baseUrl, opts.token, '/v1/chat/clear', {
    method: 'POST',
    body: '{}'
  })
  const data = (await res.json()) as { ok?: boolean; error?: string }
  if (!res.ok || !data.ok) {
    throw new Error(syncHint(res.status, data.error || 'Clear failed'))
  }
}

export async function syncMemoriesWithMac(opts: {
  baseUrl: string
  token: string
  memories: MemoryFact[]
  deletedIds?: string[]
}): Promise<MemoryFact[]> {
  const res = await authFetch(opts.baseUrl, opts.token, '/v1/memories/sync', {
    method: 'POST',
    body: JSON.stringify({
      memories: opts.memories,
      deletedIds: opts.deletedIds || []
    })
  })

  const data = (await res.json()) as {
    ok?: boolean
    error?: string
    memories?: MemoryFact[]
  }

  if (!res.ok || !data.ok) {
    throw new Error(syncHint(res.status, data.error || 'Memory sync failed'))
  }

  return Array.isArray(data.memories) ? data.memories : []
}

export async function deleteMemoryOnMac(opts: {
  baseUrl: string
  token: string
  id: string
}): Promise<void> {
  const res = await authFetch(
    opts.baseUrl,
    opts.token,
    `/v1/memories/${encodeURIComponent(opts.id)}`,
    { method: 'DELETE' }
  )
  if (res.status === 404) return
  const data = (await res.json()) as { ok?: boolean; error?: string }
  if (!res.ok || !data.ok) {
    throw new Error(syncHint(res.status, data.error || 'Delete failed'))
  }
}

/** Full reconcile: push local chat+memories, adopt Mac canonical sets. */
export async function fullSyncWithMac(opts: {
  baseUrl: string
  token: string
  messages: ChatMessage[]
  memories: MemoryFact[]
  deletedMemoryIds?: string[]
}): Promise<{ messages: ChatMessage[]; memories: MemoryFact[]; health: MacHealth }> {
  const base = normalizeBase(opts.baseUrl)
  const health = await checkMacHealth(base)
  if (!health.ok) {
    throw new Error(
      `Mac companion unreachable at ${base || '(empty URL)'}. Same Wi‑Fi? On Simulator try http://127.0.0.1:47831. Confirm Systems shows Server online.`
    )
  }

  const [messages, memories] = await Promise.all([
    syncChatWithMac({
      baseUrl: base,
      token: opts.token,
      messages: opts.messages
    }),
    syncMemoriesWithMac({
      baseUrl: base,
      token: opts.token,
      memories: opts.memories,
      deletedIds: opts.deletedMemoryIds
    })
  ])

  return { messages, memories, health }
}
