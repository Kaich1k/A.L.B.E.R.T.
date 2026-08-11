import { getSettings } from '../config'
import { streamOpenAiChatCompletions } from '../llm/openaiStream'
import { getOpenAIToolSchemasForOllama } from '../tools/registry'
import { looksLikeTextToolCall, normalizeToolCalls } from '../agent/textToolCalls'
import type {
  OllamaChatMessage,
  OllamaChatResult,
  OllamaToolCall
} from '../ollama/client'
import { DEFAULT_GROQ_MODEL } from '../../shared/types'
import {
  groqTransitionWindowOpen,
  isGroqTransitionModel,
  normalizeGroqModelForDate
} from '../../shared/groqModels'

const GROQ_BASE = 'https://api.groq.com/openai/v1'
const GROQ_FALLBACK_MODELS = [
  DEFAULT_GROQ_MODEL,
  'openai/gpt-oss-120b',
  // Preview model: keep behind production GPT-OSS in automatic failover.
  'qwen/qwen3.6-27b',
  // Temporary bridge for organizations that have not enabled GPT-OSS yet.
  'llama-3.1-8b-instant',
  'llama-3.3-70b-versatile'
] as const

export function groqModelCandidates(primary: string): string[] {
  const requested = normalizeGroqModelForDate(primary || DEFAULT_GROQ_MODEL)
  return [...new Set([requested, ...GROQ_FALLBACK_MODELS])].filter(
    (model) => !isGroqTransitionModel(model) || groqTransitionWindowOpen()
  )
}

function requireGroqKey(): string {
  const key = getSettings().groqApiKey?.trim() || process.env.GROQ_API_KEY || ''
  if (!key) {
    throw new Error(
      'Groq API key is not set. Add it in Systems → QUICK provider Groq, or set GROQ_API_KEY. Get a key at https://console.groq.com/keys'
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
  timeoutMs: number
  maxTokens?: number
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
    temperature: 0.7,
    max_tokens: Math.max(64, opts.maxTokens ?? 1024)
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
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Math.max(1, opts.timeoutMs))
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

/** Groq chat with schema softening and model-level failover. */
export async function groqChatCompletion(opts: {
  model: string
  messages: OllamaChatMessage[]
  tools?: boolean
  onToken?: (delta: string) => void
  maxTokens?: number
}): Promise<OllamaChatResult> {
  // QUICK must fail over instead of appearing frozen. Groq normally responds
  // in milliseconds; 35 seconds is an end-to-end budget across all models and
  // schema-softening attempts, not a fresh minute for every retry.
  const deadline = Date.now() + 35_000
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
  for (const model of groqModelCandidates(opts.model)) {
    for (const attempt of attempts) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        throw new Error(
          `Groq turn exceeded 35 seconds${lastError ? `: ${lastError.message}` : ''}`
        )
      }
      try {
        return await postChat({
          model,
          messages: attempt.messages,
          tools: attempt.tools,
          onToken: opts.onToken,
          timeoutMs: Math.min(15_000, remaining),
          maxTokens: opts.maxTokens
        })
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        const msg = lastError.message
        if (/\b401\b|invalid.*api.?key|authentication/i.test(msg)) throw lastError

        // A wedged model should yield to the next model, not spend the entire
        // turn retrying alternate schemas against the same backend.
        if (/abort|timed?\s*out|timeout/i.test(msg)) break

        // Model disabled, retired, or quota-bound: try another current model.
        if (
          /\b(403|404|429)\b|permissions_error|model[^.]{0,80}(blocked|retired|deprecat|decommission|not found)/i.test(
            msg
          )
        ) {
          break
        }

        // Tool/schema and transient service failures may recover with a slimmer payload.
        const canSoften =
          attempt.label !== 'text-only' &&
          (/\b(400|413|422|500|502|503|529)\b|tool|schema|function/i.test(msg))
        if (canSoften) continue
        throw lastError
      }
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
    const configured = getSettings().groqModel || DEFAULT_GROQ_MODEL
    let lastDetail = 'No compatible model responded'
    let bridgeModel = ''
    let replacementDetail = 'No replacement model was tested'
    const deadline = Date.now() + 25_000
    for (const model of groqModelCandidates(configured)) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        lastDetail = 'Groq readiness probe exceeded 25 seconds'
        break
      }
      let res: Response
      try {
        res = await fetch(`${GROQ_BASE}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: 'ping' }],
            max_completion_tokens: 32,
            stream: false
          }),
          signal: AbortSignal.timeout(Math.min(8_000, remaining))
        })
      } catch (error) {
        lastDetail = `Probe failed (${model}): ${
          error instanceof Error ? error.message : String(error)
        }`
        if (!isGroqTransitionModel(model)) replacementDetail = lastDetail
        continue
      }
      if (res.ok) {
        await res.arrayBuffer()
        if (isGroqTransitionModel(model)) {
          bridgeModel = model
          continue
        }
        const suffix = model === configured ? '' : ` · fallback from ${configured}`
        return { ok: true, mode: 'cloud', detail: `Groq OK (${model})${suffix}` }
      }
      const err = await res.text()
      lastDetail = `HTTP ${res.status} (${model}): ${err.slice(0, 140)}`
      if (!isGroqTransitionModel(model)) replacementDetail = lastDetail
      if (res.status === 401) break
    }
    if (bridgeModel) {
      return {
        ok: true,
        mode: 'cloud',
        detail: `Bridge only (${bridgeModel}) · replacement NOT READY · ${replacementDetail} · enable GPT-OSS before Aug 16`
      }
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
