import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { defaultModelFor, isModelForProvider } from './chat'
import type { ChatMessage, CompanionConfig, MemoryFact } from '../types'

const KEYS = {
  publicConfig: 'albert.companion.publicConfig',
  memories: 'albert.companion.memories',
  chat: 'albert.companion.chat',
  apiKey: 'albert.companion.apiKey',
  groqApiKey: 'albert.companion.groqApiKey',
  macToken: 'albert.companion.macToken'
} as const

const DEFAULT_CONFIG: CompanionConfig = {
  provider: 'anthropic',
  anthropicApiKey: '',
  groqApiKey: '',
  model: 'claude-haiku-4-5',
  macBaseUrl: '',
  macToken: ''
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export async function loadConfig(): Promise<CompanionConfig> {
  const publicPart = await readJson<Partial<CompanionConfig>>(KEYS.publicConfig, {})
  const anthropicApiKey = (await SecureStore.getItemAsync(KEYS.apiKey)) || ''
  const groqApiKey = (await SecureStore.getItemAsync(KEYS.groqApiKey)) || ''
  const macToken = (await SecureStore.getItemAsync(KEYS.macToken)) || ''
  const provider = publicPart.provider === 'groq' ? 'groq' : 'anthropic'
  let model = publicPart.model || DEFAULT_CONFIG.model
  if (!isModelForProvider(provider, model)) {
    model = defaultModelFor(provider)
  }
  return {
    ...DEFAULT_CONFIG,
    ...publicPart,
    provider,
    model,
    anthropicApiKey,
    groqApiKey,
    macToken
  }
}

export async function saveConfig(config: CompanionConfig): Promise<void> {
  const { anthropicApiKey, groqApiKey, macToken, ...publicPart } = config
  await AsyncStorage.setItem(KEYS.publicConfig, JSON.stringify(publicPart))
  if (anthropicApiKey) await SecureStore.setItemAsync(KEYS.apiKey, anthropicApiKey)
  else await SecureStore.deleteItemAsync(KEYS.apiKey)
  if (groqApiKey) await SecureStore.setItemAsync(KEYS.groqApiKey, groqApiKey)
  else await SecureStore.deleteItemAsync(KEYS.groqApiKey)
  if (macToken) await SecureStore.setItemAsync(KEYS.macToken, macToken)
  else await SecureStore.deleteItemAsync(KEYS.macToken)
}

export async function loadMemories(): Promise<MemoryFact[]> {
  return readJson<MemoryFact[]>(KEYS.memories, [])
}

export async function saveMemories(memories: MemoryFact[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.memories, JSON.stringify(memories))
}

export async function loadChat(): Promise<ChatMessage[]> {
  return readJson<ChatMessage[]>(KEYS.chat, [])
}

export async function saveChat(messages: ChatMessage[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.chat, JSON.stringify(messages.slice(-120)))
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
