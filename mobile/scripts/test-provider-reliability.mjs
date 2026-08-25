import assert from 'node:assert/strict'
import test from 'node:test'
import {
  autoRouteOrder,
  chatWithProvider,
  defaultModelFor,
  groqModelsForDate,
  isModelForProvider,
  modelsFor
} from '../src/lib/chat.ts'
import { chatWithClaude } from '../src/lib/claude.ts'
import {
  chatWithGroq,
  GROQ_TRANSITION_CUTOFF_MS,
  groqModelCandidates
} from '../src/lib/groq.ts'
import {
  parseMemoryLines,
  parseRetryAfterMs,
  ProviderRequestError,
  providerTextResult
} from '../src/lib/prompt.ts'
import {
  executePhoneTool,
  parseToolArguments,
  toOpenAITools
} from '../src/lib/phoneTools.ts'

const messages = [
  { id: 'm1', role: 'user', content: 'Status?', createdAt: 1 }
]

const config = (overrides = {}) => ({
  provider: 'auto',
  anthropicApiKey: '',
  groqApiKey: '',
  geminiApiKey: '',
  model: 'openai/gpt-oss-20b',
  macBaseUrl: '',
  macToken: '',
  macCredential: '',
  deviceId: 'mobile_test_device',
  deviceName: 'Test phone',
  autoSync: true,
  speakReplies: true,
  voiceRate: 1,
  ttsVoiceId: '',
  wakeOnLaunch: true,
  reducedMotion: false,
  personality: { sarcasm: 82, warmth: 82, verbosity: 35 },
  ...overrides
})

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

function modelFromRequest(init) {
  return JSON.parse(String(init?.body || '{}')).model
}

async function rejectionOf(promise) {
  try {
    await promise
  } catch (error) {
    return error
  }
  assert.fail('Expected promise to reject')
}

test('Groq transition models disappear exactly at the August 16 cutoff', () => {
  const retiring = 'llama-3.1-8b-instant'
  const before = groqModelCandidates(retiring, GROQ_TRANSITION_CUTOFF_MS - 1)
  const after = groqModelCandidates(retiring, GROQ_TRANSITION_CUTOFF_MS)
  assert.equal(before[0], retiring)
  assert.ok(before.includes('llama-3.3-70b-versatile'))
  assert.equal(after[0], 'openai/gpt-oss-20b')
  assert.equal(after.includes(retiring), false)
  assert.equal(after.includes('llama-3.3-70b-versatile'), false)
  assert.ok(groqModelsForDate(GROQ_TRANSITION_CUTOFF_MS - 1).some((entry) => entry.value === retiring))
  assert.equal(groqModelsForDate(GROQ_TRANSITION_CUTOFF_MS).some((entry) => entry.value === retiring), false)
})

test('Auto exposes both model families and defaults to fast free Groq', () => {
  assert.equal(defaultModelFor('auto'), 'openai/gpt-oss-20b')
  assert.equal(isModelForProvider('auto', 'claude-haiku-4-5'), true)
  assert.equal(isModelForProvider('auto', 'openai/gpt-oss-20b'), true)
  assert.equal(isModelForProvider('auto', 'gemini-2.5-flash'), true)
  assert.ok(modelsFor('auto').some((entry) => entry.label.startsWith('Groq ·')))
  assert.ok(modelsFor('auto').some((entry) => entry.label.startsWith('Gemini ·')))
  assert.ok(modelsFor('auto').some((entry) => entry.label.startsWith('Anthropic ·')))
})

test('Auto crosses providers only when both user keys exist', () => {
  assert.deepEqual(
    autoRouteOrder({ anthropicApiKey: '', groqApiKey: 'gsk_user', model: 'claude-haiku-4-5' }),
    ['groq']
  )
  assert.deepEqual(
    autoRouteOrder({ anthropicApiKey: 'sk_user', groqApiKey: '', model: 'openai/gpt-oss-20b' }),
    ['anthropic']
  )
  assert.deepEqual(
    autoRouteOrder({
      anthropicApiKey: 'sk_user',
      groqApiKey: 'gsk_user',
      model: 'claude-haiku-4-5'
    }),
    ['anthropic', 'groq']
  )
  assert.deepEqual(
    autoRouteOrder({
      anthropicApiKey: 'sk_user',
      groqApiKey: 'gsk_user',
      model: 'openai/gpt-oss-20b'
    }),
    ['groq', 'anthropic']
  )
  assert.deepEqual(
    autoRouteOrder({
      anthropicApiKey: 'sk_user',
      groqApiKey: 'gsk_user',
      geminiApiKey: 'AIza_user',
      model: 'gemini-2.5-flash'
    }),
    ['gemini', 'groq', 'anthropic']
  )
  assert.deepEqual(
    autoRouteOrder({
      anthropicApiKey: '',
      groqApiKey: '',
      geminiApiKey: 'AIza_user',
      model: 'openai/gpt-oss-20b'
    }),
    ['gemini']
  )
  assert.deepEqual(
    autoRouteOrder({
      anthropicApiKey: 'sk_user',
      groqApiKey: 'gsk_user',
      geminiApiKey: 'AIza_user',
      model: 'openai/gpt-oss-20b',
      hasImages: true
    }),
    ['anthropic', 'gemini']
  )
})

test('memory directives are bounded, normalized, and never become a blank reply', () => {
  const parsed = parseMemoryLines([
    '[MEMORY] PROJECT | Build Albert mobile',
    '[MEMORY] project | Build Albert mobile',
    '[MEMORY] unknown | Prefers concise replies'
  ].join('\n'))
  assert.deepEqual(parsed.memories, [
    { category: 'project', content: 'Build Albert mobile' },
    { category: 'general', content: 'Prefers concise replies' }
  ])
  assert.equal(parsed.clean, '')
  assert.equal(providerTextResult('[MEMORY] person | Kai is the user').reply, 'Understood, sir.')
})

test('Retry-After accepts seconds and HTTP dates', () => {
  assert.equal(parseRetryAfterMs('2.5', 0), 2_500)
  assert.equal(parseRetryAfterMs('Thu, 01 Jan 1970 00:00:05 GMT', 2_000), 3_000)
  assert.equal(parseRetryAfterMs('-1', 0), undefined)
  assert.equal(parseRetryAfterMs('nonsense', 0), undefined)
})

test('Anthropic returns cleaned text, memories, and actual route metadata', async () => {
  const calls = []
  const result = await chatWithClaude({
    apiKey: 'sk_user',
    model: 'claude-haiku-4-5',
    messages,
    memories: [],
    now: (() => {
      const values = [100, 137]
      return () => values.shift() ?? 137
    })(),
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init })
      const body = JSON.parse(String(init?.body || '{}'))
      assert.ok(Array.isArray(body.tools))
      assert.ok(body.tools.some((tool) => tool.name === 'web_search'))
      return jsonResponse({
        model: 'claude-haiku-4-5-20261001',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Online, sir.\n[MEMORY] preference | Likes fast replies' }]
      })
    }
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages')
  assert.equal(calls[0].init.headers['x-api-key'], 'sk_user')
  assert.equal(result.reply, 'Online, sir.')
  assert.deepEqual(result.newMemories, [{ category: 'preference', content: 'Likes fast replies' }])
  assert.equal(result.provider, 'anthropic')
  assert.equal(result.model, 'claude-haiku-4-5-20261001')
  assert.equal(result.latencyMs, 37)
})

test('phone tool helpers include web + open_app and block private fetches', async () => {
  assert.deepEqual(parseToolArguments('{"query":"DeepSeek"}'), { query: 'DeepSeek' })
  assert.ok(toOpenAITools().some((tool) => tool.function.name === 'web_fetch'))
  assert.ok(toOpenAITools().some((tool) => tool.function.name === 'open_app'))
  assert.match(
    toOpenAITools().find((tool) => tool.function.name === 'web_search')?.function.description || '',
    /Reddit|YouTube|Wikipedia/i
  )
  const blocked = await executePhoneTool('web_fetch', { url: 'http://192.168.1.1/admin' })
  assert.equal(blocked.ok, false)
  assert.match(blocked.result, /private/i)
})

test('Groq runs a web_search tool round before answering', async () => {
  const bodies = []
  const result = await chatWithGroq({
    apiKey: 'gsk_user',
    model: 'openai/gpt-oss-20b',
    messages: [{ id: 'm1', role: 'user', content: 'What is DeepSeek?', createdAt: 1 }],
    memories: [],
    candidateNowMs: GROQ_TRANSITION_CUTOFF_MS,
    fetchImpl: async (url, init) => {
      const href = String(url)
      if (href.includes('duckduckgo.com') || href.includes('wikipedia.org')) {
        return jsonResponse({
          AbstractText: 'DeepSeek is an AI company.',
          AbstractURL: 'https://example.com/deepseek',
          Answer: '',
          RelatedTopics: []
        })
      }
      const body = JSON.parse(String(init?.body || '{}'))
      bodies.push(body)
      if (bodies.length === 1) {
        assert.ok(Array.isArray(body.tools))
        return jsonResponse({
          model: 'openai/gpt-oss-20b',
          choices: [{
            message: {
              content: null,
              tool_calls: [{
                id: 'call_1',
                type: 'function',
                function: { name: 'web_search', arguments: '{"query":"DeepSeek AI"}' }
              }]
            }
          }]
        })
      }
      assert.ok(body.messages.some((row) => row.role === 'tool'))
      return jsonResponse({
        model: 'openai/gpt-oss-20b',
        choices: [{ message: { content: 'DeepSeek is an AI company, sir.' } }]
      })
    }
  })
  assert.equal(result.reply, 'DeepSeek is an AI company, sir.')
  assert.equal(bodies.length, 2)
})

test('Anthropic reports malformed and empty successful responses safely', async () => {
  const malformed = await rejectionOf(chatWithClaude({
    apiKey: 'sk_user',
    model: 'claude-haiku-4-5',
    messages,
    memories: [],
    fetchImpl: async () => new Response('{broken', { status: 200 })
  }))
  assert.ok(malformed instanceof ProviderRequestError)
  assert.equal(malformed.code, 'invalid_response')

  const empty = await rejectionOf(chatWithClaude({
    apiKey: 'sk_user',
    model: 'claude-haiku-4-5',
    messages,
    memories: [],
    fetchImpl: async () => jsonResponse({ content: [] })
  }))
  assert.ok(empty instanceof ProviderRequestError)
  assert.equal(empty.code, 'invalid_response')
})

test('Anthropic deadline resolves even when fetch ignores AbortSignal', async () => {
  const startedAt = Date.now()
  const error = await rejectionOf(chatWithClaude({
    apiKey: 'sk_user',
    model: 'claude-haiku-4-5',
    messages,
    memories: [],
    timeoutMs: 15,
    fetchImpl: async () => new Promise(() => {})
  }))
  assert.ok(error instanceof ProviderRequestError)
  assert.equal(error.code, 'timeout')
  assert.ok(Date.now() - startedAt < 500)
})

test('Groq falls through unavailable models and reports the model that answered', async () => {
  const attempted = []
  const result = await chatWithGroq({
    apiKey: 'gsk_user',
    model: 'openai/gpt-oss-20b',
    messages,
    memories: [],
    candidateNowMs: GROQ_TRANSITION_CUTOFF_MS,
    fetchImpl: async (_url, init) => {
      const model = modelFromRequest(init)
      attempted.push(model)
      if (attempted.length === 1) {
        return jsonResponse({ error: { message: 'model unavailable' } }, 404)
      }
      return jsonResponse({
        model: 'openai/gpt-oss-120b-live',
        choices: [{ message: { content: 'Standing by, sir.' } }]
      })
    }
  })
  assert.deepEqual(attempted, ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'])
  assert.equal(result.reply, 'Standing by, sir.')
  assert.equal(result.model, 'openai/gpt-oss-120b-live')
  assert.equal(result.provider, 'groq')
})

test('Groq preserves rate-limit retry guidance without hammering other models', async () => {
  let calls = 0
  const error = await rejectionOf(chatWithGroq({
    apiKey: 'gsk_user',
    model: 'openai/gpt-oss-20b',
    messages,
    memories: [],
    fetchImpl: async () => {
      calls += 1
      return jsonResponse({ error: { message: 'slow down' } }, 429, { 'retry-after': '3' })
    }
  }))
  assert.ok(error instanceof ProviderRequestError)
  assert.equal(error.code, 'rate_limit')
  assert.equal(error.retryAfterMs, 3_000)
  assert.match(error.message, /3s/)
  assert.equal(calls, 1)
})

test('Groq treats authentication as terminal and never leaks the remote body', async () => {
  let calls = 0
  const error = await rejectionOf(chatWithGroq({
    apiKey: 'gsk_bad',
    model: 'openai/gpt-oss-20b',
    messages,
    memories: [],
    fetchImpl: async () => {
      calls += 1
      return new Response('<html>secret infrastructure detail</html>', { status: 401 })
    }
  }))
  assert.ok(error instanceof ProviderRequestError)
  assert.equal(error.code, 'authentication')
  assert.doesNotMatch(error.message, /infrastructure detail/)
  assert.equal(calls, 1)
})

test('Groq safely exhausts malformed successful model responses', async () => {
  let calls = 0
  const error = await rejectionOf(chatWithGroq({
    apiKey: 'gsk_user',
    model: 'openai/gpt-oss-20b',
    messages,
    memories: [],
    candidateNowMs: GROQ_TRANSITION_CUTOFF_MS,
    fetchImpl: async () => {
      calls += 1
      return new Response('{not-json', { status: 200 })
    }
  }))
  assert.ok(error instanceof ProviderRequestError)
  assert.equal(error.code, 'invalid_response')
  assert.equal(calls, 3)
})

test('Auto falls from Groq to Anthropic only when both keys are present', async () => {
  const urls = []
  const result = await chatWithProvider({
    config: config({ anthropicApiKey: 'sk_user', groqApiKey: 'gsk_user' }),
    messages,
    memories: [],
    fetchImpl: async (url) => {
      urls.push(String(url))
      if (String(url).includes('groq.com')) {
        return jsonResponse({ error: { message: 'quota reached' } }, 429)
      }
      return jsonResponse({
        model: 'claude-haiku-4-5-live',
        content: [{ type: 'text', text: 'Fallback online, sir.' }]
      })
    }
  })
  assert.equal(urls.length, 2)
  assert.ok(urls[0].includes('groq.com'))
  assert.ok(urls[1].includes('anthropic.com'))
  assert.equal(result.provider, 'anthropic')
  assert.equal(result.model, 'claude-haiku-4-5-live')
  assert.equal(result.fallbackFrom, 'groq')
})

test('Auto with one key and explicit provider modes never cross providers', async () => {
  for (const selectedConfig of [
    config({ provider: 'auto', groqApiKey: 'gsk_user' }),
    config({ provider: 'groq', groqApiKey: 'gsk_user', anthropicApiKey: 'sk_user' })
  ]) {
    const urls = []
    const error = await rejectionOf(chatWithProvider({
      config: selectedConfig,
      messages,
      memories: [],
      fetchImpl: async (url) => {
        urls.push(String(url))
        return jsonResponse({ error: { message: 'quota reached' } }, 429)
      }
    }))
    assert.ok(error instanceof ProviderRequestError)
    assert.equal(error.code, 'rate_limit')
    assert.equal(urls.length, 1)
    assert.ok(urls[0].includes('groq.com'))
  }
})

test('caller cancellation stops Auto without invoking its second provider', async () => {
  const controller = new AbortController()
  const urls = []
  const pending = chatWithProvider({
    config: config({ anthropicApiKey: 'sk_user', groqApiKey: 'gsk_user' }),
    messages,
    memories: [],
    signal: controller.signal,
    fetchImpl: async (url) => {
      urls.push(String(url))
      return new Promise(() => {})
    }
  })
  setTimeout(() => controller.abort(), 10)
  const error = await rejectionOf(pending)
  assert.ok(error instanceof ProviderRequestError)
  assert.equal(error.code, 'cancelled')
  assert.equal(urls.length, 1)
  assert.ok(urls[0].includes('groq.com'))
})
