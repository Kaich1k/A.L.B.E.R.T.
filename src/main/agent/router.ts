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

const MID_HINTS =
  /\b(why|how|explain|research|compare|should i|help me|figure|plan|summarize|analyse|analyze|what if|walk me through)\b/i

const LOCAL_HINTS =
  /\b(hi|hello|hey|thanks|thank you|good morning|good night|how are you|open |launch |what time|weather|remember that|forget |quick question|yo\b|sup\b)\b/i

const EXPLICIT_POWER =
  /\b(use opus|switch to opus|opus mode|full power|max intelligence|power mode)\b/i
const EXPLICIT_FAST =
  /\b(use haiku|switch to haiku|haiku mode|mid mode)\b/i
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
  if (EXPLICIT_AUTO.test(text)) {
    setSettings({ routingMode: 'auto' })
    return 'auto'
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

export function selectModelTier(
  userText: string,
  opts?: { hasImages?: boolean }
): {
  tier: ModelTier
  model: string
  reason: string
  provider: LocalProvider | 'anthropic'
} {
  const locked = applyExplicitRoutingLock(userText)
  const settings = getSettings()
  const mode: RoutingMode = settings.routingMode || 'auto'
  const fastModel = settings.fastModel || 'claude-haiku-4-5'
  const powerModel = settings.powerModel || settings.model || 'claude-opus-5'
  const text = userText.trim()

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
      reason: locked === 'fast' ? 'Locked to Haiku' : 'Routing locked to Haiku'
    }
  }
  if (mode === 'local') {
    const local = resolveLocalRoute(locked === 'local')
    return local
  }

  // auto: images → Haiku vision (QUICK-provider vision is best-effort)
  if (opts?.hasImages) {
    return {
      tier: 'fast',
      model: fastModel,
      provider: 'anthropic',
      reason: 'Image attached → Haiku vision'
    }
  }

  // auto: QUICK → Haiku → Opus
  if (text.length > 450 || text.split('\n').length > 8) {
    return {
      tier: 'power',
      model: powerModel,
      provider: 'anthropic',
      reason: 'Long or dense request → Opus'
    }
  }

  if (POWER_HINTS.test(text)) {
    return {
      tier: 'power',
      model: powerModel,
      provider: 'anthropic',
      reason: 'Coding / deep-work → Opus'
    }
  }

  const projectFolder = settings.projectFolder?.trim()
  if (
    projectFolder &&
    /\b(file|folder|code|project|repo|function|class|bug|refactor|patch|edit yourself|your (own )?code|self-?edit)\b/i.test(
      text
    )
  ) {
    return {
      tier: 'power',
      model: powerModel,
      provider: 'anthropic',
      reason: 'Project/code → Opus'
    }
  }

  if (MID_HINTS.test(text) || (text.length > 160 && text.length <= 450)) {
    return {
      tier: 'fast',
      model: fastModel,
      provider: 'anthropic',
      reason: 'Complex / explanatory → Haiku'
    }
  }

  if (text.length < 100 || LOCAL_HINTS.test(text)) {
    const local = resolveLocalRoute(false)
    return {
      ...local,
      reason: `Casual chat → ${quickLabel(local.provider)}`
    }
  }

  return {
    tier: 'fast',
    model: fastModel,
    provider: 'anthropic',
    reason: 'Default mid route → Haiku'
  }
}
