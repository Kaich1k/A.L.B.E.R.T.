import { getSettings } from '../config'
import { streamOpenAiChatCompletions } from '../llm/openaiStream'
import { getOpenAIToolSchemasForOllama } from '../tools/registry'
import { normalizeToolCalls } from '../agent/textToolCalls'
import { DEFAULT_SETTINGS } from '../../shared/types'

export type OllamaChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      >
  /** Native Ollama /api/chat image payloads (base64, no data: prefix) */
  images?: string[]
  tool_call_id?: string
  tool_calls?: OllamaToolCall[]
}

export type OllamaToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type OllamaChatResult = {
  content: string
  tool_calls: OllamaToolCall[]
  model: string
}

/** OpenAI-compatible message shape (strip internal fields). */
function serializeOpenAIMessages(messages: OllamaChatMessage[]): Array<Record<string, unknown>> {
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

/** Native Ollama /api/chat — string content + optional images[]. */
function serializeNativeMessages(messages: OllamaChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((m) => {
    let content = ''
    if (typeof m.content === 'string') {
      content = m.content
    } else if (Array.isArray(m.content)) {
      content = m.content
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n')
    }
    const row: Record<string, unknown> = { role: m.role, content }
    if (m.images?.length) row.images = m.images
    if (m.tool_call_id) row.tool_call_id = m.tool_call_id
    return row
  })
}

/** Drop image payloads / multimodal parts — used for 5xx retries. */
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

function cloudBase(): string {
  return (getSettings().ollamaCloudBase || 'https://ollama.com').replace(/\/$/, '')
}

function localBase(): string {
  return (getSettings().ollamaLocalBase || 'http://127.0.0.1:11434').replace(/\/$/, '')
}

export function resolveOllamaEndpoint(): {
  base: string
  apiKey: string | null
  mode: 'cloud' | 'local'
} {
  const s = getSettings()
  const key = s.ollamaApiKey?.trim() || process.env.OLLAMA_API_KEY || ''
  const prefer = s.ollamaEndpoint || 'auto'

  if (prefer === 'cloud' || (prefer === 'auto' && key)) {
    return { base: cloudBase(), apiKey: key || null, mode: 'cloud' }
  }
  return { base: localBase(), apiKey: null, mode: 'local' }
}

async function localDaemonUp(): Promise<boolean> {
  try {
    const res = await fetch(`${localBase()}/api/tags`, {
      signal: AbortSignal.timeout(1500)
    })
    return res.ok
  } catch {
    return false
  }
}

type ChatAttempt = {
  base: string
  apiKey: string | null
  mode: 'cloud' | 'local'
  messages: OllamaChatMessage[]
  tools: boolean
  label: string
}

async function postOpenAIChat(
  attempt: ChatAttempt,
  model: string,
  onToken?: (delta: string) => void,
  timeoutMs = attempt.mode === 'local' ? 75_000 : 20_000
): Promise<OllamaChatResult> {
  const useTools = attempt.tools
  const tools = useTools ? getOpenAIToolSchemasForOllama() : undefined
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (attempt.apiKey) headers.Authorization = `Bearer ${attempt.apiKey}`

  const wantStream = Boolean(onToken)
  const body: Record<string, unknown> = {
    model,
    messages: serializeOpenAIMessages(attempt.messages),
    // Stream whenever the UI/TTS wants tokens (tools OK — deltas may include tool_calls)
    stream: wantStream
  }
  if (/^qwen3(?:\.|:|$)/i.test(model)) body.think = false
  if (tools?.length) {
    body.tools = tools
    body.tool_choice = 'auto'
  }

  const response = await fetch(`${attempt.base}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Math.max(1, timeoutMs))
  })

  if (!response.ok && response.status === 404) {
    return nativeOllamaChat({
      model,
      messages: attempt.messages,
      onToken,
      base: attempt.base,
      apiKey: attempt.apiKey,
      timeoutMs
    })
  }

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(
      `Ollama ${attempt.mode} ${response.status} [${attempt.label}]: ${errText.slice(0, 280)}`
    )
  }

  if (wantStream) {
    return streamOpenAiChatCompletions(response, model, onToken)
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
  return {
    content: (msg?.content || '').trim(),
    tool_calls: normalizeToolCalls(msg?.tool_calls || []),
    model: data.model || model
  }
}

function isRetryableStatus(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /\b(500|502|503|529|429)\b/.test(msg) || /Internal Server Error/i.test(msg)
}

/** OpenAI-compatible chat with retries (slim tools / text-only / local daemon). */
export async function ollamaChatCompletion(opts: {
  model: string
  messages: OllamaChatMessage[]
  tools?: boolean
  onToken?: (delta: string) => void
}): Promise<OllamaChatResult> {
  const primary = resolveOllamaEndpoint()
  const turnBudgetMs = primary.mode === 'local' ? 90_000 : 40_000
  const deadline = Date.now() + turnBudgetMs
  const wantTools = opts.tools !== false
  const cloudKey = getSettings().ollamaApiKey?.trim() || process.env.OLLAMA_API_KEY || ''

  const attempts: ChatAttempt[] = []

  // 1) Preferred endpoint with tools
  attempts.push({
    ...primary,
    messages: opts.messages,
    tools: wantTools,
    label: 'tools'
  })

  // 2) Same endpoint, no tools (cloud often 500s on big tool schemas)
  if (wantTools) {
    attempts.push({
      ...primary,
      messages: opts.messages,
      tools: false,
      label: 'no-tools'
    })
  }

  // 3) Text-only (drop image base64) if multimodal present
  const hasImages = opts.messages.some(
    (m) =>
      Boolean(m.images?.length) ||
      (Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'))
  )
  if (hasImages) {
    attempts.push({
      ...primary,
      messages: textOnlyMessages(opts.messages),
      tools: false,
      label: 'text-only'
    })
  }

  // 4) If primary is cloud, also try local daemon when it's up
  if (primary.mode === 'cloud') {
    // probed lazily inside loop
  } else if (cloudKey) {
    // primary local — cloud as backup
    attempts.push({
      base: cloudBase(),
      apiKey: cloudKey,
      mode: 'cloud',
      messages: opts.messages,
      tools: wantTools,
      label: 'cloud-tools'
    })
    attempts.push({
      base: cloudBase(),
      apiKey: cloudKey,
      mode: 'cloud',
      messages: textOnlyMessages(opts.messages),
      tools: false,
      label: 'cloud-text'
    })
  }

  let lastError: Error | null = null
  let triedLocal = primary.mode === 'local'

  for (const attempt of attempts) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    try {
      return await postOpenAIChat(
        attempt,
        opts.model,
        opts.onToken,
        Math.min(attempt.mode === 'local' ? 75_000 : 20_000, remaining)
      )
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (!isRetryableStatus(err) && !/fetch failed|ECONNREFUSED|Failed to fetch/i.test(lastError.message)) {
        // Non-retryable (auth, model not found) — still allow local/cloud flip below
        if (!/404|model .* not found|401|403/i.test(lastError.message)) {
          // keep trying softer attempts for 5xx only; for 401/404 break early after same-mode tries
        }
      }
    }
  }

  // Last chance: local daemon if we were on cloud
  if (!triedLocal) {
    if (Date.now() >= deadline) {
      throw lastError || new Error(`Ollama turn exceeded ${turnBudgetMs / 1000} seconds`)
    }
    const up = await localDaemonUp()
    if (up) {
      try {
        return await postOpenAIChat(
          {
            base: localBase(),
            apiKey: null,
            mode: 'local',
            messages: textOnlyMessages(opts.messages),
            tools: false,
            label: 'local-fallback'
          },
          opts.model,
          opts.onToken,
          Math.min(75_000, Math.max(1, deadline - Date.now()))
        )
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
      }
    }
  }

  throw lastError || new Error('Ollama request failed')
}

async function nativeOllamaChat(opts: {
  model: string
  messages: OllamaChatMessage[]
  onToken?: (delta: string) => void
  base?: string
  apiKey?: string | null
  timeoutMs?: number
}): Promise<OllamaChatResult> {
  const resolved = resolveOllamaEndpoint()
  const base = opts.base || resolved.base
  const apiKey = opts.apiKey !== undefined ? opts.apiKey : resolved.apiKey
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  const nativeBody: Record<string, unknown> = {
    model: opts.model,
    messages: serializeNativeMessages(opts.messages).map((m) => ({
      ...m,
      role: m.role === 'tool' ? 'user' : m.role
    })),
    stream: false
  }
  if (/^qwen3(?:\.|:|$)/i.test(opts.model)) nativeBody.think = false

  const response = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(nativeBody),
    signal: AbortSignal.timeout(
      Math.max(1, opts.timeoutMs ?? (apiKey ? 20_000 : 75_000))
    )
  })
  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Ollama native error ${response.status}: ${errText.slice(0, 400)}`)
  }
  const data = (await response.json()) as {
    model?: string
    message?: { content?: string }
  }
  const content = (data.message?.content || '').trim()
  if (opts.onToken && content) opts.onToken(content)
  return { content, tool_calls: [], model: data.model || opts.model }
}

/**
 * Pull a model into the local Ollama daemon (localhost).
 * Streams /api/pull until complete — used by Systems → Pull model.
 */
export async function pullOllamaModel(
  model?: string
): Promise<{ ok: boolean; detail: string }> {
  const name = (model || getSettings().localModel || DEFAULT_SETTINGS.localModel).trim()
  if (!name) return { ok: false, detail: 'No model name' }

  if (!(await localDaemonUp())) {
    return {
      ok: false,
      detail: 'Local Ollama is not running. Open the Ollama app, then try Pull again.'
    }
  }

  try {
    const res = await fetch(`${localBase()}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stream: true })
    })
    if (!res.ok) {
      const err = await res.text()
      return { ok: false, detail: `Pull HTTP ${res.status}: ${err.slice(0, 200)}` }
    }
    if (!res.body) {
      return { ok: false, detail: 'Pull returned no body' }
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let lastStatus = 'pulling…'
    let lastError = ''

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const row = JSON.parse(trimmed) as {
            status?: string
            error?: string
            total?: number
            completed?: number
          }
          if (row.error) lastError = row.error
          if (row.status) {
            if (
              typeof row.total === 'number' &&
              row.total > 0 &&
              typeof row.completed === 'number'
            ) {
              const pct = Math.min(100, Math.round((row.completed / row.total) * 100))
              lastStatus = `${row.status} (${pct}%)`
            } else {
              lastStatus = row.status
            }
          }
        } catch {
          /* ignore partial JSON */
        }
      }
    }

    if (lastError) return { ok: false, detail: lastError }
    return { ok: true, detail: `Pulled ${name} · ${lastStatus}` }
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err)
    }
  }
}

export async function probeOllama(): Promise<{
  ok: boolean
  mode: 'cloud' | 'local'
  detail: string
}> {
  try {
    const { base, apiKey, mode } = resolveOllamaEndpoint()
    const headers: Record<string, string> = {}
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`

    // Prefer a tiny chat probe for cloud — /api/tags is flaky there
    if (mode === 'cloud') {
      const model = getSettings().localModel || 'gpt-oss:20b'
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'ping' }],
          stream: false,
          max_tokens: 8
        }),
        signal: AbortSignal.timeout(20_000)
      })
      if (res.ok) {
        return { ok: true, mode, detail: `Cloud OK (${model}) @ ${base}` }
      }
      const err = await res.text()
      // Also note local daemon
      const localUp = await localDaemonUp()
      const hint = localUp
        ? ' · Local Ollama is running — set Endpoint to Local, then Pull the configured model (cloud and local tags can differ)'
        : ' · local daemon not running'
      return {
        ok: false,
        mode,
        detail: `Cloud HTTP ${res.status}: ${err.slice(0, 120)}${hint}`
      }
    }

    const res = await fetch(`${base}/api/tags`, { headers, signal: AbortSignal.timeout(3000) })
    if (!res.ok) {
      const res2 = await fetch(`${base}/v1/models`, {
        headers,
        signal: AbortSignal.timeout(3000)
      })
      if (res2.ok) {
        return { ok: true, mode, detail: `Connected to ${base}` }
      }
      return { ok: false, mode, detail: `HTTP ${res.status} from ${base}` }
    }
    return { ok: true, mode, detail: `Connected to ${base}` }
  } catch (err) {
    return {
      ok: false,
      mode: resolveOllamaEndpoint().mode,
      detail: err instanceof Error ? err.message : String(err)
    }
  }
}
