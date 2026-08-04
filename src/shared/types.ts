import type { PersonalityScales } from './personality'
export type { PersonalityScales, PersonalityKey } from './personality'
export { DEFAULT_PERSONALITY, PERSONALITY_META } from './personality'

export type VoiceState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking'

export type PanelId = 'home' | 'conversation' | 'memory' | 'activity' | 'settings'

export type TtsProvider = 'system' | 'kokoro' | 'elevenlabs'

export interface ComputerTab {
  id: string
  title: string
  url: string
  loading: boolean
  lastError?: string
}

export interface ComputerState {
  tabs: ComputerTab[]
  activeTabId: string | null
}

export type ChatImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

/** Image sent from the renderer (base64, no data: prefix). */
export interface ChatImagePayload {
  mediaType: ChatImageMediaType
  data: string
}

/** Stored / displayed chat image reference. */
export interface ChatImageRef {
  id: string
  mediaType: ChatImageMediaType
  /** Filename under albert-data/chat-images/ */
  fileName: string
  /** data URL for UI when freshly sent or after fetch */
  dataUrl?: string
}

export interface ChatSendPayload {
  text: string
  images?: ChatImagePayload[]
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  createdAt: number
  toolName?: string
  toolCallId?: string
  images?: ChatImageRef[]
}

export interface MemoryFact {
  id: string
  content: string
  category: string
  createdAt: number
  updatedAt: number
  score?: number
}

export interface ActivityEntry {
  id: string
  toolName: string
  args: Record<string, unknown>
  result: string
  ok: boolean
  createdAt: number
}

export type RoutingMode = 'auto' | 'local' | 'fast' | 'power'

export type ModelTier = 'local' | 'fast' | 'power'

export type OllamaEndpointMode = 'auto' | 'cloud' | 'local'

/** Which backend powers the LOCAL brain tier */
export type LocalProvider = 'ollama' | 'groq'

export interface AlbertSettings {
  /** Anthropic API key — primary brain (Claude) */
  anthropicApiKey: string
  /** Optional OpenAI key — memory embeddings */
  openaiApiKey: string
  /** Ollama Cloud API key (ollama.com) — local/cheap tier */
  ollamaApiKey: string
  /** Groq API key — alternate LOCAL provider (fast free tier) */
  groqApiKey: string
  /** @deprecated migrated into openaiApiKey */
  apiKey?: string
  /** @deprecated use powerModel */
  model: string
  /** Local / Ollama model for basic chat */
  localModel: string
  /** Groq model id when localProvider is groq */
  groqModel: string
  /** Cheap/fast model for light-complex work (Haiku) */
  fastModel: string
  /** Strong model for hard tasks (Opus) */
  powerModel: string
  /** auto routes per message; local/fast/power force one tier */
  routingMode: RoutingMode
  /** ollama = current LOCAL stack; groq = Groq Cloud as LOCAL */
  localProvider: LocalProvider
  /** Prefer Ollama cloud, local daemon, or auto */
  ollamaEndpoint: OllamaEndpointMode
  ollamaCloudBase: string
  ollamaLocalBase: string
  /** Personality dials 0–100 */
  personality: PersonalityScales
  realtimeModel: string
  /** @deprecated OpenAI realtime voice id */
  voice: string
  /** macOS / system TTS voice name (SpeechSynthesisVoice.name) */
  ttsVoice: string
  /** 0.5–2.0, default ~1.1 */
  ttsRate: number
  /** 0–2, default 1 */
  ttsPitch: number
  /**
   * Strip .!?/, before TTS. Helps macOS system speech (avoids long pauses).
   * Often better left OFF for Kokoro / ElevenLabs.
   */
  ttsStripPunctuation: boolean
  /** Cancel A.L.B.E.R.T.'s speech when you start talking */
  allowBargeIn: boolean
  /** Always listen for “wake up” / “hey albert” to start voice mode */
  wakeWordEnabled: boolean
  /** Skip heavy HUD animations (default on — saves GPU) */
  performanceMode: boolean
  /** system = macOS; kokoro = free local neural; elevenlabs = cloud */
  ttsProvider: TtsProvider
  /** Kokoro voice id (e.g. am_michael) */
  kokoroVoiceId: string
  elevenLabsApiKey: string
  elevenLabsVoiceId: string
  projectFolder: string
  confirmDangerousTools: boolean
  /**
   * Unlock broader shell/FS under the home directory (still confirms dangerous tools).
   * Off by default — project jail + allowlisted commands.
   */
  godMode: boolean
  /** Extra absolute paths Albert may read/write when god mode is off (in addition to defaults). */
  allowedFsRoots: string[]
  /** Expose LAN companion API for phone sync */
  companionEnabled: boolean
  /** TCP port for companion server */
  companionPort: number
  /** Bearer token phones must send */
  companionToken: string
}

export interface AgentStreamEvent {
  type:
    | 'token'
    | 'tool_start'
    | 'tool_end'
    | 'done'
    | 'error'
    | 'message'
    | 'route'
    | 'standby'
    | 'chat_cleared'
  content?: string
  message?: ChatMessage
  toolName?: string
  toolArgs?: Record<string, unknown>
  toolResult?: string
  ok?: boolean
  error?: string
  model?: string
  tier?: ModelTier
  reason?: string
}

export interface RealtimeSessionConfig {
  clientSecret: string
  model: string
  voice: string
  instructions: string
  tools: RealtimeToolDefinition[]
}

export interface RealtimeToolDefinition {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
}

export const CLAUDE_DASHBOARD_URL = 'https://platform.claude.com/dashboard'

export const DEFAULT_SETTINGS: AlbertSettings = {
  anthropicApiKey: '',
  openaiApiKey: '',
  ollamaApiKey: '',
  groqApiKey: '',
  model: 'claude-opus-5',
  localModel: 'llama3.2',
  groqModel: 'llama-3.1-8b-instant',
  fastModel: 'claude-haiku-4-5',
  powerModel: 'claude-opus-5',
  routingMode: 'auto',
  localProvider: 'ollama',
  ollamaEndpoint: 'auto',
  ollamaCloudBase: 'https://ollama.com',
  ollamaLocalBase: 'http://127.0.0.1:11434',
  personality: {
    sarcasm: 82,
    warmth: 82,
    verbosity: 35
  },
  realtimeModel: 'gpt-realtime',
  voice: 'marin',
  ttsVoice: '',
  ttsRate: 1.22,
  ttsPitch: 1,
  ttsStripPunctuation: true,
  allowBargeIn: true,
  wakeWordEnabled: true,
  performanceMode: true,
  ttsProvider: 'kokoro',
  kokoroVoiceId: 'am_michael',
  elevenLabsApiKey: '',
  elevenLabsVoiceId: '',
  projectFolder: '',
  confirmDangerousTools: false,
  godMode: false,
  allowedFsRoots: [],
  companionEnabled: false,
  companionPort: 47831,
  companionToken: ''
}
