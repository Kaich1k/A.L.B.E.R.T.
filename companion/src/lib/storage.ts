import type { ChatMessage, CompanionConfig, MemoryFact } from '../types'

const KEYS = {
  config: 'albert.companion.config',
  memories: 'albert.companion.memories',
  chat: 'albert.companion.chat'
} as const

const DEFAULT_CONFIG: CompanionConfig = {
  anthropicApiKey: '',
  model: 'claude-haiku-4-5',
  macBaseUrl: '',
  macToken: ''
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function loadConfig(): CompanionConfig {
  return { ...DEFAULT_CONFIG, ...readJson(KEYS.config, {}) }
}

export function saveConfig(config: CompanionConfig): void {
  localStorage.setItem(KEYS.config, JSON.stringify(config))
}

export function loadMemories(): MemoryFact[] {
  return readJson<MemoryFact[]>(KEYS.memories, [])
}

export function saveMemories(memories: MemoryFact[]): void {
  localStorage.setItem(KEYS.memories, JSON.stringify(memories))
}

export function loadChat(): ChatMessage[] {
  return readJson<ChatMessage[]>(KEYS.chat, [])
}

export function saveChat(messages: ChatMessage[]): void {
  localStorage.setItem(KEYS.chat, JSON.stringify(messages.slice(-80)))
}

export function upsertLocalMemory(
  memories: MemoryFact[],
  fact: Omit<MemoryFact, 'createdAt' | 'updatedAt'> & {
    createdAt?: number
    updatedAt?: number
  }
): MemoryFact[] {
  const now = Date.now()
  const next = [...memories]
  const idx = next.findIndex((m) => m.id === fact.id)
  const row: MemoryFact = {
    id: fact.id,
    content: fact.content.trim(),
    category: fact.category || 'general',
    createdAt: fact.createdAt ?? now,
    updatedAt: fact.updatedAt ?? now
  }
  if (idx >= 0) next[idx] = { ...next[idx], ...row, createdAt: next[idx].createdAt }
  else next.unshift(row)
  return next
}
