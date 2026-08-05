import assert from 'node:assert/strict'
import test from 'node:test'
import {
  INTERIM_TAIL_SILENCE_MS,
  InterimTranscriptTail,
  readTranscriptEvent,
  speechRetryDelayMs,
  ttsCompletionWatchdogMs,
  voiceGenerationIsCurrent
} from '../src/lib/voiceReliability.ts'

test('speech events are parsed defensively', () => {
  assert.deepEqual(
    readTranscriptEvent({
      isFinal: true,
      results: [{ transcript: '  Hello   there  ' }]
    }),
    { text: 'Hello there', isFinal: true }
  )
  assert.equal(readTranscriptEvent({ results: [] }), null)
  assert.equal(readTranscriptEvent({ results: [{ transcript: 42 }] }), null)
})

test('an interim tail finalizes once after silence', () => {
  const tail = new InterimTranscriptTail()
  assert.equal(tail.observe({ text: 'hello', isFinal: false }, 1_000), null)
  assert.equal(tail.flush(1_000 + INTERIM_TAIL_SILENCE_MS - 1), null)
  assert.equal(tail.flush(1_000 + INTERIM_TAIL_SILENCE_MS), 'hello')
  assert.equal(tail.flush(99_000), null)
})

test('a changed interim transcript restarts the silence window', () => {
  const tail = new InterimTranscriptTail()
  tail.observe({ text: 'what is', isFinal: false }, 100)
  tail.observe({ text: 'what is the weather', isFinal: false }, 800)
  assert.equal(tail.flush(100 + INTERIM_TAIL_SILENCE_MS), null)
  assert.equal(tail.flush(800 + INTERIM_TAIL_SILENCE_MS), 'what is the weather')
})

test('a native final wins and prevents a duplicate interim flush', () => {
  const tail = new InterimTranscriptTail()
  tail.observe({ text: 'open the', isFinal: false }, 100)
  assert.equal(tail.observe({ text: 'open the calendar', isFinal: true }, 200), 'open the calendar')
  assert.equal(tail.flush(100_000), null)
})

test('TTS watchdog is long enough for short replies and bounded for long replies', () => {
  assert.equal(ttsCompletionWatchdogMs('Online, sir.'), 8_000)
  assert.equal(ttsCompletionWatchdogMs('word '.repeat(1_000)), 60_000)
  assert.ok(ttsCompletionWatchdogMs('word '.repeat(30)) > 8_000)
})

test('recognizer retry policy separates recoverable and terminal errors', () => {
  assert.equal(speechRetryDelayMs('not-allowed', 0), null)
  assert.equal(speechRetryDelayMs('language-not-supported', 4), null)
  assert.equal(speechRetryDelayMs('aborted', 0), null)
  assert.equal(speechRetryDelayMs('no-speech', 7), 250)
  assert.equal(speechRetryDelayMs('busy', 0), 450)
  assert.equal(speechRetryDelayMs('busy', 3), 3_600)
  assert.equal(speechRetryDelayMs('network', 9), 6_000)
})

test('stale or background voice generations cannot continue', () => {
  assert.equal(
    voiceGenerationIsCurrent({ expected: 4, current: 4, appActive: true }),
    true
  )
  assert.equal(
    voiceGenerationIsCurrent({ expected: 3, current: 4, appActive: true }),
    false
  )
  assert.equal(
    voiceGenerationIsCurrent({ expected: 4, current: 4, appActive: false }),
    false
  )
})
