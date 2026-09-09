import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import type {
  ActivityEntry,
  ChatMessage,
  CompanionConfig,
  LocalData,
  MemoryFact,
  OperationsSnapshot,
  SyncState,
} from '../types'
import { EMPTY_OPERATIONS, EMPTY_SYNC_STATE } from '../types'
import { compactChatImagesForStorage } from './chatImages'
import { newId } from './id'
import { DEFAULT_PERSONALITY, normalizePersonality } from './personality'
import { mergeTombstones, recordLocalMutation, retainLocalTombstones } from './syncLogic'

export { mergeTombstones, recordLocalMutation } from './syncLogic'

const KEYS = {
  publicConfig: 'albert.mobile.config.v2',
  memories: 'albert.mobile.memories.v2',
  chat: 'albert.mobile.chat.v2',
  operations: 'albert.mobile.operations.v2',
  activity: 'albert.mobile.activity.v2',
  sync: 'albert.mobile.sync.v2',
  draft: 'albert.mobile.draft.v2',
  apiKey: 'albert.mobile.secret.anthropic',
  groqApiKey: 'albert.mobile.secret.groq',
  geminiApiKey: 'albert.mobile.secret.gemini',
  macToken: 'albert.mobile.secret.enrollment',
  macCredential: 'albert.mobile.secret.deviceCredential'
} as const

const LEGACY_KEYS = {
  publicConfig: 'albert.companion.publicConfig',
  memories: 'albert.companion.memories',
  chat: 'albert.companion.chat',
  apiKey: 'albert.companion.apiKey',
  groqApiKey: 'albert.companion.groqApiKey',
  macToken: 'albert.companion.macToken'
} as const

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: 'com.kaichik.albert.mobile'
}

export const DEFAULT_CONFIG: CompanionConfig = {
  provider: 'auto',
  anthropicApiKey: '',
  groqApiKey: '',
  geminiApiKey: '',
  model: 'openai/gpt-oss-20b',
  macBaseUrl: '',
  macToken: '',
  macCredential: '',
  deviceId: `mobile_${newId()}`,
  deviceName: 'A.L.B.E.R.T. Mobile',
  autoSync: true,
  speakReplies: true,
  voiceRate: 1.03,
  ttsVoiceId: '',
  wakeOnLaunch: true,
  reducedMotion: false,
  personality: { ...DEFAULT_PERSONALITY }
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

async function readJsonWithLegacy<T>(key: string, legacyKey: string, fallback: T): Promise<T> {
  try {
    const current = await AsyncStorage.getItem(key)
    if (current != null) return JSON.parse(current) as T
    const legacy = await AsyncStorage.getItem(legacyKey)
    return legacy == null ? fallback : JSON.parse(legacy) as T
  } catch {
    return fallback
  }
}

async function readSecret(key: string): Promise<string> {
  try {
    if (!(await SecureStore.isAvailableAsync())) return ''
    return (await SecureStore.getItemAsync(key, SECURE_OPTIONS)) || ''
  } catch {
    return ''
  }
}

async function readSecretWithLegacy(key: string, legacyKey: string): Promise<string> {
  const current = await readSecret(key)
  if (current) return current
  try {
    if (!(await SecureStore.isAvailableAsync())) return ''
    return (await SecureStore.getItemAsync(legacyKey)) || ''
  } catch {
    return ''
  }
}

async function writeSecret(key: string, value: string): Promise<void> {
  if (!(await SecureStore.isAvailableAsync())) {
    if (value) throw new Error('Secure credential storage is unavailable on this device')
    return
  }
  if (value) await SecureStore.setItemAsync(key, value, SECURE_OPTIONS)
  else await SecureStore.deleteItemAsync(key, SECURE_OPTIONS)
}

function normalizeConfig(value: Partial<CompanionConfig>): CompanionConfig {
  const provider =
    value.provider === 'anthropic' || value.provider === 'groq' || value.provider === 'gemini' || value.provider === 'mac'
      ? value.provider
      : 'auto'
  const voiceRate = typeof value.voiceRate === 'number' && Number.isFinite(value.voiceRate)
    ? Math.max(0.7, Math.min(1.35, value.voiceRate))
    : DEFAULT_CONFIG.voiceRate
  return {
    ...DEFAULT_CONFIG,
    ...value,
    provider,
    deviceId: /^[a-zA-Z0-9_-]{8,96}$/.test(value.deviceId || '')
      ? value.deviceId!
      : DEFAULT_CONFIG.deviceId,
    deviceName: value.deviceName?.trim().slice(0, 80) || DEFAULT_CONFIG.deviceName,
    model: value.model?.trim() || DEFAULT_CONFIG.model,
    macBaseUrl: value.macBaseUrl?.trim().replace(/\/+$/, '') || '',
    autoSync: value.autoSync !== false,
    speakReplies: value.speakReplies !== false,
    wakeOnLaunch: value.wakeOnLaunch === true,
    reducedMotion: value.reducedMotion === true,
    voiceRate,
    ttsVoiceId: typeof value.ttsVoiceId === 'string' ? value.ttsVoiceId.trim() : DEFAULT_CONFIG.ttsVoiceId,
    personality: normalizePersonality(value.personality)
  }
}

export async function loadConfig(): Promise<CompanionConfig> {
  const [publicPart, anthropicApiKey, groqApiKey, geminiApiKey, macToken, macCredential] =
    await Promise.all([
      readJsonWithLegacy<Partial<CompanionConfig>>(KEYS.publicConfig, LEGACY_KEYS.publicConfig, {}),
      readSecretWithLegacy(KEYS.apiKey, LEGACY_KEYS.apiKey),
      readSecretWithLegacy(KEYS.groqApiKey, LEGACY_KEYS.groqApiKey),
      readSecret(KEYS.geminiApiKey),
      readSecretWithLegacy(KEYS.macToken, LEGACY_KEYS.macToken),
      readSecret(KEYS.macCredential)
    ])
  return normalizeConfig({
    ...publicPart,
    anthropicApiKey,
    groqApiKey,
    geminiApiKey,
    macToken,
    macCredential
  })
}

export async function saveConfig(config: CompanionConfig): Promise<void> {
  const normalized = normalizeConfig(config)
  const { anthropicApiKey, groqApiKey, geminiApiKey, macToken, macCredential, ...publicPart } =
    normalized
  await Promise.all([
    AsyncStorage.setItem(KEYS.publicConfig, JSON.stringify(publicPart)),
    writeSecret(KEYS.apiKey, anthropicApiKey.trim()),
    writeSecret(KEYS.groqApiKey, groqApiKey.trim()),
    writeSecret(KEYS.geminiApiKey, geminiApiKey.trim()),
    writeSecret(KEYS.macToken, macToken.trim()),
    writeSecret(KEYS.macCredential, macCredential.trim()),
    AsyncStorage.removeItem(LEGACY_KEYS.publicConfig),
    SecureStore.deleteItemAsync(LEGACY_KEYS.apiKey).catch(() => undefined),
    SecureStore.deleteItemAsync(LEGACY_KEYS.groqApiKey).catch(() => undefined),
    SecureStore.deleteItemAsync(LEGACY_KEYS.macToken).catch(() => undefined)
  ])
}

export async function clearCredentials(): Promise<void> {
  await Promise.all([
    writeSecret(KEYS.apiKey, ''),
    writeSecret(KEYS.groqApiKey, ''),
    writeSecret(KEYS.geminiApiKey, ''),
    writeSecret(KEYS.macToken, ''),
    writeSecret(KEYS.macCredential, '')
  ])
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

export async function loadMemories(): Promise<MemoryFact[]> {
  return asArray<MemoryFact>(await readJsonWithLegacy<unknown>(KEYS.memories, LEGACY_KEYS.memories, []))
    .filter((row) => row && typeof row.id === 'string' && typeof row.content === 'string')
}

export async function saveMemories(memories: MemoryFact[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.memories, JSON.stringify(memories.slice(0, 5_000)))
}

export async function loadChat(): Promise<ChatMessage[]> {
  return asArray<ChatMessage>(await readJsonWithLegacy<unknown>(KEYS.chat, LEGACY_KEYS.chat, []))
    .filter((row) => row && typeof row.id === 'string' && typeof row.content === 'string')
    .slice(-300)
}

export async function saveChat(messages: ChatMessage[]): Promise<void> {
  await AsyncStorage.setItem(
    KEYS.chat,
    JSON.stringify(compactChatImagesForStorage(messages.slice(-300)))
  )
}

export async function loadOperations(): Promise<OperationsSnapshot> {
  const value = await readJson<Partial<OperationsSnapshot>>(KEYS.operations, EMPTY_OPERATIONS)
  return {
    missions: asArray(value.missions),
    routines: asArray(value.routines),
    approvals: asArray(value.approvals),
    captures: asArray(value.captures),
    generatedAt: typeof value.generatedAt === 'number' ? value.generatedAt : 0
  }
}

export async function saveOperations(operations: OperationsSnapshot): Promise<void> {
  await AsyncStorage.setItem(KEYS.operations, JSON.stringify(operations))
}

export async function loadActivity(): Promise<ActivityEntry[]> {
  return asArray<ActivityEntry>(await readJson<unknown>(KEYS.activity, [])).slice(0, 100)
}

export async function saveActivity(activity: ActivityEntry[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.activity, JSON.stringify(activity.slice(0, 100)))
}

export async function loadSyncState(): Promise<SyncState> {
  const value = await readJson<Partial<SyncState>>(KEYS.sync, EMPTY_SYNC_STATE)
  return {
    ...EMPTY_SYNC_STATE,
    ...value,
    tombstones: asArray(value.tombstones),
    outbox: asArray(value.outbox),
    consecutiveFailures: typeof value.consecutiveFailures === 'number'
      ? Math.max(0, value.consecutiveFailures)
      : 0
  }
}

export async function saveSyncState(sync: SyncState): Promise<void> {
  await AsyncStorage.setItem(KEYS.sync, JSON.stringify({
    ...sync,
    tombstones: retainLocalTombstones(sync.tombstones, [], sync.lastSyncAt, sync.outbox),
    outbox: sync.outbox.slice(-5_000)
  }))
}

export async function loadDraft(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(KEYS.draft)) || ''
  } catch {
    return ''
  }
}

export async function saveDraft(draft: string): Promise<void> {
  if (draft) await AsyncStorage.setItem(KEYS.draft, draft.slice(0, 20_000))
  else await AsyncStorage.removeItem(KEYS.draft)
}

export async function loadLocalData(): Promise<LocalData> {
  const [messages, memories, operations, activity, sync] = await Promise.all([
    loadChat(), loadMemories(), loadOperations(), loadActivity(), loadSyncState()
  ])
  return { messages, memories, operations, activity, sync }
}

export async function saveLocalData(data: LocalData): Promise<void> {
  const retainedTombstones = retainLocalTombstones(
    data.sync.tombstones,
    [],
    data.sync.lastSyncAt,
    data.sync.outbox
  )
  await AsyncStorage.multiSet([
    [KEYS.chat, JSON.stringify(compactChatImagesForStorage(data.messages.slice(-300)))],
    [KEYS.memories, JSON.stringify(data.memories.slice(0, 5_000))],
    [KEYS.operations, JSON.stringify(data.operations)],
    [KEYS.activity, JSON.stringify(data.activity.slice(0, 100))],
    [KEYS.sync, JSON.stringify({ ...data.sync, tombstones: retainedTombstones, outbox: data.sync.outbox.slice(-5_000) })]
  ])
  await AsyncStorage.multiRemove([LEGACY_KEYS.chat, LEGACY_KEYS.memories])
}

export function upsertLocalMemory(
  memories: MemoryFact[],
  fact: Omit<MemoryFact, 'createdAt' | 'updatedAt'> & { createdAt?: number; updatedAt?: number }
): MemoryFact[] {
  const now = Date.now()
  const next = [...memories]
  const idx = next.findIndex((memory) => memory.id === fact.id)
  const row: MemoryFact = {
    ...fact,
    id: fact.id,
    content: fact.content.trim(),
    category: fact.category || 'general',
    source: fact.source || 'phone',
    confidence: fact.confidence ?? 1,
    createdAt: fact.createdAt ?? now,
    updatedAt: fact.updatedAt ?? now
  }
  if (idx >= 0) next[idx] = { ...next[idx], ...row, createdAt: next[idx]!.createdAt }
  else next.unshift(row)
  return next.sort((a, b) => b.updatedAt - a.updatedAt)
}
