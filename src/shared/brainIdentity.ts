export type ActiveBrainRoute = {
  provider: 'ollama' | 'groq' | 'anthropic'
  tier: 'local' | 'fast' | 'power'
  model: string
}

/** Narrow matcher: answer current runtime identity, not general AI recommendations. */
export function isActiveBrainQuestion(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase()
  if (!normalized || normalized.length > 180) return false
  return (
    /\b(?:which|what)\s+(?:ai|a\.i\.|model|brain|provider)\s+(?:are|is)\s+(?:you\s+)?(?:using|running|on|active)\b/.test(
      normalized
    ) ||
    /\bwhat\s+are\s+you\s+(?:using|running)\b/.test(normalized) ||
    /\b(?:which|what)(?:'s|\s+is)\s+(?:your|the)\s+(?:current|active)\s+(?:ai|model|brain|provider)\b/.test(
      normalized
    ) ||
    /\b(?:current|active)\s+(?:ai|model|brain|provider)\s*\??$/.test(normalized) ||
    /\bare\s+you\s+(?:using|running|on)\s+(?:haiku|opus|anthropic|ollama|groq|gpt[- ]?oss|llama|qwen)\b/.test(
      normalized
    )
  )
}

export function activeBrainReply(route: ActiveBrainRoute): string {
  if (route.provider === 'groq') {
    return `Active brain this turn: Groq Cloud — ${route.model}, sir.`
  }
  if (route.provider === 'ollama') {
    return `Active brain this turn: Ollama — ${route.model}, sir.`
  }
  const family = route.tier === 'power' ? 'Opus' : 'Haiku'
  return `Active brain this turn: Anthropic ${family} — ${route.model}, sir.`
}
