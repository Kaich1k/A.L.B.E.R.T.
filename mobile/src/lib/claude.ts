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

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const DEFAULT_MODEL = 'claude-haiku-4-5'
const DEFAULT_TIMEOUT_MS = 22_000

function remoteErrorMessage(data: Record<string, unknown> | null): string | undefined {
  const error = data?.error
  if (!error || typeof error !== 'object' || Array.isArray(error)) return undefined
  return safeRemoteMessage((error as Record<string, unknown>).message)
}

function responseText(data: Record<string, unknown> | null): string {
  if (!Array.isArray(data?.content)) return ''
  return data.content
    .flatMap((block) => {
      if (!block || typeof block !== 'object' || Array.isArray(block)) return []
      const row = block as Record<string, unknown>
      return row.type === 'text' && typeof row.text === 'string' ? [row.text] : []
    })
    .join('\n')
    .trim()
}

export async function chatWithClaude(opts: {
  apiKey: string
  model: string
  messages: ChatMessage[]
  memories: MemoryFact[]
  signal?: AbortSignal
  timeoutMs?: number
  fetchImpl?: FetchLike
  now?: () => number
}): Promise<ProviderReply> {
  const apiKey = opts.apiKey.trim()
  const model = opts.model.trim() || DEFAULT_MODEL
  if (!apiKey) {
    throw new ProviderRequestError({
      message: 'Add your Anthropic API key in Systems.',
      code: 'missing_key',
      provider: 'anthropic',
      model
    })
  }

  const now = opts.now || Date.now
  const startedAt = now()
  try {
    const { response, raw } = await withinRequestBoundary({
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      signal: opts.signal,
      run: async (signal) => {
        const response = await (opts.fetchImpl || fetch)(ANTHROPIC_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model,
            max_tokens: 1024,
            system: `${PHONE_SYSTEM}\n\nKnown memories:\n${memoryBlock(opts.memories)}`,
            messages: historyMessages(opts.messages)
          }),
          signal
        })
        return { response, raw: await response.text() }
      }
    })

    const data = safeJsonObject(raw)
    if (!response.ok) {
      throw providerHttpError({
        provider: 'anthropic',
        model,
        status: response.status,
        remoteMessage: remoteErrorMessage(data),
        retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after'), now())
      })
    }
    if (!data) {
      throw new ProviderRequestError({
        message: 'Anthropic returned a malformed response. Please try again.',
        code: 'invalid_response',
        provider: 'anthropic',
        model,
        retryable: true
      })
    }

    const text = responseText(data)
    if (!text) {
      throw new ProviderRequestError({
        message: 'Anthropic returned an empty response. Please try again.',
        code: 'invalid_response',
        provider: 'anthropic',
        model,
        retryable: true
      })
    }

    const parsed = providerTextResult(text)
    const reportedModel = safeRemoteMessage(data.model) || model
    return {
      reply: parsed.reply,
      newMemories: parsed.memories,
      provider: 'anthropic',
      model: reportedModel,
      latencyMs: Math.max(0, now() - startedAt)
    }
  } catch (error) {
    throw transportProviderError({ error, provider: 'anthropic', model })
  }
}
