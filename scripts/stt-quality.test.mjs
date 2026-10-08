import assert from 'node:assert/strict'
import test from 'node:test'
import { downsampleTo16k, speechWindow } from '../src/renderer/src/voice/audio.ts'
import {
  hasConfidentShortReplyAudio,
  shouldEndpointUtterance,
  shouldResetShortUtterance,
  shouldTranscribe,
  SHORT_REPLY_MIN_SPEECH_MS
} from '../src/shared/voiceGate.ts'
import { isLikelyHallucination } from '../src/shared/voiceCommands.ts'

const floor = { value: 0.01, samples: 40 }
const tone = (hz, seconds, rate = 16000, amplitude = 0.12) =>
  Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amplitude * Math.sin(2 * Math.PI * hz * i / rate))
const rms = (samples) => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length)

test('identical speech remains acceptable after 45 seconds of audible idle room tone', () => {
  const utterance = tone(300, 1)
  for (const idleSeconds of [0, 45]) {
    const recording = tone(200, idleSeconds + 4.2, 16000, 0.01)
    recording.set(utterance, idleSeconds * 16000)
    const evidence = speechWindow(recording, idleSeconds * 1000, (idleSeconds + 1) * 1000)
    const gate = shouldTranscribe({ samples: evidence, floor, sensitivity: 50 })
    assert.equal(gate.ok, true)
    assert.ok(gate.voicedRatio > 0.95)
    assert.deepEqual(evidence, utterance)
    assert.ok(speechWindow(recording, idleSeconds * 1000, (idleSeconds + 1) * 1000, 420).length <= 29440)
  }
})

test('ASR padding preserves quiet boundary phonemes without diluting confidence', () => {
  const recording = new Float32Array(32000)
  recording.fill(0.003, 8000, 9000)
  recording.set(tone(300, 0.24), 9600)
  recording.fill(0.003, 13600, 14600)
  const evidence = speechWindow(recording, 600, 840)
  const padded = speechWindow(recording, 600, 840, 420)
  assert.equal(evidence.length, 3840)
  assert.equal(padded[8000 - 2880], recording[8000])
  assert.equal(padded[14000 - 2880], recording[14000])
  assert.equal(shouldTranscribe({ samples: evidence, floor, minSamples: SHORT_REPLY_MIN_SPEECH_MS * 16 }).ok, true)
})

test('a clear short reply endpoints, while ongoing speech and hot-mic capture retain their safeguards', () => {
  const base = { spokeMs: 240, silenceMs: 2800, minSpeechMs: SHORT_REPLY_MIN_SPEECH_MS, speakingNow: false, canEndpoint: true }
  assert.equal(shouldEndpointUtterance(base), true)
  assert.equal(shouldEndpointUtterance({ ...base, speakingNow: true }), false)
  assert.equal(shouldEndpointUtterance({ ...base, canEndpoint: false }), false)
  assert.equal(shouldEndpointUtterance({ ...base, minSpeechMs: 320 }), false)
  assert.equal(shouldEndpointUtterance({ ...base, silenceMs: 800 }), false)
})

test('an ended sub-minimum burst is discarded instead of contaminating the next command', () => {
  const base = { spokeMs: 120, silenceMs: 2800, minSpeechMs: SHORT_REPLY_MIN_SPEECH_MS, speakingNow: false, canEndpoint: true }
  assert.equal(shouldResetShortUtterance(base), true)
  assert.equal(shouldResetShortUtterance({ ...base, spokeMs: 0 }), false)
  assert.equal(shouldResetShortUtterance({ ...base, spokeMs: 240 }), false)
  assert.equal(shouldResetShortUtterance({ ...base, silenceMs: 800 }), false)
  assert.equal(shouldResetShortUtterance({ ...base, canEndpoint: false }), false)
})

test('yes/no survive only with strong normal-listening audio; wake and hot-mic defaults stay conservative', () => {
  const strong = { voicedRatio: 0.8, spokeMs: 240, hotMic: false }
  const allowShortReply = hasConfidentShortReplyAudio(strong)
  assert.equal(allowShortReply, true)
  for (const text of ['yes', 'No.', 'okay', 'thank you']) {
    assert.equal(isLikelyHallucination(text), true, `default filter: ${text}`)
    assert.equal(isLikelyHallucination(text, { allowShortReply }), false, `clear reply: ${text}`)
  }
  assert.equal(hasConfidentShortReplyAudio({ ...strong, hotMic: true }), false)
  assert.equal(hasConfidentShortReplyAudio({ ...strong, voicedRatio: 0.1 }), false)
  assert.equal(hasConfidentShortReplyAudio({ ...strong, spokeMs: 70 }), false)
  for (const text of ['you', 'the', 'thanks for watching', 'I think so']) {
    assert.equal(isLikelyHallucination(text, { allowShortReply }), true, text)
  }
})

test('room tone and isolated clicks still fail the acoustic gate', () => {
  const noise = tone(200, 1, 16000, 0.01)
  noise[500] = 0.8
  noise[8000] = -0.8
  assert.equal(shouldTranscribe({ samples: noise, floor, sensitivity: 50 }).ok, false)
})

test('48k and 44.1k resampling suppress above-Nyquist noise instead of aliasing it into speech frequencies', () => {
  for (const rate of [48000, 44100]) {
    const resampled = downsampleTo16k(tone(10000, 0.25, rate, 1), rate)
    assert.equal(resampled.length, 4000)
    assert.ok(rms(resampled.subarray(100, -100)) < 0.025, `unwanted alias at ${rate} Hz`)
    const speechBand = downsampleTo16k(tone(1000, 0.25, rate, 1), rate)
    assert.ok(Math.abs(rms(speechBand.subarray(100, -100)) - Math.SQRT1_2) < 0.015, `speech band at ${rate} Hz`)
  }
})

test('resampling preserves DC levels and duration, and the existing 16k path is unchanged', () => {
  const ready = tone(300, 0.1)
  assert.equal(downsampleTo16k(ready, 16000), ready)
  const constant = new Float32Array(4410).fill(0.2)
  const output = downsampleTo16k(constant, 44100)
  assert.equal(output.length, 1600)
  assert.ok(output.every((value) => Math.abs(value - 0.2) < 1e-6))
  assert.equal(downsampleTo16k(new Float32Array(), 48000).length, 0)
  assert.throws(() => downsampleTo16k(ready, 0), RangeError)
})
