import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
const root = process.env.ALBERT_TEST_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = process.env.ALBERT_TEST_SOURCE_ROOT || root
const require = createRequire(join(root, 'package.json'))
const ts = require('typescript')
function load(relative, mocks) {
  const module = { exports: {} }
  let source
  try { source = readFileSync(join(sourceRoot, relative), 'utf8') }
  catch (error) { if (error.code !== 'ENOENT' || sourceRoot === root) throw error; source = readFileSync(join(root, relative), 'utf8') }
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  vm.runInNewContext(code, {
    module, exports: module.exports, process, AbortSignal,
    require: name => name in mocks ? mocks[name] : require(name)
  })
  return module.exports
}
function permissionHarness(helper, host = { accessibility: true, screenRecording: 'granted' }) {
  const calls = []
  const api = load('src/main/computer/nativeDesktop.ts', {
    electron: { app: { once() {}, getAppPath: () => '/Applications/ALBERT.app/Contents/Resources/app.asar', getName: () => 'ALBERT', isPackaged: true }, systemPreferences: {
      isTrustedAccessibilityClient: prompt => { calls.push({ trustPrompt: prompt }); return host.accessibility },
      getMediaAccessStatus: () => { if (host.screenRecording instanceof Error) throw host.screenRecording; return host.screenRecording }
    }, desktopCapturer: { getSources: async options => { calls.push({ capture: options }); if (host.captureError) throw host.captureError; return [] } } },
    './nativeTransport': { NativeDesktopClient: class { async request(payload) {
      calls.push({ native: payload })
      if (helper instanceof Error) throw helper
      return helper
    } } },
    './automation': { automationSignal: () => new AbortController().signal },
    '../agent/turnControl': { currentTurnScope: () => null },
    '../../shared/desktopGeometry': {}
  })
  return { api, calls }
}

test('host access alone never reports an unauthorized controller as ready', async () => {
  const p = await permissionHarness({ accessibility: false, screenRecording: false }).api.desktopPermissions()
  assert.equal(p.host.accessibility, true)
  assert.equal(p.accessibility, false)
  assert.equal(p.accessibilityStatus, 'denied')
  assert.equal(p.screenRecording, true)
  assert.match(p.setup, /desktop controller/)
})
test('screen status follows the actual Electron capture host, not helper preflight', async () => {
  const p = await permissionHarness({ accessibility: true, screenRecording: false }).api.desktopPermissions()
  assert.equal(p.screenRecording, true)
  assert.equal(p.controller.screenRecording, false)
  const denied = await permissionHarness({ accessibility: true, screenRecording: true }, { accessibility: true, screenRecording: 'denied' }).api.desktopPermissions()
  assert.equal(denied.screenRecording, false)
  assert.equal(denied.screenRecordingStatus, 'denied')
  assert.equal(p.accessibility, true)
})
test('helper failure is unknown with its actual error and does not falsify host screen status', async () => {
  const p = await permissionHarness(new Error('Desktop helper missing')).api.desktopPermissions()
  assert.equal(p.accessibility, false)
  assert.equal(p.accessibilityStatus, 'unknown')
  assert.equal(p.screenRecording, true)
  assert.match(p.controller.error, /missing/)
  assert.match(p.setup, /unavailable/)
})
test('reading permission state never requests access and reports the running host identity', async () => {
  const { api, calls } = permissionHarness({ accessibility: true, screenRecording: true })
  const p = await api.desktopPermissions()
  assert.equal(calls.some(c => c.trustPrompt === true || c.capture || c.native?.op === 'request_permission'), false)
  assert.equal(p.host.executablePath, process.execPath)
  assert.equal(p.host.processId, process.pid)
  assert.equal(p.host.appPath, '/Applications/ALBERT.app/Contents/Resources/app.asar')
  assert.equal(p.host.packaged, true)
})
test('explicit accessibility request registers both responsible host and controller then rechecks', async () => {
  const { api, calls } = permissionHarness({ accessibility: false, screenRecording: false })
  const p = await api.requestDesktopPermission('accessibility')
  assert.equal(calls[0].trustPrompt, true)
  assert.equal(calls[1].native.op, 'request_permission')
  assert.equal(calls[1].native.kind, 'accessibility')
  assert.equal(calls[2].native.op, 'permissions')
  assert.equal(calls.some(c => c.capture), false)
  assert.equal(p.accessibility, false, 'a request is not a grant')
})
test('explicit screen request discards capture results and preserves registration failure', async () => {
  const { api, calls } = permissionHarness({ accessibility: true, screenRecording: false }, { accessibility: true, screenRecording: 'not-determined', captureError: new Error('capture registration failed') })
  const p = await api.requestDesktopPermission('screen')
  assert.equal(calls[0].capture.thumbnailSize.width, 0)
  assert.equal(calls[0].capture.thumbnailSize.height, 0)
  assert.equal(calls[0].capture.types[0], 'screen')
  assert.equal(calls[1].native.kind, 'screen')
  assert.match(p.request.errors[0], /capture registration failed/)
  assert.match(p.requestError, /Host request: .*capture registration failed/)
  assert.equal(p.screenRecordingStatus, 'not-determined')
  assert.equal(p.screenRecording, false)
})
test('unsupported request kind is rejected before any permission prompt', async () => {
  const { api, calls } = permissionHarness({ accessibility: true, screenRecording: true })
  await assert.rejects(api.requestDesktopPermission('everything'), /Unsupported/)
  assert.equal(calls.length, 0)
})
test('screen preflight errors remain unknown instead of denied', async () => {
  const p = await permissionHarness({ accessibility: true, screenRecording: true }, { accessibility: true, screenRecording: new Error('API unavailable') }).api.desktopPermissions()
  assert.equal(p.screenRecordingStatus, 'unknown')
  assert.equal(p.screenRecording, false)
})
test('settings snapshot preserves unknown, restricted and not-determined statuses', async () => {
  for (const status of ['unknown', 'restricted', 'not-determined', 'granted', 'denied']) {
    const { readPermissionSnapshot } = load('src/main/system/permissions.ts', {
      electron: { systemPreferences: { getMediaAccessStatus: () => 'granted' } },
      '../computer/nativeDesktop': { desktopPermissions: async () => ({ accessibility: false, accessibilityStatus: 'unknown', screenRecordingStatus: status, setup: 'Controller unavailable: missing helper' }) },
      child_process: { execFile: (_file, _args, _options, callback) => callback(null, 'ALBERT') }
    })
    const p = await readPermissionSnapshot({ graph: false, app: false, detail: 'Not connected' })
    assert.equal(p.screenRecording, status)
    assert.equal(p.accessibilityStatus, 'unknown')
    assert.match(p.controllerDetail, /missing helper/)
  }
})
test('tool arguments cannot upgrade a hover or scroll into a click or drag', async () => {
  const calls = []
  const { desktopTools } = load('src/main/tools/desktop.ts', {
    '../computer/nativeDesktop': {
      desktopRequest: async args => { calls.push(args); return { performed: args.kind } },
      desktopPermissions: async () => ({}), desktopWindowScreenshot: async () => ({})
    }
  })
  for (const [name, expected] of [['desktop_move_pointer', 'move'], ['desktop_scroll', 'scroll']]) {
    const tool = desktopTools.find(t => t.name === name)
    const result = await tool.execute({ snapshotId: 's1', x: 1, y: 2, deltaY: 3, kind: 'click', op: 'type_text' })
    assert.equal(result.ok, true)
    assert.equal(calls.at(-1).kind, expected)
    assert.equal(calls.at(-1).op, 'pointer')
  }
})
