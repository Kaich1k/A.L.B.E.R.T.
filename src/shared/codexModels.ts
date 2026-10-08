/** Slugs reported by Codex `model/list` on Kai's plan. Not guesses. */
export const CHATGPT_ASTRA_MODEL = 'gpt-6-astra'
/** Official GPT-6.1 Sol — Responses tool calling; efforts low/medium/high/xhigh/max. */
export const CHATGPT_SOL_61_MODEL = 'gpt-6.1-sol'
/** First Codex CLI release whose bundled catalog includes GPT-6.1 Sol. */
export const CHATGPT_SOL_61_MIN_CODEX_VERSION = '0.159.1'
/** Older Sol still listed on some ChatGPT/Codex plans. */
export const CHATGPT_SOL_MODEL = 'gpt-5.6-sol'

/** Reasoning efforts GPT-6.1 Sol accepts (not none/minimal). */
export const CHATGPT_SOL_61_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

/** Honest Systems label when `model/list` omits GPT-6.1 Sol. */
export const CHATGPT_SOL_61_UNAVAILABLE = 'Not reported by this Codex client/account'

function numericVersion(raw: string | null | undefined): number[] {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(raw || '')
  return match ? match.slice(1).map(Number) : []
}

export function codexVersionAtLeast(
  installed: string | null | undefined,
  required: string
): boolean {
  const have = numericVersion(installed)
  const need = numericVersion(required)
  if (have.length !== 3 || need.length !== 3) return false
  for (let i = 0; i < 3; i += 1) {
    if (have[i] !== need[i]) return have[i]! > need[i]!
  }
  return true
}

export function sol61UnavailableReason(version: string | null | undefined): string {
  if (version && !codexVersionAtLeast(version, CHATGPT_SOL_61_MIN_CODEX_VERSION)) {
    return `Codex ${version} is too old; update to ${CHATGPT_SOL_61_MIN_CODEX_VERSION}+`
  }
  return CHATGPT_SOL_61_UNAVAILABLE
}

export function codexModelListed(
  available: ReadonlyArray<{ id: string }> | null | undefined,
  modelId: string
): boolean {
  const want = modelId.trim()
  if (!want || !available?.length) return false
  return available.some((model) => model.id === want || model.id.startsWith(`${want}-`))
}

export function codexModelLabel(id: string, displayName?: string): string {
  const slug = id.trim()
  if (!slug) return displayName?.trim() || ''
  if (slug === CHATGPT_ASTRA_MODEL || slug.startsWith(`${CHATGPT_ASTRA_MODEL}-`)) return 'Astra'
  if (slug === CHATGPT_SOL_61_MODEL || slug.startsWith(`${CHATGPT_SOL_61_MODEL}-`)) return '6.1 Sol'
  if (slug.includes('sol')) return slug.includes('5.6') ? '5.6 Sol' : 'Sol'
  if (slug.includes('terra')) return 'Terra'
  if (slug.includes('luna')) return 'Luna'
  if (slug.includes('mini')) return 'Mini'
  if (slug === 'gpt-5.5') return '5.5'
  const cleaned = displayName?.replace(/^gpt[-\s]?/i, '').trim()
  return cleaned || slug
}
