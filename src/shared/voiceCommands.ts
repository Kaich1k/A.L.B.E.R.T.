/**
 * Local voice command detection — runs before the brain so standby/end/mute/hide work.
 * Shared by renderer (voice session) and main (chat safety net).
 */

import { repairAlbertMentions } from './albertName'
import { collapseRepeatedTranscript } from './voiceReliability'
export { collapseRepeatedTranscript } from './voiceReliability'

/** Leading fluff we ignore when judging “is this the whole command?” */
const FILLER =
  /^(hey\s+)?(a\.?l\.?b\.?e\.?r\.?t\.?|albert)\s*[,.]?\s*|^ok(ay)?\s*[,.…\-–—]?\s*|^gotcha\s*[,.]?\s*|^yeah\s*[,.]?\s*|^yep\s*[,.]?\s*|^yup\s*[,.]?\s*|^alright\s*[,.]?\s*|^well\s*[,.]?\s*|^however\s*[,.]?\s*|^anyway\s*[,.]?\s*|^with\s+that\s+said\s*[,.]?\s*|^that\s+said\s*[,.]?\s*|^so\s*[,.]?\s*|^u[mh]+\s*[,.…\-–—]?\s*|^please\s*|^now\s*|^just\s*|^no\s*[,.]?\s*/i

/** Trailing address / courtesy — “standby albert” / “sleep, sir” */
const TRAILING_FILLER =
  /\s*(please|thanks?|thank\s+you|for\s+now|sir|a\.?l\.?b\.?e\.?r\.?t\.?|albert)\s*[.!]?\s*$/i

/**
 * Whole-clause end-voice shapes (after filler strip).
 * Matched per sentence/clause so “I'll fix it later. You can turn off.” still works.
 */
const END_VOICE_WHOLE: RegExp[] = [
  /^(go\s+to\s+)?stand\s*-?\s*by\.?$/i,
  /^standby(\s+mode)?\.?$/i,
  /^(be\s+)?on\s+stand\s*-?\s*by\.?$/i,
  /^(be\s+)?on\s+standby\.?$/i,
  /^go\s+on\s+stand\s*-?\s*by\.?$/i,
  /^go\s+on\s+standby\.?$/i,
  /^(enter|engage|enable)\s+stand\s*-?\s*by(\s+mode)?\.?$/i,
  /^(enter|engage|enable)\s+standby(\s+mode)?\.?$/i,
  /^stand\s*-?\s*by(\s+mode)?\.?$/i,
  /^end\s+voice(\s+(mode|session|for\s+now))?\.?$/i,
  /^stop\s+voice(\s+(mode|session|for\s+now))?\.?$/i,
  /^(turn\s*off|disable|kill)\s+(the\s+)?(voice|listening|mic|microphone)\.?$/i,
  /^(stop|quit|end)\s+(the\s+)?listening\.?$/i,
  /^(shut\s+down|power\s+down)\s+(the\s+)?(voice|listening)\.?$/i,
  /^(you\s+can\s+)?turn\s+(yourself\s+)?off\.?$/i,
  /^(you\s+can\s+)?(go\s+(and|to)\s+)?stand\s*-?\s*by\.?$/i,
  /^(you\s+can\s+)?(go\s+(and|to)\s+)?standby(\s+mode)?\.?$/i,
  /^(you\s+can\s+)?(be\s+)?on\s+stand\s*-?\s*by\.?$/i,
  /^(you\s+can\s+)?(be\s+)?on\s+standby\.?$/i,
  /^you\s+can\s+(turn\s+off|stand\s*-?\s*by|standby|go\s+to\s+sleep|stop\s+listening|be\s+on\s+stand\s*-?\s*by|be\s+on\s+standby)\.?$/i,
  /^go\s+to\s+sleep\.?$/i,
  /^(you\s+should\s+|you\s+need\s+to\s+|i\s+want\s+you\s+to\s+|i\s+said\s+(you\s+should\s+)?)go\s+to\s+sleep\.?$/i,
  /^(you\s+should\s+|you\s+need\s+to\s+)(go\s+to\s+)?sleep\.?$/i,
  /^sleep\.?$/i,
  /^(deactivate|disconnect|disengage)(\s+(voice|listening))?\.?$/i,
  /^(that'?s\s+all|that\s+is\s+all)\.?$/i,
  /^(i'?m\s+done|we'?re\s+done)\.?$/i,
  /^(good\s*bye|goodbye|bye(\s+albert)?)(\s+for\s+now)?\.?$/i,
  /^see\s+you(\s+later)?\.?$/i,
  /^see\s+ya\.?$/i,
  /^(catch\s+you\s+later|talk\s+later)\.?$/i,
  /^take\s+(a\s+)?(five|5|break)\.?$/i,
  /^take\s+5\.?$/i,
  /^(you\s+can\s+)?take\s+(a\s+)?(five|5|break)\.?$/i,
  /^(albert\s*[,.]?\s+)?(you\s+can\s+)?take\s+(a\s+)?(five|5|break)\.?$/i,
  /^(go\s+to\s+)?(sleep|sleep\s+mode)\.?$/i,
  /^(back\s+to\s+)?(standby|sleep)(\s+mode)?\.?$/i,
  /^i('m|\s+am)\s+(gonna|going\s+to)\s+(head\s+out|leave|take\s+off)(\s+(somewhere|now|out))?\.?$/i,
  /^i('m|\s+am)\s+(gonna|going\s+to)\s+go\s+(now|out|somewhere)\.?$/i,
  /^invoices?\.?$/i,
  /^(end|and|in)\s*voice\.?$/i,
  /^enjoy\s+(voice|for\s+now)\.?$/i,
  /^end\s+(the\s+)?(void|vice|bois|boys)\.?$/i,
  /^(turn\s*off|stop|end)\s+(the\s+)?(boys|boy'?s|voids?|vois)\.?$/i
]

/**
 * Clear standby / end-voice intent that may sit mid-clause after filler
 * (“with that said, now you can go and standby”).
 */
const STANDBY_INTENT: RegExp[] = [
  // Short standalone directives after filler/trailing strip also hit END_VOICE_WHOLE.
  // Keep mid-clause intents here (not bare “sleep” — too many false positives).
  /\b(go\s+to\s+|enter\s+|engage\s+)?standby(\s+mode)?\b/i,
  /\byou\s+can\s+(be\s+)?(on\s+)?standby(\s+mode)?\b/i,
  /\byou\s+can\s+go\s+(and|to|on|into)\s+standby(\s+mode)?\b/i,
  /\bnow\s+you\s+can\s+(go\s+(and|to|on|into)\s+)?((be\s+)?on\s+)?standby(\s+mode)?\b/i,
  /\b(i\s+want\s+you\s+to\s+|please\s+|just\s+)?(go|get)\s+(and|to|on|into)\s+standby(\s+mode)?\b/i,
  /\b(enter|engage|enable|activate)\s+standby(\s+mode)?\b/i,
  /\b(be|stay)\s+on\s+standby(\s+mode)?\b/i,
  /\bgo\s+on\s+standby(\s+mode)?\b/i,
  /\bback\s+to\s+(standby|sleep)(\s+mode)?\b/i,
  /\btake\s+(a\s+)?(5|five|break)\b/i,
  /\b(end|stop)\s+(the\s+)?(voice|listening)(\s+(mode|session|for\s+now))?\b/i,
  /\byou\s+can\s+turn\s+(yourself\s+)?off\b/i,
  /\bturn\s+(yourself\s+)?off\b/i,
  // “No Albert, I said you should go to sleep for now.”
  /\b(you\s+should\s+|you\s+need\s+to\s+|i\s+(want|need)\s+you\s+to\s+|i\s+said\s+(you\s+should\s+)?)go\s+to\s+sleep\b/i,
  /\b(you\s+should\s+|you\s+need\s+to\s+)(go\s+to\s+)?sleep\b/i
]

/** Talking about standby / teaching the matcher — not a command to enter it. */
const STANDBY_META =
  /\b(if\s+you\s+hear|that\s+means|from\s+now\s+on|internal\s+logic|update\s+(your|the|my)\s+(internal\s+)?(logic|code|matcher|memory)|keywords?|listen(?:ing)?\s+for|recognize|don'?t\s+just\s+think|in\s+your\s+memory|make\s+sure\s+you\s+(can|recognize|do)|how\s+standby\s+works|what\s+standby\s+means|think\s+about\s+listening)\b/i

/** Explicit negation near a standby phrase. */
const STANDBY_NEGATED =
  /\b(don'?t|do\s+not|never|not\s+yet|no\s+longer)\b[\s\S]{0,48}\b(standby|take\s+(a\s+)?(5|five)|end\s+voice)\b/i

/** “Turn off X” / real tasks — do NOT end voice for these clauses. */
const TURN_OFF_SOMETHING_ELSE =
  /\bturn\s+off\b.+\b(spotify|chrome|safari|brave|firefox|music|lights?|wifi|bluetooth|the\s+\w+)/i

/** Hard task in THIS clause (not the whole multi-sentence blob). */
const CLAUSE_TASK =
  /\b(open|play|launch|click|type|search|continue|browse|spotify|chrome|safari|look\s*up|pull\s*up|fire\s*up|mess\s+around|fix|install|download|write|edit|delete|run)\b/i

const MUTE_WHOLE: RegExp[] = [
  /^(mute|shut\s*up|be\s*quiet)(\s+(please|now))?\.?$/i,
  /^mute\s+(yourself|albert|the\s+mic(rophone)?)(\s+please)?\.?$/i
]

const HIDE_WHOLE: RegExp[] = [
  /^(hide|minimize|minimise)(\s+(yourself|the\s+window|window|albert))?(\s+please)?\.?$/i,
  /^hide\s+the\s+app\.?$/i
]

const SHOW_WHOLE: RegExp[] = [
  /^(show|unhide|restore)(\s+(yourself|the\s+window|window|albert))?(\s+please)?\.?$/i,
  /^come\s+back(\s+please)?\.?$/i
]

const HALLUCINATION_PATTERNS: RegExp[] = [
  /^(thanks?\s+for\s+watching\.?)$/i,
  /^(subscribe\.?)$/i,
  /^(you\.?)$/i,
  /^\.+$/,
  /^uh+$/i,
  /^um+$/i,
  /^hmm+$/i,
  /^(thank you\.?)$/i,
  /^(please subscribe.*)$/i,
  /^(music|applause|laughter)$/i,
  /^\[.*\]$/,
  /^\(.*\)$/,
  // Whisper silence / noise crumbs that used to fake end-voice (“Bye.” → standby)
  /^(bye|goodbye|good\s*bye|hello|hi|hey|yes|no|okay|ok|so|the|a|to|and)\.?$/i,
  /^(thanks?|thank\s+you)(\s+for\s+watching)?\.?$/i,
  // Fan / HVAC / keyboard noise crumbs observed from the local Whisper build.
  /^(you\s+know|i\s+don'?t\s+know|i\s+think\s+so)\.?$/i,
  /^(yeah|yep|nope|mm+|mhm+|huh|eh|ha+|oh+|ow|wow|whoa)\.?$/i,
  /^(okay|alright|all\s+right)(\s+so)?\.?$/i,
  /^(let'?s\s+go|here\s+we\s+go|come\s+on)\.?$/i,
  /^(what|why|how|who|where|when)\??\.?$/i,
  /^(and|but|or|if|then|that'?s\s+it|that'?s\s+all)\.?$/i,
  // Boilerplate Whisper emits for near-silence, especially on video-trained data.
  /^(?:.*\b)?(?:like\s+and\s+subscribe|see\s+you\s+(?:next\s+time|in\s+the\s+next\s+video)|don'?t\s+forget\s+to\s+subscribe)\b.*$/i,
  /^(?:transcription|transcript|translated|subtitles?)\b.*$/i,
  /^[\p{P}\p{S}\s]+$/u,
  // A single repeated token ("the the the", "you you") is never a real ask.
  /^(\b\w+\b)(\s+\1\b){1,}\.?$/i
]

/** Soft phonetic / Whisper repairs before command matching + chat. */
export function correctTranscript(text: string): string {
  let t = text.trim()

  // Name first — wake + “hey Albert …” depend on this
  t = repairAlbertMentions(t, { aggressive: true })
  t = t.replace(/\bin\s+voice\b/gi, 'end voice')
  t = t.replace(/\band\s+voice\b/gi, 'end voice')
  t = t.replace(/\bend\s+boys\b/gi, 'end voice')
  t = t.replace(/\bend\s+void\b/gi, 'end voice')
  t = t.replace(/\bend\s+vice\b/gi, 'end voice')
  t = t.replace(/\bturn off boys\b/gi, 'turn off voice')
  t = t.replace(/\bturn of voice\b/gi, 'turn off voice')
  t = t.replace(/\benjoy\s+for\s+now\b/gi, 'end voice for now')
  t = t.replace(/\bsee\s+ya\b/gi, 'see ya')
  // Normalize stand-by spellings
  t = t.replace(/\bstand[\s-]*by\b/gi, 'standby')
  t = t.replace(/\bgo\s+and\s+standby\b/gi, 'go to standby')
  t = t.replace(/\bbe\s+on\s+standby\b/gi, 'be on standby')
  t = t.replace(/\btake\s+a\s+5\b/gi, 'take 5')
  t = t.replace(/\btake\s+five\b/gi, 'take 5')

  // Domain vocab Whisper often mangles
  t = t.replace(/\bhiku\b/gi, 'Haiku')
  t = t.replace(/\bhigh[- ]?coo\b/gi, 'Haiku')
  t = t.replace(/\bhighkoo\b/gi, 'Haiku')
  t = t.replace(/\bolama\b/gi, 'Ollama')
  t = t.replace(/\bollama\b/gi, 'Ollama')
  t = t.replace(/\bgrock\b/gi, 'Groq')
  t = t.replace(/\bgrok\b/gi, 'Groq')
  t = t.replace(/\byou\s*tube\b/gi, 'YouTube')
  t = t.replace(/\bardu?ino\b/gi, 'Arduino')
  t = t.replace(/\bspot ify\b/gi, 'Spotify')
  t = t.replace(/\bspot a fie\b/gi, 'Spotify')

  t = t.replace(/\bhey albert\b/gi, 'hey A.L.B.E.R.T.')
  t = t.replace(/\bokay albert\b/gi, 'okay A.L.B.E.R.T.')

  return collapseRepeatedTranscript(t)
}

/** Strip fillers so “okay, standby please” → “standby”. */
export function coreUtterance(text: string): string {
  let t = correctTranscript(text).trim()
  for (let i = 0; i < 8; i++) {
    const next = t.replace(FILLER, '').trim()
    if (next === t) break
    t = next
  }
  // Residue after “Uh,” when comma wasn’t eaten with the filler
  t = t.replace(/^[,.…\-–—]+\s*/, '').trim()
  for (let i = 0; i < 4; i++) {
    const next = t.replace(TRAILING_FILLER, '').trim()
    if (next === t) break
    t = next
  }
  return t.replace(/\s+/g, ' ').trim()
}

function clauses(text: string): string[] {
  return text
    .split(/[.!?]+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function matchesWhole(text: string, patterns: RegExp[]): boolean {
  const core = coreUtterance(text)
  if (!core) return false
  return patterns.some((re) => re.test(core))
}

function clauseHasStandbyIntent(clause: string): boolean {
  if (!clause.trim()) return false
  if (TURN_OFF_SOMETHING_ELSE.test(clause)) return false
  // Real work in the same clause (“open Chrome and go on standby”) → don’t hard-stop;
  // let the brain do the work. Pure standby directives still match.
  if (CLAUSE_TASK.test(clause)) return false
  const corrected = correctTranscript(clause)
  return STANDBY_INTENT.some((re) => re.test(corrected))
}

function clauseIsEndVoice(clause: string): boolean {
  if (!clause.trim()) return false
  if (TURN_OFF_SOMETHING_ELSE.test(clause)) return false
  if (CLAUSE_TASK.test(clause)) return false
  if (matchesWhole(clause, END_VOICE_WHOLE)) return true
  if (clauseHasStandbyIntent(clause)) return true
  const core = coreUtterance(clause)
  return /^(you\s+can\s+)?(go\s+(and|to)\s+)?take\s+(a\s+)?(five|5|break)\.?$/i.test(core)
}

/**
 * True when any clause clearly means “go to standby / turn off voice”.
 * Mid-sentence OK when it’s a real directive; meta talk about keywords/memory is ignored
 * unless the last clause is itself a standby command.
 */
export function isEndVoiceCommand(text: string): boolean {
  const corrected = correctTranscript(text)
  if (!corrected) return false
  if (STANDBY_NEGATED.test(corrected)) return false

  const parts = clauses(corrected)
  if (parts.length === 0) return false

  const last = parts[parts.length - 1]!
  // Last sentence wins — “… with that said, now you can go and standby.”
  if (clauseIsEndVoice(last)) return true

  // Teaching / discussing standby: only the last clause can trigger
  if (STANDBY_META.test(corrected)) return false

  // Otherwise any clear directive clause (e.g. “You can be on standby. I’m happy with the speed.”)
  if (parts.some((p) => clauseIsEndVoice(p))) return true

  // Single blob without punctuation
  return clauseIsEndVoice(corrected)
}

const STOPWORD =
  '(?:the|a|an|to|and|or|of|in|on|at|for|is|are|was|were|be|been|am|you|your|i|my|me|it|its|that|this|there|here|now|just|like|so|ok|okay|yes|no|not|uh|um|hmm|mhm|ah|oh|eh|huh|hey|hi|hello|bye|thanks?|thank\\s+you|please|well|yeah|yep|nope|right|really|very|got|get|do|did|does|know|think|mean)'

const STOPWORD_ONLY = new RegExp(
  `^${STOPWORD}(?:\\s+${STOPWORD}){0,5}\\.?$`,
  'i'
)

/**
 * Real speech carries content words. Noise-driven Whisper output is almost
 * always short filler, so requiring at least one content word — and two for
 * anything that would trigger a command — is the cheapest reliable filter.
 */
export function voiceContentWords(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const stop = new RegExp(`^${STOPWORD}$`, 'i')
  return cleaned.filter((word) => word.length > 1 && !stop.test(word))
}

export function isLikelyHallucination(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  if (t.length < 2) return true
  const words = t.split(/\s+/).filter(Boolean)
  if (words.length === 1 && t.length < 4) return true
  // Whisper noise crumbs: "you", "the", "you the", "thank you", etc.
  if (words.length <= 6 && STOPWORD_ONLY.test(t.replace(/[^\w\s']/g, '').trim())) return true
  if (HALLUCINATION_PATTERNS.some((re) => re.test(t))) return true
  // Long-ish output with no content words at all is noise, however many filler
  // words Whisper strung together.
  if (words.length >= 3 && voiceContentWords(t).length === 0) return true
  return false
}

export function isMuteCommand(text: string): boolean {
  const corrected = correctTranscript(text)
  if (!corrected) return false
  return (
    clauses(corrected).some((c) => matchesWhole(c, MUTE_WHOLE) && !CLAUSE_TASK.test(c)) ||
    (clauses(corrected).length <= 1 &&
      matchesWhole(corrected, MUTE_WHOLE) &&
      !CLAUSE_TASK.test(corrected))
  )
}

export function isHideCommand(text: string): boolean {
  const corrected = correctTranscript(text)
  if (!corrected) return false
  return clauses(corrected).some(
    (c) =>
      matchesWhole(c, HIDE_WHOLE) &&
      !CLAUSE_TASK.test(c) &&
      !/\bhide\s+(the\s+)?(?!window|app|yourself)\w+/i.test(c)
  )
}

/** Voice/chat shortcut so Kai can drop a bloated Codex thread without opening Systems. */
export function isNewCodexThreadCommand(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim().toLowerCase()
  return /^(hey\s+)?(a\.?l\.?b\.?e\.?r\.?t\.?[,\s]+)?((please\s+)?(start|open|make|begin)\s+(a\s+)?)?new\s+codex\s+thread\b/.test(
    t
  )
}

export function isShowCommand(text: string): boolean {
  const corrected = correctTranscript(text)
  if (!corrected) return false
  if (/\bshow\s+me\b/i.test(corrected)) return false
  return clauses(corrected).some((c) => matchesWhole(c, SHOW_WHOLE) && !CLAUSE_TASK.test(c))
}

const RESUME_MEDIA =
  /\b(playback|music|song|video|download|spotify|podcast|recording|timer|focus)\b/i

export function parseResumeCapsuleCommand(
  text: string
): { query: string; remainder: string } | null {
  const core = coreUtterance(text)
  if (!core || RESUME_MEDIA.test(core)) return null
  const match = core.match(
    /^(?:resume|restore|load|reopen)\s+(?:the\s+)?(?:context\s+)?(?:capsule\s+)?(?:for\s+|called\s+|named\s+)?["']?(.+?)["']?$/i
  )
  if (!match?.[1]) return null
  const raw = match[1].trim().replace(/[.!]+$/, '')
  const split = raw.match(/^(.*?)(?:\s+(?:and|,)\s+)(.+)$/i)
  const query = (split?.[1] || raw).trim()
  const remainder = (split?.[2] || '').trim()
  if (query.length < 2 || query.length > 80) return null
  if (/^(this|that|it|here|now)$/i.test(query)) return null
  return { query, remainder }
}

export function parseSaveCapsuleCommand(text: string): { title: string } | null {
  const core = coreUtterance(text)
  if (!core) return null
  const named = core.match(
    /^(?:please\s+)?(?:seal|save|store|capture)\s+(?:this\s+)?(?:as\s+)?(?:a\s+)?(?:context\s+)?capsule(?:\s+(?:as|called|named|for)\s+["']?(.+?)["']?)?$/i
  )
  if (named) {
    return { title: (named[1] || '').trim().replace(/[.!]+$/, '') }
  }
  const session = core.match(
    /^(?:please\s+)?(?:save|seal)\s+(?:this\s+)?(?:session|context|position|working state)(?:\s+(?:as|called|named)\s+["']?(.+?)["']?)?$/i
  )
  if (!session) return null
  return { title: (session[1] || '').trim().replace(/[.!]+$/, '') }
}
