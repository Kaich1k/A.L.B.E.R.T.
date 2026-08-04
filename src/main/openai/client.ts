import OpenAI from 'openai'
import { getSettings, requireOpenAIApiKey } from '../config'

export function createOpenAI(): OpenAI {
  return new OpenAI({ apiKey: requireOpenAIApiKey() })
}

export function hasOpenAIKey(): boolean {
  return Boolean(getSettings().openaiApiKey?.trim() || process.env.OPENAI_API_KEY)
}

export function getRealtimeModel(): string {
  return getSettings().realtimeModel || 'gpt-realtime'
}

export function getVoice(): string {
  return getSettings().voice || 'marin'
}
