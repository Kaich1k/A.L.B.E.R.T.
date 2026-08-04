import { v4 as uuid } from 'uuid'
import type { OllamaToolCall } from '../ollama/client'
import { getTools } from '../tools/registry'

/** Detect tool-call-looking text the model dumped instead of structured tool_calls. */
export function looksLikeTextToolCall(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (/\b[a-z][a-z0-9_]{2,40}\s*\{[\s\S]*\}/.test(t)) return true
  if (/```(?:tool|json|xml)?/i.test(t) && /\b[a-z][a-z0-9_]{2,40}\b/.test(t)) return true
  if (/<(?:tool_call|function_call|invoke)\b/i.test(t)) return true
  return false
}

function knownToolNames(): Set<string> {
  return new Set(getTools().map((t) => t.name))
}

function coerceArgs(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as unknown
    return typeof parsed === 'string' ? raw : JSON.stringify(parsed ?? {})
  } catch {
    return '{}'
  }
}

/**
 * Pull tool calls out of assistant text (common LOCAL model failure mode).
 * Returns synthetic OpenAI-style tool_calls + content with those spans removed.
 */
export function extractTextToolCalls(content: string): {
  calls: OllamaToolCall[]
  cleaned: string
} {
  const known = knownToolNames()
  const calls: OllamaToolCall[] = []
  let cleaned = content

  const patterns: RegExp[] = [
    // computer_open_tab {"url":"..."}
    /\b([a-z][a-z0-9_]{2,40})\s*(\{[\s\S]*?\})(?=\s*(?:\n|$|[A-Z]|"|`))/g,
    // <tool_call>name\n{...}</tool_call> style
    /<(?:tool_call|function_call)\b[^>]*>\s*([a-z][a-z0-9_]{2,40})\s*(\{[\s\S]*?\})\s*<\/(?:tool_call|function_call)>/gi,
    // invoke tool name with {json}
    /\binvoke\s+([a-z][a-z0-9_]{2,40})\s+(?:with\s+)?(\{[\s\S]*?\})/gi
  ]

  for (const re of patterns) {
    cleaned = cleaned.replace(re, (full, name: string, argsRaw: string) => {
      const toolName = String(name || '').trim()
      if (!known.has(toolName)) return full
      calls.push({
        id: `text_${uuid().slice(0, 8)}`,
        type: 'function',
        function: {
          name: toolName,
          arguments: coerceArgs(String(argsRaw || '{}').trim())
        }
      })
      return ''
    })
  }

  // name on one line, JSON on next
  cleaned = cleaned.replace(
    /(^|\n)\s*([a-z][a-z0-9_]{2,40})\s*\n\s*(\{[\s\S]*?\})\s*(?=\n|$)/g,
    (full, lead: string, name: string, argsRaw: string) => {
      const toolName = String(name || '').trim()
      if (!known.has(toolName)) return full
      calls.push({
        id: `text_${uuid().slice(0, 8)}`,
        type: 'function',
        function: {
          name: toolName,
          arguments: coerceArgs(String(argsRaw || '{}').trim())
        }
      })
      return lead
    }
  )

  // Dedupe identical name+args
  const seen = new Set<string>()
  const unique = calls.filter((c) => {
    const key = `${c.function.name}:${c.function.arguments}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return {
    calls: unique,
    cleaned: cleaned
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\s+|\s+$/g, '')
      .trim()
  }
}

/** Normalize API tool_calls so arguments is always a JSON string. */
export function normalizeToolCalls(raw: unknown): OllamaToolCall[] {
  if (!Array.isArray(raw)) return []
  const out: OllamaToolCall[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const fn = (row.function || row) as Record<string, unknown>
    const name = String(fn.name || '').trim()
    if (!name) continue
    let args = fn.arguments
    if (args == null && fn.parameters != null) args = fn.parameters
    let argStr: string
    if (typeof args === 'string') argStr = args
    else if (args && typeof args === 'object') argStr = JSON.stringify(args)
    else argStr = '{}'
    out.push({
      id: String(row.id || `call_${uuid().slice(0, 8)}`),
      type: 'function',
      function: { name, arguments: argStr }
    })
  }
  return out
}
