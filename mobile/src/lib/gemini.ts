import type { ChatMessage, MemoryFact, PersonalityScales } from '../types'
import {
  buildPhoneSystem,
  completionTokenBudget,
  openAiHistoryMessages,
  parseRetryAfterMs,
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
  toOpenAITools
} from './phoneTools'

/** Google AI Studio / Gemini OpenAI-compatible endpoint. */
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai'
const DEFAULT_TIMEOUT_MS = 42_000
const DEFAULT_ATTEMPT_TIMEOUT_MS = 14_000
const MAX_TOOL_ROUNDS = 3

/** Current Google AI Studio Flash route. 2.5 Flash is leaving free plans. */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash'

export const GEMINI_MODELS = [
  DEFAULT_GEMINI_MODEL,
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro'
] as const

export function geminiModelCandidates(primary: string): string[] {
  const requested = primary.trim() || DEFAULT_GEMINI_MODEL
  return [requested, ...GEMINI_MODELS].filter((model, index, all) => all.indexOf(model) === index)
}

function remoteErrorMessage(data: Record<string, unknown> | null): string | undefined {
  const error = data?.error
  if (!error || typeof error !== 'object' || Array.isArray(error)) return undefined
  return safeRemoteMessage((error as Record<string, unknown>).message)
}

type OpenAIToolCall = {
  id: string
  type?: string
  function?: { name?: string; arguments?: string }
  extra_content?: { google?: { thought_signature?: string } }
}

function withThoughtSignatures(calls: OpenAIToolCall[]): OpenAIToolCall[] {
  if (!calls.length) return calls
  return calls.map((call, index) => {
    const existing = call.extra_content?.google?.thought_signature?.trim()
    if (existing || index !== 0) return call
    return {
      ...call,
      extra_content: { google: { thought_signature: 'skip_thought_signature_validator' } }
    }
  })
}

function successfulMessage(data: Record<string, unknown> | null): {
  text: string
  toolCalls: OpenAIToolCall[]
} | null {
  if (!Array.isArray(data?.choices)) return null
  const first = data.choices[0]
  if (!first || typeof first !== 'object' || Array.isArray(first)) return null
  const message = (first as Record<string, unknown>).message
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null
  const row = message as Record<string, unknown>
  const content = typeof row.content === 'string' ? row.content.trim() : ''
  const toolCalls = Array.isArray(row.tool_calls)
    ? (row.tool_calls as OpenAIToolCall[]).filter(
        (call) => call && typeof call === 'object' && typeof call.function?.name === 'string'
      )
    : []
  if (!content && toolCalls.length === 0) return null
  return { text: content, toolCalls }
}

function looksLikeUnavailableModel(status: number | undefined, message: string): boolean {
  if (status === 404) return true
  if (status === 403) {
    return /model|plan|not (included|available|enabled|allowed)|permission/i.test(message)
  }
  return /model|not found|unsupported|unknown|not included|not (available|enabled|allowed)|your (current )?plan/i.test(
    message
  )
}

function shouldTryAnotherModel(error: ProviderRequestError): boolean {
  if (error.code === 'model_unavailable' || error.code === 'invalid_response') return true
  if (error.code === 'timeout') return true
  if (looksLikeUnavailableModel(error.status, error.message)) return true
  return error.code === 'provider_unavailable' && (error.status === 408 || (error.status || 0) >= 500)
}

function toolsUnsupported(error: ProviderRequestError): boolean {
  if (error.code !== 'invalid_request') return false
  return /tool|function.?call|functions|thought_signatur/i.test(error.message)
}

export async function chatWithGemini(opts: {
  apiKey: string
  model: string
  messages: ChatMessage[]
  memories: MemoryFact[]
  personality?: PersonalityScales | null
  signal?: AbortSignal
  timeoutMs?: number
  attemptTimeoutMs?: number
  fetchImpl?: FetchLike
  now?: () => number
}): Promise<ProviderReply> {
  const apiKey = opts.apiKey.trim()
  const requestedModel = opts.model.trim() || DEFAULT_GEMINI_MODEL
  if (!apiKey) {
    throw new ProviderRequestError({
      message: 'Add your Gemini API key in Systems (aistudio.google.com/apikey).',
      code: 'missing_key',
      provider: 'gemini',
      model: requestedModel
    })
  }

  const now = opts.now || Date.now
  const startedAt = now()
  const totalTimeoutMs = Math.max(1, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const deadlineAt = startedAt + totalTimeoutMs
  const candidates = geminiModelCandidates(requestedModel)
  const system = buildPhoneSystem(opts.memories, opts.personality)
  const maxTokens = completionTokenBudget(opts.personality?.verbosity ?? 35, { forTools: true })
  const tools = toOpenAITools()
  let lastError: ProviderRequestError | null = null

  for (const model of candidates) {
    if (opts.signal?.aborted) {
      throw new ProviderRequestError({
        message: 'Gemini request cancelled.',
        code: 'cancelled',
        provider: 'gemini',
        model
      })
    }
    const remainingMs = deadlineAt - now()
    if (remainingMs <= 0) break

    for (const useTools of [true, false]) {
      try {
        const transcript: Array<Record<string, unknown>> = [
          { role: 'system', content: system },
          ...openAiHistoryMessages(opts.messages)
        ]

        for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
          const roundRemaining = deadlineAt - now()
          if (roundRemaining <= 0) {
            throw new ProviderRequestError({
              message: 'Gemini did not respond before the request deadline.',
              code: 'timeout',
              provider: 'gemini',
              model,
              retryable: true
            })
          }

          const body: Record<string, unknown> = {
            model,
            messages: transcript,
            temperature: 0.7,
            max_tokens: maxTokens
          }
          if (useTools) body.tools = tools

          const { response, raw } = await withinRequestBoundary({
            timeoutMs: Math.min(opts.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS, roundRemaining),
            signal: opts.signal,
            run: async (signal) => {
              const response = await (opts.fetchImpl || fetch)(`${GEMINI_BASE}/chat/completions`, {
                method: 'POST',
                headers: {
                  'content-type': 'application/json',
                  authorization: `Bearer ${apiKey}`
                },
                body: JSON.stringify(body),
                signal
              })
              return { response, raw: await response.text() }
            }
          })

          const data = safeJsonObject(raw)
          if (!response.ok) {
            const remoteMessage = remoteErrorMessage(data)
            let error = providerHttpError({
              provider: 'gemini',
              model,
              status: response.status,
              remoteMessage,
              retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after'), now())
            })
            const planBlocked =
              error.code !== 'authentication' || /model|plan/i.test(remoteMessage || '')
            if (planBlocked && looksLikeUnavailableModel(response.status, remoteMessage || error.message)) {
              error = new ProviderRequestError({
                message: remoteMessage || `${model} is not available on this Gemini plan.`,
                code: 'model_unavailable',
                provider: 'gemini',
                model,
                status: response.status,
                retryable: true
              })
            }
            throw error
          }
          if (!data) {
            throw new ProviderRequestError({
              message: 'Gemini returned a malformed response. Trying another model may help.',
              code: 'invalid_response',
              provider: 'gemini',
              model,
              retryable: true
            })
          }

          const message = successfulMessage(data)
          if (!message) {
            throw new ProviderRequestError({
              message: 'Gemini returned an empty response. Trying another model may help.',
              code: 'invalid_response',
              provider: 'gemini',
              model,
              retryable: true
            })
          }

          if (useTools && message.toolCalls.length > 0 && round < MAX_TOOL_ROUNDS) {
            transcript.push({
              role: 'assistant',
              content: message.text || null,
              tool_calls: withThoughtSignatures(message.toolCalls)
            })
            for (const call of message.toolCalls) {
              const name = call.function?.name || 'unknown'
              const args = parseToolArguments(call.function?.arguments)
              const result = await executePhoneTool(name, args)
              transcript.push({
                role: 'tool',
                tool_call_id: call.id || `call_${name}`,
                content: result.result
              })
            }
            continue
          }

          const parsed = providerTextResult(message.text || 'Understood, sir.')
          return {
            reply: parsed.reply,
            newMemories: parsed.memories,
            provider: 'gemini',
            model: safeRemoteMessage(data.model) || model,
            latencyMs: Math.max(0, now() - startedAt)
          }
        }

        throw new ProviderRequestError({
          message: 'Gemini exceeded the web-tool loop limit without a final reply.',
          code: 'invalid_response',
          provider: 'gemini',
          model,
          retryable: true
        })
      } catch (error) {
        lastError = transportProviderError({ error, provider: 'gemini', model })
        if (useTools && toolsUnsupported(lastError)) continue
        if (!shouldTryAnotherModel(lastError)) throw lastError
        break
      }
    }
  }

  if (lastError) throw lastError
  throw new ProviderRequestError({
    message: 'Gemini did not respond before the request deadline.',
    code: 'timeout',
    provider: 'gemini',
    model: requestedModel,
    retryable: true
  })
}
