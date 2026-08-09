import type { ChatMessage, CompanionConfig, MemoryFact, LlmProvider } from '../types'
import { chatWithClaude } from './claude'
import {
  DEFAULT_GEMINI_MODEL,
  GEMINI_MODELS,
  chatWithGemini
} from './gemini'
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

const GEMINI_MODEL_LABELS: Record<string, string> = {
  'gemini-2.5-flash': '2.5 Flash (recommended free tier)',
  'gemini-2.5-flash-lite': '2.5 Flash-Lite (fastest)',
  'gemini-3.5-flash-lite': '3.5 Flash-Lite',
  'gemini-2.5-pro': '2.5 Pro (tighter free quotas)'
}

export function groqModelsForDate(nowMs = Date.now()): ReadonlyArray<{ value: string; label: string }> {
  return availableGroqModels(nowMs)
    .map((value) => ({ value, label: GROQ_MODEL_LABELS[value] || value }))
}

export function geminiModels(): ReadonlyArray<{ value: string; label: string }> {
  return GEMINI_MODELS.map((value) => ({
    value,
    label: GEMINI_MODEL_LABELS[value] || value
  }))
}

/** Compatibility snapshot for consumers that display models without calling modelsFor. */
export const GROQ_MODELS: ReadonlyArray<{ value: string; label: string }> = groqModelsForDate()

const ANTHROPIC_MODEL_IDS = new Set<string>(ANTHROPIC_MODELS.map((model) => model.value))
const ALL_KNOWN_GROQ_MODEL_IDS = new Set<string>([
  ...GROQ_STABLE_MODELS,
  ...GROQ_TRANSITION_MODELS
])
const ALL_KNOWN_GEMINI_MODEL_IDS = new Set<string>(GEMINI_MODELS)
/** Includes room for one or two web_search / web_fetch rounds. */
const DEFAULT_ROUTE_TIMEOUT_MS = 48_000

const FALLBACK_PROVIDER_ORDER: StandaloneProvider[] = ['groq', 'gemini', 'anthropic']

function isGeminiModel(model: string): boolean {
  return ALL_KNOWN_GEMINI_MODEL_IDS.has(model) || model.startsWith('gemini-')
}

export function defaultModelFor(provider: LlmProvider): string {
  if (provider === 'anthropic') return ANTHROPIC_MODELS[0].value
  if (provider === 'gemini') return DEFAULT_GEMINI_MODEL
  return GROQ_STABLE_MODELS[0]
}

export function modelsFor(provider: LlmProvider): ReadonlyArray<{ value: string; label: string }> {
  if (provider === 'anthropic') return ANTHROPIC_MODELS
  const groqModels = groqModelsForDate()
  const gemini = geminiModels()
  if (provider === 'groq') return groqModels
  if (provider === 'gemini') return gemini
  return [
    ...groqModels.map((model) => ({ ...model, label: `Groq · ${model.label}` })),
    ...gemini.map((model) => ({ ...model, label: `Gemini · ${model.label}` })),
    ...ANTHROPIC_MODELS.map((model) => ({ ...model, label: `Anthropic · ${model.label}` }))
  ]
}

export function isModelForProvider(provider: LlmProvider, model: string): boolean {
  return modelsFor(provider).some((candidate) => candidate.value === model)
}

function modelForProvider(provider: StandaloneProvider, selected: string): string {
  const model = selected.trim()
  if (provider === 'anthropic') {
    if (ALL_KNOWN_GROQ_MODEL_IDS.has(model) || isGeminiModel(model) || !model) {
      return ANTHROPIC_MODELS[0].value
    }
    return model
  }
  if (provider === 'gemini') {
    if (ANTHROPIC_MODEL_IDS.has(model) || ALL_KNOWN_GROQ_MODEL_IDS.has(model) || !model) {
      return DEFAULT_GEMINI_MODEL
    }
    return model
  }
  if (ANTHROPIC_MODEL_IDS.has(model) || isGeminiModel(model) || !model) {
    return GROQ_STABLE_MODELS[0]
  }
  return model
}

/** Auto is an explicit privacy boundary: it crosses providers only with user keys present. */
export function autoRouteOrder(opts: {
  anthropicApiKey: string
  groqApiKey: string
  geminiApiKey?: string
  model: string
}): StandaloneProvider[] {
  const available = FALLBACK_PROVIDER_ORDER.filter((provider) => {
    if (provider === 'groq') return Boolean(opts.groqApiKey.trim())
    if (provider === 'gemini') return Boolean(opts.geminiApiKey?.trim())
    return Boolean(opts.anthropicApiKey.trim())
  })
  if (available.length <= 1) return available

  const model = opts.model.trim()
  let preferred: StandaloneProvider = 'groq'
  if (ANTHROPIC_MODEL_IDS.has(model)) preferred = 'anthropic'
  else if (isGeminiModel(model)) preferred = 'gemini'
  else preferred = 'groq'

  if (!available.includes(preferred)) {
    preferred = available[0]!
  }
  return [preferred, ...available.filter((provider) => provider !== preferred)]
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
    if (provider === 'gemini') {
      return chatWithGemini({
        apiKey: config.geminiApiKey,
        model,
        messages,
        memories,
        signal: opts.signal,
        timeoutMs,
        fetchImpl: opts.fetchImpl,
        now
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

  if (config.provider === 'anthropic' || config.provider === 'groq' || config.provider === 'gemini') {
    const result = await run(config.provider, totalTimeoutMs)
    return { ...result, latencyMs: Math.max(0, now() - startedAt) }
  }

  const route = autoRouteOrder(config)
  if (route.length === 0) {
    throw new ProviderRequestError({
      message: 'Auto needs a Groq, Gemini, or Anthropic API key in Systems.',
      code: 'missing_key',
      provider: 'auto'
    })
  }
  if (route.length === 1) {
    const result = await run(route[0]!, totalTimeoutMs)
    return { ...result, latencyMs: Math.max(0, now() - startedAt) }
  }

  let lastError: ProviderRequestError | null = null
  for (let index = 0; index < route.length; index += 1) {
    const provider = route[index]!
    const remainingMs = totalTimeoutMs - (now() - startedAt)
    if (remainingMs <= 0) break
    const isLast = index === route.length - 1
    const budgetMs = isLast
      ? remainingMs
      : Math.max(1, Math.min(22_000, Math.floor(remainingMs * (index === 0 ? 0.62 : 0.5))))
    try {
      const result = await run(provider, budgetMs)
      return {
        ...result,
        fallbackFrom: index === 0 ? undefined : route[0],
        latencyMs: Math.max(0, now() - startedAt)
      }
    } catch (error) {
      lastError = error instanceof ProviderRequestError
        ? error
        : new ProviderRequestError({
            message: `${provider} failed unexpectedly.`,
            code: 'provider_unavailable',
            provider,
            retryable: true
          })
      if (lastError.code === 'cancelled' || opts.signal?.aborted) throw lastError
    }
  }

  throw new ProviderRequestError({
    message: `Auto routing could not answer. ${lastError?.message || 'No provider responded.'}`,
    code: lastError?.code || 'provider_unavailable',
    provider: 'auto',
    model: lastError?.model,
    status: lastError?.status,
    retryAfterMs: lastError?.retryAfterMs,
    retryable: lastError?.retryable ?? true
  })
}
