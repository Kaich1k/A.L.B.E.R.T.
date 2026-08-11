import { getSettings } from '../config'
import { streamOpenAiChatCompletions } from '../llm/openaiStream'
import { getOpenAIToolSchemasForOllama } from '../tools/registry'
import {
  ensureGeminiThoughtSignatures,
  looksLikeTextToolCall,
  normalizeToolCalls
} from '../agent/textToolCalls'
import type {
  OllamaChatMessage,
  OllamaChatResult,
  OllamaToolCall
} from '../ollama/client'
import { DEFAULT_GEMINI_MODEL } from '../../shared/types'

/** OpenAI-compatible Gemini endpoint (Google AI Studio / Gemini API). */
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai'
const GEMINI_FALLBACK_MODELS = [
  DEFAULT_GEMINI_MODEL,
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.5-flash-lite'
] as const

export function geminiModelCandidates(primary: string): string[] {
  const requested = (primary || DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL
  return [...new Set([requested, ...GEMINI_FALLBACK_MODELS])]
}

function requireGeminiKey(): string {
  const key =
    getSettings().geminiApiKey?.trim() ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    ''
  if (!key) {
    throw new Error(
      'Gemini API key is not set. Add it in Systems → QUICK provider Gemini, or set GEMINI_API_KEY. Get a free key at https://aistudio.google.com/apikey'
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
    if (m.tool_calls?.length) {
      // Gemini 2.5/3 rejects follow-up tool turns without thought_signature.
      row.tool_calls = ensureGeminiThoughtSignatures(m.tool_calls)
    }
    return row
  })
}

function withGeminiThoughtBypass(messages: OllamaChatMessage[]): OllamaChatMessage[] {
  return messages.map((m) => {
    if (!m.tool_calls?.length) return m
    return {
      ...m,
      tool_calls: ensureGeminiThoughtSignatures(
        m.tool_calls.map((call) => ({
          ...call,
          extra_content: undefined
        }))
      )
    }
  })
}

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
  timeoutMs: number
  maxTokens?: number
}): Promise<OllamaChatResult> {
  const key = requireGeminiKey()
  const useTools = opts.tools
  const tools = useTools ? getOpenAIToolSchemasForOllama() : undefined
  // Tool rounds: prefer non-stream so thought_signature lands intact on tool_calls.
  const wantStream = Boolean(opts.onToken) && !useTools

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: serializeMessages(opts.messages),
    stream: wantStream,
    temperature: 0.7,
    max_tokens: Math.max(64, opts.maxTokens ?? 1024)
  }
  if (tools?.length) {
    body.tools = tools
    body.tool_choice = 'auto'
  }

  const response = await fetch(`${GEMINI_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Math.max(1, opts.timeoutMs))
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Gemini error ${response.status}: ${errText.slice(0, 400)}`)
  }

  if (wantStream) {
    return streamOpenAiChatCompletions(response, opts.model, opts.onToken)
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

export async function geminiChatCompletion(opts: {
  model: string
  messages: OllamaChatMessage[]
  tools?: boolean
  onToken?: (delta: string) => void
  maxTokens?: number
}): Promise<OllamaChatResult> {
  const deadline = Date.now() + 40_000
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
  for (const model of geminiModelCandidates(opts.model)) {
    for (const attempt of attempts) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        throw new Error(
          `Gemini turn exceeded 40 seconds${lastError ? `: ${lastError.message}` : ''}`
        )
      }
      try {
        return await postChat({
          model,
          messages: attempt.messages,
          tools: attempt.tools,
          onToken: opts.onToken,
          timeoutMs: Math.min(18_000, remaining),
          maxTokens: opts.maxTokens
        })
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        const msg = lastError.message
        if (/\b401\b|invalid.*api.?key|authentication|API[_ ]?key/i.test(msg)) throw lastError
        if (/abort|timed?\s*out|timeout/i.test(msg)) break
        if (/\b(403|404|429)\b|quota|rate.?limit|not found|not supported/i.test(msg)) break
        // Missing thought_signature: rewrite history with Google's bypass token and retry once.
        if (/thought_signatur/i.test(msg) && attempt.messages.some((m) => m.tool_calls?.length)) {
          try {
            return await postChat({
              model,
              messages: withGeminiThoughtBypass(attempt.messages),
              tools: attempt.tools,
              onToken: opts.onToken,
              timeoutMs: Math.min(18_000, Math.max(1, deadline - Date.now())),
              maxTokens: opts.maxTokens
            })
          } catch (retryErr) {
            lastError = retryErr instanceof Error ? retryErr : new Error(String(retryErr))
          }
        }
        const canSoften =
          attempt.label !== 'text-only' &&
          (/\b(400|413|422|500|502|503|529)\b|tool|schema|function|thought_signatur/i.test(msg))
        if (canSoften) continue
        throw lastError
      }
    }
  }
  throw lastError || new Error('Gemini request failed')
}

export async function probeGemini(): Promise<{
  ok: boolean
  mode: 'cloud'
  detail: string
}> {
  try {
    const key =
      getSettings().geminiApiKey?.trim() ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      ''
    if (!key) {
      return { ok: false, mode: 'cloud', detail: 'No Gemini API key set' }
    }
    const configured = getSettings().geminiModel || DEFAULT_GEMINI_MODEL
    let lastDetail = 'No compatible Gemini model responded'
    const deadline = Date.now() + 25_000
    for (const model of geminiModelCandidates(configured)) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        lastDetail = 'Gemini readiness probe exceeded 25 seconds'
        break
      }
      let res: Response
      try {
        res = await fetch(`${GEMINI_BASE}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 16,
            stream: false
          }),
          signal: AbortSignal.timeout(Math.min(8_000, remaining))
        })
      } catch (error) {
        lastDetail = `Probe failed (${model}): ${
          error instanceof Error ? error.message : String(error)
        }`
        continue
      }
      if (res.ok) {
        await res.arrayBuffer()
        const suffix = model === configured ? '' : ` · fallback from ${configured}`
        return { ok: true, mode: 'cloud', detail: `Gemini OK (${model})${suffix}` }
      }
      const err = await res.text()
      lastDetail = `HTTP ${res.status} (${model}): ${err.slice(0, 140)}`
      if (res.status === 401 || res.status === 403) break
    }
    return { ok: false, mode: 'cloud', detail: lastDetail }
  } catch (err) {
    return {
      ok: false,
      mode: 'cloud',
      detail: err instanceof Error ? err.message : String(err)
    }
  }
}
