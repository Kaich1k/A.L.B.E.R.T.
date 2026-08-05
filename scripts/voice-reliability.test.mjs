import assert from 'node:assert/strict'
import test from 'node:test'

const reliability = await import('../src/shared/voiceReliability.ts')
const brainIdentity = await import('../src/shared/brainIdentity.ts')
const audio = await import('../src/renderer/src/voice/audio.ts')
const groqModels = await import('../src/shared/groqModels.ts')

test('collapses the exact repeated Whisper question from the reported turn', () => {
  assert.equal(
    reliability.collapseRepeatedTranscript(
      'Which AI are you using right now? Which AI are you using right now?'
    ),
    'Which AI are you using right now?'
  )
})

test('preserves intentional short emphasis and non-identical clauses', () => {
  assert.equal(reliability.collapseRepeatedTranscript('No no no no'), 'No no no no')
  assert.equal(
    reliability.collapseRepeatedTranscript(
      'Which AI are you using right now? Which AI should I use right now?'
    ),
    'Which AI are you using right now? Which AI should I use right now?'
  )
})

test('uses system fallback only for a total, current neural playback failure', () => {
  const base = {
    enqueued: 1,
    neuralEnqueued: true,
    started: false,
    cancelled: false,
    generationCurrent: true
  }
  assert.equal(reliability.shouldUseSystemTtsFallback(base), true)
  assert.equal(reliability.shouldUseSystemTtsFallback({ ...base, started: true }), false)
  assert.equal(reliability.shouldUseSystemTtsFallback({ ...base, cancelled: true }), false)
  assert.equal(reliability.shouldUseSystemTtsFallback({ ...base, neuralEnqueued: false }), false)
  assert.equal(reliability.shouldUseSystemTtsFallback({ ...base, generationCurrent: false }), false)
})

test('keeps recovery speech ordered and ignores stale generation failures', () => {
  assert.equal(
    reliability.ttsRecoveryTail(['Sentence one.', 'Sentence two.', 'Sentence three.'], 1),
    'Sentence two. Sentence three.'
  )
  assert.equal(reliability.isCurrentVoiceGeneration(4, 4, 4), true)
  assert.equal(reliability.isCurrentVoiceGeneration(3, 4, 4), false)
  assert.equal(reliability.isCurrentVoiceGeneration(4, 4, 5), false)
})

test('trims the three-second VAD tail but keeps a natural speech pad', () => {
  const samples = new Float32Array(16_000 * 4.5)
  samples.fill(0.08, 16_000, 24_000)
  const trimmed = audio.trimSilence(samples)
  assert.ok(trimmed.length >= 13_000, `trimmed length ${trimmed.length}`)
  assert.ok(trimmed.length <= 14_500, `trimmed length ${trimmed.length}`)
})

test('detects current-brain questions without hijacking recommendations', () => {
  assert.equal(brainIdentity.isActiveBrainQuestion('Which AI are you using right now?'), true)
  assert.equal(brainIdentity.isActiveBrainQuestion('What is your active model?'), true)
  assert.equal(brainIdentity.isActiveBrainQuestion('Are you on Haiku?'), true)
  assert.equal(brainIdentity.isActiveBrainQuestion('Which AI should I use for Albert?'), false)
  assert.equal(brainIdentity.isActiveBrainQuestion('Compare Groq and Gemini for me'), false)
})

test('formats brain identity from the resolved route, never chat history', () => {
  assert.equal(
    brainIdentity.activeBrainReply({
      provider: 'groq',
      tier: 'local',
      model: 'openai/gpt-oss-20b'
    }),
    'Active brain this turn: Groq Cloud — openai/gpt-oss-20b, sir.'
  )
  assert.equal(
    brainIdentity.activeBrainReply({
      provider: 'anthropic',
      tier: 'fast',
      model: 'claude-haiku-4-5'
    }),
    'Active brain this turn: Anthropic Haiku — claude-haiku-4-5, sir.'
  )
})

test('retires temporary Groq models deterministically at the published cutoff', () => {
  const before = Date.parse('2026-08-15T23:59:59Z')
  const after = Date.parse('2026-08-16T00:00:00Z')
  assert.equal(groqModels.groqTransitionWindowOpen(before), true)
  assert.equal(groqModels.groqTransitionWindowOpen(after), false)
  assert.equal(
    groqModels.normalizeGroqModelForDate('llama-3.1-8b-instant', before),
    'llama-3.1-8b-instant'
  )
  assert.equal(
    groqModels.normalizeGroqModelForDate('llama-3.1-8b-instant', after),
    'openai/gpt-oss-20b'
  )
})
