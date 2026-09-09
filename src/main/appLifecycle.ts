import { execFileSync, spawn } from 'child_process'
import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, openSync, closeSync } from 'fs'
import { join } from 'path'
import { commandLooksLikeSelfRestart, commandLooksLikeSelfUpdate } from '../shared/selfUpdate'
import { getDataDir } from './config'
import { albertSourceRoot } from './cursor/selfEdit'
import { codexSpawnEnv } from './codex/binary'

export interface AppJobStatus {
  kind: 'update' | 'restart'
  pid: number | undefined
  logPath: string
  startedAt: number
  finished: boolean
  exitCode: number | null
}

let job: AppJobStatus | null = null

export function getAppJobStatus(): AppJobStatus | null {
  return job
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function updateStillRunning(): boolean {
  if (!job || job.kind !== 'update' || job.finished) return false
  if (job.pid && !pidAlive(job.pid)) {
    job.finished = true
    return false
  }
  return Boolean(job.pid)
}

/** Finder-launched ALBERT has a stripped PATH; the installer needs npm/node. */
function installerEnv(): NodeJS.ProcessEnv {
  const base = codexSpawnEnv()
  try {
    const loginPath = execFileSync(process.env.SHELL || '/bin/zsh', ['-lic', 'printenv PATH'], {
      encoding: 'utf8',
      timeout: 4_000,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    if (loginPath) {
      return {
        ...base,
        PATH: [...new Set([...loginPath.split(':'), ...(base.PATH || '').split(':')].filter(Boolean))].join(
          ':'
        )
      }
    }
  } catch {
    /* keep Homebrew / nvm probes from codexSpawnEnv */
  }
  return base
}

function posixSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Launch the installer under osascript so quitting ALBERT cannot take it down.
 * `spawn({ detached: true })` is still in Albert's session; Apple Events is not.
 */
function spawnInstallerViaOsascript(
  script: string,
  flag: string,
  root: string,
  env: NodeJS.ProcessEnv,
  logPath: string
): number | undefined {
  const body = [
    `export PATH=${posixSingleQuote(env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin')}`,
    `cd ${posixSingleQuote(root)}`,
    `/usr/bin/nohup /bin/bash ${posixSingleQuote(script)} ${posixSingleQuote(flag)} >> ${posixSingleQuote(logPath)} 2>&1 &`,
    'echo $!'
  ].join('; ')
  const stdout = execFileSync('osascript', ['-e', `do shell script ${appleScriptString(body)}`], {
    encoding: 'utf8',
    timeout: 12_000,
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
  const pid = Number(stdout.split(/\s+/).pop())
  if (!Number.isFinite(pid) || pid <= 0) {
    throw new Error(`osascript did not return a pid (${stdout || 'empty'})`)
  }
  return pid
}

function spawnInstallerFallback(
  script: string,
  flag: string,
  root: string,
  env: NodeJS.ProcessEnv,
  logPath: string
): { pid: number | undefined; child: ReturnType<typeof spawn> } {
  const logFd = openSync(logPath, 'a')
  const child = spawn('/bin/bash', [script, flag], {
    cwd: root,
    env,
    detached: true,
    stdio: ['ignore', logFd, logFd]
  })
  closeSync(logFd)
  child.unref()
  return { pid: child.pid, child }
}

/**
 * Run `npm run update:app` outside Albert's process tree so quitting the app
 * cannot take the rebuild with it. Codex/shell `npm run update:app` maps here.
 */
export function startAppUpdate(relaunch = true): { ok: boolean; result: string } {
  if (updateStillRunning()) {
    return {
      ok: true,
      result: `npm run update:app is already running (pid ${job?.pid || '?'}). Log: ${job?.logPath}`
    }
  }
  const root = albertSourceRoot()
  if (!root) {
    return {
      ok: false,
      result: 'No ALBERT repo folder is configured. Set Systems → Project folder to the source tree.'
    }
  }
  const script = join(root, 'scripts/install-app.sh')
  if (!existsSync(script)) {
    return { ok: false, result: `Installer missing at ${script}` }
  }
  const logDir = join(getDataDir(), 'logs')
  mkdirSync(logDir, { recursive: true })
  const logPath = join(logDir, 'self-update.log')
  const flag = relaunch ? '--relaunch' : '--no-relaunch'
  const env = installerEnv()
  try {
    appendFileSync(logPath, `\n--- npm run update:app ${new Date().toISOString()} ${flag} ---\n`)
    let pid: number | undefined
    let via = 'osascript'
    try {
      pid = spawnInstallerViaOsascript(script, flag, root, env, logPath)
    } catch (err) {
      via = 'detached-spawn'
      appendFileSync(
        logPath,
        `osascript launch failed (${err instanceof Error ? err.message : String(err)}); using spawn fallback\n`
      )
      const fallback = spawnInstallerFallback(script, flag, root, env, logPath)
      pid = fallback.pid
      fallback.child.once('exit', (code) => {
        const current = job
        if (!current || current.pid !== pid) return
        current.finished = true
        current.exitCode = code
      })
    }
    job = {
      kind: 'update',
      pid,
      logPath,
      startedAt: Date.now(),
      finished: false,
      exitCode: null
    }
    return {
      ok: true,
      result: [
        `npm run update:app started detached${pid ? ` (pid ${pid})` : ''} via ${via}.`,
        'That is success — do not retry the shell.',
        'I will quit when the installer replaces the app, then reopen myself.',
        `Log: ${logPath}`
      ].join(' ')
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, result: `Could not start npm run update:app: ${message}` }
  }
}

export function restartAlbertApp(delayMs = 700): { ok: boolean; result: string } {
  if (updateStillRunning()) {
    return {
      ok: true,
      result: `npm run update:app is already running (pid ${job?.pid || '?'}). It will relaunch me when it finishes.`
    }
  }
  setTimeout(() => {
    try {
      app.relaunch()
    } catch {
      /* some hosts still exit cleanly */
    }
    app.exit(0)
  }, Math.min(Math.max(delayMs, 200), 8_000))
  job = {
    kind: 'restart',
    pid: process.pid,
    logPath: '',
    startedAt: Date.now(),
    finished: false,
    exitCode: null
  }
  return { ok: true, result: 'Restarting now, sir. Give me a moment to come back.' }
}

/** Codex / Albert shells for update/restart — run the real detached job instead. */
export function takeoverSelfLifecycleCommand(command: string): { ok: boolean; result: string } | null {
  if (commandLooksLikeSelfUpdate(command)) return startAppUpdate(true)
  if (commandLooksLikeSelfRestart(command)) return restartAlbertApp()
  return null
}
