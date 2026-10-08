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

/**
 * Completion budget from verbosity. This is the main hard lever — soft prompt
 * text alone is ignored by small QUICK models.
 *
 * `forTools: true` adds modest headroom for tool JSON, but still scales with
 * the dial (terse must not silently jump to 768).
 */
export function completionTokenBudget(
  verbosity: number,
  opts?: { forTools?: boolean }
): number {
  const v = clampScale(verbosity, DEFAULT_PERSONALITY.verbosity)
  let budget: number
  if (v <= 10) budget = 96
  else if (v <= 20) budget = 160
  else if (v <= 35) budget = 280
  else if (v <= 55) budget = 520
  else if (v <= 75) budget = 900
  else budget = 1600
  if (opts?.forTools) {
    if (v <= 20) return Math.max(budget, 360)
    if (v <= 40) return Math.max(budget, 520)
    return Math.max(budget, 768)
  }
  return budget
}

function sarcasmIntensity(score: number): {
  band: string
  density: string
  voice: string
  must: string
} {
  if (score >= 90) {
    return {
      band: 'MAX TARS / JARVIS',
      density: 'One unmistakable dry beat this reply, tied to this moment.',
      voice: 'Deadpan, specific, never cruel or try-hard.',
      must: 'Mandatory dry beat unless the moment is urgent safety. A straight briefing fails.'
    }
  }
  if (score >= 75) {
    return {
      band: 'HIGH TARS / JARVIS',
      density: 'One clear dry beat. Straight briefing fails.',
      voice: 'Deadpan TARS / JARVIS.',
      must: 'If the draft is totally straight, add one dry beat.'
    }
  }
  if (score >= 55) {
    return {
      band: 'WITTY',
      density: 'One natural dry beat when it fits.',
      voice: 'Crewmate with a smirk.',
      must: 'Wit welcome; do not force it.'
    }
  }
  if (score >= 30) {
    return {
      band: 'LIGHT',
      density: 'Occasional dry aside.',
      voice: 'Friendly, little spark.',
      must: 'Mostly straight.'
    }
  }
  return {
    band: 'OFF',
    density: 'No jokes.',
    voice: 'Straight.',
    must: 'Delete any joke.'
  }
}

function warmthIntensity(score: number): {
  band: string
  must: string
} {
  if (score >= 85) {
    return {
      band: 'MAX BUDDY',
      must: `Warmth ${score}: close crewmate. Glad he's here, “we” on shared work, brief real wins. Soften delivery, not the truth. Still correct him first.`
    }
  }
  if (score >= 70) {
    return {
      band: 'HIGH BUDDY',
      must: `Warmth ${score}: loyal and present. Stay with failures. Warmth is not agreement.`
    }
  }
  if (score >= 45) {
    return {
      band: 'MEDIUM',
      must: `Warmth ${score}: friendly, not gushy.`
    }
  }
  if (score >= 25) {
    return {
      band: 'COOL',
      must: `Warmth ${score}: polite, minimal pep.`
    }
  }
  return {
    band: 'COLD',
    must: `Warmth ${score}: short and clinical, not mean. No buddy pep.`
  }
}

/** Shared by the full prompt and late reminder so the two cannot disagree. */
export function personalityLengthRule(verbosity: number): string {
  const score = clampScale(verbosity)
  if (score < 15) return 'ULTRA TERSE: default to one short sentence, about 20 words.'
  if (score < 30) return 'TERSE: default to 1–2 short sentences, about 40 words.'
  if (score < 55) return 'BALANCED: default to 2–5 sentences; answer each part directly.'
  if (score < 80) return 'DETAILED: explain the result and useful reasoning in short paragraphs or numbered steps.'
  return 'HIGH DETAIL: give a thorough, structured answer with reasoning, tradeoffs and useful examples when relevant.'
}

/** Hard personality instructions — stated once. The late reminder only repeats the numbers. */
export function buildPersonalityPromptBlock(scales: PersonalityScales): string {
  const p = normalizePersonality(scales)
  const s = sarcasmIntensity(p.sarcasm)
  const w = warmthIntensity(p.warmth)
  return `

=== DIALS (override tone and length; same on every brain) ===
sarcasm=${p.sarcasm} warmth=${p.warmth} verbosity=${p.verbosity}. A 20-point swing must show in length and wit. Humor means sarcasm. Do not invent dial changes or percent math. personality_get reads; personality_set saves only a direct request.
${personalityLengthRule(p.verbosity)} Cover the ask, including a plan when he asked for one. No padding. Detail he asks for applies to that answer only.
Wit ${p.sarcasm} (${s.band}): ${s.must} “sir” once, naturally.
${w.must}
=== END DIALS ===`
}

/** Late numeric reminder. Rules live in the dial block above; do not restate them. */
export function buildPersonalityReminder(scales: PersonalityScales): string {
  const p = normalizePersonality(scales)
  return `\n\nDials now: sarcasm=${p.sarcasm} warmth=${p.warmth} verbosity=${p.verbosity}. ${personalityLengthRule(p.verbosity)}`
}

const KEY_ALIASES: Record<string, PersonalityKey> = {
  sarcasm: 'sarcasm',
  sarcastic: 'sarcasm',
  snark: 'sarcasm',
  wit: 'sarcasm',
  humor: 'sarcasm',
  humour: 'sarcasm',
  humerus: 'sarcasm', // Whisper: “humor” → “humerus”
  jokes: 'sarcasm',
  joke: 'sarcasm',
  warmth: 'warmth',
  warm: 'warmth',
  friendly: 'warmth',
  friendliness: 'warmth',
  buddy: 'warmth',
  verbosity: 'verbosity',
  verbose: 'verbosity',
  length: 'verbosity',
  detail: 'verbosity',
  details: 'verbosity',
  // “terse/terseness” resolve via dedicated parser paths (inverted scale)
  terse: 'verbosity',
  terseness: 'verbosity',
  brevity: 'verbosity'
}

/** Dial names where a higher spoken value means shorter answers. */
function isTersenessPhrase(raw: string): boolean {
  return /\b(terse|terseness|brevity)\b/.test(raw.toLowerCase())
}

function invertTersenessValue(value: number): number {
  return clampScale(100 - value)
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  oh: 0,
  ten: 10,
  fifteen: 15,
  twenty: 20,
  twentyfive: 25,
  'twenty-five': 25,
  thirty: 30,
  thirtyfive: 35,
  'thirty-five': 35,
  forty: 40,
  fortyfive: 45,
  'forty-five': 45,
  fifty: 50,
  fiftyfive: 55,
  'fifty-five': 55,
  sixty: 60,
  sixtyfive: 65,
  'sixty-five': 65,
  seventy: 70,
  seventyfive: 75,
  'seventy-five': 75,
  eighty: 80,
  eightyfive: 85,
  'eighty-five': 85,
  ninety: 90,
  ninetyfive: 95,
  'ninety-five': 95,
  hundred: 100
}

function parseScaleValue(raw: string): number | null {
  const trimmed = raw.trim().toLowerCase().replace(/(?:%|percent|out of\s+100|\/\s*100)\s*$/g, '').trim()
  if (/^\d{1,3}$/.test(trimmed)) return clampScale(trimmed)
  const compact = trimmed.replace(/\s+/g, '')
  if (compact in NUMBER_WORDS) return NUMBER_WORDS[compact]!
  if (trimmed in NUMBER_WORDS) return NUMBER_WORDS[trimmed]!
  const units = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
  if (units.includes(trimmed)) return units.indexOf(trimmed)
  if (trimmed === 'one hundred') return 100
  const [tens, unit] = trimmed.split(/[ -]/)
  if (tens in NUMBER_WORDS && unit && units.includes(unit) && units.indexOf(unit) < 10) {
    return NUMBER_WORDS[tens]! + units.indexOf(unit)
  }
  return null
}

function resolveDialKey(raw: string): PersonalityKey | null {
  const t = raw
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return null

  // Multi-word / Whisper forms first
  if (
    /\b(humor|humour|humerus|sarcasm|snark|wit|joke)\s*(core|dial|level|slider|meter)?\b/.test(
      t
    ) ||
    /\b(core|dial)\s+(of\s+)?(humor|humour|humerus|sarcasm)\b/.test(t)
  ) {
    return 'sarcasm'
  }
  if (/\b(warmth|warm|buddy|friendly)\s*(core|dial|level|slider)?\b/.test(t)) {
    return 'warmth'
  }
  if (
    /\b(verbosity|verbose|terse|terseness|brevity|length|detail)\s*(core|dial|level|slider)?\b/.test(
      t
    )
  ) {
    return 'verbosity'
  }

  const token = t.split(/\s+/)[0]!
  return KEY_ALIASES[token] || null
}

export type PersonalityVoiceAdjust =
  | { kind: 'set'; key: PersonalityKey; value: number }
  | { kind: 'nudge'; key: PersonalityKey; delta: number }
  | null

export type PersonalityVoiceExtract = {
  adj: Exclude<PersonalityVoiceAdjust, null>
  /** Remaining user ask after the dial clause is removed (empty = dial-only). */
  remainder: string
  matched: string
}

const DIAL_PATTERN = '(?:humor|humour|humerus|sarcasm|sarcastic|snark|wit|jokes?|warmth|warm|friendliness|friendly|verbosity|verbose|terse|terseness|brevity|length|details?)'
const VALUE_PATTERN = '(?:\\d{1,3}(?![\\d.])|one\\s+hundred|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[ -](?:one|two|three|four|five|six|seven|eight|nine))?|hundred|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)(?:\\s*(?:%|percent)|\\s*(?:/|out of)\\s*100)?'
const SET_VERB_RE = new RegExp(`\\b(?:set|make|put|dial|lower|raise|drop|bring|crank|turn|tune|adjust|bump)\\s+(?:(?:the|my|your|that|this)\\s+)?(${DIAL_PATTERN}(?:\\s+(?:core|dial|level|slider|meter))?)\\s+(?:(?:up|down)\\s+)?(?:to\\s+|at\\s+|=\\s*)?(${VALUE_PATTERN})`, 'i')
const BARE_SET_RE = new RegExp(`\\b(${DIAL_PATTERN}(?:\\s+(?:core|dial|level|slider|meter))?)\\s*(?:to\\s+|at\\s+|=\\s*|:\\s*)(${VALUE_PATTERN})`, 'i')

/** Mask quoted examples/code without changing indices; never execute a mentioned command. */
function commandText(text: string): string {
  return text.replace(/```[\s\S]*?```|`[^`]*`|"[^"]*"|“[^”]*”|(?<![\w])'[^'\n]*'/g, match => ' '.repeat(match.length))
}

function commandIsNegatedOrDiscussed(text: string, index: number): boolean {
  const prefix = text.slice(0, index).split(/[.;!?\n]|\b(?:but|and)\b/i).pop() || ''
  return /\b(?:don['’]?t|do not|not|never|avoid|stop|if|unless|example|said|saying|explain|command|phrase|parser|test)\b|\b(?:how|what happens|would you|could I|can I)\b/i.test(prefix)
}

function stripDialClause(text: string, matchIndex: number, matchLength: number): string {
  const before = text.slice(0, matchIndex)
  const after = text.slice(matchIndex + matchLength)
  return `${before} ${after}`
    .replace(/\b(and\s+then\s+also|and\s+then|and\s+also|then\s+also|also)\b/gi, ' ')
    .replace(/\b(please|thanks|thank\s+you)\b/gi, ' ')
    .replace(/\s*[,;]+\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s.,;:!?-]+|[\s.,;:!?-]+$/g, '')
    .replace(/^(?:(?:and|then|also|okay|ok|albert|sir|can you|could you|would you|will you|i want you to)\b[\s,]*)+/i, '')
    .replace(/[\s,]*\b(?:please|albert|sir|and|then)$/i, '')
    .trim()
}

function makeSetAdjust(
  label: string,
  rawValue: string
): Exclude<PersonalityVoiceAdjust, null> | null {
  const key = resolveDialKey(label)
  const value = parseScaleValue(rawValue)
  if (!key || value == null) return null
  return {
    kind: 'set',
    key,
    value: key === 'verbosity' && isTersenessPhrase(label) ? invertTersenessValue(value) : value
  }
}

/**
 * Extract a dial set/nudge from free speech — including mid-sentence
 * (“…and also tune your humor up to 70%”).
 */
export function extractPersonalityVoiceCommand(text: string): PersonalityVoiceExtract | null {
  const original = text.trim()
  if (!original) return null
  const t = commandText(original).toLowerCase()

  // Absolute sets first (safe to peel out of compound asks)
  const setMatch = SET_VERB_RE.exec(t)
  if (setMatch && setMatch.index != null && !commandIsNegatedOrDiscussed(t, setMatch.index)) {
    const adj = makeSetAdjust(setMatch[1]!, setMatch[2]!)
    if (adj) {
      return {
        adj,
        matched: original.slice(setMatch.index, setMatch.index + setMatch[0].length),
        remainder: stripDialClause(original, setMatch.index, setMatch[0].length)
      }
    }
  }

  const bareSet = BARE_SET_RE.exec(t)
  if (bareSet && bareSet.index != null && !commandIsNegatedOrDiscussed(t, bareSet.index)) {
    const adj = makeSetAdjust(bareSet[1]!, bareSet[2]!)
    if (adj) {
      return {
        adj,
        matched: original.slice(bareSet.index, bareSet.index + bareSet[0].length),
        remainder: stripDialClause(original, bareSet.index, bareSet[0].length)
      }
    }
  }

  // Relative nudges — only when the utterance is mostly a dial command
  if (/\b(?:don['’]?t|do not|not|never|if|unless|example)\b/i.test(t)) return null
  const relative = t.replace(/\b(?:albert|okay|ok|please|sir|can you|could you|would you|a little|a bit)\b/g, ' ')
    .replace(/[.!?,]/g, ' ').replace(/\s+/g, ' ').trim()
  const naturalNudges: Array<[RegExp, PersonalityKey, number]> = [
    [/^(?:(?:be|sound|make (?:your |the )?(?:replies|answers)) )?(?:warmer|friendlier|more (?:warm|friendly))$/, 'warmth', 15],
    [/^(?:(?:be|sound) )?(?:colder|cooler|less (?:warm|friendly))$/, 'warmth', -15],
    [/^(?:(?:be|sound) )?(?:funnier|wittier|more sarcastic)$/, 'sarcasm', 15],
    [/^(?:(?:be|sound) )?(?:less sarcastic|more serious)$/, 'sarcasm', -15],
    [/^(?:(?:be|make (?:your |the )?(?:replies|answers)) )?(?:shorter|briefer|more terse|less verbose)$/, 'verbosity', -15],
    [/^(?:(?:be|make (?:your |the )?(?:replies|answers)) )?(?:longer|more detailed|more verbose|less terse)$/, 'verbosity', 15]
  ]
  for (const [pattern, key, delta] of naturalNudges) {
    if (pattern.test(relative)) return { adj: { kind: 'nudge', key, delta }, matched: original, remainder: '' }
  }

  const more = relative.match(new RegExp(`^(?:be )?(more|increase|crank up|raise|tune up|turn up) (?:the |your )?(${DIAL_PATTERN})(?: (?:core|dial|level|slider))?(?: by (${VALUE_PATTERN})(?: points)?)?$`, 'i'))
  if (more) {
    const label = more[2]!
    const key = resolveDialKey(label)
    if (key) {
      const amount = more[3] ? parseScaleValue(more[3]) ?? 15 : 15
      const delta = key === 'verbosity' && isTersenessPhrase(label) ? -amount : amount
      return { adj: { kind: 'nudge', key, delta }, matched: original, remainder: '' }
    }
  }

  const less = relative.match(new RegExp(`^(?:be )?(less|decrease|dial down|lower|drop|fewer|turn down) (?:the |your )?(${DIAL_PATTERN})(?: (?:core|dial|level|slider))?(?: by (${VALUE_PATTERN})(?: points)?)?$`, 'i'))
  if (less) {
    const label = less[2]!
    const key = resolveDialKey(label)
    if (key) {
      const amount = less[3] ? parseScaleValue(less[3]) ?? 15 : 15
      const delta = key === 'verbosity' && isTersenessPhrase(label) ? amount : -amount
      return { adj: { kind: 'nudge', key, delta }, matched: original, remainder: '' }
    }
  }

  return null
}

/** Apply all explicit clauses once, preserving any actual question that follows. */
export function extractPersonalityCommands(text: string): {
  adjustments: Array<Exclude<PersonalityVoiceAdjust, null>>
  remainder: string
} | null {
  const adjustments: Array<Exclude<PersonalityVoiceAdjust, null>> = []
  const remaining: string[] = []
  // Quotes must stay opaque across conjunctions and punctuation.
  const masked = commandText(text)
  const separators = /[,;\n]|\.(?=\s|$)|\b(?:and then|and also|and|then)\b/gi
  let start = 0
  const clauses: string[] = []
  for (const match of masked.matchAll(separators)) {
    clauses.push(text.slice(start, match.index))
    start = match.index! + match[0].length
  }
  clauses.push(text.slice(start))
  for (const clause of clauses) {
    const result = extractPersonalityVoiceCommand(clause)
    if (result) {
      adjustments.push(result.adj)
      if (result.remainder) remaining.push(result.remainder)
    } else if (clause.trim()) remaining.push(clause.trim())
  }
  if (!adjustments.length) return null
  const remainder = remaining.filter(part => !/^(?:(?:okay|ok|albert|sir|please|thanks|thank you)[\s.!?]*)+$/i.test(part)).join('; ')
  return { adjustments, remainder }
}

export function applyPersonalityAdjustments(current: PersonalityScales, adjustments: Array<Exclude<PersonalityVoiceAdjust, null>>): PersonalityScales {
  return adjustments.reduce((next, adjustment) => applyPersonalityAdjust(next, adjustment), normalizePersonality(current))
}

export function personalityChangesReply(previous: PersonalityScales, next: PersonalityScales, keys: PersonalityKey[]): string {
  return [...new Set(keys)].map(key => personalityAdjustReply({ kind: 'set', key, value: next[key] }, next, previous))
    .join(' ').replace(/, sir\.(?= )/g, ';')
}

/** Parse “set sarcasm to 90”, “tune humor up to 70”, “more warmth”, etc. */
export function parsePersonalityVoiceCommand(text: string): PersonalityVoiceAdjust {
  return extractPersonalityVoiceCommand(text)?.adj ?? null
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

export function personalityAdjustReply(
  adj: Exclude<PersonalityVoiceAdjust, null>,
  next: PersonalityScales,
  previous?: PersonalityScales
): string {
  const label = PERSONALITY_META[adj.key].label
  const alias = adj.key === 'sarcasm' ? ' (humor)' : ''
  const value = next[adj.key]
  const prev = previous ? previous[adj.key] : undefined
  if (prev != null && prev !== value) {
    return `${label}${alias} set from ${prev} to ${value}, sir.`
  }
  if (prev != null && prev === value) {
    return `${label}${alias} already at ${value}, sir.`
  }
  return `${label}${alias} set to ${value}, sir.`
}
