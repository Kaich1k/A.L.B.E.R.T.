#!/usr/bin/env node
/**
 * Codex preflight for A.L.B.E.R.T.
 *
 * Checks the three things that actually break: the binary is missing, the
 * app-server handshake fails, or ChatGPT sign-in hasn't happened. Runs the same
 * JSON-RPC calls the app does, deliberately standalone so it works even when
 * the Electron build is broken.
 */
import { spawn, execFileSync } from 'node:child_process'
import { accessSync, constants, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CANDIDATE_DIRS = [
  ...(process.env.PATH || '').split(':'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  join(homedir(), '.local', 'bin'),
  join(homedir(), '.bun', 'bin'),
  join(homedir(), '.volta', 'bin')
].filter(Boolean)

function findCodex() {
  if (process.env.ALBERT_CODEX_BIN && existsSync(process.env.ALBERT_CODEX_BIN)) {
    return process.env.ALBERT_CODEX_BIN
  }
  for (const dir of [...new Set(CANDIDATE_DIRS)]) {
    const candidate = join(dir, 'codex')
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // keep looking
    }
  }
  try {
    return execFileSync(process.env.SHELL || '/bin/zsh', ['-lic', 'command -v codex'], {
      encoding: 'utf8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .trim()
      .split('\n')
      .pop()
      .trim()
  } catch {
    return null
  }
}

/** Drive one short app-server session and collect the responses we asked for. */
function probeAppServer(bin) {
  return new Promise((resolve) => {
    const child = spawn(bin, ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'] })
    const results = new Map()
    const notifications = []
    let buffer = ''
    let stderr = ''
    let done = false

    const finish = (error) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        child.stdin.end()
      } catch {
        // already closed
      }
      child.kill('SIGTERM')
      resolve({ results, notifications, stderr, error })
    }

    const timer = setTimeout(() => finish('timed out after 25s'), 25_000)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      for (;;) {
        const nl = buffer.indexOf('\n')
        if (nl < 0) break
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        let msg
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        if (msg.id !== undefined && msg.method === undefined) {
          results.set(msg.id, msg)
          if (msg.id === 1) {
            // Handshake acknowledged — now ask the real questions.
            send({ jsonrpc: '2.0', method: 'initialized', params: {} })
            send({ jsonrpc: '2.0', id: 2, method: 'account/read', params: {} })
            send({ jsonrpc: '2.0', id: 3, method: 'model/list', params: {} })
            send({ jsonrpc: '2.0', id: 4, method: 'account/rateLimits/read', params: {} })
          }
          if (results.has(2) && results.has(3) && results.has(4)) finish(null)
        } else if (msg.method) {
          notifications.push(msg.method)
        }
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (err) => finish(err.message))
    child.on('exit', (code) => {
      if (!done) finish(`app-server exited early (code ${code})`)
    })

    const send = (msg) => {
      try {
        child.stdin.write(`${JSON.stringify(msg)}\n`)
      } catch {
        finish('could not write to app-server stdin')
      }
    }

    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'albert_mac', title: 'A.L.B.E.R.T. doctor', version: '0.1.0' },
        capabilities: { experimentalApi: true }
      }
    })
  })
}

function line(ok, label, detail) {
  const mark = ok === null ? '•' : ok ? '✓' : '✗'
  console.log(`${mark} ${label}${detail ? ` — ${detail}` : ''}`)
}

const problems = []

console.log('A.L.B.E.R.T. → Codex preflight\n')

const bin = findCodex()
if (!bin) {
  line(false, 'codex binary', 'not found')
  problems.push('Install the CLI: npm install -g @openai/codex (needs Node 22+)')
} else {
  let version = 'unknown'
  try {
    version = execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 8_000 }).trim()
  } catch {
    // version is optional
  }
  line(true, 'codex binary', `${bin} (${version})`)

  const { results, error, stderr } = await probeAppServer(bin)

  const init = results.get(1)
  if (error && !init) {
    line(false, 'app-server handshake', error)
    problems.push('codex app-server would not start. Try `codex app-server` in a terminal.')
    if (stderr.trim()) console.log(`\n  stderr: ${stderr.trim().split('\n').slice(0, 4).join('\n  ')}`)
  } else if (init?.error) {
    line(false, 'app-server handshake', init.error.message || 'rejected')
    problems.push('The installed Codex rejected our initialize params.')
  } else {
    line(true, 'app-server handshake', init?.result?.userAgent || 'ok')
  }

  const account = results.get(2)
  const payload = account?.result ?? {}
  const acct = payload.account ?? payload.accounts?.[0] ?? null
  const mode = acct?.type ?? payload.authMode ?? null
  if (mode === 'chatgpt') {
    line(true, 'ChatGPT sign-in', `${acct?.email || 'signed in'} (${acct?.planType || 'plan unknown'})`)
  } else if (mode) {
    line(null, 'ChatGPT sign-in', `signed in via ${mode}, not ChatGPT`)
    problems.push('A.L.B.E.R.T. expects ChatGPT auth so turns use your Plus allowance.')
  } else {
    line(false, 'ChatGPT sign-in', 'not signed in')
    problems.push('Sign in from A.L.B.E.R.T. → Systems → Codex, or run `codex login`.')
  }

  const modelPayload = results.get(3)?.result ?? {}
  const modelList = modelPayload.data ?? modelPayload.models
  if (Array.isArray(modelList) && modelList.length) {
    const ids = modelList
      .filter((m) => m?.hidden !== true)
      .map((m) => m.id || m.model || m.slug)
      .filter(Boolean)
    line(true, 'models', `${ids.length} available — ${ids.join(', ')}`)
  } else {
    line(null, 'models', 'none reported (sign-in usually fixes this)')
  }

  const limits = results.get(4)?.result
  const snapshot = limits?.rateLimits ?? limits
  const used = [snapshot?.primary?.usedPercent, snapshot?.secondary?.usedPercent].filter(
    (v) => typeof v === 'number'
  )
  if (used.length) {
    line(true, 'allowance', `${Math.max(0, 100 - Math.max(...used))}% left`)
  } else {
    line(null, 'allowance', 'not reported yet')
  }
}

console.log('')
if (!problems.length) {
  console.log('All clear. Codex is ready to be A.L.B.E.R.T.\u2019s engineering brain.')
  process.exit(0)
}
console.log('Action needed:')
for (const problem of problems) console.log(`  - ${problem}`)
process.exit(1)
