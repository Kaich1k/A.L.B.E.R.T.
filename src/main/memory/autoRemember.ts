/**
 * Quiet auto-memory: pull lasting facts out of what Kai says, without waiting
 * for him to say "remember this" or for the model to call the remember tool.
 *
 * Narrow on purpose — one-off tasks and secrets must not land in the DB.
 */
import {
  extractDurableFacts,
  normalizeFactKey
} from '../chatgptImport/parse'

export const AUTO_MEMORY_CATEGORY = 'auto'
export const AUTO_MEMORY_LIMIT = 3

const MIN_FACT_CHARS = 12
const MAX_FACT_CHARS = 320

/** Extra live-chat shapes the ChatGPT-export extractor does not cover. */
const LIVE_PATTERNS: RegExp[] = [
  /\bfrom now on\b/i,
  /\bkeep in mind\b/i,
  /\bfor the record\b/i,
  /\bi (?:always|never|usually|rarely)\b/i,
  /\bi (?:decided|chose) to\b/i,
  /\bi (?:don't|do not) (?:like|want|eat|drink|use|need)\b/i,
  /\bi(?:'m| am) allergic\b/i,
  /\bi work (?:at|on|as|for)\b/i,
  /\bi live (?:in|at|near)\b/i,
  /\bwe(?:'re| are) (?:building|working on|using)\b/i,
  /\bplease (?:always|never|don't|do not)\b/i,
  /\bi need you to (?:always|never|remember)\b/i,
  /\bmy (?:assistant|deadline|partner|wife|girlfriend|boyfriend|son|daughter|kids?|parents?|school|university|professor|timezone|allergy)\b/i,
  /\b(?:project|repo|app) (?:is|called|named)\b/i
]

const REJECT_MORE: RegExp[] = [
  /```/,
  /\b(?:password|passwd|api[- ]?key|secret\b|token\b|ssn|social security|credit card|private key)\b/i,
  /^(please\s+)?(open|launch|click|screenshot|search|google|play|stop|mute|hide|show)\b/i,
  /\b(?:this (?:code|error|file|bug|test)|stack trace|typeerror)\b/i,
  /\b(?:inspect this project|run the tests|fix (?:this|it|the))\b/i
]

function splitSentences(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function looksDurable(sentence: string): boolean {
  if (sentence.length < MIN_FACT_CHARS || sentence.length > MAX_FACT_CHARS) return false
  if (REJECT_MORE.some((re) => re.test(sentence))) return false
  if (LIVE_PATTERNS.some((re) => re.test(sentence))) return true
  return false
}

/** Durable facts from one user utterance, newest-unique, capped. */
export function extractAutoMemories(text: string): string[] {
  if (!text || text.length > 6_000) return []

  const found: string[] = []
  const seen = new Set<string>()

  const add = (fact: string): void => {
    const cleaned = fact.replace(/\s+/g, ' ').trim()
    const key = normalizeFactKey(cleaned)
    if (!key || seen.has(key)) return
    if (REJECT_MORE.some((re) => re.test(cleaned))) return
    seen.add(key)
    found.push(cleaned)
  }

  for (const fact of extractDurableFacts(text)) add(fact)
  for (const sentence of splitSentences(text)) {
    if (looksDurable(sentence)) add(sentence)
  }

  return found
}

export function selectNewAutoMemories(
  text: string,
  existingContent: string[],
  limit = AUTO_MEMORY_LIMIT
): string[] {
  const existing = new Set(existingContent.map(normalizeFactKey).filter(Boolean))
  const out: string[] = []
  for (const fact of extractAutoMemories(text)) {
    const key = normalizeFactKey(fact)
    if (!key || existing.has(key)) continue
    existing.add(key)
    out.push(fact)
    if (out.length >= limit) break
  }
  return out
}
