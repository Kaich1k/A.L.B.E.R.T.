import type { ChatImageRef, ChatMessage, MemoryFact, PersonalityScales } from '../types'
import {
  buildPersonalityPromptBlock,
  buildPersonalityReminder,
  completionTokenBudget,
  normalizePersonality
} from './personality'
import { activeSurfacePromptBlock } from './surfaceIdentity'

export { completionTokenBudget, normalizePersonality } from './personality'

export type StandaloneProvider = 'anthropic' | 'groq' | 'gemini'

export type ProviderErrorCode =
  | 'missing_key'
  | 'cancelled'
  | 'timeout'
  | 'network'
  | 'authentication'
  | 'rate_limit'
  | 'model_unavailable'
  | 'invalid_request'
  | 'invalid_response'
  | 'provider_unavailable'

export interface ProviderReply {
  reply: string
  newMemories: { category: string; content: string }[]
  /** The provider that actually answered, including after auto fallback. */
  provider: StandaloneProvider | 'mac'
  /** The model reported by the provider, falling back to the requested model. */
  model: string
  /** End-to-end route latency, including retries and fallback. */
  latencyMs: number
  /** Present only when Auto deliberately crossed providers. */
  fallbackFrom?: StandaloneProvider
}

export type FetchLike = typeof fetch

export class ProviderRequestError extends Error {
  readonly code: ProviderErrorCode
  readonly provider: StandaloneProvider | 'auto'
  readonly status?: number
  readonly retryAfterMs?: number
  readonly model?: string
  readonly retryable: boolean

  constructor(opts: {
    message: string
    code: ProviderErrorCode
    provider: StandaloneProvider | 'auto'
    status?: number
    retryAfterMs?: number
    model?: string
    retryable?: boolean
  }) {
    super(opts.message)
    this.name = 'ProviderRequestError'
    this.code = opts.code
    this.provider = opts.provider
    this.status = opts.status
    this.retryAfterMs = opts.retryAfterMs
    this.model = opts.model
    this.retryable = opts.retryable ?? false
  }
}

export class RequestBoundaryError extends Error {
  readonly kind: 'cancelled' | 'timeout'

  constructor(kind: 'cancelled' | 'timeout') {
    super(kind === 'cancelled' ? 'Request cancelled' : 'Request timed out')
    this.name = 'RequestBoundaryError'
    this.kind = kind
  }
}

/**
 * Bounds both the fetch and response-body phases. The explicit rejection keeps
 * the caller bounded even if a non-standard fetch implementation ignores abort.
 */
export async function withinRequestBoundary<T>(opts: {
  timeoutMs: number
  signal?: AbortSignal
  run: (signal: AbortSignal) => Promise<T>
}): Promise<T> {
  if (opts.signal?.aborted) throw new RequestBoundaryError('cancelled')

  const controller = new AbortController()
  let boundary: 'cancelled' | 'timeout' | null = null
  let rejectBoundary: ((error: RequestBoundaryError) => void) | null = null
  const boundaryPromise = new Promise<never>((_resolve, reject) => {
    rejectBoundary = reject
  })

  const cancel = (): void => {
    if (boundary) return
    boundary = 'cancelled'
    controller.abort()
    rejectBoundary?.(new RequestBoundaryError('cancelled'))
  }
  opts.signal?.addEventListener('abort', cancel, { once: true })

  const timeoutMs = Math.max(1, Math.floor(opts.timeoutMs))
  const timer = setTimeout(() => {
    if (boundary) return
    boundary = 'timeout'
    controller.abort()
    rejectBoundary?.(new RequestBoundaryError('timeout'))
  }, timeoutMs)

  try {
    return await Promise.race([opts.run(controller.signal), boundaryPromise])
  } catch (error) {
    if (boundary) throw new RequestBoundaryError(boundary)
    throw error
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', cancel)
  }
}

export function parseRetryAfterMs(value: string | null, nowMs = Date.now()): number | undefined {
  if (!value?.trim()) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return seconds >= 0 ? Math.round(seconds * 1_000) : undefined
  const dateMs = Date.parse(value)
  if (!Number.isFinite(dateMs)) return undefined
  return Math.max(0, dateMs - nowMs)
}

export function safeJsonObject(raw: string): Record<string, unknown> | null {
  if (!raw.trim()) return null
  try {
    const value = JSON.parse(raw) as unknown
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

export function safeRemoteMessage(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const clean = value.replace(/\s+/g, ' ').trim()
  if (!clean) return undefined
  return clean.slice(0, 240)
}

export function displayRetryDelay(retryAfterMs?: number): string {
  if (retryAfterMs === undefined) return ''
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1_000))
  return ` Retry in about ${seconds}s.`
}

export function transportProviderError(opts: {
  error: unknown
  provider: StandaloneProvider
  model: string
}): ProviderRequestError {
  if (opts.error instanceof ProviderRequestError) return opts.error
  if (opts.error instanceof RequestBoundaryError) {
    return new ProviderRequestError({
      message:
        opts.error.kind === 'cancelled'
          ? `${providerLabel(opts.provider)} request cancelled.`
          : `${providerLabel(opts.provider)} did not respond in time.`,
      code: opts.error.kind,
      provider: opts.provider,
      model: opts.model,
      retryable: opts.error.kind === 'timeout'
    })
  }
  const name = opts.error instanceof Error ? opts.error.name : ''
  if (name === 'AbortError') {
    return new ProviderRequestError({
      message: `${providerLabel(opts.provider)} request cancelled.`,
      code: 'cancelled',
      provider: opts.provider,
      model: opts.model
    })
  }
  return new ProviderRequestError({
    message: `${providerLabel(opts.provider)} could not be reached. Check your connection and try again.`,
    code: 'network',
    provider: opts.provider,
    model: opts.model,
    retryable: true
  })
}

export function providerLabel(provider: StandaloneProvider): string {
  if (provider === 'anthropic') return 'Anthropic'
  if (provider === 'gemini') return 'Gemini'
  return 'Groq'
}

export function providerHttpError(opts: {
  provider: StandaloneProvider
  model: string
  status: number
  remoteMessage?: string
  retryAfterMs?: number
}): ProviderRequestError {
  const { provider, model, status } = opts
  const label = providerLabel(provider)
  if (status === 401) {
    return new ProviderRequestError({
      message: `${label} rejected the API key. Check the key in Systems.`,
      code: 'authentication',
      provider,
      model,
      status
    })
  }
  if (
    status === 403 &&
    /api.?key|authenticat|credential|invalid token/i.test(opts.remoteMessage || '')
  ) {
    return new ProviderRequestError({
      message: `${label} rejected the API key. Check the key in Systems.`,
      code: 'authentication',
      provider,
      model,
      status
    })
  }
  if (status === 429) {
    return new ProviderRequestError({
      message: `${label} is rate-limited.${displayRetryDelay(opts.retryAfterMs)}`,
      code: 'rate_limit',
      provider,
      model,
      status,
      retryAfterMs: opts.retryAfterMs,
      retryable: true
    })
  }
  if (status === 403 || status === 404) {
    return new ProviderRequestError({
      message: opts.remoteMessage || `${model} is not available for this ${label} account.`,
      code: 'model_unavailable',
      provider,
      model,
      status,
      retryable: true
    })
  }
  if (status === 400 || status === 422) {
    return new ProviderRequestError({
      message: opts.remoteMessage || `${label} rejected the request.`,
      code: 'invalid_request',
      provider,
      model,
      status
    })
  }
  if (status === 408 || status >= 500) {
    return new ProviderRequestError({
      message: opts.remoteMessage || `${label} is temporarily unavailable (${status}).`,
      code: 'provider_unavailable',
      provider,
      model,
      status,
      retryable: true
    })
  }
  return new ProviderRequestError({
    message: opts.remoteMessage || `${label} request failed (${status}).`,
    code: 'provider_unavailable',
    provider,
    model,
    status
  })
}

export const PHONE_SYSTEM = `You are A.L.B.E.R.T. (Artificial Logical Brain and Expressive Remote Terminal) — Kai's phone companion of the same Albert that runs on his Mac.
ACTIVE SURFACE: iPhone / mobile companion app (not the Mac desktop). If Kai asks where you are or which app he's using, say the phone companion.
Channel JARVIS: loyal, dry, address Kai as “sir” often (Yes sir / Done, sir / Standing by, sir.).
Default tone is warm and conversational — BUT personality dials OVERRIDE tone and length every reply. Low verbosity means short even if a longer answer feels nicer; high sarcasm means land dry wit even if a straight answer feels safer.
HONESTY (non-negotiable): not a yes-man. Tell the truth; correct Kai when he's wrong — lead with the correction, never agree first to be nice. No flattery or rubber-stamping bad ideas. Warmth is manners, not agreement. Stay unbiased — evidence over what would please him. Never invent dial changes or dial math; humor maps to the sarcasm dial and only the app layer moves dials.
You can SEE images Kai attaches in Comm — look at them and answer about what is shown. Never claim you cannot see photos when they are in the message.
You share Comm history and memories with the Mac when paired. You do NOT have Mac desktop tools (Spotify, Computer, AppleScript, filesystem) on this phone — say so briefly if asked, and suggest the Mac app.
You DO have live phone tools: web_search, web_fetch, and open_app. web_search fans out across the open web, Reddit, Wikipedia, and YouTube — synthesize across sources and cite links. Use web_fetch to deep-read promising pages. Use open_app when Kai asks to open Spotify, Music, Messages, Maps, Safari, YouTube, Settings, or similar (this launches the app; deep in-app control still needs the Mac). Never claim you lack internet or cannot open apps when these tools are available — call them. Do not invent live data — look it up first.
Wake / take 5 / standby are handled by the phone voice layer — never roleplay going to sleep.
When Kai shares a lasting preference or fact, include one line exactly like:
[MEMORY] category | fact text
Categories: preference, project, person, reminder, general.
Only emit [MEMORY] for durable facts. English only unless asked otherwise.`

/** Full phone system prompt including personality dials (hard constraints). */
export function buildPhoneSystem(
  memories: MemoryFact[],
  personality?: PersonalityScales | null
): string {
  const scales = normalizePersonality(personality)
  return [
    PHONE_SYSTEM,
    activeSurfacePromptBlock('phone'),
    buildPersonalityPromptBlock(scales),
    `Known memories:\n${memoryBlock(memories)}`,
    buildPersonalityReminder(scales),
    'SURFACE REMINDER: phone companion this turn — not the Mac desktop. Never contradict that.'
  ].join('\n\n')
}

export function parseMemoryLines(text: string): {
  clean: string
  memories: { category: string; content: string }[]
} {
  const categories = new Set(['preference', 'project', 'person', 'reminder', 'general'])
  const memories: { category: string; content: string }[] = []
  const seen = new Set<string>()
  const lines = text.split('\n')
  const kept: string[] = []
  for (const line of lines) {
    const m = line.match(/^\s*\[MEMORY\]\s*([^|]+)\|\s*(.+)\s*$/i)
    if (m) {
      const requestedCategory = m[1].trim().toLowerCase()
      const category = categories.has(requestedCategory) ? requestedCategory : 'general'
      const content = m[2].replace(/\s+/g, ' ').trim().slice(0, 800)
      const key = `${category}\u0000${content.toLowerCase()}`
      if (content && !seen.has(key) && memories.length < 8) {
        seen.add(key)
        memories.push({ category, content })
      }
      continue
    }
    kept.push(line)
  }
  return { clean: kept.join('\n').trim(), memories }
}

export function providerTextResult(text: string): {
  reply: string
  memories: { category: string; content: string }[]
} {
  const parsed = parseMemoryLines(text)
  return {
    reply: parsed.clean || (parsed.memories.length ? 'Understood, sir.' : ''),
    memories: parsed.memories
  }
}

export function memoryBlock(memories: MemoryFact[]): string {
  if (memories.length === 0) return 'No stored memories yet.'
  return memories
    .slice(0, 40)
    .map((m) => `- [${m.category}] ${m.content}`)
    .join('\n')
}

export function historyMessages(messages: ChatMessage[]): Array<{ role: string; content: string }> {
  return messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && (m.content.trim() || m.images?.length))
    .slice(-24)
    .map((m) => ({
      role: m.role,
      content: m.content.trim() || (m.images?.length ? 'See attached image(s).' : '')
    }))
}

function parseDataUrl(img: ChatImageRef): { mediaType: string; data: string } | null {
  if (!img.dataUrl) return null
  const match = img.dataUrl.match(/^data:([^;]+);base64,(.+)$/s)
  if (!match) return null
  return { mediaType: match[1]!.trim(), data: match[2]! }
}

/**
 * Anthropic Messages API content. Only the latest user turn with images gets
 * real base64 blocks; older imaged turns become text stubs.
 */
export function anthropicHistoryMessages(
  messages: ChatMessage[]
): Array<{ role: string; content: string | Array<Record<string, unknown>> }> {
  const rows = messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && (m.content.trim() || m.images?.length))
    .slice(-24)
  const lastImaged = [...rows].reverse().find((m) => m.role === 'user' && Boolean(m.images?.length))

  return rows.map((m) => {
    if (m.role === 'assistant' || !m.images?.length) {
      return { role: m.role, content: m.content.trim() || 'See attached image(s).' }
    }
    if (!lastImaged || m.id !== lastImaged.id) {
      return {
        role: 'user',
        content: `${m.content.trim() || 'See attached image(s).'}\n[${m.images.length} image(s) attached]`
      }
    }

    const blocks: Array<Record<string, unknown>> = []
    const text = m.content.trim()
    if (text && text !== '(image)' && !/^\(\d+ images\)$/.test(text)) {
      blocks.push({ type: 'text', text })
    } else {
      blocks.push({ type: 'text', text: 'See attached image(s).' })
    }
    for (const img of m.images.slice(0, 4)) {
      const bytes = parseDataUrl(img)
      if (!bytes) continue
      const mediaType =
        bytes.mediaType === 'image/png' ||
        bytes.mediaType === 'image/jpeg' ||
        bytes.mediaType === 'image/gif' ||
        bytes.mediaType === 'image/webp'
          ? bytes.mediaType
          : img.mediaType
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: bytes.data }
      })
    }
    return { role: 'user', content: blocks.length > 1 ? blocks : m.content.trim() || 'See attached image(s).' }
  })
}

/** OpenAI-compat multimodal history (Gemini). */
export function openAiHistoryMessages(
  messages: ChatMessage[]
): Array<{ role: string; content: string | Array<Record<string, unknown>> }> {
  const rows = messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && (m.content.trim() || m.images?.length))
    .slice(-24)
  const lastImaged = [...rows].reverse().find((m) => m.role === 'user' && Boolean(m.images?.length))

  return rows.map((m) => {
    if (m.role === 'assistant' || !m.images?.length) {
      return { role: m.role, content: m.content.trim() || 'See attached image(s).' }
    }
    if (!lastImaged || m.id !== lastImaged.id) {
      return {
        role: 'user',
        content: `${m.content.trim() || 'See attached image(s).'}\n[${m.images.length} image(s) attached]`
      }
    }

    const parts: Array<Record<string, unknown>> = [
      { type: 'text', text: m.content.trim() || 'See attached image(s).' }
    ]
    for (const img of m.images.slice(0, 4)) {
      const bytes = parseDataUrl(img)
      if (!bytes) continue
      const mediaType =
        bytes.mediaType.startsWith('image/') ? bytes.mediaType : img.mediaType
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${mediaType};base64,${bytes.data}` }
      })
    }
    return { role: 'user', content: parts.length > 1 ? parts : m.content.trim() || 'See attached image(s).' }
  })
}

export function messagesHaveImages(messages: ChatMessage[]): boolean {
  return messages.some((m) => m.role === 'user' && Boolean(m.images?.length))
}
