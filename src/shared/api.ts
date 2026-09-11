import type {
  ActivityEntry,
  AgentStreamEvent,
  AlbertSettings,
  ChatImagePayload,
  ChatMessage,
  ChatSendPayload,
  ComputerState,
  ComputerTab,
  MemoryFact,
  Mission,
  MissionPriority,
  MissionStep,
  OperationsSnapshot,
  Routine,
  ApprovalRequest,
  CaptureItem,
  CodexAllowance,
  CodexStatus,
  ContextCapsule,
  CursorAgentStatus,
  DailyBrief,
  HudSnapshot,
  MissionArtifact,
  ProjectPulse,
  TheaterEvent,
  RealtimeSessionConfig,
  VoiceState
} from './types'

export interface ChatGptImportScan {
  foundMemoryJson: boolean
  foundConversationsJson: boolean
  /** Enabled saved memories present in the export. */
  totalMemories: number
  /** Saved memories switched off in ChatGPT — skipped on purpose. */
  disabledMemories: number
  /** Durable-looking facts distilled from transcripts. */
  totalHistory: number
  conversationsSeen: number
  messagesScanned: number
  /** Counts after removing anything already in memory. */
  newMemories: number
  newHistory: number
  warnings: string[]
}

export interface ChatGptImportResult {
  importedMemories: number
  importedHistory: number
  skippedDuplicates: number
  failed: number
  warnings: string[]
}

export interface AlbertApi {
  getSettings: () => Promise<AlbertSettings>
  setSettings: (partial: Partial<AlbertSettings>) => Promise<AlbertSettings>
  getChatHistory: () => Promise<ChatMessage[]>
  clearChat: () => Promise<boolean>
  appendChat: (role: 'user' | 'assistant', content: string) => Promise<ChatMessage>
  /** Text or `{ text, images }` — images are base64 payloads from Comm. */
  sendChat: (payload: string | ChatSendPayload) => Promise<ChatMessage>
  getChatImageDataUrl: (fileName: string) => Promise<string | null>
  readClipboardImage: () => Promise<ChatImagePayload | null>
  onChatEvent: (handler: (event: AgentStreamEvent) => void) => () => void
  listMemories: () => Promise<MemoryFact[]>
  deleteMemory: (id: string) => Promise<boolean>
  updateMemory: (
    id: string,
    content: string,
    category?: string
  ) => Promise<MemoryFact | null>
  onMemoryChanged: (handler: () => void) => () => void
  listActivity: () => Promise<ActivityEntry[]>
  clearActivity: () => Promise<boolean>
  createRealtimeSession: () => Promise<RealtimeSessionConfig>
  executeTool: (
    name: string,
    args: Record<string, unknown>,
    confirmed?: boolean
  ) => Promise<{ ok: boolean; result: string }>
  warmVoice: () => Promise<boolean>
  transcribeAudio: (
    samples: Float32Array | number[],
    opts?: { prompt?: string }
  ) => Promise<string>
  getCompanionStatus: () => Promise<{
    running: boolean
    port: number | null
    token: string
    urls: string[]
    protocolVersion: number
    devices: Array<{ id: string; name: string; scopes: string[]; createdAt: number; lastSeenAt: number; revokedAt?: number }>
  }>
  applyCompanion: () => Promise<{
    running: boolean
    port: number | null
    token: string
    urls: string[]
    protocolVersion: number
    devices: Array<{ id: string; name: string; scopes: string[]; createdAt: number; lastSeenAt: number; revokedAt?: number }>
  }>
  rotateCompanionToken: () => Promise<{
    running: boolean
    port: number | null
    token: string
    urls: string[]
    protocolVersion: number
    devices: Array<{ id: string; name: string; scopes: string[]; createdAt: number; lastSeenAt: number; revokedAt?: number }>
  }>
  revokeCompanionDevice: (deviceId: string) => Promise<boolean>
  speakElevenLabs: (
    text: string,
    overrides?: { apiKey?: string; voiceId?: string }
  ) => Promise<string>
  speakKokoro: (text: string, overrides?: { voiceId?: string }) => Promise<string>
  warmKokoro: () => Promise<boolean>
  onKokoroProgress: (
    handler: (payload: {
      status: string
      file?: string
      progress?: number
      message?: string
    }) => void
  ) => () => void
  getComputerState: () => Promise<ComputerState>
  showComputer: () => Promise<ComputerState>
  openComputerTab: (url: string, title?: string) => Promise<ComputerTab>
  navigateComputerTab: (url: string, tabId?: string) => Promise<ComputerTab | null>
  focusComputerTab: (tabId: string) => Promise<boolean>
  closeComputerTab: (tabId: string) => Promise<boolean>
  updateComputerTab: (
    tabId: string,
    patch: Partial<Pick<ComputerTab, 'title' | 'url' | 'loading' | 'lastError'>>
  ) => Promise<ComputerState>
  onComputerChanged: (handler: (state: ComputerState) => void) => () => void
  onComputerGetPage: (
    handler: (payload: { requestId: string; tabId: string }) => void
  ) => () => void
  replyComputerGetPage: (
    payload:
      | { requestId: string; ok: true; title: string; url: string; text: string }
      | { requestId: string; ok: false; error: string }
  ) => void
  hideWindow: () => Promise<boolean>
  showWindow: () => Promise<boolean>
  toggleWindow: () => Promise<boolean>
  openPrivacyPane: (
    pane: 'accessibility' | 'screen' | 'automation' | 'microphone'
  ) => Promise<boolean>
  probeOllama: () => Promise<{ ok: boolean; mode: 'cloud' | 'local'; detail: string }>
  pullOllamaModel: (model?: string) => Promise<{ ok: boolean; detail: string }>
  probeGroq: () => Promise<{ ok: boolean; mode: 'cloud'; detail: string }>
  probeGemini: () => Promise<{ ok: boolean; mode: 'cloud'; detail: string }>
  getOperations: () => Promise<OperationsSnapshot>
  createMission: (input: { title: string; outcome?: string; priority?: MissionPriority; deadline?: number; risk?: Mission['risk']; steps?: string[] }) => Promise<Mission>
  updateMission: (id: string, patch: Partial<Mission>) => Promise<Mission | null>
  deleteMission: (id: string) => Promise<boolean>
  addMissionStep: (missionId: string, title: string) => Promise<MissionStep>
  updateMissionStep: (id: string, patch: Partial<MissionStep>) => Promise<MissionStep | null>
  createRoutine: (input: { name: string; prompt: string; schedule: string; enabled?: boolean }) => Promise<Routine>
  updateRoutine: (id: string, patch: Partial<Routine>) => Promise<Routine | null>
  deleteRoutine: (id: string) => Promise<boolean>
  resolveApproval: (id: string, resolution: 'approved' | 'declined') => Promise<ApprovalRequest | null>
  createCapture: (content: string, kind?: CaptureItem['kind']) => Promise<CaptureItem>
  updateCapture: (id: string, state: CaptureItem['state']) => Promise<CaptureItem | null>
  onOperationsChanged: (handler: () => void) => () => void

  /** Codex engineering brain */
  getCodexStatus: () => Promise<CodexStatus>
  connectCodex: () => Promise<CodexStatus>
  loginCodex: () => Promise<{ authUrl: string | null; error?: string }>
  cancelCodexLogin: () => Promise<void>
  logoutCodex: () => Promise<CodexStatus>
  refreshCodexAllowance: () => Promise<CodexAllowance | null>
  interruptCodex: () => Promise<boolean>
  newCodexThread: () => Promise<CodexStatus>

  /** One-time ChatGPT export import (no memory API exists) */
  pickChatGptExport: () => Promise<string | null>
  scanChatGptExport: (path: string) => Promise<ChatGptImportScan>
  runChatGptImport: (
    path: string,
    includeHistory?: boolean
  ) => Promise<ChatGptImportResult>

  listCapsules: () => Promise<ContextCapsule[]>
  saveCapsule: (input?: { title?: string; notes?: string; panel?: string; missionId?: string }) => Promise<ContextCapsule>
  restoreCapsule: (idOrQuery: string) => Promise<{ capsule: ContextCapsule | null; reply: string }>
  deleteCapsule: (id: string) => Promise<boolean>
  importCapsules: (raw: unknown) => Promise<ContextCapsule[]>
  onCapsulesChanged: (handler: () => void) => () => void
  onCapsuleRestored: (handler: (capsule: ContextCapsule) => void) => () => void
  getProjectPulse: (force?: boolean) => Promise<ProjectPulse>
  getDailyBrief: (force?: boolean) => Promise<DailyBrief>
  listArtifacts: () => Promise<MissionArtifact[]>
  saveArtifact: (input: { title: string; body: string; kind?: string; missionId?: string }) => Promise<MissionArtifact>
  listTheater: () => Promise<TheaterEvent[]>
  getHudSnapshot: () => Promise<HudSnapshot>
  getCursorAgentStatus: () => Promise<CursorAgentStatus>
  runCursorAgent: (prompt: string, workspace?: string) => Promise<{ ok: boolean; result: string }>
  openInCursor: (workspace?: string) => Promise<{ ok: boolean; result: string }>
  interruptCursorAgent: () => Promise<boolean>
  setAmbientHud: (enabled: boolean) => Promise<boolean>
  hudDrag: (payload: {
    phase: 'start' | 'move' | 'end'
    screenX: number
    screenY: number
  }) => Promise<void>
  setHudRoam: (enabled: boolean) => Promise<boolean>
  dockHud: (slot?: {
    x: number
    y: number
    width: number
    height: number
    park?: boolean
  } | null) => Promise<void>
  undockHud: () => Promise<void>
  reportHudRuntime: (state: { voiceState?: VoiceState; busy?: boolean; tool?: string }) => Promise<void>
  setHudClickThrough: (ignore: boolean) => Promise<void>
  toggleVoice: () => Promise<void>
}
