import type { AlbertSettings, CodexStatus, LocalProvider, RoutingMode } from './types'

/** The three brains the UI actually offers. */
export type BrainChoice = 'chatgpt' | 'gemini' | 'opus'

export function brainChoice(settings: {
  routingMode?: string | null
  localProvider?: string | null
}): BrainChoice {
  const mode = settings.routingMode || 'codex'
  if (mode === 'power' || mode === 'fast') return 'opus'
  if (mode === 'local') return 'gemini'
  return 'chatgpt'
}

export function settingsForBrain(choice: BrainChoice): Partial<AlbertSettings> {
  if (choice === 'gemini') {
    return { routingMode: 'local', localProvider: 'gemini' as LocalProvider }
  }
  if (choice === 'opus') {
    return { routingMode: 'power' }
  }
  return { routingMode: 'codex' }
}

export function brainDisplayName(choice: BrainChoice): string {
  if (choice === 'gemini') return 'Gemini'
  if (choice === 'opus') return 'Claude'
  return 'ChatGPT'
}

export function brainLockHint(choice: BrainChoice): string {
  if (choice === 'chatgpt') return 'ChatGPT answers every turn'
  if (choice === 'gemini') return 'Gemini answers every turn'
  return 'Claude answers every turn'
}

/** Enough configured to start a turn. ChatGPT is the default path. */
export function hasTalkableBrain(settings: AlbertSettings): boolean {
  if (settings.codexEnabled !== false) return true
  if (settings.geminiApiKey?.trim()) return true
  if (settings.anthropicApiKey?.trim()) return true
  if (settings.groqApiKey?.trim() || settings.ollamaApiKey?.trim()) return true
  return settings.localProvider === 'ollama'
}

export function chatgptStatusLine(codex: CodexStatus | null | undefined): string {
  if (!codex) return 'Checking ChatGPT…'
  if (!codex.installed) return `ChatGPT CLI missing. ${codex.installHint ?? ''}`.trim()
  if (!codex.signedIn) return 'ChatGPT found — sign in to start talking.'
  const who = codex.email ?? 'your ChatGPT account'
  const plan = codex.planType ? ` · ${codex.planType}` : ''
  const allow = codex.allowance?.label ? ` · ${codex.allowance.label}` : ''
  return `Signed in as ${who}${plan}${allow}`
}

export function routeHudLabel(tier: string | undefined, model?: string, reason?: string): string {
  const name =
    tier === 'codex'
      ? 'ChatGPT'
      : tier === 'power' || tier === 'fast'
        ? 'Claude'
        : tier === 'local'
          ? 'Gemini'
          : 'Brain'
  const modelBit = model && model !== 'codex' ? ` · ${model}` : ''
  const why = reason ? ` — ${reason}` : ''
  return `${name}${modelBit}${why}`
}

export function isChatgptRouting(mode: RoutingMode | undefined): boolean {
  return mode !== 'local' && mode !== 'fast' && mode !== 'power'
}

/** Provider the router will actually use, not the three-brain UI lock. */
export type ConfiguredProvider = 'chatgpt' | 'gemini' | 'groq' | 'ollama' | 'opus'

export function configuredProvider(settings: {
  routingMode?: string | null
  localProvider?: string | null
}): ConfiguredProvider {
  const mode = settings.routingMode || 'codex'
  if (mode === 'power' || mode === 'fast') return 'opus'
  if (mode === 'local') {
    if (settings.localProvider === 'groq') return 'groq'
    if (settings.localProvider === 'ollama') return 'ollama'
    return 'gemini'
  }
  return 'chatgpt'
}

export function configuredProviderName(provider: ConfiguredProvider): string {
  if (provider === 'opus') return 'Claude'
  if (provider === 'groq') return 'Groq'
  if (provider === 'ollama') return 'Ollama'
  if (provider === 'gemini') return 'Gemini'
  return 'ChatGPT'
}

export function workshopLink(
  settings: {
    routingMode?: string | null
    localProvider?: string | null
    geminiApiKey?: string
    anthropicApiKey?: string
    groqApiKey?: string
    ollamaApiKey?: string
  },
  signedIn: boolean
): { ok: boolean; text: string; name: string } {
  const provider = configuredProvider(settings)
  const name = configuredProviderName(provider)
  if (provider === 'chatgpt') {
    return { ok: signedIn, text: signedIn ? 'Connected' : 'Offline', name }
  }
  const configured =
    provider === 'opus'
      ? Boolean(settings.anthropicApiKey?.trim())
      : provider === 'groq'
        ? Boolean(settings.groqApiKey?.trim())
        : provider === 'ollama'
          ? Boolean(settings.ollamaApiKey?.trim() || settings.localProvider === 'ollama')
          : Boolean(settings.geminiApiKey?.trim())
  return { ok: false, text: configured ? 'Configured' : 'Offline', name }
}
