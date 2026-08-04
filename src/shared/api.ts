import type {
  ActivityEntry,
  AgentStreamEvent,
  AlbertSettings,
  ChatMessage,
  ChatSendPayload,
  ComputerState,
  ComputerTab,
  MemoryFact,
  RealtimeSessionConfig
} from './types'

export interface AlbertApi {
  getSettings: () => Promise<AlbertSettings>
  setSettings: (partial: Partial<AlbertSettings>) => Promise<AlbertSettings>
  getChatHistory: () => Promise<ChatMessage[]>
  clearChat: () => Promise<boolean>
  appendChat: (role: 'user' | 'assistant', content: string) => Promise<ChatMessage>
  /** Text or `{ text, images }` — images are base64 payloads from Comm. */
  sendChat: (payload: string | ChatSendPayload) => Promise<ChatMessage>
  getChatImageDataUrl: (fileName: string) => Promise<string | null>
  onChatEvent: (handler: (event: AgentStreamEvent) => void) => () => void
  listMemories: () => Promise<MemoryFact[]>
  deleteMemory: (id: string) => Promise<boolean>
  updateMemory: (
    id: string,
    content: string,
    category?: string
  ) => Promise<MemoryFact | null>
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
  }>
  applyCompanion: () => Promise<{
    running: boolean
    port: number | null
    token: string
    urls: string[]
  }>
  rotateCompanionToken: () => Promise<{
    running: boolean
    port: number | null
    token: string
    urls: string[]
  }>
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
  probeGroq: () => Promise<{ ok: boolean; mode: 'cloud'; detail: string }>
}
