import assert from 'node:assert/strict'
import test from 'node:test'

const reliability = await import('../src/shared/voiceReliability.ts')
const brainIdentity = await import('../src/shared/brainIdentity.ts')
const audio = await import('../src/renderer/src/voice/audio.ts')
const groqModels = await import('../src/shared/groqModels.ts')
const wakeWord = await import('../src/renderer/src/voice/wakeWord.ts')

test('wake matching accepts the natural phrase and keeps active speech in one segment', () => {
  assert.equal(wakeWord.isWakePhrase('ALBERT wake up'), true)
  assert.equal(wakeWord.isWakePhrase('Albert, wake up.'), true)
  assert.equal(wakeWord.isWakePhrase('Hey Albert'), true)
  assert.equal(wakeWord.isWakePhrase('Wake up, Albert'), true)
  assert.equal(wakeWord.isMicrophoneTrackHealthy({ readyState: 'live', enabled: true, muted: false }), true)
  assert.equal(wakeWord.isMicrophoneTrackHealthy({ readyState: 'ended', enabled: true, muted: false }), false)
  assert.equal(wakeWord.isMicrophoneTrackHealthy({ readyState: 'live', enabled: false, muted: false }), false)
  assert.equal(wakeWord.isMicrophoneTrackHealthy({ readyState: 'live', enabled: true, muted: true }), false)
  assert.equal(
    wakeWord.shouldFinishWakeSegment({ elapsedMs: 3_300, spokeMs: 500, silenceMs: 0 }),
    false
  )
  assert.equal(
    wakeWord.shouldFinishWakeSegment({ elapsedMs: 3_300, spokeMs: 500, silenceMs: 200 }),
    true
  )
  assert.equal(
    wakeWord.shouldFinishWakeSegment({ elapsedMs: 6_500, spokeMs: 500, silenceMs: 0 }),
    false
  )
  assert.equal(
    wakeWord.shouldFinishWakeSegment({ elapsedMs: 12_000, spokeMs: 2_000, silenceMs: 0 }),
    true
  )
})

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

test('repairs the observed recommended homophone without rewriting real amendments', () => {
  assert.equal(
    voiceCommands.correctTranscript('Pull up the tabs in the York Amendment in your Computer.'),
    'Pull up the tabs you recommended in your Computer.'
  )
  assert.equal(
    voiceCommands.correctTranscript('Compare the options the York Amendment.'),
    'Compare the options you recommended.'
  )
  assert.equal(
    voiceCommands.correctTranscript('Explain the New York amendment.'),
    'Explain the New York amendment.'
  )
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

test('bare I am going to go does not end voice, standby still does', () => {
  assert.equal(voiceCommands.isEndVoiceCommand("I'm going to go."), false)
  assert.equal(voiceCommands.isEndVoiceCommand("I'm going to go"), false)
  assert.equal(voiceCommands.isEndVoiceCommand("I'm going to go now."), true)
  assert.equal(voiceCommands.isEndVoiceCommand('standby'), true)
  assert.equal(voiceCommands.isEndVoiceCommand('go to standby'), true)
  assert.equal(voiceCommands.isEndVoiceCommand('stop listening'), true)
  assert.equal(
    voiceCommands.isEndVoiceCommand("it didn't stop like the listening section"),
    false
  )
  assert.equal(
    voiceCommands.isEndVoiceCommand('make the listening stop at the correct time'),
    false
  )
  assert.equal(voiceCommands.isBareStandbyReply('Standing by, sir.'), true)
  assert.equal(voiceCommands.isBareStandbyReply('On it — opening Chrome now.'), false)
})

test('barge-in hold and command confidence keep one-word noise from stopping him', () => {
  assert.equal(voiceGate.commandConfident(0.1, 1), false)
  assert.equal(voiceGate.commandConfident(0.4, 1), true)
  assert.equal(voiceGate.commandConfident(0.1, 2), true)
})

test('voice endpointing is quick for commands and patient with longer thoughts', () => {
  assert.equal(voiceGate.endOfUtteranceSilenceMs(600), 900)
  assert.equal(voiceGate.endOfUtteranceSilenceMs(2_000), 1_300)
  assert.equal(voiceGate.endOfUtteranceSilenceMs(8_000), 1_800)
  assert.equal(voiceGate.isSustainedSpeech(80, 90), false)
  assert.equal(voiceGate.isSustainedSpeech(90, 90), true)
  assert.equal(
    voiceGate.isStillInPhrase({
      loudNow: false,
      aboveSilence: true,
      msSinceLoudSpeech: 1_000,
      hasSpoken: true
    }),
    true
  )
  assert.equal(
    voiceGate.isStillInPhrase({
      loudNow: false,
      aboveSilence: false,
      msSinceLoudSpeech: 1_000,
      hasSpoken: true
    }),
    false
  )
  assert.equal(
    voiceGate.isStillInPhrase({
      loudNow: false,
      aboveSilence: true,
      msSinceLoudSpeech: voiceGate.PHRASE_HOLD_MS,
      hasSpoken: true
    }),
    false
  )
  assert.equal(
    voiceGate.shouldEndpointUtterance({
      spokeMs: 800,
      silenceMs: 2_800,
      minSpeechMs: 320,
      speakingNow: false,
      canEndpoint: true
    }),
    true
  )
  assert.equal(
    voiceGate.shouldEndpointUtterance({
      spokeMs: 800,
      silenceMs: 800,
      minSpeechMs: 320,
      speakingNow: false,
      canEndpoint: true
    }),
    false
  )
  assert.equal(
    voiceGate.shouldEndpointUtterance({
      spokeMs: 20_000,
      silenceMs: 2_000,
      minSpeechMs: 320,
      speakingNow: true,
      canEndpoint: true,
      recordingMs: 30_000
    }),
    false
  )
})

test('silence trimming follows room tone while retaining quiet phonemes', () => {
  assert.equal(voiceGate.transcriptTrimThreshold({ value: 0.002, samples: 40 }), 0.0035)
  assert.ok(
    Math.abs(voiceGate.transcriptTrimThreshold({ value: 0.01, samples: 40 }) - 0.0055) <
      Number.EPSILON * 4
  )
  assert.equal(voiceGate.transcriptTrimThreshold({ value: 0.03, samples: 40 }), 0.009)
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
