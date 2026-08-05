import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const settingsPath =
  process.env.ALBERT_SETTINGS_PATH ||
  join(homedir(), 'Library', 'Application Support', 'albert', 'albert-data', 'settings.json')

async function readSettings() {
  try {
    return JSON.parse(await readFile(settingsPath, 'utf8'))
  } catch {
    return {}
  }
}

function migratedGroqModel(model) {
  if (
    !model ||
    model === 'llama-3.1-8b-instant' ||
    model === 'llama-3.3-70b-versatile'
  ) return 'openai/gpt-oss-20b'
  if (
    model === 'meta-llama/llama-4-scout-17b-16e-instruct' ||
    model === 'qwen/qwen3-32b'
  ) {
    return 'openai/gpt-oss-120b'
  }
  return model
}

async function groqRequest(key, body) {
  const started = performance.now()
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000)
  })
  const elapsedMs = Math.round(performance.now() - started)
  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 240)
    throw new Error(`HTTP ${response.status} after ${elapsedMs}ms: ${detail}`)
  }
  return { response, elapsedMs }
}

async function testGroq(settings) {
  const key = String(settings.groqApiKey || process.env.GROQ_API_KEY || '').trim()
  if (!key) return { status: 'skipped', reason: 'no configured Groq key' }
  const savedModel = String(settings.groqModel || 'openai/gpt-oss-20b')
  const transitionOpen = Date.now() < Date.parse('2026-08-16T00:00:00Z')
  const configuredModel =
    !transitionOpen && ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'].includes(savedModel)
      ? 'openai/gpt-oss-20b'
      : savedModel
  const preferredModel = migratedGroqModel(savedModel)
  const candidates = [
    ...new Set([
      configuredModel,
      preferredModel,
      'openai/gpt-oss-20b',
      'openai/gpt-oss-120b',
      'qwen/qwen3.6-27b',
      ...(transitionOpen
        ? ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile']
        : [])
    ])
  ]
  const availability = []
  for (const candidate of candidates) {
    try {
      const probe = await groqRequest(key, {
        model: candidate,
        messages: [{ role: 'user', content: 'Reply OK.' }],
        temperature: 0,
        max_completion_tokens: 32,
        stream: false
      })
      availability.push({ model: candidate, available: true, elapsedMs: probe.elapsedMs })
    } catch (error) {
      availability.push({
        model: candidate,
        available: false,
        detail: (error instanceof Error ? error.message : String(error)).slice(0, 180)
      })
    }
  }
  const availableModels = availability.filter((entry) => entry.available).map((entry) => entry.model)
  const model = availableModels.includes(configuredModel)
    ? configuredModel
    : availableModels[0]
  if (!model) {
    return { status: 'fail', configuredModel, preferredModel, availability }
  }

  const streamStarted = performance.now()
  const streamed = await groqRequest(key, {
    model,
    messages: [{ role: 'user', content: 'Reply with exactly ALBERT_SMOKE_OK.' }],
    temperature: 0,
    max_completion_tokens: 48,
    stream: true
  })
  let firstTokenMs = null
  let output = ''
  const reader = streamed.response.body?.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (reader) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta
        const token = delta?.content || ''
        if (token && firstTokenMs == null) {
          firstTokenMs = Math.round(performance.now() - streamStarted)
        }
        output += token
      } catch {
        // Ignore partial/metadata SSE rows.
      }
    }
  }

  const tool = await groqRequest(key, {
    model,
    messages: [
      { role: 'system', content: 'Use the supplied function for clock requests.' },
      { role: 'user', content: 'Call get_clock for America/Chicago.' }
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'get_clock',
          description: 'Read a clock for an IANA timezone.',
          parameters: {
            type: 'object',
            properties: { timezone: { type: 'string' } },
            required: ['timezone'],
            additionalProperties: false
          }
        }
      }
    ],
    tool_choice: 'auto',
    temperature: 0,
    max_completion_tokens: 128,
    stream: false
  })
  const toolJson = await tool.response.json()
  const toolCall = toolJson.choices?.[0]?.message?.tool_calls?.[0]
  const textOk = output.includes('ALBERT_SMOKE_OK')
  const toolOk = toolCall?.function?.name === 'get_clock'

  return {
    status: textOk && toolOk ? 'pass' : 'fail',
    configuredModel,
    preferredModel,
    model,
    availability,
    streaming: {
      firstTokenMs,
      totalMs: Math.round(performance.now() - streamStarted),
      exactReplyObserved: textOk
    },
    tools: { elapsedMs: tool.elapsedMs, functionCallObserved: toolOk },
    remaining: {
      requestsToday: tool.response.headers.get('x-ratelimit-remaining-requests'),
      tokensThisMinute: tool.response.headers.get('x-ratelimit-remaining-tokens')
    }
  }
}

async function testLocalOllama(settings) {
  const base = String(settings.ollamaLocalBase || 'http://127.0.0.1:11434').replace(/\/$/, '')
  try {
    const started = performance.now()
    const response = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2_500) })
    if (!response.ok) return { status: 'offline', detail: `HTTP ${response.status}` }
    const data = await response.json()
    const daemonProbeMs = Math.round(performance.now() - started)
    const installedModels = (data.models || []).map((row) => row.name).slice(0, 12)
    const configured = String(settings.localModel || '')
    const model = installedModels.includes(configured) ? configured : installedModels[0]
    if (!model) {
      return { status: 'online', daemonProbeMs, installedModels }
    }

    async function infer() {
      const inferStarted = performance.now()
      const chat = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Reply with exactly ALBERT_LOCAL_OK.' }],
          stream: false,
          think: false,
          keep_alive: '5m',
          options: { temperature: 0, num_predict: 32, num_ctx: 4096 }
        }),
        signal: AbortSignal.timeout(90_000)
      })
      if (!chat.ok) throw new Error(`chat HTTP ${chat.status}`)
      const result = await chat.json()
      const evalSeconds = Number(result.eval_duration || 0) / 1_000_000_000
      return {
        elapsedMs: Math.round(performance.now() - inferStarted),
        exactReplyObserved: String(result.message?.content || '').includes('ALBERT_LOCAL_OK'),
        outputTokens: Number(result.eval_count || 0),
        tokensPerSecond:
          evalSeconds > 0 ? Number((Number(result.eval_count || 0) / evalSeconds).toFixed(1)) : null,
        loadMs: Math.round(Number(result.load_duration || 0) / 1_000_000)
      }
    }

    const first = await infer()
    const warm = await infer()
    return {
      status: 'pass',
      daemonProbeMs,
      installedModels,
      testedModel: model,
      first,
      warm
    }
  } catch (error) {
    return { status: 'offline', detail: error instanceof Error ? error.message : String(error) }
  }
}

const settings = await readSettings()
const results = {
  checkedAt: new Date().toISOString(),
  groq: await testGroq(settings).catch((error) => ({
    status: 'fail',
    detail: error instanceof Error ? error.message : String(error)
  })),
  ollamaLocal: await testLocalOllama(settings)
}

console.log(JSON.stringify(results, null, 2))
if (results.groq.status === 'fail') process.exitCode = 1
