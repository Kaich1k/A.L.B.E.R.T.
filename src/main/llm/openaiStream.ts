import type { OllamaChatResult, OllamaToolCall } from '../ollama/client'
import { normalizeToolCalls } from '../agent/textToolCalls'

type ToolCallDelta = {
  index?: number
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
  extra_content?: {
    google?: {
      thought_signature?: string
    }
  }
}

/**
 * Parse an OpenAI-compatible chat.completions SSE body.
 * Emits content deltas via onToken as they arrive (so TTS can start early).
 * Accumulates tool_call deltas when present (including Gemini thought signatures).
 */
export async function streamOpenAiChatCompletions(
  response: Response,
  model: string,
  onToken?: (delta: string) => void
): Promise<OllamaChatResult> {
  const reader = response.body?.getReader()
  if (!reader) {
    const text = await response.text()
    if (onToken && text) onToken(text)
    return { content: text.trim(), tool_calls: [], model }
  }

  const decoder = new TextDecoder()
  let content = ''
  let buf = ''
  const toolMap = new Map<number, OllamaToolCall>()

  const mergeToolDelta = (delta: ToolCallDelta): void => {
    const index = delta.index ?? 0
    const existing = toolMap.get(index)
    const signature = delta.extra_content?.google?.thought_signature?.trim()
    if (!existing) {
      const created: OllamaToolCall = {
        id: delta.id || `call_${index}`,
        type: 'function',
        function: {
          name: delta.function?.name || '',
          arguments: delta.function?.arguments || ''
        }
      }
      if (signature) {
        created.extra_content = { google: { thought_signature: signature } }
      }
      toolMap.set(index, created)
      return
    }
    if (delta.id) existing.id = delta.id
    if (delta.function?.name) {
      existing.function.name = (existing.function.name || '') + delta.function.name
    }
    if (delta.function?.arguments) {
      existing.function.arguments =
        (existing.function.arguments || '') + delta.function.arguments
    }
    if (signature) {
      existing.extra_content = { google: { thought_signature: signature } }
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() || ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const json = JSON.parse(payload) as {
          choices?: Array<{
            delta?: {
              content?: string | null
              tool_calls?: ToolCallDelta[]
            }
          }>
        }
        const delta = json.choices?.[0]?.delta
        if (!delta) continue
        if (delta.content) {
          content += delta.content
          onToken?.(delta.content)
        }
        if (delta.tool_calls?.length) {
          for (const tc of delta.tool_calls) mergeToolDelta(tc)
        }
      } catch {
        /* ignore partial JSON */
      }
    }
  }

  const tool_calls = normalizeToolCalls([...toolMap.values()].filter((t) => t.function.name))
  return {
    content: content.trim(),
    tool_calls,
    model
  }
}
