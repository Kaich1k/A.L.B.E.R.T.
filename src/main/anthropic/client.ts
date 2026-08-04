import Anthropic from '@anthropic-ai/sdk'
import { getSettings, requireAnthropicApiKey } from '../config'

export function createAnthropic(): Anthropic {
  return new Anthropic({ apiKey: requireAnthropicApiKey() })
}

/** @deprecated prefer selectModelTier / powerModel */
export function getChatModel(): string {
  const s = getSettings()
  return s.powerModel || s.model || 'claude-opus-5'
}

export function getFastModel(): string {
  return getSettings().fastModel || 'claude-haiku-4-5'
}

export function getPowerModel(): string {
  const s = getSettings()
  return s.powerModel || s.model || 'claude-opus-5'
}
