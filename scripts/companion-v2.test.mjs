import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, before } from 'node:test'

const testRoot = mkdtempSync(join(tmpdir(), 'albert-companion-v2-'))
process.env.ALBERT_TEST_USER_DATA = testRoot

let config
let dbModule
let protocol
let serverModule

before(async () => {
  const LegacyDatabase = (await import('better-sqlite3')).default
  const legacyDir = join(testRoot, 'albert-data')
  mkdirSync(legacyDir, { recursive: true })
  const legacy = new LegacyDatabase(join(legacyDir, 'albert.sqlite'))
  legacy.exec(`
    CREATE TABLE messages (
      id TEXT PRIMARY KEY, role TEXT NOT NULL, content TEXT NOT NULL,
      tool_name TEXT, tool_call_id TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE memories (
      id TEXT PRIMARY KEY, content TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'general',
      embedding TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE activity (
      id TEXT PRIMARY KEY, tool_name TEXT NOT NULL, args TEXT NOT NULL,
      result TEXT NOT NULL, ok INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE approvals (
      id TEXT PRIMARY KEY, mission_id TEXT, title TEXT NOT NULL, description TEXT NOT NULL,
      action_label TEXT NOT NULL, risk TEXT NOT NULL, preview TEXT,
      state TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, resolved_at INTEGER
    );
    CREATE TABLE captures (
      id TEXT PRIMARY KEY, content TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'note',
      state TEXT NOT NULL DEFAULT 'inbox', created_at INTEGER NOT NULL
    );
    INSERT INTO approvals(id,title,description,action_label,risk,state,created_at,resolved_at)
      VALUES ('legacy-approval','Legacy','Legacy row','Approve','Review','approved',1000,2000);
    INSERT INTO captures(id,content,kind,state,created_at)
      VALUES ('legacy-capture','Legacy capture','note','inbox',3000);
  `)
  legacy.close()

  config = await import('../src/main/config.ts')
  dbModule = await import('../src/main/memory/db.ts')
  protocol = await import('../src/main/companion/protocol.ts')
  serverModule = await import('../src/main/companion/server.ts')
})

after(async () => {
  await serverModule?.stopCompanionServer()
  dbModule?.closeDb()
  rmSync(testRoot, { recursive: true, force: true })
})

function unique(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function baseOperations(now, suffix = '') {
  const missionId = `mission_${suffix || 'one'}`
  return {
    missions: [{
      id: missionId,
      title: 'Ship companion sync',
      outcome: 'Phone and Mac converge',
      state: 'active',
      priority: 'high',
      progress: 25,
      deadline: now + 30 * 24 * 60 * 60_000,
      budgetCents: 1_250,
      risk: 'prepare',
      source: 'user',
      createdAt: now - 1_000,
      updatedAt: now,
      steps: [{
        id: `step_${suffix || 'one'}`,
        missionId,
        position: 0,
        title: 'Validate protocol',
        state: 'active',
        createdAt: now - 1_000,
        updatedAt: now
      }]
    }],
    routines: [{
      id: `routine_${suffix || 'one'}`,
      name: 'Daily brief',
      prompt: 'Summarize today',
      schedule: 'at 09:00',
      enabled: true,
      nextRunAt: now + 24 * 60 * 60_000,
      createdAt: now - 1_000,
      updatedAt: now
    }],
    approvals: [{
      id: `approval_${suffix || 'one'}`,
      missionId,
      title: 'Approve launch',
      description: 'Review launch action',
      actionLabel: 'Approve',
      risk: 'External action',
      state: 'pending',
      createdAt: now - 1_000,
      updatedAt: now
    }],
    captures: [{
      id: `capture_${suffix || 'one'}`,
      content: 'Remember the launch window',
      kind: 'note',
      state: 'inbox',
      createdAt: now - 1_000,
      updatedAt: now
    }],
    generatedAt: now
  }
}

async function reservePort() {
  return await new Promise((resolve, reject) => {
    const candidate = createHttpServer()
    candidate.once('error', reject)
    candidate.listen(0, '127.0.0.1', () => {
      const address = candidate.address()
      const port = typeof address === 'object' && address ? address.port : 0
      candidate.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

test('migration creates v2 tables, timestamp columns, and durable delete triggers', () => {
  const db = dbModule.getDb()
  const tables = new Set(db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((row) => row.name))
  for (const table of ['companion_devices', 'companion_mutations', 'sync_tombstones']) {
    assert.ok(tables.has(table), `missing ${table}`)
  }

  for (const table of ['approvals', 'captures']) {
    const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name))
    assert.ok(columns.has('updated_at'), `${table}.updated_at missing`)
  }
  assert.equal(db.prepare(`SELECT updated_at as updatedAt FROM approvals WHERE id='legacy-approval'`).get().updatedAt, 2_000)
  assert.equal(db.prepare(`SELECT updated_at as updatedAt FROM captures WHERE id='legacy-capture'`).get().updatedAt, 3_000)

  const triggers = new Set(db.prepare(`SELECT name FROM sqlite_master WHERE type='trigger'`).all().map((row) => row.name))
  for (const table of ['messages', 'memories', 'missions', 'mission_steps', 'routines', 'approvals', 'captures']) {
    assert.ok(triggers.has(`sync_${table}_delete`), `missing ${table} delete trigger`)
  }

  const id = unique('trigger-memory')
  const now = Date.now()
  db.prepare(`INSERT INTO memories(id,content,category,embedding,created_at,updated_at) VALUES (?,?,'test',NULL,?,?)`)
    .run(id, 'delete me', now, now)
  db.prepare(`DELETE FROM memories WHERE id=?`).run(id)
  const tombstone = db.prepare(
    `SELECT entity_type as entityType,entity_id as entityId,deleted_at as deletedAt FROM sync_tombstones WHERE entity_id=?`
  ).get(id)
  assert.equal(tombstone.entityType, 'memory')
  assert.equal(tombstone.entityId, id)
  assert.ok(Math.abs(tombstone.deletedAt - Date.now()) < 5_000)

  assert.equal(config.setSettings({ companionPort: 70_000 }).companionPort, 47_831)
  config.setSettings({ companionToken: '  padded-pairing-token  ' })
  assert.equal(serverModule.ensureCompanionToken(), 'padded-pairing-token')
  assert.equal(config.getSettings().companionToken, 'padded-pairing-token')
})

test('enrollment hashes secrets, credential auth is constant-shape, rotation and revocation work', () => {
  const deviceId = unique('device').replaceAll('.', '_').slice(0, 80)
  const first = protocol.enrollCompanionDevice({ id: deviceId, name: 'Test Phone' })
  assert.match(first.credential, new RegExp(`^v2\\.${deviceId}\\.[a-f0-9]{64}$`))

  const row = dbModule.getDb().prepare(`SELECT secret_hash as secretHash FROM companion_devices WHERE id=?`).get(deviceId)
  assert.equal(row.secretHash.length, 64)
  assert.ok(!first.credential.includes(row.secretHash), 'stored hash must not be the bearer secret')
  assert.equal(protocol.authenticateCompanionDevice(`Bearer ${first.credential}`)?.id, deviceId)
  assert.equal(protocol.authenticateCompanionDevice(`Bearer ${first.credential.slice(0, -1)}0`), null)

  const second = protocol.enrollCompanionDevice({ id: deviceId, name: 'Renamed Phone' })
  assert.notEqual(second.credential, first.credential)
  assert.equal(protocol.authenticateCompanionDevice(`Bearer ${first.credential}`), null)
  assert.equal(protocol.authenticateCompanionDevice(`Bearer ${second.credential}`)?.name, 'Renamed Phone')
  assert.equal(protocol.revokeCompanionDevice(deviceId), true)
  assert.equal(protocol.authenticateCompanionDevice(`Bearer ${second.credential}`), null)
  assert.equal(protocol.revokeCompanionDevice(deviceId), false)
})

test('full-state reconciliation is idempotent and preserves real future schedule dates', () => {
  const now = Date.now()
  const deviceId = unique('syncdevice').replaceAll('.', '_').slice(0, 80)
  protocol.enrollCompanionDevice({ id: deviceId, name: 'Sync Phone' })
  const operations = baseOperations(now, unique('full').replaceAll('.', '_'))
  const messageId = unique('chat')
  const memoryId = unique('memory')
  const mutationId = unique('mutation')
  const payload = {
    protocolVersion: 2,
    deviceId,
    mutationIds: [mutationId, mutationId, 'not valid with spaces'],
    messages: [{ id: messageId, role: 'user', content: 'Hello from mobile', createdAt: now }],
    memories: [{
      id: memoryId,
      content: 'Prefers concise briefs',
      category: 'preference',
      source: 'phone',
      confidence: 0.82,
      lastUsedAt: now - 500,
      expiresAt: now + 7 * 24 * 60 * 60_000,
      createdAt: now,
      updatedAt: now
    }],
    operations,
    tombstones: []
  }

  const first = protocol.reconcileCompanionState(payload, deviceId)
  assert.equal(first.chatChanged, true)
  assert.equal(first.memoryChanged, true)
  assert.equal(first.operationsChanged, true)
  assert.deepEqual(first.acknowledgedMutationIds, [mutationId])
  assert.equal(first.insertedMessages.length, 1)
  const syncedMemory = first.memories.find((row) => row.id === memoryId)
  assert.equal(syncedMemory?.source, 'phone')
  assert.equal(syncedMemory?.confidence, 0.82)
  assert.equal(syncedMemory?.lastUsedAt, now - 500)
  assert.equal(syncedMemory?.expiresAt, now + 7 * 24 * 60 * 60_000)
  assert.equal(first.operations.missions.find((row) => row.id === operations.missions[0].id)?.deadline, operations.missions[0].deadline)
  assert.equal(first.operations.routines.find((row) => row.id === operations.routines[0].id)?.nextRunAt, operations.routines[0].nextRunAt)

  const second = protocol.reconcileCompanionState(payload, deviceId)
  assert.equal(second.chatChanged, false)
  assert.equal(second.memoryChanged, false)
  assert.equal(second.operationsChanged, false)
  assert.equal(second.insertedMessages.length, 0)
  assert.equal(dbModule.getDb().prepare(`SELECT COUNT(*) as n FROM companion_mutations WHERE id=?`).get(mutationId).n, 1)
})

test('newer state wins, malformed numerics are contained, and stale approvals cannot regress missions', () => {
  const db = dbModule.getDb()
  const now = Date.now()
  const deviceId = unique('lwwdevice').replaceAll('.', '_').slice(0, 80)
  protocol.enrollCompanionDevice({ id: deviceId, name: 'LWW Phone' })
  const suffix = unique('lww').replaceAll('.', '_')
  const operations = baseOperations(now, suffix)
  operations.missions[0].state = 'complete'
  operations.missions[0].progress = 100
  operations.missions[0].budgetCents = Number.NaN
  operations.approvals[0].state = 'approved'
  operations.approvals[0].updatedAt = now - 10_000
  operations.approvals[0].resolvedAt = now - 10_000

  protocol.reconcileCompanionState({ protocolVersion: 2, deviceId, operations }, deviceId)
  const mission = db.prepare(`SELECT state,progress,budget_cents as budgetCents FROM missions WHERE id=?`)
    .get(operations.missions[0].id)
  assert.equal(mission.state, 'complete')
  assert.equal(mission.progress, 100)
  assert.equal(mission.budgetCents, null)

  const memoryId = unique('lww-memory')
  protocol.reconcileCompanionState({
    protocolVersion: 2,
    deviceId,
    memories: [{ id: memoryId, content: 'new', category: 'test', confidence: Number.NaN, createdAt: now, updatedAt: now }]
  }, deviceId)
  const memory = db.prepare(`SELECT content,confidence FROM memories WHERE id=?`).get(memoryId)
  assert.deepEqual(memory, { content: 'new', confidence: 1 })
  const stale = protocol.reconcileCompanionState({
    protocolVersion: 2,
    deviceId,
    memories: [{ id: memoryId, content: 'stale', category: 'test', createdAt: now - 5_000, updatedAt: now - 5_000 }]
  }, deviceId)
  assert.equal(stale.memoryChanged, false)
  assert.equal(db.prepare(`SELECT content FROM memories WHERE id=?`).get(memoryId).content, 'new')

  const malformed = protocol.reconcileCompanionState({
    protocolVersion: 2,
    deviceId,
    memories: [{ id: memoryId, content: 'missing version', category: 'test', createdAt: now }],
    operations: {
      missions: [{ ...operations.missions[0], title: 'Missing update clock', updatedAt: undefined }]
    },
    tombstones: [{ entityType: 'memory', entityId: memoryId }]
  }, deviceId)
  assert.equal(malformed.memoryChanged, false)
  assert.equal(db.prepare(`SELECT content FROM memories WHERE id=?`).get(memoryId).content, 'new')
  assert.equal(db.prepare(`SELECT title FROM missions WHERE id=?`).get(operations.missions[0].id).title, 'Ship companion sync')
})

test('tombstones delete every entity class, notify change domains, and block resurrection', () => {
  const now = Date.now()
  const deviceId = unique('deletedevice').replaceAll('.', '_').slice(0, 80)
  protocol.enrollCompanionDevice({ id: deviceId, name: 'Delete Phone' })
  const suffix = unique('delete').replaceAll('.', '_')
  const operations = baseOperations(now, suffix)
  const message = { id: unique('delete-chat'), role: 'assistant', content: 'temporary', createdAt: now }
  const memory = { id: unique('delete-memory'), content: 'temporary memory', category: 'test', createdAt: now, updatedAt: now }
  protocol.reconcileCompanionState({ protocolVersion: 2, deviceId, messages: [message], memories: [memory], operations }, deviceId)

  const tombstones = [
    { entityType: 'chat', entityId: message.id, deletedAt: now + 1 },
    { entityType: 'memory', entityId: memory.id, deletedAt: now + 1 },
    { entityType: 'mission', entityId: operations.missions[0].id, deletedAt: now + 1 },
    { entityType: 'routine', entityId: operations.routines[0].id, deletedAt: now + 1 },
    { entityType: 'approval', entityId: operations.approvals[0].id, deletedAt: now + 1 },
    { entityType: 'capture', entityId: operations.captures[0].id, deletedAt: now + 1 }
  ]
  const removed = protocol.reconcileCompanionState({ protocolVersion: 2, deviceId, tombstones }, deviceId)
  assert.equal(removed.chatChanged, true)
  assert.equal(removed.memoryChanged, true)
  assert.equal(removed.operationsChanged, true)

  const replay = protocol.reconcileCompanionState({
    protocolVersion: 2,
    deviceId,
    messages: [message],
    memories: [memory],
    operations
  }, deviceId)
  assert.equal(replay.messages.some((row) => row.id === message.id), false)
  assert.equal(replay.memories.some((row) => row.id === memory.id), false)
  assert.equal(replay.operations.missions.some((row) => row.id === operations.missions[0].id), false)
  assert.equal(replay.operations.routines.some((row) => row.id === operations.routines[0].id), false)
  assert.equal(replay.operations.approvals.some((row) => row.id === operations.approvals[0].id), false)
  assert.equal(replay.operations.captures.some((row) => row.id === operations.captures[0].id), false)
})

test('HTTP boundary enforces enrollment/auth, protocol identity, body limit, content type, CORS, revoke, and rate limit', async () => {
  const port = await reservePort()
  const enrollmentToken = unique('pairing-token')
  config.setSettings({ companionEnabled: true, companionPort: port, companionToken: enrollmentToken })
  await serverModule.startCompanionServer()
  const base = `http://127.0.0.1:${port}`

  let response = await fetch(`${base}/v2/health`)
  assert.equal(response.status, 401)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')

  response = await fetch(`${base}/v2/enroll`, {
    method: 'POST',
    headers: { authorization: 'Bearer wrong', 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId: 'httpdevice01', deviceName: 'HTTP Phone' })
  })
  assert.equal(response.status, 401)

  response = await fetch(`${base}/v2/enroll`, {
    method: 'POST',
    headers: { authorization: `Bearer ${enrollmentToken}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ deviceId: 'httpdevice01', deviceName: 'HTTP Phone' })
  })
  assert.equal(response.status, 201)
  const enrollment = await response.json()
  assert.equal(enrollment.protocolVersion, 2)
  assert.match(enrollment.credential, /^v2\.httpdevice01\.[a-f0-9]{64}$/)
  const credential = enrollment.credential

  response = await fetch(`${base}/v2/health`, { headers: { authorization: `Bearer ${credential}` } })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).device.id, 'httpdevice01')

  response = await fetch(`${base}/health?token=${encodeURIComponent(enrollmentToken)}`)
  assert.equal(response.status, 401, 'query-string credentials must be ignored')

  globalThis.__ALBERT_TEST_EVENTS__ = []
  const syncNow = Date.now()
  const httpOperations = baseOperations(syncNow, 'http')
  response = await fetch(`${base}/v2/sync`, {
    method: 'POST',
    headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      protocolVersion: 2,
      deviceId: 'httpdevice01',
      messages: [{ id: 'http-chat', role: 'user', content: 'HTTP sync', createdAt: syncNow }],
      memories: [{ id: 'http-memory', content: 'HTTP memory', category: 'test', createdAt: syncNow, updatedAt: syncNow }],
      operations: httpOperations
    })
  })
  assert.equal(response.status, 200)
  const eventTypes = globalThis.__ALBERT_TEST_EVENTS__.map((event) => event.payload?.type || event.channel)
  assert.ok(eventTypes.includes('chat_synced'))
  assert.ok(eventTypes.includes('albert:memory:changed'))
  assert.ok(eventTypes.includes('albert:operations:changed'))

  response = await fetch(`${base}/v2/sync`, {
    method: 'POST',
    headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/jsonp' },
    body: '{}'
  })
  assert.equal(response.status, 415)

  response = await fetch(`${base}/v2/sync`, {
    method: 'POST',
    headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
    body: '{'
  })
  assert.equal(response.status, 400)

  response = await fetch(`${base}/v2/sync`, {
    method: 'POST',
    headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
    body: JSON.stringify({ protocolVersion: 1, deviceId: 'httpdevice01' })
  })
  assert.equal(response.status, 409)

  response = await fetch(`${base}/v2/sync`, {
    method: 'POST',
    headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
    body: JSON.stringify({ protocolVersion: 2, deviceId: 'otherdevice01' })
  })
  assert.equal(response.status, 403)

  response = await fetch(`${base}/v2/sync`, {
    method: 'POST',
    headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
    body: JSON.stringify({ protocolVersion: 2, deviceId: 'httpdevice01', padding: 'x'.repeat(2 * 1024 * 1024) })
  })
  assert.equal(response.status, 413)

  response = await fetch(`${base}/v2/health`, {
    method: 'OPTIONS',
    headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' }
  })
  assert.equal(response.status, 403)
  assert.equal(response.headers.get('access-control-allow-origin'), null)

  response = await fetch(`${base}/v2/health`, {
    method: 'OPTIONS',
    headers: { origin: 'http://localhost:19006', 'access-control-request-method': 'GET' }
  })
  assert.equal(response.status, 204)
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:19006')

  response = await fetch(`${base}/v2/devices/self`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${credential}` }
  })
  assert.equal(response.status, 200)
  response = await fetch(`${base}/v2/health`, { headers: { authorization: `Bearer ${credential}` } })
  assert.equal(response.status, 401)

  let limited
  for (let index = 0; index < 121; index += 1) {
    const attempt = await fetch(`${base}/v2/health`)
    if (attempt.status === 429) {
      limited = attempt
      break
    }
  }
  assert.ok(limited, 'expected per-address rate limiter to reject excess traffic')
  assert.equal(limited.headers.get('retry-after'), '60')
})

test('an old tombstone outside the 10,000-row response window still blocks server resurrection', () => {
  const db = dbModule.getDb()
  const oldId = unique('old-deleted-chat')
  const insert = db.prepare(
    `INSERT INTO sync_tombstones(entity_type,entity_id,deleted_at) VALUES ('chat',?,?)
     ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=excluded.deleted_at`
  )
  db.transaction(() => {
    insert.run(oldId, 1)
    for (let index = 0; index < 10_001; index += 1) {
      insert.run(`scale-delete-${index}`, 10_000 + index)
    }
  })()
  assert.equal(protocol.listSyncTombstones().some((row) => row.entityId === oldId), false)

  const deviceId = unique('scaledevice').replaceAll('.', '_').slice(0, 80)
  protocol.enrollCompanionDevice({ id: deviceId, name: 'Scale Phone' })
  const result = protocol.reconcileCompanionState({
    protocolVersion: 2,
    deviceId,
    messages: [{ id: oldId, role: 'user', content: 'must stay deleted', createdAt: Date.now() }]
  }, deviceId)
  assert.equal(result.messages.some((row) => row.id === oldId), false)
  assert.equal(result.tombstones.some((row) => row.entityType === 'chat' && row.entityId === oldId), true)
})
