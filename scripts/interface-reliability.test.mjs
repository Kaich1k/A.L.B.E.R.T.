import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const graph = await import('../src/shared/memoryGraph.ts')
const pulse = await import('../src/shared/projectPulseParse.ts')
const voice = await import('../src/shared/voiceCommands.ts')
const voiceStack = await import('../src/shared/voiceStack.ts')
const approval = await import('../src/shared/approvalKind.ts')

test('memory graph classifies people, projects, prefs, and decisions', () => {
  assert.equal(graph.classifyMemoryKind('My wife is named Ada and she hates cilantro.'), 'person')
  assert.equal(graph.classifyMemoryKind('We are building GPACE outreach this semester.'), 'project')
  assert.equal(graph.classifyMemoryKind('From now on I prefer short spoken answers.'), 'preference')
  assert.equal(graph.classifyMemoryKind('I decided to ship the Mac build before mobile.'), 'decision')
  assert.equal(graph.classifyMemoryKind('I live in Chicago near campus.'), 'place')
})

test('memory graph links overlapping facts without exploding', () => {
  const built = graph.buildMemoryGraph([
    {
      id: '1',
      content: 'Kai is building GPACE outreach with ALBERT.',
      category: 'project',
      createdAt: 1,
      updatedAt: 1,
      source: 'conversation',
      confidence: 0.9
    },
    {
      id: '2',
      content: 'GPACE outreach deadline is Friday.',
      category: 'decision',
      createdAt: 1,
      updatedAt: 1,
      source: 'auto',
      confidence: 0.8
    },
    {
      id: '3',
      content: 'I prefer dark HUD chrome and short replies.',
      category: 'preference',
      createdAt: 1,
      updatedAt: 1,
      source: 'conversation',
      confidence: 1
    }
  ])
  assert.equal(built.nodes.length, 3)
  assert.ok(built.edges.some((edge) => edge.from === '1' && edge.to === '2'))
  assert.ok(built.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)))
})

test('pulse parsers read git and TODO noise', () => {
  const dirty = pulse.parseGitStatus(' M src/main/index.ts\n?? notes.md\n')
  assert.deepEqual(dirty.map((row) => row.path), ['src/main/index.ts', 'notes.md'])
  const commits = pulse.parseGitLog('abc1234\t2 hours ago\tFix voice barge-in\n')
  assert.equal(commits[0].subject, 'Fix voice barge-in')
  assert.equal(pulse.parseTodoLine('  // TODO: resume GPACE outreach'), 'TODO resume GPACE outreach')
  assert.equal(pulse.parseTodoLine('const ok = true'), null)
  assert.ok(pulse.pulseScore({ dirty: 0, stale: 0, todos: 0, failures: 0, blocked: 0 }) >= 90)
  assert.ok(pulse.pulseScore({ dirty: 8, stale: 3, todos: 20, failures: 2, blocked: 1 }) < 70)
})

test('resume and save capsule voice commands', () => {
  assert.deepEqual(voice.parseResumeCapsuleCommand('Albert, resume GPACE outreach'), {
    query: 'GPACE outreach',
    remainder: ''
  })
  assert.deepEqual(voice.parseResumeCapsuleCommand('resume GPACE outreach and draft the next email'), {
    query: 'GPACE outreach',
    remainder: 'draft the next email'
  })
  assert.equal(voice.parseResumeCapsuleCommand('resume playback'), null)
  assert.deepEqual(voice.parseSaveCapsuleCommand('seal a context capsule called GPACE outreach'), {
    title: 'GPACE outreach'
  })
  assert.deepEqual(voice.parseSaveCapsuleCommand('save this session'), { title: '' })
  assert.equal(voice.parseSaveCapsuleCommand('save this file'), null)
})

test('voice stack keeps original while shortening', () => {
  assert.equal(voiceStack.parseVoiceStackCommand('short version'), 'short')
  assert.equal(voiceStack.parseVoiceStackCommand('pause that'), 'pause')
  assert.equal(voiceStack.parseVoiceStackCommand('show me'), 'show')
  assert.equal(voiceStack.parseVoiceStackCommand('send that to my phone'), 'phone')
  const original = 'First sentence is useful. Second sentence is also useful. Third goes on far too long for voice.'
  const short = voiceStack.shortenAnswer(original, 80)
  assert.ok(short.length <= 81)
  assert.ok(original.includes('Third goes on'))
  assert.equal(approval.classifyApprovalKind({ title: 'Send the outreach email', preview: 'To: dean@school.edu' }), 'email')
  assert.equal(approval.classifyApprovalKind({ preview: 'diff --git a/x b/x\n@@ -1 +1 @@' }), 'diff')
  assert.equal(approval.classifyApprovalKind({ title: 'npm run test', description: 'shell' }), 'shell')
})

test('live ALBERT source writes are detected without touching Electron', async () => {
  const live = await import('../src/shared/liveSource.ts')
  const root = '/Users/kai/Documents/VS/ALBERT'
  assert.equal(live.isLiveSourcePath(`${root}/src/renderer/src/App.tsx`, root), true)
  assert.equal(live.isLiveSourcePath(`${root}/scripts/install-app.sh`, root), true)
  assert.equal(live.isLiveSourcePath(`${root}/README.md`, root), false)
  assert.equal(live.isLiveSourcePath(`${root}-evil/src/App.tsx`, root), false)
  assert.equal(live.resolveLivePath('src/renderer/src/App.tsx', root), `${root}/src/renderer/src/App.tsx`)
  assert.equal(live.liveSourceHit(['src/renderer/src/styles/global.css'], root), `${root}/src/renderer/src/styles/global.css`)
  assert.equal(live.liveSourceHit(['README.md'], root), null)
  assert.equal(live.commandLooksLikeLiveSourceWrite('sed -i "" "s/a/b/" src/main/index.ts'), true)
  assert.equal(live.commandLooksLikeLiveSourceWrite('echo hi > src/renderer/src/App.tsx'), true)
  assert.equal(live.commandLooksLikeLiveSourceWrite('rg TODO src/main'), false)
  assert.equal(live.commandLooksLikeLiveSourceWrite('npm test'), false)
  assert.equal(live.commandLooksLikeLiveSourceWrite('agent -p --workspace . "fix the orb"'), false)
  assert.deepEqual(
    live.pathsFromUnifiedDiff(
      'diff --git a/src/renderer/src/styles/global.css b/src/renderer/src/styles/global.css\n+++ b/src/renderer/src/styles/global.css\n@@ -1 +1 @@\n-a\n+b\n'
    ),
    ['src/renderer/src/styles/global.css']
  )
  assert.equal(
    live.liveSourceHit(
      live.pathsFromUnifiedDiff('diff --git a/README.md b/README.md\n+++ b/README.md\n'),
      root
    ),
    null
  )
})

test('speech orb work hints follow the tool, not random screen edges', async () => {
  const hud = await import('../src/shared/hudWork.ts')
  assert.deepEqual(hud.hintForTool('desktop_click', { x: 1400, y: 220 }), {
    kind: 'click',
    x: 1400,
    y: 220
  })
  assert.equal(hud.hintForTool('computer_youtube', { query: 'gpace' }).kind, 'computer')
  assert.deepEqual(hud.hintForTool('spotify_control', { action: 'play' }), {
    kind: 'app',
    app: 'Spotify'
  })
  assert.equal(hud.hintForTool('open_app', { name: 'Notes' }).app, 'Notes')
  assert.equal(hud.hintForTool('browser_open_url', { browser: 'Google Chrome' }).app, 'Google Chrome')
  assert.equal(hud.hintForTool('cursor_agent', { prompt: 'fix orb' }).app, 'Cursor')
  assert.equal(hud.hintForTool('desktop_type_text', { text: 'hi' }).kind, 'frontmost')
  assert.equal(hud.hintForTool('web_search', { query: 'weather' }).kind, 'main')
  assert.equal(hud.shouldFlyForHint(hud.hintForTool('web_search')), false)
  assert.equal(hud.shouldFlyForHint(hud.hintForTool('desktop_click', { x: 1, y: 1 })), true)
  const stay = hud.yieldAwayFromCursor(
    { x: 0, y: 0, width: 196, height: 196 },
    { x: 400, y: 400 }
  )
  assert.equal(stay, null)
  const step = hud.yieldAwayFromCursor(
    { x: 0, y: 0, width: 196, height: 196 },
    { x: 98, y: 98 }
  )
  assert.ok(step)
  const after = Math.hypot(step.x + 98 - 98, step.y + 98 - 98)
  assert.ok(after >= 98, 'yield moves away from the pointer, not toward it')
  const area = { x: 0, y: 0, width: 1920, height: 1080 }
  const parked = hud.orbNearPoint({ x: 400, y: 300 }, 196, area)
  const cx = parked.x + 98
  const cy = parked.y + 98
  assert.ok(Math.hypot(cx - 400, cy - 300) >= 98, 'orb must not sit on the click')
  const second = { x: 1920, y: 0, width: 1920, height: 1080 }
  const otherDesk = hud.orbNearPoint({ x: 2500, y: 200 }, 196, second)
  assert.ok(otherDesk.x >= 1920, 'orb can fly onto a second display')
  const beside = hud.orbBesideWindow({ x: 2100, y: 80, width: 800, height: 600 }, 196, second)
  assert.ok(beside.x >= 1920)
  const berth = { x: 1000, y: 200, width: 236, height: 236 }
  const overBerth = { x: 1024, y: 174, width: 288, height: 288 }
  assert.equal(hud.orbShouldSnapToDock(overBerth, berth), true)
  const farFromBerth = { x: 40, y: 40, width: 288, height: 288 }
  assert.equal(hud.orbShouldSnapToDock(farFromBerth, berth), false)
  assert.equal(hud.orbShouldSnapToDock(overBerth, { ...berth, width: 20, height: 20 }), false)
})

test('self-update commands must not run as a child shell', async () => {
  const self = await import('../src/shared/selfUpdate.ts')
  assert.equal(self.commandLooksLikeSelfUpdate('npm run update:app'), true)
  assert.equal(self.commandLooksLikeSelfUpdate('npm run "update:app"'), true)
  assert.equal(self.commandLooksLikeSelfUpdate('npm run install:app'), true)
  assert.equal(self.commandLooksLikeSelfUpdate('bash scripts/install-app.sh --relaunch'), true)
  assert.equal(self.commandLooksLikeSelfUpdate('npx electron-builder --mac dir'), true)
  assert.equal(self.commandLooksLikeSelfUpdate('npm test'), false)
  assert.equal(self.commandLooksLikeSelfRestart('killall ALBERT'), true)
  assert.equal(self.commandLooksLikeSelfRestart('pkill -f ALBERT.app/Contents/MacOS'), true)
  assert.equal(
    self.commandLooksLikeSelfRestart('osascript -e \'tell application "ALBERT" to quit\''),
    true
  )
  assert.equal(self.commandLooksLikeSelfRestart('open ~/Applications/ALBERT.app'), true)
  assert.equal(self.commandLooksLikeSelfRestart('open /Users/kai/Applications/ALBERT.app'), true)
  assert.equal(self.commandLooksLikeSelfRestart('npm test'), false)
  assert.equal(self.commandLooksLikeSelfRestart('npm run update:app'), false)
  assert.equal(self.utteranceLooksLikeRebuildNow('npm run update:app'), true)
  assert.equal(
    self.utteranceLooksLikeRebuildNow('did you crash or just not run npm run update:app'),
    true
  )
  assert.equal(self.utteranceLooksLikeRebuildNow('rebuild the app now'), true)
  assert.equal(self.utteranceLooksLikeRebuildNow('reopen yourself'), true)
  assert.equal(
    self.utteranceLooksLikeRebuildNow('make that last fix please albert, and then reopen'),
    false
  )
  assert.equal(self.utteranceLooksLikeRebuildNow('what was it interrupted by'), false)
  const live = await import('../src/main/cursor/selfEdit.ts')
  assert.equal(live.blockedLiveWrite('run_project_command', { command: 'npm run update:app' }), null)
  assert.equal(live.blockedLiveWrite('run_project_command', { command: 'npm test' }), null)
})

test('HUD and Computer windows are auxiliary and must not parent dialogs', async () => {
  const windows = await import('../src/shared/albertWindows.ts')
  assert.equal(windows.isAuxiliaryAlbertUrl('http://localhost:5173/#hud'), true)
  assert.equal(windows.isAuxiliaryAlbertUrl('file:///tmp/index.html#computer'), true)
  assert.equal(windows.isAuxiliaryAlbertUrl('file:///tmp/index.html'), false)
  assert.equal(windows.isAuxiliaryAlbertUrl('http://localhost:5173/'), false)
})

test('orb and dock visual contract stays intact', () => {
  const ambient = readFileSync(new URL('../src/renderer/src/components/AmbientHud.tsx', import.meta.url), 'utf8')
  const comm = readFileSync(new URL('../src/renderer/src/components/ConversationPanel.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../src/renderer/src/styles/global.css', import.meta.url), 'utf8')
  const installer = readFileSync(new URL('./install-app.sh', import.meta.url), 'utf8')

  assert.match(ambient, /className=\{`speech-orb/)
  assert.match(ambient, /speech-orb__disc/)
  assert.match(ambient, /speech-orb__talk/)
  assert.match(ambient, /speech-orb__pin/)
  assert.doesNotMatch(ambient, /speech-orb__readout/)
  assert.match(comm, /className=\"orb-dock\"/)
  assert.match(comm, /className=\{`orb-dock__berth/)
  assert.match(css, /\.speech-orb__disc[\s\S]*?border-radius:\s*50%/)
  assert.match(css, /\.orb-dock__berth[\s\S]*?background:\s*rgba\(90, 96, 102, 0\.55\)/)
  assert.match(css, /\.speech-orb__wave,\s*\n\.speech-orb__readout \{ display: none; \}/)
  assert.match(installer, /find .*dist.*-maxdepth 1.*-name 'mac\*'/)
})
