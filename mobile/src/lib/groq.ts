import type { ChatMessage, MemoryFact } from '../types'
import {
  historyMessages,
  memoryBlock,
  parseRetryAfterMs,
  PHONE_SYSTEM,
  ProviderRequestError,
  providerHttpError,
  providerTextResult,
  safeJsonObject,
  safeRemoteMessage,
  transportProviderError,
  withinRequestBoundary,
  type FetchLike,
  type ProviderReply
} from './prompt'

const GROQ_BASE = 'https://api.groq.com/openai/v1'
const DEFAULT_TIMEOUT_MS = 28_000
const DEFAULT_ATTEMPT_TIMEOUT_MS = 9_000

export const GROQ_TRANSITION_CUTOFF_MS = Date.parse('2026-08-16T00:00:00Z')
export const GROQ_STABLE_MODELS = [
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
  'qwen/qwen3.6-27b'
] as const
export const GROQ_TRANSITION_MODELS = [
  'llama-3.1-8b-instant',
  'llama-3.3-70b-versatile'
] as const

export function availableGroqModels(nowMs = Date.now()): string[] {
  return [
    ...GROQ_STABLE_MODELS,
    ...(nowMs < GROQ_TRANSITION_CUTOFF_MS ? GROQ_TRANSITION_MODELS : [])
  ]
}

export function groqModelCandidates(primary: string, nowMs = Date.now()): string[] {
  const requested = primary.trim()
  const transitionExpired =
    nowMs >= GROQ_TRANSITION_CUTOFF_MS &&
    (GROQ_TRANSITION_MODELS as readonly string[]).includes(requested)
  const preferred = transitionExpired || !requested ? GROQ_STABLE_MODELS[0] : requested
  return [preferred, ...availableGroqModels(nowMs)]
    .filter((model, index, all) => all.indexOf(model) === index)
}

function remoteErrorMessage(data: Record<string, unknown> | null): string | undefined {
  const error = data?.error
  if (!error || typeof error !== 'object' || Array.isArray(error)) return undefined
  return safeRemoteMessage((error as Record<string, unknown>).message)
}

function successfulText(data: Record<string, unknown> | null): string {
  if (!Array.isArray(data?.choices)) return ''
  const first = data.choices[0]
  if (!first || typeof first !== 'object' || Array.isArray(first)) return ''
  const message = (first as Record<string, unknown>).message
  if (!message || typeof message !== 'object' || Array.isArray(message)) return ''
  const content = (message as Record<string, unknown>).content
  return typeof content === 'string' ? content.trim() : ''
}

function shouldTryAnotherModel(error: ProviderRequestError): boolean {
  if (error.code === 'model_unavailable' || error.code === 'invalid_response') return true
  if (error.code === 'timeout') return true
  return error.code === 'provider_unavailable' && (error.status === 408 || (error.status || 0) >= 500)
}

export async function chatWithGroq(opts: {
  apiKey: string
  model: string
  messages: ChatMessage[]
  memories: MemoryFact[]
  signal?: AbortSignal
  timeoutMs?: number
  attemptTimeoutMs?: number
  fetchImpl?: FetchLike
  now?: () => number
  candidateNowMs?: number
}): Promise<ProviderReply> {
  const apiKey = opts.apiKey.trim()
  const requestedModel = opts.model.trim() || GROQ_STABLE_MODELS[0]
  if (!apiKey) {
    throw new ProviderRequestError({
      message: 'Add your Groq API key in Systems.',
      code: 'missing_key',
      provider: 'groq',
      model: requestedModel
    })
  }

  const now = opts.now || Date.now
  const startedAt = now()
  const totalTimeoutMs = Math.max(1, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const deadlineAt = startedAt + totalTimeoutMs
  const candidates = groqModelCandidates(requestedModel, opts.candidateNowMs ?? Date.now())
  const system = `${PHONE_SYSTEM}\n\nKnown memories:\n${memoryBlock(opts.memories)}`
  const messages = [{ role: 'system', content: system }, ...historyMessages(opts.messages)]
  let lastError: ProviderRequestError | null = null

  for (const model of candidates) {
    if (opts.signal?.aborted) {
      throw new ProviderRequestError({
        message: 'Groq request cancelled.',
        code: 'cancelled',
        provider: 'groq',
        model
      })
    }
    const remainingMs = deadlineAt - now()
    if (remainingMs <= 0) break

    try {
      const { response, raw } = await withinRequestBoundary({
        timeoutMs: Math.min(opts.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS, remainingMs),
        signal: opts.signal,
        run: async (signal) => {
          const response = await (opts.fetchImpl || fetch)(`${GROQ_BASE}/chat/completions`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model,
              messages,
              temperature: 0.7,
              max_tokens: 1024
            }),
            signal
          })
          return { response, raw: await response.text() }
        }
      })

      const data = safeJsonObject(raw)
      if (!response.ok) {
        const remoteMessage = remoteErrorMessage(data)
        let error = providerHttpError({
          provider: 'groq',
          model,
          status: response.status,
          remoteMessage,
          retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after'), now())
        })
        if (
          (response.status === 400 || response.status === 422) &&
          /model|decommission|retir|no longer|not (?:available|supported)/i.test(remoteMessage || '')
        ) {
          error = new ProviderRequestError({
            message: remoteMessage || `${model} is no longer available on Groq.`,
            code: 'model_unavailable',
            provider: 'groq',
            model,
            status: response.status,
            retryable: true
          })
        }
        throw error
      }
      if (!data) {
        throw new ProviderRequestError({
          message: 'Groq returned a malformed response. Trying another model may help.',
          code: 'invalid_response',
          provider: 'groq',
          model,
          retryable: true
        })
      }

      const text = successfulText(data)
      if (!text) {
        throw new ProviderRequestError({
          message: 'Groq returned an empty response. Trying another model may help.',
          code: 'invalid_response',
          provider: 'groq',
          model,
          retryable: true
        })
      }

      const parsed = providerTextResult(text)
      return {
        reply: parsed.reply,
        newMemories: parsed.memories,
        provider: 'groq',
        model: safeRemoteMessage(data.model) || model,
        latencyMs: Math.max(0, now() - startedAt)
      }
    } catch (error) {
      lastError = transportProviderError({ error, provider: 'groq', model })
      if (!shouldTryAnotherModel(lastError)) throw lastError
    }
  }

  if (lastError) throw lastError
  throw new ProviderRequestError({
    message: 'Groq did not respond before the request deadline.',
    code: 'timeout',
    provider: 'groq',
    model: requestedModel,
    retryable: true
  })
}
