import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mergeSyncedData,
  mergeTombstones,
  recordLocalMutation,
  retainLocalTombstones,
  SyncCoordinator,
  syncBackoffMs
} from '../src/lib/syncLogic.ts'
import {
  buildSyncPayloadBatches,
  slimMessageForSync,
  SYNC_SERVER_ARRAY_LIMITS,
  syncAllWithMac,
  syncPayloadBytes
} from '../src/lib/sync.ts'
import { normalizeMacUrl, parsePairInfo } from '../src/lib/pairInfo.ts'

const emptyOps = () => ({ missions: [], routines: [], approvals: [], captures: [], generatedAt: 0 })
const emptyData = () => ({
  messages: [],
  memories: [],
  operations: emptyOps(),
  activity: [],
  sync: { tombstones: [], outbox: [], consecutiveFailures: 0 }
})

test('Mac Copy pair info format pastes the LAN URL and bootstrap token exactly', () => {
  const token = 'abcdef0123456789abcdef0123456789'
  const parsed = parsePairInfo([
    'A.L.B.E.R.T. phone companion',
    'URL=http://albert-mac.local:47831',
    `TOKEN=${token}`,
    'Mac URLs:',
    '  http://127.0.0.1:47831',
    '  http://albert-mac.local:47831',
    '  http://192.168.1.8:47831'
  ].join('\n'))
  // Prefer IPv4 over .local — Bonjour often fails on physical iPhones.
  assert.equal(parsed.macBaseUrl, 'http://192.168.1.8:47831')
  assert.equal(parsed.macToken, token)
})

test('Mac URL normalization adds HTTP but refuses credentials in URLs', () => {
  assert.equal(normalizeMacUrl('albert-mac.local:47831/path?q=secret'), 'http://albert-mac.local:47831')
  assert.throws(() => normalizeMacUrl('http://token@albert-mac.local:47831'), /credentials/)
})

test('newest tombstone wins and remains durable', () => {
  const rows = mergeTombstones(
    [{ entityType: 'memory', entityId: 'm1', deletedAt: 20 }],
    [
      { entityType: 'memory', entityId: 'm1', deletedAt: 10 },
      { entityType: 'chat', entityId: 'c1', deletedAt: 30 }
    ]
  )
  assert.deepEqual(rows, [
    { entityType: 'memory', entityId: 'm1', deletedAt: 20 },
    { entityType: 'chat', entityId: 'c1', deletedAt: 30 }
  ])
})

test('offline delete records both outbox intent and tombstone', () => {
  const next = recordLocalMutation(emptyData().sync, 'memory', 'm1', 'delete', 123)
  assert.equal(next.outbox.length, 1)
  assert.equal(next.outbox[0].action, 'delete')
  assert.deepEqual(next.tombstones, [{ entityType: 'memory', entityId: 'm1', deletedAt: 123 }])
})

test('offline deletes newer than the last successful sync survive the 10,000-row window', () => {
  const old = Array.from({ length: 100 }, (_, index) => ({
    entityType: 'memory', entityId: `old_${index}`, deletedAt: index + 1
  }))
  const pending = Array.from({ length: 10_012 }, (_, index) => ({
    entityType: 'memory', entityId: `pending_${index}`, deletedAt: 20_000 + index
  }))
  const retained = retainLocalTombstones(old, pending, 15_000)
  assert.equal(retained.length, 10_012)
  assert.equal(retained.filter((row) => row.entityId.startsWith('pending_')).length, 10_012)
  const afterSync = retainLocalTombstones(retained, [], 40_000)
  assert.equal(afterSync.length, 10_000)

  const futureDated = Array.from({ length: 10_000 }, (_, index) => ({
    entityType: 'chat', entityId: `future_${index}`, deletedAt: 60_000 + index
  }))
  const skewSafe = recordLocalMutation({
    ...emptyData().sync,
    tombstones: futureDated,
    lastSyncAt: 50_000
  }, 'chat', 'clock_skew_delete', 'delete', 40_000)
  assert.ok(skewSafe.tombstones.some((row) => row.entityId === 'clock_skew_delete'))
})

test('remote stale records cannot resurrect deleted chat or memory', () => {
  const local = emptyData()
  local.sync.tombstones = [
    { entityType: 'chat', entityId: 'c1', deletedAt: 100 },
    { entityType: 'memory', entityId: 'm1', deletedAt: 100 }
  ]
  const merged = mergeSyncedData(local, {
    protocolVersion: 2,
    acknowledgedMutationIds: [],
    messages: [{ id: 'c1', role: 'user', content: 'resurrect me', createdAt: 90 }],
    memories: [{ id: 'm1', content: 'resurrect me', category: 'general', createdAt: 80, updatedAt: 90 }],
    operations: emptyOps(),
    tombstones: []
  }, [])
  assert.equal(merged.messages.length, 0)
  assert.equal(merged.memories.length, 0)
})

test('an old payload-relevant Mac tombstone is applied before the 10,000-row retention cap', () => {
  const oldId = 'chat_old_relevant'
  const latest = emptyData()
  latest.messages = [{ id: oldId, role: 'user', content: 'stale local copy', createdAt: 1 }]
  const newer = Array.from({ length: 10_000 }, (_, index) => ({
    entityType: 'chat',
    entityId: `newer_${index}`,
    deletedAt: 10_000 + index
  }))
  const merged = mergeSyncedData(latest, {
    protocolVersion: 2,
    tombstones: [{ entityType: 'chat', entityId: oldId, deletedAt: 1 }, ...newer]
  }, [])
  assert.equal(merged.messages.some((message) => message.id === oldId), false)
  assert.equal(merged.sync.tombstones.length, 10_000)
})

test('large state is deletion-first, losslessly batched, and always below the byte ceiling', () => {
  const data = emptyData()
  data.sync.outbox = Array.from({ length: 18 }, (_, index) => ({
    id: `mut_${index}`,
    entityType: 'memory',
    entityId: `memory_${index}`,
    action: 'upsert',
    createdAt: index + 1
  }))
  data.sync.tombstones = Array.from({ length: 24 }, (_, index) => ({
    entityType: 'chat',
    entityId: `deleted_${index}`,
    deletedAt: index + 1
  }))
  data.messages = Array.from({ length: 16 }, (_, index) => ({
    id: `chat_${index}`,
    role: index % 2 ? 'assistant' : 'user',
    content: `Message ${index} · ${'∆'.repeat(60)}`,
    createdAt: index + 1
  }))
  data.memories = Array.from({ length: 12 }, (_, index) => ({
    id: `memory_${index}`,
    content: `Memory ${index} ${'signal '.repeat(30)}`,
    category: 'test',
    createdAt: index + 1,
    updatedAt: index + 1
  }))
  data.operations.missions = [{
    id: 'mission_scale', title: 'Scale audit', outcome: 'No step loss', state: 'active',
    priority: 'high', progress: 0, risk: 'prepare', source: 'user', createdAt: 1, updatedAt: 2,
    steps: Array.from({ length: 45 }, (_, index) => ({
      id: `step_${index}`, missionId: 'mission_scale', position: index,
      title: `Verify batch ${index} ${'x'.repeat(80)}`, state: 'pending', createdAt: 1, updatedAt: 2
    }))
  }]

  const limit = 10_000
  const { batches } = buildSyncPayloadBatches(data, 'mobile_test_device', limit)
  assert.ok(batches.length > 1)
  for (const batch of batches) {
    assert.ok(syncPayloadBytes(batch) <= limit)
    assert.equal(syncPayloadBytes(batch), Buffer.byteLength(JSON.stringify(batch), 'utf8'))
  }

  assert.deepEqual(
    batches.flatMap((batch) => batch.mutationIds || []),
    data.sync.outbox.map((mutation) => mutation.id)
  )
  assert.deepEqual(
    batches.flatMap((batch) => batch.tombstones || []).map((row) => row.entityId),
    data.sync.tombstones.map((row) => row.entityId)
  )
  assert.deepEqual(
    batches.flatMap((batch) => batch.messages || []).map((row) => row.id),
    data.messages.map((row) => row.id)
  )
  assert.deepEqual(
    batches.flatMap((batch) => batch.memories || []).map((row) => row.id),
    data.memories.map((row) => row.id)
  )
  assert.deepEqual(
    batches.flatMap((batch) => batch.operations?.missions || [])
      .flatMap((mission) => mission.steps)
      .map((step) => step.id),
    data.operations.missions[0].steps.map((step) => step.id)
  )
  const lastDeleteBatch = batches.reduce(
    (last, batch, index) => batch.tombstones?.length ? index : last,
    -1
  )
  const firstUpsertBatch = batches.findIndex((batch) => Boolean(
    batch.messages?.length || batch.memories?.length || batch.operations
  ))
  assert.ok(lastDeleteBatch <= firstUpsertBatch)
})

test('batching also respects every desktop per-array sanitization ceiling', () => {
  const data = emptyData()
  data.sync.outbox = Array.from(
    { length: SYNC_SERVER_ARRAY_LIMITS.mutationIds + 1 },
    (_, index) => ({
      id: `mut_cap_${index}`,
      entityType: 'mission',
      entityId: `mission_cap_${index}`,
      action: 'upsert',
      createdAt: index + 1
    })
  )
  data.operations.missions = Array.from(
    { length: SYNC_SERVER_ARRAY_LIMITS.missions + 1 },
    (_, index) => ({
      id: `mission_cap_${index}`,
      title: `Mission ${index}`,
      outcome: 'Converge without silent truncation',
      state: 'queued',
      priority: 'normal',
      progress: 0,
      risk: 'prepare',
      source: 'user',
      createdAt: index + 1,
      updatedAt: index + 1,
      steps: []
    })
  )

  const { batches } = buildSyncPayloadBatches(data, 'mobile_cap_device', 50_000_000)
  assert.ok(batches.length > 1)
  assert.ok(batches.every((batch) =>
    (batch.mutationIds?.length || 0) <= SYNC_SERVER_ARRAY_LIMITS.mutationIds &&
    (batch.operations?.missions?.length || 0) <= SYNC_SERVER_ARRAY_LIMITS.missions
  ))
  assert.equal(batches.flatMap((batch) => batch.mutationIds || []).length, data.sync.outbox.length)
  assert.equal(
    batches.flatMap((batch) => batch.operations?.missions || []).length,
    data.operations.missions.length
  )
})

test('multi-request sync accumulates early acknowledgements and tailored tombstones', async () => {
  const data = emptyData()
  data.sync.outbox = [{
    id: 'mut_large_sync', entityType: 'memory', entityId: 'stale_memory', action: 'upsert', createdAt: 1
  }]
  data.memories = [{
    id: 'stale_memory', content: 'must not resurrect', category: 'test', createdAt: 1, updatedAt: 2
  }]
  data.messages = Array.from({ length: 30 }, (_, index) => ({
    id: `large_chat_${index}`,
    role: 'user',
    content: `${index}:${'x'.repeat(75_000)}`,
    createdAt: index + 1
  }))

  const originalFetch = globalThis.fetch
  let requests = 0
  globalThis.fetch = async (_url, init) => {
    requests += 1
    const payload = JSON.parse(String(init?.body || '{}'))
    return new Response(JSON.stringify({
      ok: true,
      protocolVersion: 2,
      serverTime: 100 + requests,
      acknowledgedMutationIds: payload.mutationIds || [],
      messages: [],
      memories: [],
      operations: emptyOps(),
      activity: [],
      tombstones: requests === 1
        ? [{ entityType: 'memory', entityId: 'stale_memory', deletedAt: 99 }]
        : []
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  try {
    const merged = await syncAllWithMac({
      config: {
        macBaseUrl: 'http://127.0.0.1:47831',
        macCredential: `v2.mobile_test_device.${'a'.repeat(64)}`,
        deviceId: 'mobile_test_device'
      },
      data
    })
    assert.ok(requests > 1)
    assert.equal(merged.sync.outbox.length, 0)
    assert.equal(merged.memories.some((memory) => memory.id === 'stale_memory'), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('acked sent mutations clear while newer in-flight mutations survive', () => {
  const sent = { id: 'mut_sent', entityType: 'chat', entityId: 'c1', action: 'upsert', createdAt: 1 }
  const newer = { id: 'mut_new', entityType: 'memory', entityId: 'm2', action: 'upsert', createdAt: 2 }
  const local = emptyData()
  local.sync.outbox = [sent, newer]
  const merged = mergeSyncedData(local, {
    protocolVersion: 2,
    acknowledgedMutationIds: ['mut_sent'],
    operations: emptyOps()
  }, [sent])
  assert.deepEqual(merged.sync.outbox.map((row) => row.id), ['mut_new'])
})

test('latest local update survives a stale response', () => {
  const local = emptyData()
  local.memories = [{ id: 'm1', content: 'fresh', category: 'project', createdAt: 1, updatedAt: 30 }]
  const merged = mergeSyncedData(local, {
    protocolVersion: 2,
    acknowledgedMutationIds: [],
    memories: [{ id: 'm1', content: 'old', category: 'project', createdAt: 1, updatedAt: 20 }],
    operations: emptyOps()
  }, [])
  assert.equal(merged.memories[0].content, 'fresh')
})

test('mission and nested step tombstones are both applied', () => {
  const local = emptyData()
  local.operations.missions = [{
    id: 'mission1', title: 'M', outcome: 'O', state: 'active', priority: 'normal', progress: 0,
    risk: 'prepare', source: 'user', createdAt: 1, updatedAt: 2,
    steps: [{ id: 'step1', missionId: 'mission1', position: 0, title: 'S', state: 'pending', createdAt: 1, updatedAt: 2 }]
  }]
  local.sync.tombstones = [{ entityType: 'step', entityId: 'step1', deletedAt: 3 }]
  const merged = mergeSyncedData(local, {
    protocolVersion: 2,
    acknowledgedMutationIds: [],
    operations: emptyOps()
  }, [])
  assert.equal(merged.operations.missions.length, 1)
  assert.equal(merged.operations.missions[0].steps.length, 0)
})

test('protocol mismatch is rejected before state adoption', () => {
  assert.throws(() => mergeSyncedData(emptyData(), { protocolVersion: 1 }, []), /version 2 is required/)
})

test('backoff is exponential and capped', () => {
  assert.equal(syncBackoffMs(0), 20_000)
  assert.equal(syncBackoffMs(1), 2_500)
  assert.equal(syncBackoffMs(4), 20_000)
  assert.equal(syncBackoffMs(99), 300_000)
})

test('sync coordinator coalesces overlapping calls', async () => {
  const coordinator = new SyncCoordinator()
  let calls = 0
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const task = async () => {
    calls += 1
    await gate
    return emptyData()
  }
  const first = coordinator.run(task)
  const second = coordinator.run(task)
  assert.equal(calls, 1)
  assert.equal(coordinator.inFlight, true)
  release()
  assert.equal(await first, await second)
  assert.equal(coordinator.inFlight, false)
})

test('oversized chat photos are stubbed so sync can proceed under the byte ceiling', () => {
  const hugeBase64 = 'A'.repeat(2_500_000)
  const data = emptyData()
  data.messages = [
    {
      id: 'phone_mt4gk0a6-1mx4oiih3',
      role: 'user',
      content: 'photo from the lab',
      createdAt: 1,
      images: [{
        id: 'img_huge',
        mediaType: 'image/jpeg',
        fileName: 'lab.jpg',
        dataUrl: `data:image/jpeg;base64,${hugeBase64}`
      }]
    },
    {
      id: 'phone_small_followup',
      role: 'assistant',
      content: 'Got it, sir.',
      createdAt: 2
    }
  ]
  data.sync.outbox = [
    { id: 'mut_1', entityType: 'chat', entityId: 'phone_mt4gk0a6-1mx4oiih3', action: 'upsert', createdAt: 1 },
    { id: 'mut_2', entityType: 'chat', entityId: 'phone_small_followup', action: 'upsert', createdAt: 2 }
  ]

  const slimmed = slimMessageForSync(data.messages[0])
  assert.equal(slimmed.images?.[0]?.dataUrl, undefined)
  assert.equal(slimmed.images?.[0]?.fileName, 'lab.jpg')

  const { batches, skipped } = buildSyncPayloadBatches(data, 'mobile_photo_device')
  assert.equal(skipped.length, 0)
  assert.ok(batches.length >= 1)
  for (const batch of batches) {
    assert.ok(syncPayloadBytes(batch) <= 1_900_000)
    for (const message of batch.messages || []) {
      for (const image of message.images || []) {
        assert.equal(image.dataUrl, undefined)
      }
    }
  }
  assert.deepEqual(
    batches.flatMap((batch) => batch.messages || []).map((row) => row.id),
    data.messages.map((row) => row.id)
  )
})

test('pathological solo rows are skipped instead of wedging the queue', () => {
  const data = emptyData()
  // Force a row that remains over budget even after message slimming by using a tiny ceiling.
  data.messages = [{
    id: 'phone_still_too_big',
    role: 'user',
    content: 'x'.repeat(5_000),
    createdAt: 1
  }]
  data.memories = [{
    id: 'memory_ok',
    content: 'small',
    category: 'general',
    createdAt: 1,
    updatedAt: 1
  }]
  const { batches, skipped } = buildSyncPayloadBatches(data, 'mobile_skip_device', 2_048)
  assert.ok(skipped.some((row) => row.includes('phone_still_too_big')))
  assert.deepEqual(
    batches.flatMap((batch) => batch.memories || []).map((row) => row.id),
    ['memory_ok']
  )
})
