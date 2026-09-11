/**
 * Parse an official ChatGPT data export into memory facts.
 *
 * There is no API for ChatGPT's saved memories — the export is the only route,
 * which makes this a one-time import rather than a live sync. Pure functions
 * only (no fs, no Electron) so the dedupe and distillation rules are testable.
 */

export const CHATGPT_MEMORY_CATEGORY = 'chatgpt-memory'
export const CHATGPT_HISTORY_CATEGORY = 'chatgpt-history'

export interface ImportCandidate {
  content: string
  category: typeof CHATGPT_MEMORY_CATEGORY | typeof CHATGPT_HISTORY_CATEGORY
  /** Source conversation title, when the fact came from a transcript. */
  source?: string
  createdAt?: number
}

export interface ImportScan {
  memories: ImportCandidate[]
  history: ImportCandidate[]
  /** Saved memories present but switched off in ChatGPT — skipped on purpose. */
  disabledMemories: number
  conversationsSeen: number
  messagesScanned: number
}

/** Cap so one import can't swamp the recall budget with old chatter. */
export const HISTORY_FACT_LIMIT = 400
const MIN_FACT_CHARS = 12
const MAX_FACT_CHARS = 320

/** Current exports may split history into conversations-000.json, etc. */
export function isConversationExportFile(name: string): boolean {
  return /^conversations(?:[-_]\d+)?\.json$/i.test(name.trim())
}

/** Content hash for dedupe: case, punctuation and spacing insensitive. */
export function normalizeFactKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>)
  return []
}

function toMillis(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  // Export timestamps are seconds with a fractional part.
  return value > 1e11 ? Math.round(value) : Math.round(value * 1000)
}

/**
 * `memory.json` has shipped as a bare array, `{ memories: [...] }`, and
 * `{ saved_memories: [...] }`; entries key content as `content`, `text`, or
 * `memory`. Accept all of them.
 */
export function parseMemoryJson(raw: unknown): {
  memories: ImportCandidate[]
  disabled: number
} {
  const root = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const rows = Array.isArray(raw)
    ? raw
    : asArray(root.memories ?? root.saved_memories ?? root.entries ?? root.items ?? [])

  const memories: ImportCandidate[] = []
  let disabled = 0

  for (const entry of rows) {
    if (typeof entry === 'string') {
      const content = entry.trim()
      if (content.length >= MIN_FACT_CHARS) {
        memories.push({ content, category: CHATGPT_MEMORY_CATEGORY })
      }
      continue
    }
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const content = String(row.content ?? row.text ?? row.memory ?? '').trim()
    if (!content) continue

    // Only `enabled === false` counts as off; a missing flag means enabled.
    if (row.enabled === false) {
      disabled += 1
      continue
    }

    memories.push({
      content: content.slice(0, MAX_FACT_CHARS * 2),
      category: CHATGPT_MEMORY_CATEGORY,
      createdAt: toMillis(row.created_at ?? row.create_time ?? row.updated_at)
    })
  }

  return { memories, disabled }
}

/**
 * Sentences that state something durable about Kai. Deliberately narrow — a
 * loose matcher fills memory with one-off task chatter, which is worse than
 * importing nothing.
 */
const DURABLE_PATTERNS: RegExp[] = [
  /^i'?m (?:a|an|the|currently|based|working|studying|building|from|in )\b/i,
  /^i (?:use|prefer|like|love|hate|avoid|always|never|usually|own|run|drive|own a)\b/i,
  /^i'?ve (?:been|got|always)\b/i,
  /^my (?:name|goal|plan|setup|laptop|mac|phone|budget|job|major|degree|project|company|team|dog|cat|birthday|timezone|workflow|preference)\b/i,
  /^call me\b/i,
  /^(?:please )?remember (?:that|this|i|my)\b/i,
  /^i'?m working on\b/i,
  /^i want (?:to build|you to)\b/i,
  /^(?:for context|context:|fyi)[,:]?\s+i\b/i
]

/** Task-shaped or throwaway lines that pass the patterns but aren't facts. */
const REJECT_PATTERNS: RegExp[] = [
  /\b(?:this (?:code|error|file|snippet)|the above|following code)\b/i,
  /```/,
  /^i'?m (?:not sure|confused|getting|seeing|trying to (?:fix|debug|run))\b/i,
  /\b(?:thanks|thank you|ok|okay|got it|nvm|nevermind)\b\s*$/i,
  /^i (?:use|prefer) (?:it|that|this|them)\b/i
]

function splitSentences(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Pull durable-looking self-disclosure out of one user message. */
export function extractDurableFacts(message: string): string[] {
  if (!message || message.length > 4_000) return []
  const out: string[] = []

  for (const sentence of splitSentences(message)) {
    if (sentence.length < MIN_FACT_CHARS || sentence.length > MAX_FACT_CHARS) continue
    if (!DURABLE_PATTERNS.some((re) => re.test(sentence))) continue
    if (REJECT_PATTERNS.some((re) => re.test(sentence))) continue
    out.push(sentence.replace(/\s+/g, ' '))
  }

  return out
}

interface ConversationMessage {
  role: string
  text: string
  createdAt?: number
}

/** Flatten one export conversation node graph into ordered messages. */
export function conversationMessages(conversation: unknown): ConversationMessage[] {
  const convo = (conversation && typeof conversation === 'object'
    ? conversation
    : {}) as Record<string, unknown>
  const nodes = asArray(convo.mapping)
  const rows: ConversationMessage[] = []

  for (const node of nodes) {
    const message = ((node as Record<string, unknown>)?.message ?? null) as
      | Record<string, unknown>
      | null
    if (!message) continue
    const role = String(
      (message.author as Record<string, unknown> | undefined)?.role ?? ''
    )
    const content = (message.content ?? {}) as Record<string, unknown>
    const parts = Array.isArray(content.parts) ? content.parts : []
    const text = parts
      .map((part) =>
        typeof part === 'string'
          ? part
          : String((part as Record<string, unknown>)?.text ?? '')
      )
      .filter(Boolean)
      .join('\n')
      .trim()
    if (!text) continue
    rows.push({ role, text, createdAt: toMillis(message.create_time) })
  }

  // Export order isn't guaranteed; sort so the newest facts win on dedupe.
  return rows.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
}

export function parseConversationsJson(raw: unknown): {
  history: ImportCandidate[]
  conversationsSeen: number
  messagesScanned: number
} {
  const conversations = Array.isArray(raw)
    ? raw
    : asArray((raw as Record<string, unknown>)?.conversations ?? [])

  const history: ImportCandidate[] = []
  const seenKeys = new Set<string>()
  let messagesScanned = 0

  for (const conversation of conversations) {
    const title = String(
      (conversation as Record<string, unknown>)?.title ?? 'ChatGPT conversation'
    ).slice(0, 120)

    for (const message of conversationMessages(conversation)) {
      // Only Kai's own words are treated as facts about Kai.
      if (message.role !== 'user') continue
      messagesScanned += 1
      for (const fact of extractDurableFacts(message.text)) {
        const key = normalizeFactKey(fact)
        if (!key || seenKeys.has(key)) continue
        seenKeys.add(key)
        history.push({
          content: fact,
          category: CHATGPT_HISTORY_CATEGORY,
          source: title,
          createdAt: message.createdAt
        })
      }
    }
  }

  // Newest first, then cap — recent context is the useful part.
  history.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  return {
    history: history.slice(0, HISTORY_FACT_LIMIT),
    conversationsSeen: conversations.length,
    messagesScanned
  }
}

/** Parse one legacy conversation file or any number of current split files. */
export function parseConversationExports(rawFiles: unknown[]): {
  history: ImportCandidate[]
  conversationsSeen: number
  messagesScanned: number
} {
  const conversations: unknown[] = []

  for (const raw of rawFiles) {
    if (Array.isArray(raw)) {
      conversations.push(...raw)
      continue
    }
    if (!raw || typeof raw !== 'object') continue
    conversations.push(...asArray((raw as Record<string, unknown>).conversations ?? []))
  }

  return parseConversationsJson(conversations)
}

/**
 * Drop candidates A.L.B.E.R.T. already knows, comparing against existing memory
 * content so re-running an import is a no-op rather than a duplicate storm.
 */
export function dedupeAgainstExisting(
  candidates: ImportCandidate[],
  existingContent: string[]
): ImportCandidate[] {
  const seen = new Set(existingContent.map(normalizeFactKey).filter(Boolean))
  const out: ImportCandidate[] = []
  for (const candidate of candidates) {
    const key = normalizeFactKey(candidate.content)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(candidate)
  }
  return out
}
