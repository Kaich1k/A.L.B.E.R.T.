import { getSettings, setSettings } from '../config'
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GROQ_MODEL,
  DEFAULT_SETTINGS,
  type LocalProvider,
  type ModelTier,
  type RoutingMode
} from '../../shared/types'

const POWER_HINTS =
  /\b(opus|think hard|be thorough|deep dive|architect|refactor|implement|debug|troubleshoot|analyse|analyze|design system|codebase|pull request|\bpr\b|unit test|typeerror|stack trace|optimize|migrate|rewrite|complex|multi[- ]step|step by step|plan out|from scratch|self-?edit|god mode)\b/i

const EXPLICIT_POWER =
  /\b(use opus|switch to opus|opus mode|full power|max intelligence|power mode)\b/i
const EXPLICIT_FAST =
  /\b(use haiku|switch to haiku|haiku mode|mid mode)\b/i
const EXPLICIT_CODEX =
  /\b(use codex|switch to codex|codex mode|engineering mode|use (chat ?gpt|gpt-?5|gpt-?6)|switch to (chat ?gpt|gpt-?5|gpt-?6))\b/i
const EXPLICIT_LOCAL =
  /\b(use (ollama|local|groq|gemini|google|quick)|switch to (ollama|local|groq|gemini|google|quick)|local mode|quick mode|ollama mode|groq mode|gemini mode|google mode|cheap mode|keep it (cheap|local|quick))\b/i
const EXPLICIT_AUTO = /\b(auto mode|auto routing|unlock routing)\b/i
const EXPLICIT_GROQ_PROVIDER = /\b(use groq|switch to groq|groq mode)\b/i
const EXPLICIT_GEMINI_PROVIDER =
  /\b(use (gemini|google( ai)?( studio)?)|switch to (gemini|google)|gemini mode|google mode)\b/i
const EXPLICIT_OLLAMA_PROVIDER = /\b(use ollama|switch to ollama|ollama mode)\b/i

function quickLabel(provider: LocalProvider): string {
  if (provider === 'groq') return 'Groq Cloud (QUICK)'
  if (provider === 'gemini') return 'Gemini / Google AI Studio (QUICK)'
  return 'Ollama (QUICK)'
}

function resolveLocalRoute(locked: boolean): {
  tier: 'local'
  model: string
  reason: string
  provider: LocalProvider
} {
  const settings = getSettings()
  const provider: LocalProvider =
    settings.localProvider === 'groq'
      ? 'groq'
      : settings.localProvider === 'gemini'
        ? 'gemini'
        : 'ollama'
  if (provider === 'groq') {
    return {
      tier: 'local',
      model: settings.groqModel || DEFAULT_GROQ_MODEL,
      provider: 'groq',
      reason: locked ? `Locked to ${quickLabel(provider)}` : `Routing locked to ${quickLabel(provider)}`
    }
  }
  if (provider === 'gemini') {
    return {
      tier: 'local',
      model: settings.geminiModel || DEFAULT_GEMINI_MODEL,
      provider: 'gemini',
      reason: locked ? `Locked to ${quickLabel(provider)}` : `Routing locked to ${quickLabel(provider)}`
    }
  }
  return {
    tier: 'local',
    model: settings.localModel || DEFAULT_SETTINGS.localModel,
    provider: 'ollama',
    reason: locked ? `Locked to ${quickLabel(provider)}` : `Routing locked to ${quickLabel(provider)}`
  }
}

/** If the user asked to lock a tier, persist routingMode so UI stays in sync. */
export function applyExplicitRoutingLock(userText: string): RoutingMode | null {
  const text = userText.trim()
  if (EXPLICIT_AUTO.test(text) || EXPLICIT_CODEX.test(text)) {
    setSettings({ routingMode: 'codex' })
    return 'codex'
  }
  if (EXPLICIT_POWER.test(text)) {
    setSettings({ routingMode: 'power' })
    return 'power'
  }
  if (EXPLICIT_FAST.test(text)) {
    setSettings({ routingMode: 'fast' })
    return 'fast'
  }
  if (EXPLICIT_GROQ_PROVIDER.test(text)) {
    setSettings({ routingMode: 'local', localProvider: 'groq' })
    return 'local'
  }
  if (EXPLICIT_GEMINI_PROVIDER.test(text)) {
    setSettings({ routingMode: 'local', localProvider: 'gemini' })
    return 'local'
  }
  if (EXPLICIT_OLLAMA_PROVIDER.test(text)) {
    setSettings({ routingMode: 'local', localProvider: 'ollama' })
    return 'local'
  }
  if (EXPLICIT_LOCAL.test(text)) {
    setSettings({ routingMode: 'local' })
    return 'local'
  }
  return null
}

export interface ModelRoute {
  tier: ModelTier
  model: string
  reason: string
  provider: LocalProvider | 'anthropic' | 'codex'
  /** Codex only: use the escalation model rather than the everyday one. */
  escalate?: boolean
}

export function selectModelTier(
  userText: string,
  _opts?: { hasImages?: boolean }
): ModelRoute {
  const locked = applyExplicitRoutingLock(userText)
  const settings = getSettings()
  const mode: RoutingMode = settings.routingMode || 'codex'
  const fastModel = settings.fastModel || 'claude-haiku-4-5'
  const powerModel = settings.powerModel || settings.model || 'claude-opus-5'
  const text = userText.trim()
  const codexOn = settings.codexEnabled !== false

  const chatgptRoute = (reason: string, escalate = false): ModelRoute => ({
    tier: 'codex',
    model: (escalate ? settings.codexEscalationModel : settings.codexModel) || 'codex',
    provider: 'codex',
    reason,
    escalate
  })

  if (mode === 'power') {
    return {
      tier: 'power',
      model: powerModel,
      provider: 'anthropic',
      reason: locked === 'power' ? 'Locked to Opus' : 'Routing locked to Opus'
    }
  }
  if (mode === 'fast') {
    return {
      tier: 'fast',
      model: fastModel,
      provider: 'anthropic',
      reason: locked === 'fast' ? 'Locked to Opus family' : 'Routing locked to Haiku'
    }
  }
  if (mode === 'local') {
    return resolveLocalRoute(locked === 'local')
  }

  // Default and "auto": ChatGPT every turn. Gemini/Opus only via lock or failure fallback.
  if (codexOn) {
    const escalate = POWER_HINTS.test(text) && text.length > 280
    return chatgptRoute(
      locked === 'codex' ? 'ChatGPT' : 'ChatGPT — default brain',
      escalate
    )
  }

  if (settings.geminiApiKey?.trim()) {
    return {
      tier: 'local',
      model: settings.geminiModel || DEFAULT_GEMINI_MODEL,
      provider: 'gemini',
      reason: 'ChatGPT off → Gemini fallback'
    }
  }

  if (settings.paidFallbackEnabled && settings.anthropicApiKey?.trim()) {
    return {
      tier: 'power',
      model: powerModel,
      provider: 'anthropic',
      reason: 'ChatGPT off → Opus fallback'
    }
  }

  return chatgptRoute('ChatGPT — default brain')
}
