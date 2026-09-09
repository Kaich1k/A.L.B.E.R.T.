import type { PersonalityScales } from './personality'
export type { PersonalityScales, PersonalityKey } from './personality'
export { DEFAULT_PERSONALITY, PERSONALITY_META } from './personality'

export type VoiceState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking'

export type PanelId = 'home' | 'conversation' | 'missions' | 'memory' | 'activity' | 'settings'

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
  /** Optional stable id supplied by the phone companion for idempotent sync. */
  userMessageId?: string
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
  source?: string
  confidence?: number
  lastUsedAt?: number
  expiresAt?: number
}

export interface ActivityEntry {
  id: string
  toolName: string
  args: Record<string, unknown>
  result: string
  ok: boolean
  createdAt: number
}

export type MissionState = 'draft' | 'queued' | 'active' | 'waiting' | 'approval' | 'blocked' | 'complete' | 'cancelled'
export type MissionPriority = 'low' | 'normal' | 'high' | 'critical'

export interface MissionStep {
  id: string
  missionId: string
  position: number
  title: string
  state: 'pending' | 'active' | 'approval' | 'complete' | 'failed' | 'skipped'
  toolName?: string
  toolArgs?: Record<string, unknown>
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

export type ApprovalKind = 'email' | 'diff' | 'purchase' | 'shell' | 'app' | 'file' | 'other'

export interface ApprovalRequest {
  id: string
  missionId?: string
  title: string
  description: string
  actionLabel: string
  risk: string
  preview?: string
  kind?: ApprovalKind
  state: 'pending' | 'approved' | 'declined' | 'expired'
  createdAt: number
  /** Last state transition; added for deterministic phone ↔ Mac reconciliation. */
  updatedAt?: number
  resolvedAt?: number
}

export interface CaptureItem {
  id: string
  content: string
  kind: 'note' | 'task' | 'idea' | 'url' | 'receipt' | 'reference'
  state: 'inbox' | 'filed' | 'archived'
  createdAt: number
  /** Last edit/state transition; older databases fall back to createdAt. */
  updatedAt?: number
}

export interface OperationsSnapshot {
  missions: Mission[]
  routines: Routine[]
  approvals: ApprovalRequest[]
  captures: CaptureItem[]
  generatedAt: number
}

export interface ContextCapsuleTab {
  title: string
  url: string
}

export interface ContextCapsule {
  id: string
  title: string
  notes: string
  panel: string
  missionId?: string
  missionTitle?: string
  projectFolder?: string
  tabs: ContextCapsuleTab[]
  apps: string[]
  createdAt: number
  lastRestoredAt?: number
}

export interface ProjectPulseChange {
  path: string
  status: string
}

export interface ProjectPulseCommit {
  hash: string
  subject: string
  date: string
}

export interface ProjectPulseBranch {
  name: string
  lastCommitAt: number
}

export interface ProjectPulseTodo {
  path: string
  line: number
  text: string
}

export interface ProjectPulse {
  projectFolder: string | null
  isGit: boolean
  branch: string | null
  aheadBehind?: string
  dirty: ProjectPulseChange[]
  recentCommits: ProjectPulseCommit[]
  staleBranches: ProjectPulseBranch[]
  todos: ProjectPulseTodo[]
  testFailures: Array<{ toolName: string; result: string; createdAt: number }>
  nextTask: string | null
  score: number | null
  generatedAt: number
  error?: string
}

export type MemoryKind = 'person' | 'project' | 'preference' | 'decision' | 'place' | 'general'

export interface MemoryGraphNode {
  id: string
  kind: MemoryKind
  label: string
  content: string
  source: string
  confidence: number
  category: string
  x: number
  y: number
}

export interface MemoryGraphEdge {
  from: string
  to: string
  reason: string
}

export interface MemoryGraph {
  nodes: MemoryGraphNode[]
  edges: MemoryGraphEdge[]
}

export interface MissionArtifact {
  id: string
  missionId?: string
  kind: string
  title: string
  body: string
  source: string
  version: number
  createdAt: number
}

export interface TheaterEvent {
  id: string
  toolName: string
  argsPreview: string
  resultPreview?: string
  ok?: boolean
  phase: 'start' | 'end'
  createdAt: number
}

export interface DailyBrief {
  generatedAt: number
  weather: string
  calendar: string[]
  missions: string[]
  overnight: string[]
  firstMove: string
  error?: string
}

export interface CursorAgentStatus {
  running: boolean
  pid: number | null
  workspace: string | null
  prompt: string
  log: string
  lastError: string | null
  startedAt: number | null
}

export interface HudSnapshot {
  voiceState: string
  busy: boolean
  missionTitle: string | null
  nextStep: string | null
  focusRemaining: number
  theaterCount: number
  roam: boolean
  /** True when the floating HUD is hidden and the Comm berth owns the orb. */
  docked: boolean
}

export type RoutingMode = 'auto' | 'local' | 'fast' | 'power' | 'codex'

export type ModelTier = 'local' | 'fast' | 'power' | 'codex'

/** How Codex command/file-write approvals are handled. */
export type CodexApprovalMode = 'project' | 'always' | 'never'

export interface CodexPlanStepView {
  step: string
  status: string
}

export interface CodexAllowance {
  /** Percent of the ChatGPT allowance still available, when Codex reports it. */
  remainingPercent: number | null
  /** Short human sentence for the HUD, e.g. "82% allowance left · resets in 3h". */
  label: string
  planType: string | null
  updatedAt: number
}

export interface CodexStatus {
  /** `codex` CLI found on this Mac. */
  installed: boolean
  version: string | null
  /** app-server handshake completed. */
  connected: boolean
  signedIn: boolean
  authMode: 'chatgpt' | 'apiKey' | 'bedrock' | null
  email: string | null
  planType: string | null
  model: string | null
  escalationModel: string | null
  effort: string
  availableModels: Array<{ id: string; displayName: string; efforts: string[] }>
  threadId: string | null
  allowance: CodexAllowance | null
  lastError: string | null
  /** Populated when the CLI is missing so the UI can tell Kai what to run. */
  installHint: string | null
}

export type OllamaEndpointMode = 'auto' | 'cloud' | 'local'

/** Which backend powers the internal QUICK tier (legacy key remains `local`) */
export type LocalProvider = 'ollama' | 'groq' | 'gemini'

export interface AlbertSettings {
  /** Anthropic API key — primary brain (Claude) */
  anthropicApiKey: string
  /** Optional OpenAI key — memory embeddings */
  openaiApiKey: string
  /** Ollama Cloud API key (ollama.com) — QUICK tier */
  ollamaApiKey: string
  /** Groq API key — alternate QUICK provider (fast free cloud tier) */
  groqApiKey: string
  /** Google AI Studio / Gemini API key — free-tier QUICK provider */
  geminiApiKey: string
  /** @deprecated migrated into openaiApiKey */
  apiKey?: string
  /** @deprecated use powerModel */
  model: string
  /** Local / Ollama model for basic chat */
  localModel: string
  /** Groq model id when localProvider is groq */
  groqModel: string
  /** Gemini model id when localProvider is gemini */
  geminiModel: string
  /** Cheap/fast model for light-complex work (Haiku) */
  fastModel: string
  /** Strong model for hard tasks (Opus) */
  powerModel: string
  /** auto routes per message; local/fast/power force one tier */
  routingMode: RoutingMode
  /** ollama / groq / gemini — all live in the QUICK tier */
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
  /**
   * 0–100 mic sensitivity. Thresholds are computed relative to the rolling room
   * noise floor; this shifts the margin above it. Lower = ignores more noise.
   */
  micSensitivity: number
  /** Always listen for “wake up” / “hey albert” to start voice mode */
  wakeWordEnabled: boolean
  /** Skip heavy HUD animations (default on — saves GPU) */
  performanceMode: boolean
  /** Play the cinematic system initialization overlay once per app session. */
  startupAnimationEnabled: boolean
  /** Visual information density for ambient HUD elements. */
  hudDensity: 'minimal' | 'balanced' | 'cinematic'
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
  /** Route engineering work to Codex over the app-server protocol */
  codexEnabled: boolean
  /** Everyday Codex model; empty means "let discovery pick" */
  codexModel: string
  /** Reserved for hard work — costs more allowance */
  codexEscalationModel: string
  /** Reasoning effort: minimal / low / medium / high (model-dependent) */
  codexEffort: string
  /** Persisted so Codex context survives an app restart */
  codexThreadId: string
  /**
   * project = auto-accept inside projectFolder only; always = prompt every time;
   * never = auto-accept anywhere (dangerous, opt-in).
   */
  codexApprovalMode: CodexApprovalMode
  /**
   * Allow paid Anthropic (Haiku/Opus) to cover for Codex failures.
   * Off by default so a Codex outage never quietly spends money.
   */
  paidFallbackEnabled: boolean
  /**
   * Quietly store lasting facts Kai mentions (preferences, identity, projects).
   * One-off tasks and secrets are ignored.
   */
  autoRememberEnabled: boolean
  /** Cursor user API key for `agent` CLI dispatches (same agent as the IDE). */
  cursorApiKey: string
  /** Show the always-on-top speech orb. */
  ambientHudEnabled: boolean
  /** Desktop HUD drifts on its own until dragged. */
  ambientHudRoam: boolean
  /** One-shot: speech orb is now the desktop voice cursor. */
  speechOrbDesktop?: boolean
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
    | 'chat_synced'
    | 'settings'
    /** Codex reasoning/progress line — visual only, never spoken. */
    | 'codex_progress'
    | 'codex_plan'
    | 'codex_diff'
    | 'codex_status'
    | 'pause_speech'
    | 'theater'
    | 'cursor_progress'
    | 'hud_docked'
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
  settings?: AlbertSettings
  /** codex_plan */
  plan?: CodexPlanStepView[]
  /** codex_diff */
  diff?: string
  /** codex_status */
  codex?: CodexStatus
  /** Cursor local-agent progress (visual only). */
  cursorLog?: string
  /** Command theater tick. */
  theater?: TheaterEvent
  /** Floating HUD was parked in / released from the Comm berth. */
  docked?: boolean
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
export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-20b'
/** Free-tier friendly default from Google AI Studio / Gemini API. */
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'

export const DEFAULT_SETTINGS: AlbertSettings = {
  anthropicApiKey: '',
  openaiApiKey: '',
  ollamaApiKey: '',
  groqApiKey: '',
  geminiApiKey: '',
  model: 'claude-opus-5',
  localModel: 'qwen3.5:4b',
  groqModel: DEFAULT_GROQ_MODEL,
  geminiModel: DEFAULT_GEMINI_MODEL,
  fastModel: 'claude-haiku-4-5',
  powerModel: 'claude-opus-5',
  routingMode: 'codex',
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
  micSensitivity: 50,
  wakeWordEnabled: true,
  performanceMode: true,
  startupAnimationEnabled: true,
  hudDensity: 'cinematic',
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
  companionToken: '',
  codexEnabled: true,
  codexModel: '',
  codexEscalationModel: '',
  codexEffort: 'medium',
  codexThreadId: '',
  codexApprovalMode: 'project',
  paidFallbackEnabled: false,
  autoRememberEnabled: true,
  cursorApiKey: '',
  ambientHudEnabled: true,
  ambientHudRoam: true,
  speechOrbDesktop: true
}
