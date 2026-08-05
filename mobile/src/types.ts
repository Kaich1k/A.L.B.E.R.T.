export interface MemoryFact {
  id: string
  content: string
  category: string
  source?: string
  confidence?: number
  lastUsedAt?: number
  expiresAt?: number
  createdAt: number
  updatedAt: number
}

export type MessageDelivery = 'local' | 'pending' | 'synced' | 'failed'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  provider?: 'anthropic' | 'groq' | 'offline' | 'mac'
  model?: string
  origin?: 'phone' | 'mac'
  delivery?: MessageDelivery
  error?: string
}

export type LlmProvider = 'auto' | 'anthropic' | 'groq'

export interface CompanionConfig {
  provider: LlmProvider
  anthropicApiKey: string
  groqApiKey: string
  model: string
  macBaseUrl: string
  /** Bootstrap pairing token copied from the Mac; cleared on the phone after enrollment. */
  macToken: string
  /** Revocable per-device v2 credential; always stored in SecureStore. */
  macCredential: string
  deviceId: string
  deviceName: string
  autoSync: boolean
  speakReplies: boolean
  voiceRate: number
  wakeOnLaunch: boolean
  reducedMotion: boolean
}

export type TabId = 'home' | 'chat' | 'operations' | 'memory' | 'systems'

export type VoicePhase =
  | 'standby'
  | 'permission'
  | 'arming'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'fault'

export type MacLinkState =
  | 'unconfigured'
  | 'checking'
  | 'enrolling'
  | 'authenticated'
  | 'syncing'
  | 'offline'
  | 'auth-failed'
  | 'fault'

export type MissionState =
  | 'draft'
  | 'queued'
  | 'active'
  | 'waiting'
  | 'approval'
  | 'blocked'
  | 'complete'
  | 'cancelled'
export type MissionPriority = 'low' | 'normal' | 'high' | 'critical'

export interface MissionStep {
  id: string
  missionId: string
  position: number
  title: string
  state: 'pending' | 'active' | 'approval' | 'complete' | 'failed' | 'skipped'
  result?: string
  verification?: string
  createdAt: number
  updatedAt: number
}

export interface Mission {
  id: string
  title: string
  outcome: string
  state: MissionState
  priority: MissionPriority
  progress: number
  deadline?: number
  budgetCents?: number
  risk: 'observe' | 'prepare' | 'approve' | 'restricted'
  source: 'user' | 'chat' | 'routine' | 'system'
  createdAt: number
  updatedAt: number
  steps: MissionStep[]
}

export interface Routine {
  id: string
  name: string
  prompt: string
  schedule: string
  enabled: boolean
  quietStart?: string
  quietEnd?: string
  lastRunAt?: number
  nextRunAt?: number
  createdAt: number
  updatedAt: number
}

export interface ApprovalRequest {
  id: string
  missionId?: string
  title: string
  description: string
  actionLabel: string
  risk: string
  preview?: string
  state: 'pending' | 'approved' | 'declined' | 'expired'
  createdAt: number
  updatedAt?: number
  resolvedAt?: number
}

export interface CaptureItem {
  id: string
  content: string
  kind: 'note' | 'task' | 'idea' | 'url' | 'receipt' | 'reference'
  state: 'inbox' | 'filed' | 'archived'
  createdAt: number
  updatedAt?: number
}

export interface OperationsSnapshot {
  missions: Mission[]
  routines: Routine[]
  approvals: ApprovalRequest[]
  captures: CaptureItem[]
  generatedAt: number
}

export interface ActivityEntry {
  id: string
  toolName: string
  args: Record<string, unknown>
  result: string
  ok: boolean
  createdAt: number
}

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

export interface PendingMutation {
  id: string
  entityType: SyncEntityType | 'sync'
  entityId: string
  action: 'upsert' | 'delete' | 'clear' | 'resolve'
  createdAt: number
}

export interface SyncState {
  tombstones: SyncTombstone[]
  outbox: PendingMutation[]
  lastAttemptAt?: number
  lastSyncAt?: number
  consecutiveFailures: number
  lastError?: string
  remoteName?: string
  protocolVersion?: number
}

export interface LocalData {
  messages: ChatMessage[]
  memories: MemoryFact[]
  operations: OperationsSnapshot
  activity: ActivityEntry[]
  sync: SyncState
}

export const EMPTY_OPERATIONS: OperationsSnapshot = {
  missions: [],
  routines: [],
  approvals: [],
  captures: [],
  generatedAt: 0
}

export const EMPTY_SYNC_STATE: SyncState = {
  tombstones: [],
  outbox: [],
  consecutiveFailures: 0
}
