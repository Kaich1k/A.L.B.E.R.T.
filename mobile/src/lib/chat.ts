import type { ChatMessage, CompanionConfig, MemoryFact, LlmProvider } from '../types'
import { chatWithClaude } from './claude'
import { chatWithGroq } from './groq'

export const ANTHROPIC_MODELS = [
  { value: 'claude-haiku-4-5', label: 'Haiku (fast)' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet' },
  { value: 'claude-opus-4-8', label: 'Opus' }
] as const

export const GROQ_MODELS = [
  { value: 'llama-3.1-8b-instant', label: 'Llama 8B (fast)' },
  { value: 'llama-3.3-70b-versatile', label: 'Llama 70B' },
  { value: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B' },
  { value: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B' }
] as const

export function defaultModelFor(provider: LlmProvider): string {
  return provider === 'groq' ? GROQ_MODELS[0].value : ANTHROPIC_MODELS[0].value
}

export function modelsFor(provider: LlmProvider): ReadonlyArray<{ value: string; label: string }> {
  return provider === 'groq' ? GROQ_MODELS : ANTHROPIC_MODELS
}

export function isModelForProvider(provider: LlmProvider, model: string): boolean {
  return modelsFor(provider).some((m) => m.value === model)
}

export async function chatWithProvider(opts: {
  config: CompanionConfig
  messages: ChatMessage[]
  memories: MemoryFact[]
}): Promise<{ reply: string; newMemories: { category: string; content: string }[] }> {
  const { config, messages, memories } = opts
  if (config.provider === 'groq') {
    return chatWithGroq({
      apiKey: config.groqApiKey,
      model: config.model,
      messages,
      memories
    })
  }
  return chatWithClaude({
    apiKey: config.anthropicApiKey,
    model: config.model,
    messages,
    memories
  })
}
