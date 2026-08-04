import type { MemoryFact } from '../types'

function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

export async function checkMacHealth(baseUrl: string): Promise<boolean> {
  const base = normalizeBase(baseUrl)
  if (!base) return false
  try {
    const res = await fetch(`${base}/v1/health`, { method: 'GET' })
    if (!res.ok) return false
    const data = (await res.json()) as { ok?: boolean }
    return Boolean(data.ok)
  } catch {
    return false
  }
}

export async function syncMemoriesWithMac(opts: {
  baseUrl: string
  token: string
  memories: MemoryFact[]
}): Promise<MemoryFact[]> {
  const base = normalizeBase(opts.baseUrl)
  if (!base || !opts.token.trim()) {
    throw new Error('Set Mac URL and pairing token first')
  }

  const res = await fetch(`${base}/v1/memories/sync`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.token.trim()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ memories: opts.memories })
  })

  const data = (await res.json()) as {
    ok?: boolean
    error?: string
    memories?: MemoryFact[]
  }

  if (!res.ok || !data.ok) {
    throw new Error(data.error || `Sync failed (${res.status})`)
  }

  return Array.isArray(data.memories) ? data.memories : []
}
