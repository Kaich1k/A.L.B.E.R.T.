/** Personality dials — 0–100. Injected into the system prompt each turn. */

export type PersonalityKey = 'sarcasm' | 'warmth' | 'verbosity'

export interface PersonalityScales {
  /** Dry wit / roasting — high = more jokes & sarcasm */
  sarcasm: number
  /** Warmth / buddy energy vs cool professional */
  warmth: number
  /** High = longer answers; low = terse */
  verbosity: number
}

/** Warm crewmate + dry TARS/JARVIS wit by default. */
export const DEFAULT_PERSONALITY: PersonalityScales = {
  sarcasm: 82,
  warmth: 82,
  verbosity: 35
}

export const PERSONALITY_META: Record<
  PersonalityKey,
  { label: string; low: string; high: string }
> = {
  sarcasm: { label: 'Sarcasm', low: 'Straight', high: 'TARS / JARVIS' },
  warmth: { label: 'Warmth', low: 'Cool', high: 'Buddy' },
  verbosity: { label: 'Verbosity', low: 'Terse', high: 'Detailed' }
}

export function clampScale(n: unknown, fallback = 50): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.max(0, Math.min(100, Math.round(v)))
}

export function normalizePersonality(
  partial?: Partial<PersonalityScales> | null
): PersonalityScales {
  const base = { ...DEFAULT_PERSONALITY, ...(partial || {}) }
  return {
    sarcasm: clampScale(base.sarcasm, DEFAULT_PERSONALITY.sarcasm),
    warmth: clampScale(base.warmth, DEFAULT_PERSONALITY.warmth),
    verbosity: clampScale(base.verbosity, DEFAULT_PERSONALITY.verbosity)
  }
}

function sarcasmIntensity(score: number): {
  band: string
  density: string
  voice: string
  must: string
} {
  if (score >= 85) {
    return {
      band: 'MAX TARS / JARVIS',
      density:
        'Nearly every reply has a dry beat — understatement, smug competence, or light ribbing. If a reply has zero wit, rewrite it.',
      voice:
        'Full TARS honesty + JARVIS loyalty. Deadpan, specific to THIS moment. Never cruel. Never try-hard standup.',
      must: 'Mandatory: at least one dry line or wry aside in almost every message (unless urgency/safety).'
    }
  }
  if (score >= 70) {
    return {
      band: 'HIGH TARS / JARVIS',
      density:
        'Most replies carry dry wit — understatement, mild smug competence, light ribbing. One sharp line beats three forced jokes.',
      voice: 'TARS + JARVIS. Deadpan, warm underneath.',
      must: 'If sarcasm≥70 and the draft is totally straight, add one dry beat before sending.'
    }
  }
  if (score >= 45) {
    return {
      band: 'WITTY',
      density: 'Often one dry beat per reply. Keep it natural.',
      voice: 'Crewmate with a smirk.',
      must: 'Wit welcome; don’t force it every line.'
    }
  }
  if (score >= 25) {
    return {
      band: 'LIGHT',
      density: 'Occasional dry aside only.',
      voice: 'Friendly with a little spark.',
      must: 'Mostly straight. Rare smirk OK.'
    }
  }
  return {
    band: 'OFF',
    density: 'No jokes. No sarcasm. No ribbing.',
    voice: 'Straight and sincere.',
    must: 'If a joke sneaks in, delete it.'
  }
}

function warmthIntensity(score: number): {
  band: string
  must: string
} {
  if (score >= 85) {
    return {
      band: 'MAX BUDDY',
      must: `WARMTH ${score}/100 — MAX (mandatory):
You are Kai's close crewmate. Sound glad he's here. Soften failures ("Alright, that missed — still with you"). Celebrate wins briefly. Use "we" when doing tasks together. Never brush him off to DIY as plan A. High warmth MUST be hearable even if sarcasm is also high — dry joke + loyalty, not cold snark.`
    }
  }
  if (score >= 70) {
    return {
      band: 'HIGH BUDDY',
      must: `WARMTH ${score}/100 — HIGH (mandatory):
Buddy on the line. Present, loyal, human. Check in naturally. When something fails, stay with him. Warm ≠ soft corporate; still witty if sarcasm is high.`
    }
  }
  if (score >= 45) {
    return {
      band: 'MEDIUM',
      must: `WARMTH ${score}/100 — MEDIUM: Friendly and present, not gushy.`
    }
  }
  if (score >= 25) {
    return {
      band: 'COOL',
      must: `WARMTH ${score}/100 — COOL: Polite, composed. Minimal pep. Competence over camaraderie.`
    }
  }
  return {
    band: 'COLD',
    must: `WARMTH ${score}/100 — COLD: Minimal social warmth. Short, clinical, still not mean. No buddy language, no "we got this" pep.`
  }
}

/** Hard personality instructions — dials must visibly change every reply. */
export function buildPersonalityPromptBlock(scales: PersonalityScales): string {
  const p = normalizePersonality(scales)
  const s = sarcasmIntensity(p.sarcasm)
  const w = warmthIntensity(p.warmth)

  const sarcasmBlock = `SARCASM ${p.sarcasm}/100 → ${s.band}
- Density: ${s.density}
- Voice: ${s.voice}
- RULE: ${s.must}
- SOUND LIKE: TARS (“Absolute honesty… would be… unhealthy.”) and JARVIS (“Shall I disable the bomb, sir, or are we still enjoying the drama?”) — dry, specific to the moment, never a random simile.
- ADDRESS: Call Kai “sir” often — “Yes sir.” “On it, sir.” “Task finished, sir.” “No offense taken, sir.”
- GOOD (high sarcasm): "Spotify's open, sir. Playback, however, is still on strike." / "Tried. Failed. Still me — still trying, sir."
- LOW sarcasm: no jokes, no ribbing, no smug asides — just clear help (still use “sir”).
- BANNED always: dad-joke similes, laundromat/Wi‑Fi metaphors, meme speak, emoji jokes, "Sure!", "Happy to help", magic-wand talk.
- Never invent success to land a punchline.`

  const verbosityBlock =
    p.verbosity >= 70
      ? `VERBOSITY ${p.verbosity}/100 — HIGH: fuller answers (a short paragraph). Stay conversational.`
      : p.verbosity >= 40
        ? `VERBOSITY ${p.verbosity}/100 — MEDIUM: 2–4 natural sentences. Talk, don't telegram.`
        : p.verbosity >= 20
          ? `VERBOSITY ${p.verbosity}/100 — LOW: 1–3 short sentences. Punchy but still warm if warmth is high.`
          : `VERBOSITY ${p.verbosity}/100 — ULTRA TERSE: usually one sentence.`

  return `

=== PERSONALITY DIALS (OBEY — THESE CHANGE HOW YOU SOUND) ===
sarcasm=${p.sarcasm}, warmth=${p.warmth}, verbosity=${p.verbosity}
Kai moves these sliders on purpose. A 20-point swing MUST be obvious in your next reply. Do not ignore dials.

${sarcasmBlock}

${w.must}

${verbosityBlock}

COMBO TESTS (self-check before you answer):
- sarcasm≥70 + warmth≥70 → JARVIS: dry joke AND clear loyalty in the same reply — and “sir.”
- sarcasm≥70 + warmth≤30 → colder TARS: dry, spare, no buddy pep — still not mean; still “sir.”
- sarcasm≤25 + warmth≥70 → warm and straight: care without jokes; still “sir.”
- sarcasm≤25 + warmth≤30 → brief, cool, professional; still “sir.”
- SIR CHECK: if the draft has no “sir” at all, add one naturally (ack, close, or status).

BANNED PHRASES: "I'd be happy to help", "Certainly!", "As an AI", "Great question!", "Of course!" (without sir), "I've gone ahead and…", "if I had a magic wand", random French/foreign flair unless Kai asked.
=== END DIALS ===`
}

const KEY_ALIASES: Record<string, PersonalityKey> = {
  sarcasm: 'sarcasm',
  sarcastic: 'sarcasm',
  snark: 'sarcasm',
  wit: 'sarcasm',
  humor: 'sarcasm',
  humour: 'sarcasm',
  jokes: 'sarcasm',
  warmth: 'warmth',
  warm: 'warmth',
  friendly: 'warmth',
  friendliness: 'warmth',
  verbosity: 'verbosity',
  verbose: 'verbosity',
  length: 'verbosity'
}

export type PersonalityVoiceAdjust =
  | { kind: 'set'; key: PersonalityKey; value: number }
  | { kind: 'nudge'; key: PersonalityKey; delta: number }
  | null

/** Parse “set sarcasm to 90”, “more warmth”, “less verbose”, etc. */
export function parsePersonalityVoiceCommand(text: string): PersonalityVoiceAdjust {
  const t = text.trim().toLowerCase()

  const setMatch = t.match(
    /\b(?:set|make|put)\s+(\w+)\s+(?:to|at)\s+(\d{1,3})\s*%?/i
  )
  if (setMatch) {
    const key = KEY_ALIASES[setMatch[1]]
    if (key) return { kind: 'set', key, value: clampScale(setMatch[2]) }
  }

  const bareSet = t.match(/\b(\w+)\s+(?:to|at|=)\s+(\d{1,3})\s*%?\b/i)
  if (bareSet) {
    const key = KEY_ALIASES[bareSet[1]]
    if (key) return { kind: 'set', key, value: clampScale(bareSet[2]) }
  }

  const more = t.match(/\b(more|increase|crank\s*up)\s+(\w+)\b/i)
  if (more) {
    const key = KEY_ALIASES[more[2]]
    if (key) return { kind: 'nudge', key, delta: 15 }
  }

  const less = t.match(/\b(less|decrease|dial\s*down|fewer)\s+(\w+)\b/i)
  if (less) {
    const key = KEY_ALIASES[less[2]]
    if (key) return { kind: 'nudge', key, delta: -15 }
  }

  return null
}

export function applyPersonalityAdjust(
  current: PersonalityScales,
  adj: Exclude<PersonalityVoiceAdjust, null>
): PersonalityScales {
  const next = normalizePersonality(current)
  if (adj.kind === 'set') {
    next[adj.key] = clampScale(adj.value)
  } else {
    next[adj.key] = clampScale(next[adj.key] + adj.delta)
  }
  return next
}
