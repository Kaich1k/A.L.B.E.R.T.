import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dependencyRoot = process.env.ALBERT_TEST_ROOT || root
const requireDependency = createRequire(join(dependencyRoot, 'package.json'))
const ts = requireDependency('typescript')

function loadTs(relative, mocks = {}, globals = {}) {
  const cache = new Map()
  function load(filename) {
    const candidate = existsSync(filename) ? filename : join(dependencyRoot, filename.slice(root.length + 1))
    if (cache.has(candidate)) return cache.get(candidate).exports
    const module = { exports: {} }
    cache.set(candidate, module)
    const source = ts.transpileModule(readFileSync(candidate, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText
    vm.runInNewContext(source, {
      module, exports: module.exports, __dirname: dirname(candidate), Buffer, process,
      setTimeout, clearTimeout, console, Float32Array, Uint8Array, Blob,
      require(name) {
        if (name in mocks) return mocks[name]
        if (name.startsWith('.')) return load(resolve(dirname(filename), name + '.ts'))
        return requireDependency(name)
      },
      ...globals
    }, { filename: candidate })
    return module.exports
  }
  return load(join(root, relative))
}

const speech = loadTs('src/shared/speechText.ts')

function streamed(chunks) {
  let buffer = ''
  const spoken = []
  for (const chunk of chunks) {
    buffer += chunk
    const output = speech.drainSpeakableUnits(buffer, false, !spoken.length)
    spoken.push(...output.units)
    buffer = output.rest
  }
  spoken.push(...speech.drainSpeakableUnits(buffer, true, !spoken.length).units)
  return spoken.flatMap(text => speech.segmentForSpeech(text))
}

test('a token-boundary period never turns a decimal into two utterances', () => {
  assert.equal(speech.takeSpeakableUnits('The value is 3.', false, true).speak, '')
  const chunks = streamed(['The value is 3.', '14. ', 'That is the result.'])
  assert.equal(chunks.length, 2)
  assert.match(chunks[0].text, /three and point and one four/)
  assert.equal(speech.takeSpeakableUnits('Ready.', true, true).speak, 'Ready.')
})

test('first audio waits for a sensible clause but has a bounded long-clause fallback', () => {
  const ordinary = 'I can open your calendar and find a good time for the meeting tomorrow if you tell me what duration'
  assert.equal(speech.takeSpeakableUnits(ordinary, false, true).speak, '')
  assert.match(speech.takeSpeakableUnits(ordinary + ' you prefer. ', false, true).speak, /duration you prefer\./)
  const clause = speech.takeSpeakableUnits('When you are ready, we can inspect the current window and find your document', false, true)
  assert.equal(clause.speak, 'When you are ready,')
  const long = 'A very long unpunctuated answer '.repeat(10)
  const bounded = speech.takeSpeakableUnits(long, false, true)
  assert.ok(bounded.speak.length >= 72 && bounded.speak.length <= 160)
  assert.equal((bounded.speak + ' ' + bounded.rest).trim(), long.trim())
})

test('paragraph breath survives the stream queue and neural segmentation', () => {
  const chunks = streamed(['I found the report.\n\n', 'The main result is ready.'])
  assert.equal(chunks[0].pauseAfter, 'paragraph')
  assert.equal(chunks[1].pauseAfter, 'sentence')
})

test('partially streamed code fences stay silent and following prose still speaks', () => {
  for (const fence of ['```', '~~~']) {
    const chunks = streamed(['Here is the code:\n', fence.slice(0, 1), fence.slice(1) + 'javascript\n', 'console.log("Hello.");\n', fence + '\n', 'The example is ready.'])
    const text = chunks.map(x => x.text).join(' ')
    assert.match(text, /Here is the code/)
    assert.match(text, /The example is ready/)
    assert.doesNotMatch(text, /javascript|console|Hello|`|~/)
    assert.equal(speech.segmentForSpeech(fence + '\nunfinished code').length, 0)
  }
})

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function sessionHarness({ allowBargeIn = true, pendingHostStop = false } = {}) {
  let now = 10_000
  let sequence = 0
  let amplitude = 0.08
  let stopCalls = 0
  let finished = 0
  const timers = new Map()
  const listeners = new Set()
  const requests = []
  const direct = []
  const transcripts = []
  const states = []
  const queued = []
  const settings = { allowBargeIn, micSensitivity: 50 }
  const hostStop = deferred()
  const analyser = {
    fftSize: 2048,
    connect() {}, disconnect() {},
    getByteTimeDomainData(data) {
      const value = Math.round(amplitude * 128)
      for (let i = 0; i < data.length; i++) data[i] = 128 + (i % 2 ? value : -value)
    }
  }
  class FakeAudioContext {
    state = 'running'
    destination = {}
    createMediaStreamSource() { return { connect() {} } }
    createAnalyser() { return analyser }
    createGain() { return { gain: { value: 1 }, connect() {} } }
    async resume() {}
    async close() {}
  }
  class FakeRecorder {
    static isTypeSupported() { return true }
    state = 'inactive'
    mimeType = 'audio/webm'
    start() { this.state = 'recording' }
    stop() { this.state = 'inactive'; this.onstop?.() }
  }
  class FakeQueue {
    hasStarted = false
    reset(opts) { this.opts = opts; this.hasStarted = false }
    enqueue(text) {
      if (this.opts.shouldCancel()) return
      queued.push(text)
      this.hasStarted = true
      this.opts.onFirstStart?.()
    }
    async flush() {}
  }
  const { ClaudeVoiceSession } = loadTs('src/renderer/src/voice/claudeVoiceSession.ts', {
    '../store': { useAlbertStore: { getState: () => ({ settings }) } },
    './tts': {
      stopSpeaking() {}, StreamingTtsQueue: FakeQueue,
      speakText(text, options) { const item = deferred(); direct.push({ ...item, text, options }); return item.promise }
    },
    './liveKeywords': { LiveKeywordMonitor: class { start() {} stop() {} } }
  }, {
    Date: class extends Date { static now() { return now } },
    MediaRecorder: FakeRecorder, AudioContext: FakeAudioContext,
    window: {
      setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { at: now + delay, fn }); return id },
      clearTimeout(id) { timers.delete(id) },
      albert: {
        onChatEvent(fn) { listeners.add(fn); return () => listeners.delete(fn) },
        sendChat() { const item = deferred(); requests.push(item); return item.promise },
        stopCurrentWork() { stopCalls++; return pendingHostStop ? hostStop.promise : Promise.resolve(true) }
      }
    }
  })
  const session = new ClaudeVoiceSession(state => states.push(state), (role, text) => transcripts.push({ role, text }))
  session.running = true
  const advance = (ms) => {
    const target = now + ms
    while (true) {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      if (!next || next[1].at > target) break
      timers.delete(next[0]); now = next[1].at; next[1].fn()
    }
    now = target
  }
  return {
    session, requests, direct, states, queued, transcripts, listeners, settings,
    get stopCalls() { return stopCalls }, get finished() { return finished },
    advance, emit(text) { for (const fn of listeners) fn({ type: 'token', content: text }) },
    setAmplitude(value) { amplitude = value },
    capture({ speaking = false, busy = false } = {}) {
      session.stream = { getTracks: () => [] }; session.speaking = speaking; session.busy = busy
      session.processRecording = async () => { finished++ }
      session.beginUtteranceCapture({ force: speaking || busy })
    }
  }
}

test('actual session VAD endpoints short turns promptly and never cuts continuing speech', () => {
  const h = sessionHarness()
  h.capture()
  h.advance(600)
  assert.equal(h.finished, 0)
  h.setAmplitude(0.005)
  h.advance(800)
  assert.equal(h.finished, 0, 'allow a natural short hesitation')
  h.advance(200)
  assert.equal(h.finished, 1, 'endpoint after roughly 900 ms true silence')
  const continuous = sessionHarness()
  continuous.capture(); continuous.advance(8_000)
  assert.equal(continuous.finished, 0, 'never cut active speech on duration')
})

test('actual session keeps quiet syllables within a phrase and gives longer thoughts more room', () => {
  const h = sessionHarness()
  h.capture(); h.advance(5_500)
  h.setAmplitude(0.026)
  h.advance(900)
  assert.equal(h.finished, 0, 'quiet syllables still hold the phrase open')
  h.setAmplitude(0.005)
  h.advance(1_600)
  assert.equal(h.finished, 0)
  h.advance(300)
  assert.equal(h.finished, 1)
})

test('actual session does not capture speaker bleed when interruption is disabled', () => {
  const h = sessionHarness({ allowBargeIn: false })
  h.capture({ speaking: true, busy: true }); h.advance(2_000)
  assert.equal(h.session.spokeMs, 0)
  assert.equal(h.stopCalls, 0)
  assert.equal(h.session.speaking, true)
})

test('barge-in releases the actual recording loop before the old host request finishes', () => {
  const h = sessionHarness({ pendingHostStop: true })
  h.capture({ speaking: true, busy: true }); h.advance(520)
  assert.equal(h.stopCalls, 1)
  assert.equal(h.session.busy, false)
  assert.equal(h.session.speaking, false)
  h.setAmplitude(0.005); h.advance(1_100)
  assert.equal(h.finished, 1, 'new input must endpoint even if host cancellation is pending')
})

test('late completion of an interrupted chat cannot clear the next turn speaking state', async () => {
  const h = sessionHarness()
  h.session.busy = true
  const first = h.session.sendChatAndSpeak('First ask')
  h.emit('The old response. ')
  h.session.muteNow()
  assert.equal(h.stopCalls, 1)
  h.session.speakEpoch++
  h.session.busy = true; h.session.bargeIn = false; h.session.muted = false
  const next = h.session.sendChatAndSpeak('New ask')
  h.emit('A fresh response. ')
  assert.equal(h.session.speaking, true)
  h.requests[0].resolve({ content: 'Obsolete reply.' })
  await first
  assert.equal(h.session.speaking, true, 'old finally must not touch the new turn')
  assert.equal(h.session.busy, true)
  assert.equal(h.transcripts.length, 0)
  h.requests[1].resolve({ content: 'A fresh response.' })
  await next
  assert.equal(h.transcripts.length, 1)
  assert.equal(h.transcripts[0].text, 'A fresh response.')
})

test('late completion of direct speech cannot stop a replacement voice turn', async () => {
  const h = sessionHarness()
  const first = h.session.speakDirect('Hiding, sir.')
  h.direct[0].options.onStart()
  h.session.muteNow()
  h.session.speakEpoch++
  h.session.speaking = true
  assert.equal(h.direct[0].options.shouldCancel(), true)
  h.direct[0].resolve({ provider: 'kokoro' })
  await first
  assert.equal(h.session.speaking, true)
})
