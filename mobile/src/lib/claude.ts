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
import {
  executePhoneTool,
  parseToolArguments,
  toAnthropicTools
} from './phoneTools'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const DEFAULT_MODEL = 'claude-haiku-4-5'
const DEFAULT_TIMEOUT_MS = 36_000
const MAX_TOOL_ROUNDS = 3

function remoteErrorMessage(data: Record<string, unknown> | null): string | undefined {
  const error = data?.error
  if (!error || typeof error !== 'object' || Array.isArray(error)) return undefined
  return safeRemoteMessage((error as Record<string, unknown>).message)
}

function responseText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((block) => {
      if (!block || typeof block !== 'object' || Array.isArray(block)) return []
      const row = block as Record<string, unknown>
      return row.type === 'text' && typeof row.text === 'string' ? [row.text] : []
    })
    .join('\n')
    .trim()
}

type AnthropicToolUse = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

function toolUses(content: unknown): AnthropicToolUse[] {
  if (!Array.isArray(content)) return []
  const out: AnthropicToolUse[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue
    const row = block as Record<string, unknown>
    if (row.type !== 'tool_use' || typeof row.name !== 'string' || typeof row.id !== 'string') continue
    out.push({
      type: 'tool_use',
      id: row.id,
      name: row.name,
      input: parseToolArguments(row.input)
    })
  }
  return out
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
  const deadlineAt = startedAt + Math.max(1, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const tools = toAnthropicTools()
  const transcript = historyMessages(opts.messages).map((message) => ({
    role: message.role,
    content: message.content
  })) as Array<Record<string, unknown>>

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
      const remainingMs = deadlineAt - now()
      if (remainingMs <= 0) {
        throw new ProviderRequestError({
          message: 'Anthropic did not respond before the request deadline.',
          code: 'timeout',
          provider: 'anthropic',
          model,
          retryable: true
        })
      }

      const { response, raw } = await withinRequestBoundary({
        timeoutMs: remainingMs,
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
              messages: transcript,
              tools
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

      const content = data.content
      const uses = toolUses(content)
      const stopReason = typeof data.stop_reason === 'string' ? data.stop_reason : ''

      if (uses.length > 0 && (stopReason === 'tool_use' || !responseText(content)) && round < MAX_TOOL_ROUNDS) {
        transcript.push({ role: 'assistant', content })
        const toolResults = []
        for (const use of uses) {
          const result = await executePhoneTool(use.name, use.input)
          toolResults.push({
            type: 'tool_result',
            tool_use_id: use.id,
            content: result.result
          })
        }
        transcript.push({ role: 'user', content: toolResults })
        continue
      }

      const text = responseText(content)
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
      return {
        reply: parsed.reply,
        newMemories: parsed.memories,
        provider: 'anthropic',
        model: safeRemoteMessage(data.model) || model,
        latencyMs: Math.max(0, now() - startedAt)
      }
    }

    throw new ProviderRequestError({
      message: 'Anthropic exceeded the web-tool loop limit without a final reply.',
      code: 'invalid_response',
      provider: 'anthropic',
      model,
      retryable: true
    })
  } catch (error) {
    throw transportProviderError({ error, provider: 'anthropic', model })
  }
}
