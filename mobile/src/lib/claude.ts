import type { ChatMessage, MemoryFact } from '../types'
import { historyMessages, memoryBlock, parseMemoryLines, PHONE_SYSTEM } from './prompt'

export async function chatWithClaude(opts: {
  apiKey: string
  model: string
  messages: ChatMessage[]
  memories: MemoryFact[]
}): Promise<{ reply: string; newMemories: { category: string; content: string }[] }> {
  if (!opts.apiKey.trim()) throw new Error('Add your Anthropic API key under Pair')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': opts.apiKey.trim(),
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: opts.model || 'claude-haiku-4-5',
      max_tokens: 1024,
      system: `${PHONE_SYSTEM}\n\nKnown memories:\n${memoryBlock(opts.memories)}`,
      messages: historyMessages(opts.messages)
    })
  })

  const data = (await res.json()) as {
    error?: { message?: string }
    content?: Array<{ type: string; text?: string }>
  }

  if (!res.ok) {
    throw new Error(data.error?.message || `Claude request failed (${res.status})`)
  }

  const text = (data.content || [])
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text || '')
    .join('\n')
    .trim()

  const parsed = parseMemoryLines(text)
  return { reply: parsed.clean || text, newMemories: parsed.memories }
}
