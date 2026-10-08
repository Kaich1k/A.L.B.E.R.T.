import assert from 'node:assert/strict'
import test from 'node:test'

const ctx = await import('../src/shared/conversationContext.ts')

function msg(id, role, content, createdAt) {
  return { id, role, content, createdAt }
}

test('undefined since does not wipe shared Comm history (Codex default)', () => {
  const messages = [
    msg('a', 'user', 'hello from Gemini turn', 1_000),
    msg('b', 'assistant', 'still the same thread, sir', 2_000),
    msg('c', 'user', 'now on ChatGPT', 3_000)
  ]
  const block = ctx.recentConversationContext(messages, 'c', undefined)
  assert.match(block, /ONE CONTINUOUS COMM THREAD/)
  assert.match(block, /hello from Gemini turn/)
  assert.match(block, /still the same thread/)
  assert.doesNotMatch(block, /now on ChatGPT/)
})

test('explicit fresh-thread bound excludes older turns', () => {
  const messages = [
    msg('a', 'user', 'old chat', 1_000),
    msg('b', 'assistant', 'old reply', 2_000),
    msg('c', 'user', 'after purge', 5_000),
    msg('d', 'assistant', 'fresh start, sir', 6_000)
  ]
  const block = ctx.recentConversationContext(messages, undefined, 4_000)
  assert.doesNotMatch(block, /old chat/)
  assert.match(block, /after purge/)
  assert.match(block, /fresh start/)
})

test('continuity memory prefers preferences plus fresh facts', () => {
  const all = [
    { id: '1', category: 'preference', content: 'likes terse replies', updatedAt: 9, createdAt: 1 },
    { id: '2', category: 'project', content: 'building ALBERT', updatedAt: 8, createdAt: 1 },
    { id: '3', category: 'misc', content: 'noise', updatedAt: 1, createdAt: 1 }
  ]
  const relevant = [all[2]]
  const picked = ctx.selectContinuityMemories(relevant, all, 10)
  assert.ok(picked.some((m) => m.id === '1'))
  assert.ok(picked.some((m) => m.id === '2'))
})
