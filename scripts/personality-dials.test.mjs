import assert from 'node:assert/strict'
import test from 'node:test'

const personality = await import('../src/shared/personality.ts')

test('parses tune your humor up to 70%', () => {
  const adj = personality.parsePersonalityVoiceCommand('tune your humor up to 70%')
  assert.deepEqual(adj, { kind: 'set', key: 'sarcasm', value: 70 })
})

test('extracts humor dial from a compound ask without stealing the rest', () => {
  const extracted = personality.extractPersonalityVoiceCommand(
    'Okay perfect albert, thank you. And also just let me know how many sessions I should record, the length of each session and like the instructions for each. And then also tune your humor up to 70%.'
  )
  assert.ok(extracted)
  assert.deepEqual(extracted.adj, { kind: 'set', key: 'sarcasm', value: 70 })
  assert.match(extracted.remainder, /how many sessions/i)
  assert.doesNotMatch(extracted.remainder, /humor|70/i)
})

test('humour spelling and bare "humor to 60" work', () => {
  assert.deepEqual(personality.parsePersonalityVoiceCommand('set humour to 60'), {
    kind: 'set',
    key: 'sarcasm',
    value: 60
  })
  assert.deepEqual(personality.parsePersonalityVoiceCommand('humor core to seventy'), {
    kind: 'set',
    key: 'sarcasm',
    value: 70
  })
})

test('does not treat "more detailed plan" as a dial nudge', () => {
  assert.equal(
    personality.parsePersonalityVoiceCommand('I want a more detailed plan for the EEG sessions'),
    null
  )
})

test('confirmations report real before/after values — no fake percent math', () => {
  const prev = { sarcasm: 50, warmth: 95, verbosity: 50 }
  const adj = { kind: 'set', key: 'sarcasm', value: 70 }
  const next = personality.applyPersonalityAdjust(prev, adj)
  const reply = personality.personalityAdjustReply(adj, next, prev)
  assert.equal(reply, 'Sarcasm (humor) set from 50 to 70, sir.')
  assert.doesNotMatch(reply, /percent|insufferable/i)
})
