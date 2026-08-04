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

export interface CompanionConfig {
  anthropicApiKey: string
  model: string
  macBaseUrl: string
  macToken: string
}
