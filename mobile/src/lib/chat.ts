import type { ChatMessage, CompanionConfig, MemoryFact, LlmProvider } from '../types'
import { chatWithClaude } from './claude'
import {
  availableGroqModels,
  chatWithGroq,
  GROQ_STABLE_MODELS,
  GROQ_TRANSITION_MODELS
} from './groq'
import {
  ProviderRequestError,
  type FetchLike,
  type ProviderReply,
  type StandaloneProvider
} from './prompt'

export type { ProviderReply } from './prompt'
export { ProviderRequestError } from './prompt'

export const ANTHROPIC_MODELS = [
  { value: 'claude-haiku-4-5', label: 'Haiku (fast)' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet' },
  { value: 'claude-opus-4-8', label: 'Opus' }
] as const

const GROQ_MODEL_LABELS: Record<string, string> = {
  'openai/gpt-oss-20b': 'GPT-OSS 20B (recommended)',
  'openai/gpt-oss-120b': 'GPT-OSS 120B',
  'qwen/qwen3.6-27b': 'Qwen 3.6 27B (preview)',
  'llama-3.1-8b-instant': 'Llama 8B (temporary bridge; retires Aug 16)',
  'llama-3.3-70b-versatile': 'Llama 70B (temporary bridge; retires Aug 16)'
}

export function groqModelsForDate(nowMs = Date.now()): ReadonlyArray<{ value: string; label: string }> {
  return availableGroqModels(nowMs)
    .map((value) => ({ value, label: GROQ_MODEL_LABELS[value] || value }))
}

/** Compatibility snapshot for consumers that display models without calling modelsFor. */
export const GROQ_MODELS: ReadonlyArray<{ value: string; label: string }> = groqModelsForDate()

const ANTHROPIC_MODEL_IDS = new Set<string>(ANTHROPIC_MODELS.map((model) => model.value))
const ALL_KNOWN_GROQ_MODEL_IDS = new Set<string>([
  ...GROQ_STABLE_MODELS,
  ...GROQ_TRANSITION_MODELS
])
const DEFAULT_ROUTE_TIMEOUT_MS = 36_000

export function defaultModelFor(provider: LlmProvider): string {
  return provider === 'anthropic' ? ANTHROPIC_MODELS[0].value : GROQ_STABLE_MODELS[0]
}

export function modelsFor(provider: LlmProvider): ReadonlyArray<{ value: string; label: string }> {
  if (provider === 'anthropic') return ANTHROPIC_MODELS
  const groqModels = groqModelsForDate()
  if (provider === 'groq') return groqModels
  return [
    ...groqModels.map((model) => ({ ...model, label: `Groq · ${model.label}` })),
    ...ANTHROPIC_MODELS.map((model) => ({ ...model, label: `Anthropic · ${model.label}` }))
  ]
}

export function isModelForProvider(provider: LlmProvider, model: string): boolean {
  return modelsFor(provider).some((candidate) => candidate.value === model)
}

function modelForProvider(provider: StandaloneProvider, selected: string): string {
  const model = selected.trim()
  if (provider === 'anthropic') {
    return ALL_KNOWN_GROQ_MODEL_IDS.has(model) || !model ? ANTHROPIC_MODELS[0].value : model
  }
  return ANTHROPIC_MODEL_IDS.has(model) || !model ? GROQ_STABLE_MODELS[0] : model
}

/** Auto is an explicit privacy boundary: it crosses providers only with both keys present. */
export function autoRouteOrder(opts: {
  anthropicApiKey: string
  groqApiKey: string
  model: string
}): StandaloneProvider[] {
  const hasAnthropic = Boolean(opts.anthropicApiKey.trim())
  const hasGroq = Boolean(opts.groqApiKey.trim())
  if (!hasAnthropic && !hasGroq) return []
  if (!hasAnthropic) return ['groq']
  if (!hasGroq) return ['anthropic']
  return ANTHROPIC_MODEL_IDS.has(opts.model.trim())
    ? ['anthropic', 'groq']
    : ['groq', 'anthropic']
}

export async function chatWithProvider(opts: {
  config: CompanionConfig
  messages: ChatMessage[]
  memories: MemoryFact[]
  signal?: AbortSignal
  timeoutMs?: number
  fetchImpl?: FetchLike
  now?: () => number
  candidateNowMs?: number
}): Promise<ProviderReply> {
  const { config, messages, memories } = opts
  const now = opts.now || Date.now
  const startedAt = now()
  const totalTimeoutMs = Math.max(1, opts.timeoutMs ?? DEFAULT_ROUTE_TIMEOUT_MS)

  const run = async (provider: StandaloneProvider, timeoutMs: number): Promise<ProviderReply> => {
    const model = modelForProvider(provider, config.model)
    if (provider === 'groq') {
      return chatWithGroq({
        apiKey: config.groqApiKey,
        model,
        messages,
        memories,
        signal: opts.signal,
        timeoutMs,
        fetchImpl: opts.fetchImpl,
        now,
        candidateNowMs: opts.candidateNowMs
      })
    }
    return chatWithClaude({
      apiKey: config.anthropicApiKey,
      model,
      messages,
      memories,
      signal: opts.signal,
      timeoutMs,
      fetchImpl: opts.fetchImpl,
      now
    })
  }

  if (config.provider === 'anthropic' || config.provider === 'groq') {
    const result = await run(config.provider, totalTimeoutMs)
    return { ...result, latencyMs: Math.max(0, now() - startedAt) }
  }

  const route = autoRouteOrder(config)
  if (route.length === 0) {
    throw new ProviderRequestError({
      message: 'Auto needs a user-supplied Groq or Anthropic API key in Systems.',
      code: 'missing_key',
      provider: 'auto'
    })
  }
  if (route.length === 1) {
    const result = await run(route[0]!, totalTimeoutMs)
    return { ...result, latencyMs: Math.max(0, now() - startedAt) }
  }

  const primary = route[0]!
  const secondary = route[1]!
  const primaryBudgetMs = Math.max(1, Math.min(22_000, Math.floor(totalTimeoutMs * 0.62)))
  let primaryError: ProviderRequestError
  try {
    const result = await run(primary, primaryBudgetMs)
    return { ...result, latencyMs: Math.max(0, now() - startedAt) }
  } catch (error) {
    primaryError = error instanceof ProviderRequestError
      ? error
      : new ProviderRequestError({
          message: `${primary} failed unexpectedly.`,
          code: 'provider_unavailable',
          provider: primary,
          retryable: true
        })
    if (primaryError.code === 'cancelled' || opts.signal?.aborted) throw primaryError
  }

  const remainingMs = totalTimeoutMs - (now() - startedAt)
  if (remainingMs <= 0) {
    throw new ProviderRequestError({
      message: `Auto routing did not answer before its deadline. ${primaryError.message}`,
      code: 'timeout',
      provider: 'auto',
      retryable: true
    })
  }
  try {
    const result = await run(secondary, remainingMs)
    return {
      ...result,
      fallbackFrom: primary,
      latencyMs: Math.max(0, now() - startedAt)
    }
  } catch (error) {
    const secondaryError = error instanceof ProviderRequestError
      ? error
      : new ProviderRequestError({
          message: `${secondary} failed unexpectedly.`,
          code: 'provider_unavailable',
          provider: secondary,
          retryable: true
        })
    if (secondaryError.code === 'cancelled') throw secondaryError
    throw new ProviderRequestError({
      message: `Auto routing could not answer. ${primaryError.message} ${secondaryError.message}`,
      code: secondaryError.code,
      provider: 'auto',
      model: secondaryError.model,
      status: secondaryError.status,
      retryAfterMs: secondaryError.retryAfterMs,
      retryable: primaryError.retryable || secondaryError.retryable
    })
  }
}
