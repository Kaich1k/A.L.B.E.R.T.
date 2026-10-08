import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
const root = process.env.ALBERT_TEST_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
const ts = require('typescript')
function load(relative, mocks) {
  const module = { exports: {} }
  const code = ts.transpileModule(readFileSync(join(root, relative), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  vm.runInNewContext(code, {
    module, exports: module.exports, process, AbortSignal,
    require: name => name in mocks ? mocks[name] : require(name)
  })
  return module.exports
}
function permissions(helper, host = { accessibility: true, screenRecording: true }) {
  return load('src/main/computer/nativeDesktop.ts', {
    electron: { app: { once() {} }, systemPreferences: {
      isTrustedAccessibilityClient: () => host.accessibility,
      getMediaAccessStatus: () => host.screenRecording ? 'granted' : 'denied'
    } },
    './nativeTransport': { NativeDesktopClient: class { async request() {
      if (helper instanceof Error) throw helper
      return helper
    } } },
    './automation': { automationSignal: () => new AbortController().signal },
    '../agent/turnControl': { currentTurnScope: () => null },
    '../../shared/desktopGeometry': {}
  }).desktopPermissions()
}

test('host access alone never reports an unauthorized controller as ready', async () => {
  const p = await permissions({ accessibility: false, screenRecording: false })
  assert.equal(p.host.accessibility, true)
  assert.equal(p.accessibility, false)
  assert.equal(p.screenRecording, false)
  assert.match(p.setup, /desktop controller/)
})
test('window screenshots require both controller and host screen access', async () => {
  const p = await permissions({ accessibility: true, screenRecording: true }, { accessibility: true, screenRecording: false })
  assert.equal(p.accessibility, true)
  assert.equal(p.screenRecording, false)
})
test('an unavailable helper is a visible failure, never a ready signal', async () => {
  const p = await permissions(new Error('Desktop helper missing'))
  assert.equal(p.accessibility, false)
  assert.equal(p.screenRecording, false)
  assert.match(p.controller.error, /missing/)
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
