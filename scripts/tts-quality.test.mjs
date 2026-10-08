import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Staged checks can borrow unchanged dependencies without copying the repo.
const dependencyRoot = process.env.ALBERT_TEST_ROOT || root
const requireDependency = createRequire(join(dependencyRoot, 'package.json'))
const ts = requireDependency('typescript')

function loadTs(relative, mocks = {}, globals = {}, testExports = '') {
  const cache = new Map()
  function load(filename) {
    const candidate = existsSync(filename) ? filename : join(dependencyRoot, filename.slice(root.length + 1))
    if (cache.has(candidate)) return cache.get(candidate).exports
    const module = { exports: {} }
    cache.set(candidate, module)
    const extra = filename === join(root, relative) ? testExports : ''
    const source = ts.transpileModule(readFileSync(candidate, 'utf8') + '\n' + extra, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText
    vm.runInNewContext(source, {
      module, exports: module.exports, __dirname: dirname(candidate), Buffer,
      process, setTimeout, clearTimeout, console: { ...console, warn() {} },
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

function pcm(samples, sampleRate = 24000) {
  const channels = Array.isArray(samples) ? samples : [samples]
  return { length: channels[0].length, sampleRate, duration: channels[0].length / sampleRate,
    numberOfChannels: channels.length, getChannelData: (index) => channels[index] }
}

test('silence trimming retains quiet initial and final consonants', () => {
  const { findSpeechActiveWindow } = loadTs('src/shared/ttsAudio.ts')
  const samples = new Float32Array(24000)
  for (let i = 2400; i < 5280; i++) samples[i] = i % 2 ? 0.004 : -0.004
  for (let i = 5280; i < 17280; i++) samples[i] = 0.10 * Math.sin(i * 0.13)
  for (let i = 17280; i < 19200; i++) samples[i] = i % 2 ? 0.004 : -0.004
  const active = findSpeechActiveWindow(pcm(samples))
  assert.ok(active.offsetSec <= 0.10, 'initial consonant must be retained')
  assert.ok(active.offsetSec + active.durationSec >= 0.80, 'final consonant must be retained')
  assert.ok(active.offsetSec > 0.05, 'unnecessary opening silence should still be trimmed')
  assert.ok(active.offsetSec + active.durationSec < 0.86, 'unnecessary ending silence should still be trimmed')
  assert.equal(active.leadingSilentSec, 0.025)
  assert.equal(active.trailingSilentSec, 0.035)
})

test('trimming detects speech on either stereo channel and handles silence', () => {
  const { findSpeechActiveWindow } = loadTs('src/shared/ttsAudio.ts')
  const silence = new Float32Array(24000)
  const right = silence.slice()
  for (let i = 4800; i < 12000; i++) right[i] = i % 2 ? 0.001 : -0.001
  const active = findSpeechActiveWindow(pcm([silence, right]))
  assert.ok(active.offsetSec <= 0.2)
  assert.ok(active.offsetSec + active.durationSec >= 0.5)
  const empty = findSpeechActiveWindow(pcm(silence))
  assert.equal(empty.offsetSec, 0)
  assert.equal(empty.durationSec, 1)
})

function ttsHarness({ chunks } = {}) {
  const nativeSpeech = []
  const neuralRequests = []
  let rejectSynthesis
  const settings = { ttsProvider: 'kokoro', kokoroVoiceId: 'bm_daniel', ttsRate: 1.06, ttsPitch: 1, ttsStripPunctuation: false, ttsVoice: 'Daniel' }
  const speechSynthesis = {
    speaking: false, pending: false,
    getVoices: () => [{ name: 'Daniel', lang: 'en-GB', localService: true }],
    cancel() {}, resume() {},
    speak(utterance) {
      nativeSpeech.push(utterance)
      utterance.onstart?.()
      queueMicrotask(() => utterance.onend?.())
    }
  }
  const api = loadTs('src/renderer/src/voice/tts.ts', {
    '../store': { useAlbertStore: { getState: () => ({ settings }) } },
    '../../../shared/speechText': {
      chunkForSystemTts: text => chunks || [text],
      segmentForSpeech: text => [{ text, pauseAfter: 'sentence' }],
      stripMarkdownForSpeech: text => text,
      joinGapSeconds: () => 0
    }
  }, {
    window: { setTimeout, clearTimeout, performance, speechSynthesis,
      albert: {
        speakKokoro(text, options) {
          neuralRequests.push({ text, options })
          return new Promise((_, reject) => { rejectSynthesis = reject })
        },
        cancelKokoro: async () => undefined
      }
    },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text } }
  })
  return { api, nativeSpeech, neuralRequests, reject: error => rejectSynthesis(error) }
}

test('cancelled pending Kokoro synthesis never restarts through system fallback', async () => {
  const harness = ttsHarness()
  const playback = harness.api.speakText('Keep this cancelled.')
  const rejected = assert.rejects(playback, /cancelled/)
  await new Promise(resolve => setImmediate(resolve))
  harness.api.stopSpeaking()
  harness.reject(new Error('Kokoro synthesis cancelled'))
  await rejected
  assert.equal(harness.nativeSpeech.length, 0)
  assert.equal(harness.neuralRequests[0].options.voiceId, 'bm_daniel')
})

test('genuine neural failure still falls back after adopting its playback generation', async () => {
  const harness = ttsHarness()
  const playback = harness.api.speakText('Recover this sentence.')
  await new Promise(resolve => setImmediate(resolve))
  harness.reject(new Error('Synthetic worker failure'))
  const result = await playback
  assert.equal(result.providerUsed, 'system')
  assert.equal(result.fallbackFrom, 'kokoro')
  assert.equal(harness.nativeSpeech.length, 1)
  assert.equal(harness.nativeSpeech[0].text, 'Recover this sentence.')
  assert.equal(harness.nativeSpeech[0].rate, 1.06)
})

test('stopping native speech does not restart its later chunks', async () => {
  const harness = ttsHarness({ chunks: ['First part.', 'Later part.'] })
  await harness.api.speakText('Long response.', {
    provider: 'system', onStart: () => harness.api.stopSpeaking()
  })
  assert.equal(harness.nativeSpeech.length, 1)
})

function audioHarness({ deferredDecode = false } = {}) {
  const speech = loadTs('src/shared/speechText.ts')
  const nativeSpeech = []
  const starts = []
  const sources = []
  const timers = new Map()
  let timerId = 0
  let rejectDecode
  let decodeStarted = false
  const samples = new Float32Array(24000)
  for (let index = 2400; index < 19200; index++) samples[index] = 0.1 * Math.sin(index * 0.13)
  const buffer = pcm(samples)
  const context = {
    state: 'running', currentTime: 1, destination: {},
    decodeAudioData() {
      decodeStarted = true
      return deferredDecode ? new Promise((_, reject) => { rejectDecode = reject }) : Promise.resolve(buffer)
    },
    createBufferSource() {
      const source = { connect() {}, disconnect() {},
        start(at, offset, duration) { starts.push({ at, offset, duration }) },
        stop() { queueMicrotask(() => source.onended?.()) }, onended: null }
      sources.push(source)
      return source
    },
    createGain() { return { connect() {}, disconnect() {}, gain: { setValueAtTime() {}, linearRampToValueAtTime() {} } } }
  }
  const settings = { ttsProvider: 'kokoro', kokoroVoiceId: 'bm_daniel', ttsRate: 1.06, ttsPitch: 1, ttsStripPunctuation: false, ttsVoice: 'Daniel' }
  const api = loadTs('src/renderer/src/voice/tts.ts', {
    '../store': { useAlbertStore: { getState: () => ({ settings }) } },
    '../../../shared/speechText': speech
  }, {
    atob: () => '\0',
    AudioContext: class { constructor() { return context } },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text } },
    window: {
      setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id },
      clearTimeout(id) { timers.delete(id) }, performance,
      speechSynthesis: {
        speaking: false, pending: false, cancel() {}, resume() {},
        getVoices: () => [{ name: 'Daniel', lang: 'en-GB', localService: true }],
        speak(utterance) { nativeSpeech.push(utterance); utterance.onstart?.(); queueMicrotask(() => utterance.onend?.()) }
      },
      albert: { speakKokoro: async () => 'audio', cancelKokoro: async () => undefined }
    }
  }, 'export { scheduleGaplessBase64 };')
  return { api, starts, nativeSpeech, context, sources, timers,
    decodeStarted: () => decodeStarted, rejectDecode: error => rejectDecode(error),
    finishAll() { context.currentTime = 20; sources.forEach(source => source.onended?.()) } }
}

test('gap scheduling uses previous pause and subtracts both retained pads exactly once', async () => {
  const harness = audioHarness()
  const first = await harness.api.scheduleGaplessBase64('audio', { pauseAfter: 'paragraph' })
  const second = await harness.api.scheduleGaplessBase64('audio', { pauseAfter: 'clause' })
  const third = await harness.api.scheduleGaplessBase64('audio', { pauseAfter: 'none' })
  const [a, b, c] = harness.starts
  const firstGap = b.at - (a.at + a.duration)
  const secondGap = c.at - (b.at + b.duration)
  assert.ok(Math.abs(firstGap - (0.28 - 0.035 - 0.025)) < 1e-9)
  assert.ok(Math.abs(secondGap - (0.07 - 0.035 - 0.025)) < 1e-9)
  assert.ok(Math.abs(firstGap + 0.035 + 0.025 - 0.28) < 1e-9, 'retained silence must not stack onto requested pause')
  harness.finishAll()
  await Promise.all([first.ended, second.ended, third.ended])
  assert.equal(harness.timers.size, 0)
})

test('cancelled decode after playback generation adoption never falls back', async () => {
  const harness = audioHarness({ deferredDecode: true })
  const playback = harness.api.speakText('Cancel during decoding.')
  const rejected = assert.rejects(playback, /decode rejected/)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(harness.decodeStarted(), true)
  harness.api.stopSpeaking()
  harness.rejectDecode(new Error('decode rejected'))
  await rejected
  assert.equal(harness.nativeSpeech.length, 0)
  assert.equal(harness.timers.size, 0)
})

test('genuine prestart decode error preserves system fallback', async () => {
  const harness = audioHarness({ deferredDecode: true })
  const playback = harness.api.speakText('Recover a decode failure.')
  await new Promise(resolve => setImmediate(resolve))
  harness.rejectDecode(new Error('decode rejected'))
  const result = await playback
  assert.equal(result.providerUsed, 'system')
  assert.equal(harness.nativeSpeech.length, 1)
  assert.equal(harness.nativeSpeech[0].rate, 1.06)
  assert.equal(harness.timers.size, 0)
})

function workerHarness(globals = {}) {
  const workers = []
  const api = loadTs('src/main/voice/kokoro.ts', {
    electron: { app: { isPackaged: false, getPath: () => '/unused', getAppPath: () => root }, BrowserWindow: { getAllWindows: () => [] } },
    fs: { mkdirSync() {}, existsSync: () => true, copyFileSync() {} },
    '../config': { getSettings: () => ({ kokoroVoiceId: 'bm_daniel', ttsRate: 1.06 }) },
    child_process: { fork() {
      const child = new EventEmitter()
      child.connected = true
      child.killed = false
      child.stderr = new EventEmitter()
      child.messages = []
      child.send = (message, callback) => { child.messages.push(message); callback?.(null) }
      child.kill = () => { child.killed = true; return true }
      workers.push(child)
      return child
    } }
  }, globals)
  return { api, workers }
}

test('failed worker init can retry; late events from retired worker cannot break replacement', async () => {
  const { api, workers } = workerHarness()
  const first = api.warmKokoro()
  const rejected = assert.rejects(first, /test init failed/)
  workers[0].emit('message', { type: 'err', id: workers[0].messages[0].id, message: 'test init failed' })
  await rejected
  assert.equal(workers[0].killed, true)
  const retry = api.warmKokoro()
  assert.equal(workers.length, 2)
  const replacementId = workers[1].messages[0].id
  workers[0].emit('exit', 1)
  workers[0].emit('error', new Error('late retired error'))
  workers[0].emit('message', { type: 'err', id: replacementId, message: 'stale message' })
  workers[1].emit('message', { type: 'ok', id: replacementId, result: 'ready' })
  await retry
  await api.warmKokoro()
  assert.equal(workers.length, 2)
  assert.equal(workers[1].killed, false)
})

test('init timeout retires the failed readiness promise and permits a fresh worker', async () => {
  const timers = new Map()
  let timerId = 0
  const { api, workers } = workerHarness({
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id },
    clearTimeout(id) { timers.delete(id) }
  })
  const first = api.warmKokoro()
  const rejected = assert.rejects(first, /init timed out/)
  timers.get(1)()
  await rejected
  const retry = api.warmKokoro()
  assert.equal(workers.length, 2)
  workers[1].emit('message', { type: 'ok', id: workers[1].messages[0].id, result: 'ready' })
  await retry
})
