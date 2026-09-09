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

test('formats Codex as the active brain without claiming Anthropic', () => {
  assert.equal(brainIdentity.isActiveBrainQuestion('Are you on Codex?'), true)
  assert.equal(
    brainIdentity.activeBrainReply({
      provider: 'codex',
      tier: 'codex',
      model: 'gpt-5.6-terra'
    }),
    'Active brain this turn: ChatGPT — gpt-5.6-terra, sir — running on your ChatGPT allowance.'
  )
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

test('detects active surface questions without hijacking unrelated ask', () => {
  assert.equal(brainIdentity.isActiveSurfaceQuestion('Are you on the phone?'), true)
  assert.equal(brainIdentity.isActiveSurfaceQuestion('Which app are you on?'), true)
  assert.equal(brainIdentity.isActiveSurfaceQuestion('Where are you answering from?'), true)
  assert.equal(brainIdentity.isActiveSurfaceQuestion('Are we talking on the Mac?'), true)
  assert.equal(brainIdentity.isActiveSurfaceQuestion('Open Spotify on my phone'), false)
  assert.equal(
    brainIdentity.activeSurfaceReply('phone'),
    "You're on the phone app with me right now, sir — not the Mac desktop."
  )
  assert.equal(
    brainIdentity.activeSurfaceReply('mac'),
    "You're on the Mac desktop app with me right now, sir — not the phone companion."
  )
})

const voiceCommands = await import('../src/shared/voiceCommands.ts')
const voiceGate = await import('../src/shared/voiceGate.ts')

test('noise crumbs from HVAC and keyboard are treated as hallucinations', () => {
  for (const crumb of ['you', 'the', 'yeah', 'okay', 'huh', 'you know', 'I think so', 'thanks for watching']) {
    assert.equal(voiceCommands.isLikelyHallucination(crumb), true, crumb)
  }
  assert.equal(voiceCommands.isLikelyHallucination('inspect this project and run the tests'), false)
})

test('stopword-only utterances never count as a command', () => {
  assert.equal(voiceCommands.voiceContentWords('yeah okay so').length, 0)
  assert.equal(voiceCommands.voiceContentWords('inspect this project').length >= 2, true)
})

test('rolling noise floor plus voiced-frame ratio reject fan-like buffers', () => {
  let floor = voiceGate.createNoiseFloor(0.01)
  for (let i = 0; i < 40; i++) floor = voiceGate.updateNoiseFloor(floor, 0.012)
  const thresholds = voiceGate.speechThresholds(floor, 50)
  assert.ok(thresholds.barge >= 0.035, `barge ${thresholds.barge}`)
  assert.ok(thresholds.speech > floor.value)

  const noise = new Float32Array(16_000)
  for (let i = 0; i < noise.length; i++) noise[i] = (i % 17 === 0 ? 0.08 : 0.01) * (i % 2 ? 1 : -1)
  const gate = voiceGate.shouldTranscribe({ samples: noise, floor, sensitivity: 50 })
  assert.equal(gate.ok, false)

  const speech = new Float32Array(16_000)
  for (let i = 0; i < speech.length; i++) {
    const voiced = Math.floor(i / 320) % 3 !== 2
    speech[i] = voiced ? Math.sin(i / 12) * 0.18 : 0.004
  }
  const speechGate = voiceGate.shouldTranscribe({ samples: speech, floor, sensitivity: 50 })
  assert.equal(speechGate.ok, true)
})

test('default listening gate accepts normal conversational microphone levels', () => {
  let floor = voiceGate.createNoiseFloor(0.012)
  for (let i = 0; i < 30; i++) floor = voiceGate.updateNoiseFloor(floor, 0.012)
  const thresholds = voiceGate.speechThresholds(floor, 50)
  assert.ok(thresholds.speech < 0.035, `speech threshold ${thresholds.speech}`)

  const quietSpeech = new Float32Array(16_000)
  for (let i = 0; i < quietSpeech.length; i++) {
    const voiced = Math.floor(i / 320) % 4 !== 3
    quietSpeech[i] = voiced ? Math.sin(i / 9) * 0.055 : 0.004
  }
  assert.equal(voiceGate.shouldTranscribe({ samples: quietSpeech, floor, sensitivity: 50 }).ok, true)
})

test('barge-in hold and command confidence keep one-word noise from stopping him', () => {
  assert.equal(voiceGate.commandConfident(0.1, 1), false)
  assert.equal(voiceGate.commandConfident(0.4, 1), true)
  assert.equal(voiceGate.commandConfident(0.1, 2), true)
})

test('voice endpointing answers short commands quickly without clipping longer thoughts', () => {
  assert.equal(voiceGate.endOfUtteranceSilenceMs(600), 1_800)
  assert.equal(voiceGate.endOfUtteranceSilenceMs(2_000), 2_200)
  assert.equal(voiceGate.endOfUtteranceSilenceMs(8_000), 2_600)
})

test('overlapping Whisper chunks keep the whole thought without duplicated boundaries', () => {
  assert.equal(
    reliability.mergeTranscriptChunks([
      'make the listening accurate and do not cut',
      'do not cut my voice off when I pause'
    ]),
    'make the listening accurate and do not cut my voice off when I pause'
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
