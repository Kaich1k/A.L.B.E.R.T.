import Anthropic from '@anthropic-ai/sdk'
import type { ChatMessage, MemoryFact } from '../types'

const SYSTEM = `You are A.L.B.E.R.T. (Artificial Logical Brain and Expressive Remote Terminal) on a phone companion.
Be concise, capable, and slightly dry. You do not have Mac tools here — only conversation and memory.
When the user shares a lasting preference, fact, or reminder, include one line exactly like:
[MEMORY] category | fact text
Categories: preference, project, person, reminder, general.
Only emit [MEMORY] for durable facts worth keeping. Do not invent memories.`

function parseMemoryLines(text: string): { clean: string; memories: { category: string; content: string }[] } {
  const memories: { category: string; content: string }[] = []
  const lines = text.split('\n')
  const kept: string[] = []
  for (const line of lines) {
    const m = line.match(/^\s*\[MEMORY\]\s*([^|]+)\|\s*(.+)\s*$/i)
    if (m) {
      memories.push({ category: m[1].trim().toLowerCase() || 'general', content: m[2].trim() })
      continue
    }
    kept.push(line)
  }
  return { clean: kept.join('\n').trim(), memories }
}

export async function chatWithClaude(opts: {
  apiKey: string
  model: string
  messages: ChatMessage[]
  memories: MemoryFact[]
}): Promise<{ reply: string; newMemories: { category: string; content: string }[] }> {
  if (!opts.apiKey.trim()) throw new Error('Add your Anthropic API key in Settings')

  const client = new Anthropic({
    apiKey: opts.apiKey.trim(),
    dangerouslyAllowBrowser: true
  })

  const memoryBlock =
    opts.memories.length === 0
      ? 'No stored memories yet.'
      : opts.memories
          .slice(0, 40)
          .map((m) => `- [${m.category}] ${m.content}`)
          .join('\n')

  const history = opts.messages.slice(-24).map((m) => ({
    role: m.role,
    content: m.content
  }))

  const response = await client.messages.create({
    model: opts.model || 'claude-haiku-4-5',
    max_tokens: 1024,
    system: `${SYSTEM}\n\nKnown memories:\n${memoryBlock}`,
    messages: history
  })

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()

  const parsed = parseMemoryLines(text)
  return { reply: parsed.clean || text, newMemories: parsed.memories }
}
