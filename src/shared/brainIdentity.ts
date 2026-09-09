export type ActiveBrainRoute = {
  provider: 'ollama' | 'groq' | 'gemini' | 'anthropic' | 'codex'
  tier: 'local' | 'fast' | 'power' | 'codex'
  model: string
}

export type ActiveSurface = 'mac' | 'phone'

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
    /\bare\s+you\s+(?:using|running|on)\s+(?:haiku|opus|anthropic|ollama|groq|gemini|google|gpt[- ]?oss|llama|qwen|codex|chatgpt)\b/.test(
      normalized
    )
  )
}

export function activeBrainReply(route: ActiveBrainRoute): string {
  if (route.provider === 'codex') {
    // Codex resolves the exact slug at turn time; don't claim one we don't have.
    const model = route.model && route.model !== 'codex' ? ` — ${route.model}` : ''
    return `Active brain this turn: ChatGPT${model}, sir — running on your ChatGPT allowance.`
  }
  if (route.provider === 'groq') {
    return `Active brain this turn: Groq Cloud — ${route.model}, sir.`
  }
  if (route.provider === 'gemini') {
    return `Active brain this turn: Gemini / Google AI Studio — ${route.model}, sir.`
  }
  if (route.provider === 'ollama') {
    return `Active brain this turn: Ollama — ${route.model}, sir.`
  }
  const family = route.tier === 'power' ? 'Opus' : 'Haiku'
  return `Active brain this turn: Anthropic ${family} — ${route.model}, sir.`
}

/** Narrow matcher: which client surface Albert is answering from. */
export function isActiveSurfaceQuestion(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase()
  if (!normalized || normalized.length > 180) return false
  return (
    /\b(?:are|is)\s+you\s+(?:on|in|running\s+on|talking\s+(?:from|on)|answering\s+(?:from|on))\s+(?:the\s+)?(?:phone|iphone|ipad|mobile|ios|mac|macos|desktop|computer|laptop)\b/.test(
      normalized
    ) ||
    /\b(?:which|what)\s+(?:app|device|client|surface|platform|side)\s+(?:are|is)\s+(?:you\s+)?(?:on|using|running|answering\s+from)\b/.test(
      normalized
    ) ||
    /\bare\s+you\s+(?:the\s+)?(?:phone|mobile|mac|desktop)\s+(?:app|version|build|companion)?\b/.test(
      normalized
    ) ||
    /\b(?:am\s+i|are\s+we)\s+(?:talking|chatting)\s+(?:on|via|through)\s+(?:the\s+)?(?:phone|iphone|mobile|mac|desktop)\b/.test(
      normalized
    ) ||
    /\bwhere\s+are\s+you\s+(?:running|answering|talking)\s+from\b/.test(normalized)
  )
}

export function activeSurfaceReply(surface: ActiveSurface): string {
  if (surface === 'phone') {
    return `You're on the phone app with me right now, sir — not the Mac desktop.`
  }
  return `You're on the Mac desktop app with me right now, sir — not the phone companion.`
}

/** Shared prompt block so models don't confuse phone history with the active client. */
export function activeSurfacePromptBlock(surface: ActiveSurface): string {
  if (surface === 'phone') {
    return `=== ACTIVE SURFACE (THIS TURN) ===
Client: PHONE / iOS companion app.
Kai is talking to you on his phone right now — not the Mac Electron app.
You have phone tools (web_search, web_fetch, open_app). You do NOT have Mac desktop tools (Spotify control, Computer window, AppleScript, filesystem, desktop clicks) on this surface.
If chat history mentions Mac-only actions, that was a different surface/turn. Do not claim you are on the Mac.
If Kai asks where you are / which app he's using, answer: phone companion.
=== END SURFACE ===`
  }
  return `=== ACTIVE SURFACE (THIS TURN) ===
Client: MAC desktop app (Electron on macOS).
Kai is talking to you on his Mac right now — not the iPhone companion.
You have Mac tools (Computer, desktop, Spotify, filesystem, etc.). Phone-only open_app schemes are not this surface.
If chat history was synced from the phone, that does not mean you are on the phone now.
If Kai asks where you are / which app he's using, answer: Mac desktop.
=== END SURFACE ===`
}
