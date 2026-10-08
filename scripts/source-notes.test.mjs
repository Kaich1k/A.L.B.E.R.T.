import test from 'node:test'
import assert from 'node:assert/strict'
import { createSourceNoteCache } from '../src/renderer/src/chat/sourceNotes.ts'

test('one pending source write survives duplicate requests and later visits', async () => {
  const cache = createSourceNoteCache()
  let resolve
  let writes = 0
  const write = () => { writes++; return new Promise((done) => { resolve = done }) }
  const first = cache.save('A', write)
  await cache.save('A', write)
  assert.equal(writes, 1)
  assert.equal(cache.getSnapshot().get('A').state, 'pending')
  resolve()
  await first
  await cache.save('B', async () => {})
  await cache.save('A', write)
  assert.equal(writes, 1)
  assert.equal(cache.getSnapshot().get('A').state, 'saved')
})

test('late failure stays with its source and a retry can succeed', async () => {
  const cache = createSourceNoteCache()
  let reject
  const a = cache.save('A', () => new Promise((_, fail) => { reject = fail }))
  await cache.save('B', async () => {})
  reject(new Error('A could not be saved'))
  await a
  assert.deepEqual(cache.getSnapshot().get('A'), { state: 'error', error: 'A could not be saved' })
  assert.deepEqual(cache.getSnapshot().get('B'), { state: 'saved' })
  await cache.save('A', async () => {})
  assert.deepEqual(cache.getSnapshot().get('A'), { state: 'saved' })
})

test('snapshots notify mounted consumers and remain readable after unsubscribe', async () => {
  const cache = createSourceNoteCache()
  const initial = cache.getSnapshot()
  let updates = 0
  const off = cache.subscribe(() => { updates++ })
  await cache.save('A', async () => {})
  assert.equal(updates, 2)
  assert.notEqual(cache.getSnapshot(), initial)
  assert.equal(initial.size, 0)
  off()
  await cache.save('B', async () => {})
  assert.equal(updates, 2)
  assert.equal(cache.getSnapshot().get('A').state, 'saved')
})
