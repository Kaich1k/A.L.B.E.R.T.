import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { NativeDesktopClient } from '../src/main/computer/nativeTransport.ts'
import { imagePointToDesktop, sameDesktopBounds } from '../src/shared/desktopGeometry.ts'
import { automationSignal, cancelComputerWork } from '../src/main/computer/automation.ts'

function harness() {
  const children = []
  const launch = () => {
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.exitCode = null
    child.signalCode = null
    child.requests = []
    child.stdin = new Writable({ write(chunk, _, done) { child.requests.push(JSON.parse(chunk.toString())); done() } })
    child.kill = (signal) => { child.signalCode = signal; child.emit('exit', null, signal); return true }
    child.reply = (id, result = {}) => child.stdout.write(JSON.stringify({ id, ok: true, result }) + '\n')
    children.push(child)
    return child
  }
  return { children, client: new NativeDesktopClient(() => '/test/helper', launch) }
}
const tick = () => new Promise(resolve => setImmediate(resolve))

test('native desktop requests serialize and preserve exact response ownership', async () => {
  const { client, children } = harness()
  const first = client.request({ op: 'inspect_window', windowId: 'w1' })
  const second = client.request({ op: 'perform_action', snapshotId: 's1' })
  await tick()
  assert.equal(children[0].requests.length, 1)
  children[0].reply(children[0].requests[0].id, { snapshotId: 's1' })
  assert.deepEqual(await first, { snapshotId: 's1' })
  await tick()
  assert.equal(children[0].requests.length, 2)
  children[0].reply(children[0].requests[1].id, { performed: 'AXPress' })
  assert.deepEqual(await second, { performed: 'AXPress' })
  client.dispose()
})

test('stop kills pending helper work and prevents queued actions from starting', async () => {
  const { client, children } = harness()
  const controller = new AbortController()
  const first = client.request({ op: 'pointer', kind: 'drag' }, controller.signal)
  const next = client.request({ op: 'type_text', text: 'must not type' }, controller.signal)
  const firstRejected = assert.rejects(first, /interrupted/)
  const nextRejected = assert.rejects(next, /interrupted/)
  await tick()
  controller.abort()
  await Promise.all([firstRejected, nextRejected])
  assert.equal(children[0].signalCode, 'SIGTERM')
  assert.equal(children[0].requests.length, 1)
  assert.equal(children.length, 1)
})

test('stale helper events cannot resolve or cancel a replacement request', async () => {
  const { client, children } = harness()
  const pending = client.request({ op: 'inspect_window' })
  const rejected = assert.rejects(pending, /stopped/)
  await tick()
  const old = children[0]
  client.dispose()
  await rejected
  const fresh = client.request({ op: 'list_windows' })
  await tick()
  old.emit('exit', 1)
  old.reply(old.requests[0].id, { stale: true })
  children[1].reply(children[1].requests[0].id, { windows: [] })
  assert.deepEqual(await fresh, { windows: [] })
  client.dispose()
})

test('malformed helper protocol fails closed and requires a fresh helper', async () => {
  const { client, children } = harness()
  const result = client.request({ op: 'inspect_window' })
  const rejected = assert.rejects(result, /invalid response/)
  await tick()
  children[0].stdout.write('not-json\n')
  await rejected
  assert.equal(children[0].signalCode, 'SIGTERM')
})

test('screenshot coordinates map scaled Retina pixels to negative-origin desktop points', () => {
  const bounds = { x: -1440, y: 120, width: 1200, height: 800 }
  assert.deepEqual(imagePointToDesktop(800, 600, { width: 1600, height: 1200 }, bounds), { x: -840, y: 520 })
  assert.throws(() => imagePointToDesktop(1600, 10, { width: 1600, height: 1200 }, bounds), /outside/)
  assert.throws(() => imagePointToDesktop(NaN, 0, { width: 1600, height: 1200 }, bounds), /outside/)
  assert.equal(sameDesktopBounds(bounds, { ...bounds }), true)
  assert.equal(sameDesktopBounds(bounds, { ...bounds, x: -1400 }), false)
})

test('computer stop aborts the old signal while the next operation gets a fresh one', () => {
  const previous = automationSignal()
  cancelComputerWork()
  assert.equal(previous.aborted, true)
  assert.equal(automationSignal().aborted, false)
})
