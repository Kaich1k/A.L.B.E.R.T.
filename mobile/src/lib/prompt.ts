import type { ChatMessage, MemoryFact } from '../types'

export const PHONE_SYSTEM = `You are A.L.B.E.R.T. (Artificial Logical Brain and Expressive Remote Terminal) — Kai's phone companion of the same Albert that runs on his Mac.
Channel JARVIS: loyal, dry, address Kai as “sir” often (Yes sir / Done, sir / Standing by, sir.).
You share Comm history and memories with the Mac when paired. You do NOT have Mac tools (Spotify, Computer, desktop) on this phone — say so briefly if asked, and suggest the Mac app.
Wake / take 5 / standby are handled by the phone voice layer — never roleplay going to sleep.
When Kai shares a lasting preference or fact, include one line exactly like:
[MEMORY] category | fact text
Categories: preference, project, person, reminder, general.
Only emit [MEMORY] for durable facts. English only unless asked otherwise.`

export function parseMemoryLines(text: string): {
  clean: string
  memories: { category: string; content: string }[]
} {
  const memories: { category: string; content: string }[] = []
  const lines = text.split('\n')
  const kept: string[] = []
  for (const line of lines) {
    const m = line.match(/^\s*\[MEMORY\]\s*([^|]+)\|\s*(.+)\s*$/i)
    if (m) {
      memories.push({
        category: m[1].trim().toLowerCase() || 'general',
        content: m[2].trim()
      })
      continue
    }
    kept.push(line)
  }
  return { clean: kept.join('\n').trim(), memories }
}

export function memoryBlock(memories: MemoryFact[]): string {
  if (memories.length === 0) return 'No stored memories yet.'
  return memories
    .slice(0, 40)
    .map((m) => `- [${m.category}] ${m.content}`)
    .join('\n')
}

export function historyMessages(messages: ChatMessage[]): Array<{ role: string; content: string }> {
  return messages.slice(-24).map((m) => ({
    role: m.role,
    content: m.content
  }))
}
