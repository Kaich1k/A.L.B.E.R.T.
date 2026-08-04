import type { ChatMessage, MemoryFact } from '../types'
import { historyMessages, memoryBlock, parseMemoryLines, PHONE_SYSTEM } from './prompt'

const GROQ_BASE = 'https://api.groq.com/openai/v1'

export async function chatWithGroq(opts: {
  apiKey: string
  model: string
  messages: ChatMessage[]
  memories: MemoryFact[]
}): Promise<{ reply: string; newMemories: { category: string; content: string }[] }> {
  if (!opts.apiKey.trim()) throw new Error('Add your Groq API key under Pair')

  const system = `${PHONE_SYSTEM}\n\nKnown memories:\n${memoryBlock(opts.memories)}`
  const messages = [
    { role: 'system', content: system },
    ...historyMessages(opts.messages)
  ]

  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${opts.apiKey.trim()}`
    },
    body: JSON.stringify({
      model: opts.model || 'llama-3.1-8b-instant',
      messages,
      temperature: 0.7,
      max_tokens: 1024
    })
  })

  const data = (await res.json()) as {
    error?: { message?: string }
    choices?: Array<{ message?: { content?: string } }>
  }

  if (!res.ok) {
    throw new Error(data.error?.message || `Groq request failed (${res.status})`)
  }

  const text = (data.choices?.[0]?.message?.content || '').trim()
  const parsed = parseMemoryLines(text)
  return { reply: parsed.clean || text, newMemories: parsed.memories }
}
