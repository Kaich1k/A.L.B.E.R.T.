import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { codexDynamicTools, dynamicToolsFingerprint, dispatchCodexDynamicTool, notificationMatchesTurn, CodexTurnNotificationGate } from '../src/main/codex/dynamicTools.ts'
import { resolveToolEnabledThread, previousConversationContext, readToolThreadBinding } from '../src/main/codex/toolThreads.ts'

const definition = { name: 'read_window', description: 'Read the selected window.', parameters: { type: 'object', properties: { app: { type: 'string' } }, required: ['app'] } }
const request = { threadId: 'thread-1', turnId: 'turn-1', callId: 'call-1', namespace: 'albert', tool: 'read_window', arguments: { app: 'Notes' } }
function context(execute = async () => ({ ok: true, result: 'Window title' })) {
  return { threadId: 'thread-1', turnId: 'turn-1', calls: new Map(), isCurrent: () => true, loadExecutor: async () => ({ hasTool: (name) => name === 'read_window', execute }) }
}

test('registry definitions use the installed namespace/function schema without losing required inputs', () => {
  const spec = codexDynamicTools([definition])[0]
  assert.equal(spec.type, 'namespace')
  assert.equal(spec.name, 'albert')
  assert.deepEqual(spec.tools, [{ type: 'function', name: definition.name, description: definition.description, inputSchema: definition.parameters }])
  const other = { ...definition, name: 'other' }
  assert.equal(dynamicToolsFingerprint([definition, other]), dynamicToolsFingerprint([other, definition]))
})

test('text and actual image bytes return the app-server contentItems protocol', async () => {
  const result = await dispatchCodexDynamicTool(request, context(async () => ({ ok: true, result: 'Current window', image: { mediaType: 'image/png', data: 'aGVsbG8=' } })))
  assert.deepEqual(result, { success: true, contentItems: [{ type: 'inputText', text: 'Current window' }, { type: 'inputImage', imageUrl: 'data:image/png;base64,aGVsbG8=' }] })
})

test('foreign, stopped, unset-turn, and completed-turn calls never load the registry', async () => {
  let loads = 0
  const c = { ...context(), loadExecutor: async () => { loads++; throw new Error('Unexpected load') } }
  for (const r of [{ ...request, threadId: 'old' }, { ...request, turnId: 'old' }]) assert.equal((await dispatchCodexDynamicTool(r, c)).success, false)
  assert.equal((await dispatchCodexDynamicTool(request, { ...c, turnId: null })).success, false)
  assert.equal((await dispatchCodexDynamicTool(request, { ...c, isCurrent: () => false })).success, false)
  assert.equal((await dispatchCodexDynamicTool(request, null)).success, false)
  assert.equal(loads, 0)
})

test('stop during asynchronous registry load prevents the action', async () => {
  let current = true
  let actions = 0
  const c = { ...context(), isCurrent: () => current, loadExecutor: async () => { current = false; return { hasTool: () => true, execute: async () => { actions++; return { ok: true, result: '' } } } } }
  assert.equal((await dispatchCodexDynamicTool(request, c)).success, false)
  assert.equal(actions, 0)
})

test('stop during execution suppresses stale results and images', async () => {
  let current = true
  const c = { ...context(async () => { current = false; return { ok: true, result: 'stale', image: { mediaType: 'image/png', data: 'stale' } } }), isCurrent: () => current }
  const result = await dispatchCodexDynamicTool(request, c)
  assert.equal(result.success, false)
  assert.equal(result.contentItems.length, 1)
  assert.match(result.contentItems[0].text, /Interrupted/)
})

test('duplicate requests share one in-flight action; reused ids with different arguments fail', async () => {
  let actions = 0
  const c = context(async () => { actions++; await new Promise((resolve) => setTimeout(resolve, 5)); return { ok: true, result: 'once' } })
  const [a, b] = await Promise.all([dispatchCodexDynamicTool(request, c), dispatchCodexDynamicTool(request, c)])
  assert.deepEqual(a, b)
  assert.equal(actions, 1)
  assert.equal((await dispatchCodexDynamicTool({ ...request, arguments: { app: 'Mail' } }, c)).success, false)
  assert.equal(actions, 1)
})

test('unknown names, malformed arguments, and foreign namespaces never execute', async () => {
  let actions = 0
  const c = context(async () => { actions++; return { ok: true, result: 'unexpected' } })
  for (const changes of [{ tool: 'unknown' }, { arguments: [] }, { arguments: 'not an object' }, { arguments: null }, { namespace: 'other' }, { callId: '' }]) {
    assert.equal((await dispatchCodexDynamicTool({ ...request, ...changes }, c)).success, false)
  }
  assert.equal(actions, 0)
})

test('denials and thrown failures return an unsuccessful tool response without protocol exceptions', async () => {
  const denied = await dispatchCodexDynamicTool(request, context(async () => ({ ok: false, result: 'User denied this action.' })))
  assert.equal(denied.success, false)
  assert.match(denied.contentItems[0].text, /denied/)
  const failed = await dispatchCodexDynamicTool(request, context(async () => { throw new Error('Window closed') }))
  assert.deepEqual(failed, { success: false, contentItems: [{ type: 'inputText', text: 'Window closed' }] })
})

test('old-turn notifications cannot finish the current turn', () => {
  const c = { threadId: 'thread-1', turnId: 'turn-2' }
  assert.equal(notificationMatchesTurn({ threadId: 'old', turn: { id: 'turn-2' } }, c), false)
  assert.equal(notificationMatchesTurn({ threadId: 'thread-1', turn: { id: 'turn-1' } }, c), false)
  assert.equal(notificationMatchesTurn({ threadId: 'thread-1', turnId: 'turn-2' }, c), true)
  assert.equal(notificationMatchesTurn({}, c), true)
})

const history = { thread: { id: 'old-thread', turns: [{ items: [
  { type: 'userMessage', content: [{ type: 'text', text: 'Remember the blue workshop.' }, { type: 'image', url: 'secret image bytes' }] },
  { type: 'agentMessage', text: 'I kept the blue workshop.', phase: 'final_answer' },
  { type: 'commandExecution', aggregatedOutput: 'private process data' }
] }] } }
function options(directory, overrides = {}) {
  return { existingThreadId: 'old-thread', liveThreadId: null, fingerprint: 'abc', directory, threadParams: { developerInstructions: 'Albert companion.', cwd: '/work', approvalPolicy: 'on-request', sandbox: 'workspace-write' }, dynamicTools: codexDynamicTools([definition]), assertCurrent: () => {}, onMigration: () => {}, ...overrides }
}
function temp(t) { const d = mkdtempSync(join(tmpdir(), 'albert-tool-bridge-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d }

test('migration preserves complete history and previous id before a tool-enabled successor is bound', async (t) => {
  const directory = temp(t)
  const calls = []
  let notice
  const transport = { request: async (method, params) => { calls.push({ method, params }); return method === 'thread/read' ? history : { thread: { id: 'new-thread' } } } }
  const id = await resolveToolEnabledThread(transport, options(directory, { onMigration: (...args) => { notice = args } }))
  assert.equal(id, 'new-thread')
  assert.deepEqual(calls.map((c) => c.method), ['thread/read', 'thread/start'])
  assert.deepEqual(calls[1].params.dynamicTools, codexDynamicTools([definition]))
  assert.match(calls[1].params.developerInstructions, /Remember the blue workshop/)
  assert.doesNotMatch(calls[1].params.developerInstructions, /secret image bytes|private process data/)
  const binding = readToolThreadBinding(directory)
  assert.equal(binding.previousThreadId, 'old-thread')
  assert.deepEqual(JSON.parse(readFileSync(binding.historyPath, 'utf8')), history)
  assert.deepEqual(notice, ['old-thread', 'new-thread'])
})

test('restart resumes a bound thread without unsupported dynamicTools and retains old context', async (t) => {
  const directory = temp(t)
  const transport = { request: async (method) => method === 'thread/read' ? history : { thread: { id: 'new-thread' } } }
  await resolveToolEnabledThread(transport, options(directory))
  const calls = []
  const id = await resolveToolEnabledThread({ request: async (method, params) => { calls.push({ method, params }); return {} } }, options(directory, { existingThreadId: 'new-thread' }))
  assert.equal(id, 'new-thread')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'thread/resume')
  assert.equal(calls[0].params.dynamicTools, undefined)
  assert.match(calls[0].params.developerInstructions, /Remember the blue workshop/)
})

test('fresh conversations bind tools immediately without reading nonexistent history', async (t) => {
  const calls = []
  await resolveToolEnabledThread({ request: async (method, params) => { calls.push({ method, params }); return { thread: { id: 'first' } } } }, options(temp(t), { existingThreadId: '' }))
  assert.deepEqual(calls.map((c) => c.method), ['thread/start'])
  assert.equal(calls[0].params.dynamicTools[0].name, 'albert')
})

test('failed history/read and failed start never replace the previous binding', async (t) => {
  for (const failAt of ['thread/read', 'thread/start']) {
    const directory = temp(t)
    await assert.rejects(resolveToolEnabledThread({ request: async (method) => { if (method === failAt) throw new Error('offline'); return history } }, options(directory)), /offline/)
    assert.equal(readToolThreadBinding(directory), null)
  }
})

test('interruption while history is being read never starts a successor', async (t) => {
  let cancelled = false
  let starts = 0
  await assert.rejects(resolveToolEnabledThread({ request: async (method) => { if (method === 'thread/start') starts++; cancelled = true; return history } }, options(temp(t), { assertCurrent: () => { if (cancelled) throw new Error('Interrupted') } })), /Interrupted/)
  assert.equal(starts, 0)
})

test('handoff is bounded and missing history fails instead of silently dropping context', () => {
  assert.throws(() => previousConversationContext({ thread: {} }), /previous thread was kept unchanged/)
  const big = { thread: { turns: [{ items: [{ type: 'agentMessage', text: 'x'.repeat(100_000) }] }] } }
  assert.ok(previousConversationContext(big, 1000).length < 1100)
})


test('start response correlates buffered events and rejects a late predecessor completion', async () => {
  const gate = new CodexTurnNotificationGate('thread-1')
  let ready = false
  gate.ready.then(() => { ready = true })
  assert.deepEqual(gate.receive('turn/completed', { threadId: 'thread-1', turn: { id: 'old' } }), [])
  assert.deepEqual(gate.receive('turn/started', { threadId: 'thread-1', turn: { id: 'new' } }), [])
  assert.deepEqual(gate.receive('item/agentMessage/delta', { threadId: 'thread-1', turnId: 'new', delta: 'Hello' }), [])
  await Promise.resolve()
  assert.equal(ready, false)
  const pending = gate.bind('new')
  await gate.ready
  assert.equal(ready, true)
  assert.deepEqual(pending.map(p => p.method), ['turn/started', 'item/agentMessage/delta'])
  assert.deepEqual(gate.receive('turn/completed', { threadId: 'thread-1', turn: { id: 'old' } }), [])
  assert.equal(gate.receive('turn/completed', { threadId: 'thread-1', turn: { id: 'new' } }).length, 1)
  assert.equal(notificationMatchesTurn({ threadId: 'thread-1', turnId: 'old' }, { threadId: 'thread-1', turnId: null }), false)
})

test('stopping before turn/start replies releases waiting callbacks but never replays buffered work', async () => {
  const gate = new CodexTurnNotificationGate('thread-1')
  gate.receive('turn/completed', { threadId: 'thread-1', turn: { id: 'new' } })
  gate.close()
  await gate.ready
  assert.deepEqual(gate.bind('new'), [])
  assert.deepEqual(gate.receive('item/agentMessage/delta', { threadId: 'thread-1', turnId: 'new' }), [])
})
