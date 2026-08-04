export interface MemoryFact {
  id: string
  content: string
  category: string
  createdAt: number
  updatedAt: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
}

export type LlmProvider = 'anthropic' | 'groq'

export interface CompanionConfig {
  provider: LlmProvider
  anthropicApiKey: string
  groqApiKey: string
  model: string
  macBaseUrl: string
  macToken: string
}

export type TabId = 'home' | 'chat' | 'memory' | 'pair'

export type VoicePhase = 'standby' | 'listening' | 'thinking' | 'speaking'
