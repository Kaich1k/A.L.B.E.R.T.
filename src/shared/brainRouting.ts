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
  if (choice === 'opus') return 'Opus'
  return 'ChatGPT'
}

export function brainLockHint(choice: BrainChoice): string {
  if (choice === 'chatgpt') return 'ChatGPT answers every turn'
  if (choice === 'gemini') return 'Locked to Gemini — free fallback'
  return 'Locked to Opus — paid Anthropic'
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
      : tier === 'power'
        ? 'Opus'
        : tier === 'local'
          ? 'Gemini'
          : 'Fallback'
  const modelBit = model && model !== 'codex' ? ` · ${model}` : ''
  const why = reason ? ` — ${reason}` : ''
  return `${name}${modelBit}${why}`
}

export function isChatgptRouting(mode: RoutingMode | undefined): boolean {
  return mode !== 'local' && mode !== 'fast' && mode !== 'power'
}
