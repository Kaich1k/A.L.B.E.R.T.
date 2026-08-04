import { getSettings } from '../config'
import { streamOpenAiChatCompletions } from '../llm/openaiStream'
import { getOpenAIToolSchemasForOllama } from '../tools/registry'
import { looksLikeTextToolCall, normalizeToolCalls } from '../agent/textToolCalls'
import type {
  OllamaChatMessage,
  OllamaChatResult,
  OllamaToolCall
} from '../ollama/client'

const GROQ_BASE = 'https://api.groq.com/openai/v1'

function requireGroqKey(): string {
  const key = getSettings().groqApiKey?.trim() || process.env.GROQ_API_KEY || ''
  if (!key) {
    throw new Error(
      'Groq API key is not set. Add it in Systems → LOCAL provider Groq, or set GROQ_API_KEY. Get a key at https://console.groq.com/keys'
    )
  }
  return key
}

function serializeMessages(messages: OllamaChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((m) => {
    const row: Record<string, unknown> = {
      role: m.role,
      content: m.content
    }
    if (m.tool_call_id) row.tool_call_id = m.tool_call_id
    if (m.tool_calls?.length) row.tool_calls = m.tool_calls
    return row
  })
}

/** Flatten multimodal content — Groq vision varies by model; keep LOCAL text-first. */
function textOnlyMessages(messages: OllamaChatMessage[]): OllamaChatMessage[] {
  return messages.map((m) => {
    let content = ''
    if (typeof m.content === 'string') content = m.content
    else if (Array.isArray(m.content)) {
      content = m.content
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n')
    }
    return {
      role: m.role,
      content: content || '(empty)',
      tool_call_id: m.tool_call_id,
      tool_calls: m.tool_calls
    }
  })
}

async function postChat(opts: {
  model: string
  messages: OllamaChatMessage[]
  tools: boolean
  onToken?: (delta: string) => void
}): Promise<OllamaChatResult> {
  const key = requireGroqKey()
  const useTools = opts.tools
  const tools = useTools ? getOpenAIToolSchemasForOllama() : undefined
  const wantStream = Boolean(opts.onToken)

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: serializeMessages(opts.messages),
    // Real SSE streaming — fake “onToken(full text)” at the end made voice wait ~10s
    stream: wantStream,
    temperature: 0.7
  }
  if (tools?.length) {
    body.tools = tools
    body.tool_choice = 'auto'
  }

  const response = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Groq error ${response.status}: ${errText.slice(0, 400)}`)
  }

  if (wantStream) {
    const streamed = await streamOpenAiChatCompletions(response, opts.model, opts.onToken)
    // If the model emitted tool-call syntax as plain text, don't leave it in the buffer
    if (looksLikeTextToolCall(streamed.content) && !streamed.tool_calls.length) {
      return streamed
    }
    return streamed
  }

  const data = (await response.json()) as {
    model?: string
    choices?: Array<{
      message?: {
        content?: string | null
        tool_calls?: OllamaToolCall[]
      }
    }>
  }

  const msg = data.choices?.[0]?.message
  const content = (msg?.content || '').trim()
  const tool_calls = normalizeToolCalls(msg?.tool_calls || [])
  if (
    opts.onToken &&
    content &&
    !tool_calls.length &&
    !looksLikeTextToolCall(content)
  ) {
    opts.onToken(content)
  }
  return {
    content,
    tool_calls,
    model: data.model || opts.model
  }
}

/**
 * Groq OpenAI-compatible chat. Retries without tools / text-only on 429/5xx.
 */
export async function groqChatCompletion(opts: {
  model: string
  messages: OllamaChatMessage[]
  tools?: boolean
  onToken?: (delta: string) => void
}): Promise<OllamaChatResult> {
  const wantTools = opts.tools !== false
  const attempts: Array<{ messages: OllamaChatMessage[]; tools: boolean; label: string }> = [
    { messages: opts.messages, tools: wantTools, label: 'tools' }
  ]
  if (wantTools) {
    attempts.push({ messages: opts.messages, tools: false, label: 'no-tools' })
  }
  attempts.push({
    messages: textOnlyMessages(opts.messages),
    tools: false,
    label: 'text-only'
  })

  let lastError: Error | null = null
  for (const attempt of attempts) {
    try {
      return await postChat({
        model: opts.model,
        messages: attempt.messages,
        tools: attempt.tools,
        onToken: opts.onToken
      })
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      const msg = lastError.message
      const retryable = /\b(429|500|502|503|529)\b/.test(msg)
      if (!retryable) throw lastError
    }
  }
  throw lastError || new Error('Groq request failed')
}

export async function probeGroq(): Promise<{
  ok: boolean
  mode: 'cloud'
  detail: string
}> {
  try {
    const key = getSettings().groqApiKey?.trim() || process.env.GROQ_API_KEY || ''
    if (!key) {
      return { ok: false, mode: 'cloud', detail: 'No Groq API key set' }
    }
    const model = getSettings().groqModel || 'llama-3.1-8b-instant'
    const res = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 8,
        stream: false
      }),
      signal: AbortSignal.timeout(20_000)
    })
    if (res.ok) {
      return { ok: true, mode: 'cloud', detail: `Groq OK (${model})` }
    }
    const err = await res.text()
    return {
      ok: false,
      mode: 'cloud',
      detail: `HTTP ${res.status}: ${err.slice(0, 180)}`
    }
  } catch (err) {
    return {
      ok: false,
      mode: 'cloud',
      detail: err instanceof Error ? err.message : String(err)
    }
  }
}
