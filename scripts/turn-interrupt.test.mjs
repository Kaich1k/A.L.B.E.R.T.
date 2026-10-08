import assert from 'node:assert/strict'
import test from 'node:test'

const turn = await import('../src/main/agent/turnControl.ts')
const voice = await import('../src/shared/voiceReliability.ts')

test('a second prompt drops tokens and speech from the interrupted turn', async () => {
  turn.resetTurnControlForTests()
  const first = turn.supersedeChatTurn()
  let streamed = ''
  await turn.enterChatTurn(first, async () => {
    streamed += 'Hello'
    const second = turn.supersedeChatTurn()
    assert.equal(turn.chatTurnStale(first.generation), true)
    assert.equal(first.signal.aborted, true)
    assert.equal(turn.chatTurnStale(second.generation), false)
    if (!turn.chatTurnStale(first.generation)) streamed += ' from the old turn'
    await turn.enterChatTurn(second, async () => {
      if (!turn.chatTurnStale(second.generation)) streamed += ' fresh'
    })
  })
  assert.equal(streamed, 'Hello fresh')
  assert.equal(voice.isCurrentVoiceGeneration(1, 2, 2), false)
  assert.equal(voice.isCurrentVoiceGeneration(2, 2, 2), true)
})

test('cancelling speech generation invalidates queued synthesis', () => {
  assert.equal(voice.shouldUseSystemTtsFallback({
    enqueued: 2,
    neuralEnqueued: true,
    started: false,
    cancelled: true,
    generationCurrent: false
  }), false)
})
