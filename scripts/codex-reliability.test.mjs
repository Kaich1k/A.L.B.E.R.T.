import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync, writeFileSync } from 'node:fs'

const protocol = await import('../src/main/codex/protocol.ts')
const auth = await import('../src/main/codex/auth.ts')
const models = await import('../src/main/codex/models.ts')
const events = await import('../src/main/codex/events.ts')
const approvals = await import('../src/main/codex/approvals.ts')
const appServer = await import('../src/main/codex/appServer.ts')
const binary = await import('../src/main/codex/binary.ts')
const parse = await import('../src/main/chatgptImport/parse.ts')
const autoRemember = await import('../src/main/memory/autoRemember.ts')
const quickPolicy = await import('../src/main/tools/quickPolicy.ts')
const voiceCommands = await import('../src/shared/voiceCommands.ts')

test('decodeJsonLines frames whole messages and keeps a partial trailer', () => {
  const first = appServer.decodeJsonLines('{"id":1,"result":{"ok":true}}\n{"method":"turn/started"')
  assert.equal(first.messages.length, 1)
  assert.equal(first.messages[0].id, 1)
  assert.equal(first.rest, '{"method":"turn/started"')

  const second = appServer.decodeJsonLines(`${first.rest},"params":{"turn":{"id":"t1"}}}\n`)
  assert.equal(second.messages.length, 1)
  assert.equal(second.messages[0].method, 'turn/started')
  assert.equal(second.rest, '')
})

test('decodeJsonLines drops rust log noise instead of throwing', () => {
  const { messages, rest } = appServer.decodeJsonLines(
    'tracing: warmup\n{"jsonrpc":"2.0","id":2,"result":{}}\nnot json\n'
  )
  assert.equal(messages.length, 1)
  assert.equal(messages[0].id, 2)
  assert.equal(rest, '')
})

test('account/read shapes normalize to a ChatGPT auth state', () => {
  assert.deepEqual(
    auth.toAuthState({
      account: { type: 'chatgpt', email: 'kai@example.com', planType: 'plus' }
    }),
    { signedIn: true, mode: 'chatgpt', email: 'kai@example.com', planType: 'plus' }
  )
  assert.deepEqual(auth.toAuthState({}), auth.SIGNED_OUT)
  assert.equal(auth.toAuthState({ authMode: 'chatgpt' }).signedIn, true)
  assert.equal(auth.toAuthState({ account: { type: 'apiKey' } }).mode, 'apiKey')
})

test('allowance math uses the tighter window and formats a HUD label', () => {
  const snapshot = {
    primary: { usedPercent: 18, windowDurationMins: 180, resetsAt: Date.now() / 1000 + 3 * 3600 },
    secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: null },
    planType: 'plus'
  }
  assert.equal(auth.remainingAllowancePercent(snapshot), 60)
  assert.match(auth.describeAllowance(snapshot), /60% allowance left/)
  assert.equal(auth.remainingAllowancePercent(null), null)
})

test('model list accepts data[] and object effort entries', () => {
  const listed = models.parseModelList({
    data: [
      {
        id: 'gpt-5.6-sol',
        displayName: 'GPT-5.6 Sol',
        hidden: false,
        supportedReasoningEfforts: [
          { reasoningEffort: 'low' },
          { reasoningEffort: 'medium' },
          { reasoningEffort: 'high' }
        ],
        isDefault: false
      },
      {
        id: 'gpt-5.6-terra',
        displayName: 'GPT-5.6 Terra',
        hidden: false,
        supportedReasoningEfforts: [
          { reasoningEffort: 'low' },
          { reasoningEffort: 'medium' },
          { reasoningEffort: 'high' }
        ],
        isDefault: false
      },
      { id: 'gpt-6-astra', hidden: false, isDefault: true, supportedReasoningEfforts: ['medium'] },
      { id: 'secret-preview', hidden: true }
    ]
  })
  assert.deepEqual(
    listed.map((m) => m.id),
    ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-6-astra']
  )
  assert.deepEqual(listed[0].efforts, ['low', 'medium', 'high'])
  assert.equal(models.pickModel(listed, models.CODEX_MODEL_PREFERENCE, ''), 'gpt-5.6-terra')
  assert.equal(models.pickModel(listed, models.CODEX_ESCALATION_PREFERENCE, ''), 'gpt-6-astra')
  assert.equal(models.normalizeEffort(listed, 'gpt-5.6-terra', 'ludicrous'), 'medium')
  assert.equal(models.normalizeEffort(listed, 'gpt-5.6-terra', 'high'), 'high')
})

test('classifies Codex faults from protocol error info', () => {
  assert.equal(
    protocol.classifyCodexError({
      message: 'quota',
      codexErrorInfo: { type: 'UsageLimitExceeded' }
    }).kind,
    'usageLimit'
  )
  assert.equal(
    protocol.classifyCodexError({
      message: 'please login',
      codexErrorInfo: { type: 'Unauthorized' }
    }).kind,
    'notSignedIn'
  )
  assert.equal(
    protocol.classifyCodexError({
      message: 'too many tokens',
      codexErrorInfo: { type: 'ContextWindowExceeded' }
    }).kind,
    'contextWindow'
  )
})

test('unknown Codex server requests decline instead of throwing', () => {
  assert.deepEqual(approvals.declineUnknownCodexServerRequest('mcpServer/elicitation/request'), {
    action: 'decline',
    content: null
  })
  assert.deepEqual(approvals.declineUnknownCodexServerRequest('item/permissions/requestApproval'), {
    permissions: {},
    scope: 'turn'
  })
  assert.equal(
    approvals.declineUnknownCodexServerRequest('item/commandExecution/requestApproval').decision,
    'decline'
  )
  assert.equal(protocol.CODEX_CLIENT_CAPABILITIES.experimentalApi, true)
  assert.deepEqual(approvals.grantRequestedPermissions({ permissions: { network: true } }), {
    permissions: { network: true },
    scope: 'session'
  })
})

test('maps item and turn notifications into the HUD vocabulary', () => {
  const delta = events.mapCodexNotification('item/agentMessage/delta', { delta: 'Hello' })
  assert.deepEqual(delta, [{ kind: 'delta', text: 'Hello' }])

  const commentary = events.mapCodexNotification('item/completed', {
    item: { type: 'agentMessage', id: 'm1', text: 'Working…', phase: 'commentary' }
  })
  assert.equal(commentary[0].kind, 'agentMessage')
  assert.equal(commentary[0].final, false)

  const final = events.mapCodexNotification('item/completed', {
    item: { type: 'agentMessage', id: 'm2', text: 'Fixed, sir.', phase: 'final_answer' }
  })
  assert.equal(final[0].final, true)
  assert.equal(events.isFinalAgentMessage(null), true)
  assert.equal(events.isFinalAgentMessage('commentary'), false)

  const plan = events.mapCodexNotification('turn/plan/updated', {
    plan: [{ step: 'Run tests', status: 'in_progress' }]
  })
  assert.equal(plan[0].kind, 'plan')
  assert.equal(events.progressLabel(plan[0]), 'Run tests')

  const command = events.mapCodexNotification('item/started', {
    item: { type: 'commandExecution', id: 'c1', command: 'npm test', cwd: '/tmp' }
  })
  assert.equal(command[0].kind, 'commandStart')
  assert.match(events.progressLabel(command[0]), /npm test/)
  assert.equal(events.progressLabel({ kind: 'turnStarted', turnId: 't1' }), 'ChatGPT is working')
  assert.equal(events.progressLabel({ kind: 'reasoning', text: 'hmm' }), 'Thinking')

  const completed = events.mapCodexNotification('turn/completed', {
    turn: { id: 't9', status: 'completed' }
  })
  assert.deepEqual(completed, [{ kind: 'turnCompleted', turnId: 't9', status: 'completed' }])

  const limits = events.mapCodexNotification('account/rateLimits/updated', {
    rateLimits: { primary: { usedPercent: 10 } }
  })
  assert.equal(limits[0].kind, 'rateLimits')
})

test('auto-accepts only inside the project folder when confirmations are off', () => {
  const project = '/Users/kai/Documents/VS/ALBERT'
  const inside = approvals.decideCodexApproval({
    kind: 'fileChange',
    paths: [`${project}/README.md`],
    cwd: project,
    projectFolder: project,
    confirmDangerousTools: false
  })
  assert.equal(inside.auto, true)
  assert.equal(inside.decision, 'accept')

  const liveSrc = approvals.decideCodexApproval({
    kind: 'fileChange',
    paths: [`${project}/src/main/foo.ts`],
    cwd: project,
    projectFolder: project,
    confirmDangerousTools: false,
    liveReload: true,
    protectedRoot: project
  })
  assert.equal(liveSrc.auto, true)
  assert.equal(liveSrc.decision, 'decline')

  const liveSrcPaused = approvals.decideCodexApproval({
    kind: 'fileChange',
    paths: [`${project}/src/main/foo.ts`],
    cwd: project,
    projectFolder: project,
    confirmDangerousTools: false,
    liveReload: true,
    protectedRoot: project,
    hmrPaused: true
  })
  assert.equal(liveSrcPaused.auto, true)
  assert.equal(liveSrcPaused.decision, 'accept')

  const packagedSrc = approvals.decideCodexApproval({
    kind: 'fileChange',
    paths: [`${project}/src/main/foo.ts`],
    cwd: project,
    projectFolder: project,
    confirmDangerousTools: false,
    liveReload: false
  })
  assert.equal(packagedSrc.auto, true)
  assert.equal(packagedSrc.decision, 'accept')

  const liveShell = approvals.decideCodexApproval({
    kind: 'command',
    paths: [project],
    cwd: project,
    projectFolder: project,
    confirmDangerousTools: false,
    liveReload: true,
    protectedRoot: project,
    command: 'sed -i "" "s/a/b/" src/renderer/src/App.tsx'
  })
  assert.equal(liveShell.auto, true)
  assert.equal(liveShell.decision, 'decline')

  const liveShellPaused = approvals.decideCodexApproval({
    kind: 'command',
    paths: [project],
    cwd: project,
    projectFolder: project,
    confirmDangerousTools: false,
    liveReload: true,
    protectedRoot: project,
    hmrPaused: true,
    command: 'sed -i "" "s/a/b/" src/renderer/src/App.tsx'
  })
  assert.equal(liveShellPaused.auto, true)
  assert.equal(liveShellPaused.decision, 'accept')

  const sibling = approvals.decideCodexApproval({
    kind: 'fileChange',
    paths: ['/Users/kai/Documents/VS/ALBERT-evil/secret.ts'],
    cwd: '/Users/kai/Documents/VS/ALBERT-evil',
    projectFolder: project,
    confirmDangerousTools: false
  })
  assert.equal(sibling.auto, false)

  const home = approvals.decideCodexApproval({
    kind: 'command',
    paths: ['/Users/kai/.ssh/id_ed25519'],
    cwd: '/Users/kai',
    projectFolder: project,
    confirmDangerousTools: false
  })
  assert.equal(home.auto, false)

  const confirmOn = approvals.decideCodexApproval({
    kind: 'fileChange',
    paths: [`${project}/README.md`],
    cwd: project,
    projectFolder: project,
    confirmDangerousTools: true
  })
  assert.equal(confirmOn.auto, false)

  const grant = approvals.decideCodexApproval({
    kind: 'command',
    paths: [project],
    cwd: project,
    projectFolder: project,
    confirmDangerousTools: false,
    grantRoot: '/Users/kai'
  })
  assert.equal(grant.auto, false)

  const selfUpdate = approvals.decideCodexApproval({
    kind: 'command',
    paths: [project],
    cwd: project,
    projectFolder: project,
    confirmDangerousTools: false,
    grantRoot: '/Users/kai',
    command: 'npm run update:app'
  })
  assert.equal(selfUpdate.auto, true)
  assert.equal(selfUpdate.decision, 'decline')

  const selfRestart = approvals.decideCodexApproval({
    kind: 'command',
    paths: [project],
    cwd: project,
    projectFolder: project,
    confirmDangerousTools: false,
    command: 'killall ALBERT'
  })
  assert.equal(selfRestart.auto, true)
  assert.equal(selfRestart.decision, 'decline')

  assert.equal(approvals.isInsideRoot(`${project}/src`, project), true)
  assert.equal(approvals.isInsideRoot(`${project}-evil/src`, project), false)
})

test('fileChange and command approval payloads extract absolute paths', () => {
  assert.deepEqual(
    approvals.fileChangePaths({
      changes: [{ path: '/tmp/a.ts' }, { path: '/tmp/b.ts' }]
    }),
    ['/tmp/a.ts', '/tmp/b.ts']
  )
  assert.deepEqual(
    approvals.commandApprovalPaths({
      commandActions: [{ path: '/proj/src/main.ts' }, { kind: 'unknown' }]
    }),
    ['/proj/src/main.ts']
  )
  assert.deepEqual(approvals.commandApprovalPaths({ command: 'rm -rf /' }), [])
})

test('ChatGPT export import parses memories and distills durable history', () => {
  const { memories, disabled } = parse.parseMemoryJson({
    memories: [
      { content: 'Kai is building A.L.B.E.R.T. on a Mac.', enabled: true },
      { content: 'Old unused fact about a discarded project.', enabled: false }
    ]
  })
  assert.equal(memories.length, 1)
  assert.equal(disabled, 1)
  assert.equal(memories[0].category, parse.CHATGPT_MEMORY_CATEGORY)

  assert.deepEqual(parse.extractDurableFacts("I'm building a robotics bench at home."), [
    "I'm building a robotics bench at home."
  ])
  assert.deepEqual(parse.extractDurableFacts("I'm trying to fix this TypeError."), [])

  const { history, conversationsSeen, messagesScanned } = parse.parseConversationsJson([
    {
      title: 'Bench notes',
      mapping: {
        a: {
          message: {
            author: { role: 'user' },
            content: { parts: ["I prefer local Whisper over cloud speech."] },
            create_time: 1_700_000_000
          }
        },
        b: {
          message: {
            author: { role: 'assistant' },
            content: { parts: ['Noted.'] },
            create_time: 1_700_000_001
          }
        }
      }
    }
  ])
  assert.equal(conversationsSeen, 1)
  assert.equal(messagesScanned, 1)
  assert.equal(history.length, 1)
  assert.equal(history[0].category, parse.CHATGPT_HISTORY_CATEGORY)

  const leftover = parse.dedupeAgainstExisting(history, ['I prefer local Whisper over cloud speech.'])
  assert.equal(leftover.length, 0)
})

test('auto-remember keeps durable facts and drops tasks and secrets', () => {
  const kept = autoRemember.extractAutoMemories(
    "I prefer Kokoro over system speech. From now on always call me sir. My password is hunter2. Inspect this project and run the tests."
  )
  assert.ok(kept.some((f) => /kokoro/i.test(f)))
  assert.ok(kept.some((f) => /call me sir/i.test(f)))
  assert.equal(kept.some((f) => /password|hunter2/i.test(f)), false)
  assert.equal(kept.some((f) => /inspect this project/i.test(f)), false)

  const fresh = autoRemember.selectNewAutoMemories(
    "I prefer Kokoro over system speech.",
    ['I prefer Kokoro over system speech.']
  )
  assert.deepEqual(fresh, [])
})

test('QUICK tools include project/file work and still deny shell', () => {
  assert.ok(quickPolicy.QUICK_TOOL_DENY.has('run_shell'))
  assert.ok(quickPolicy.QUICK_TOOL_DENY.has('run_applescript'))
  for (const name of quickPolicy.QUICK_REQUIRED_TOOLS) {
    assert.equal(quickPolicy.QUICK_TOOL_DENY.has(name), false, name)
  }
})

test('new Codex thread voice command is a narrow matcher', () => {
  assert.equal(voiceCommands.isNewCodexThreadCommand('new Codex thread'), true)
  assert.equal(voiceCommands.isNewCodexThreadCommand('Albert, start a new Codex thread'), true)
  assert.equal(voiceCommands.isNewCodexThreadCommand('inspect this project and fix the tests'), false)
})

test('codexSearchDirs probes PATH, homebrew, and the global npm prefix', () => {
  const dirs = binary.codexSearchDirs({
    PATH: '/custom/bin:/usr/bin',
    HOME: '/Users/kai',
    ALBERT_CODEX_BIN: '/opt/custom/codex'
  })
  assert.ok(dirs.includes('/custom/bin'))
  assert.ok(dirs.includes('/opt/homebrew/bin'))
  assert.ok(dirs.includes('/usr/local/bin'))
  assert.ok(dirs.includes('/opt/custom'))
})

test('findCodexBinary honors ALBERT_CODEX_BIN when the file is executable', () => {
  binary.resetCodexBinaryCache()
  const dir = mkdtempSync(join(tmpdir(), 'albert-codex-bin-'))
  const fake = join(dir, 'codex')
  writeFileSync(fake, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  const found = binary.findCodexBinary({ ALBERT_CODEX_BIN: fake, PATH: '', HOME: dir })
  assert.equal(found, fake)
  binary.resetCodexBinaryCache()
})

test('Finder-style PATH is augmented so env node can resolve', () => {
  const env = binary.codexSpawnEnv({ PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: '/Users/kai' })
  const parts = env.PATH.split(':')
  assert.ok(parts.includes('/opt/homebrew/bin'))
  assert.ok(parts.includes('/usr/local/bin'))
  assert.ok(parts.indexOf('/opt/homebrew/bin') < parts.indexOf('/usr/bin'))
})

test('node shims launch as node + script instead of env node', () => {
  binary.resetCodexBinaryCache()
  const dir = mkdtempSync(join(tmpdir(), 'albert-codex-shim-'))
  const shim = join(dir, 'codex')
  const node = join(dir, 'node')
  writeFileSync(shim, '#!/usr/bin/env node\nconsole.log("ok")\n', { mode: 0o755 })
  writeFileSync(node, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  assert.equal(binary.looksLikeNodeScript(shim), true)
  assert.equal(binary.looksLikeNodeScript(node), false)
  const launch = binary.resolveCodexLaunch(shim, { PATH: dir, HOME: dir, ALBERT_NODE_BIN: node })
  assert.deepEqual(launch, { command: node, args: [shim] })
  binary.resetCodexBinaryCache()
})
