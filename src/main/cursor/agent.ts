import { spawn, execFileSync, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join, resolve as resolvePath } from 'path'
import { BrowserWindow } from 'electron'
import type { CursorAgentStatus } from '../../shared/types'
import { startAppUpdate } from '../appLifecycle'
import { getSettings } from '../config'
import { codexSearchDirs, codexSpawnEnv } from '../codex/binary'
import { albertSourceRoot } from './selfEdit'
import { pauseLiveHmr, resumeLiveHmr } from './hmrPause'

let child: ChildProcess | null = null
let status: CursorAgentStatus = idleStatus()

function idleStatus(): CursorAgentStatus {
  return {
    running: false,
    pid: null,
    workspace: null,
    prompt: '',
    log: '',
    lastError: null,
    startedAt: null
  }
}

export function findAgentBinary(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.ALBERT_CURSOR_AGENT?.trim()
  if (explicit && existsSync(explicit)) return explicit
  const names = ['agent', 'cursor-agent']
  for (const dir of [
    join(homedir(), '.local/bin'),
    join(homedir(), '.cursor/bin'),
    join(homedir(), '.cursor/extensions'),
    ...codexSearchDirs(env)
  ]) {
    for (const name of names) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }
  try {
    const found = execFileSync('/bin/zsh', ['-lic', 'command -v agent || command -v cursor-agent'], {
      encoding: 'utf8',
      timeout: 4000,
      env
    })
      .trim()
      .split('\n')
      .find((line) => line && existsSync(line))
    if (found) return found
  } catch {
    /* PATH probe is best-effort */
  }
  return null
}

export function getCursorAgentStatus(): CursorAgentStatus {
  return { ...status }
}

function emitProgress(chunk: string): void {
  status = { ...status, log: `${status.log}${chunk}`.slice(-8_000) }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('albert:chat:event', {
        type: 'cursor_progress',
        cursorLog: status.log.slice(-400)
      })
    }
  }
}

export function interruptCursorAgent(): boolean {
  if (!child || child.killed) return false
  child.kill('SIGTERM')
  resumeLiveHmr()
  return true
}

export async function runCursorAgent(prompt: string, workspace?: string): Promise<{
  ok: boolean
  result: string
}> {
  const trimmed = prompt.trim()
  if (!trimmed) return { ok: false, result: 'A prompt is required.' }
  if (child && !child.killed) {
    return { ok: false, result: 'A Cursor agent is already running. Interrupt it first, sir.' }
  }

  const bin = findAgentBinary()
  if (!bin) {
    return {
      ok: false,
      result:
        'Cursor agent CLI not found. Install it (`agent` in ~/.local/bin) or set ALBERT_CURSOR_AGENT. This is the same agent the IDE tab uses.'
    }
  }

  const cwd = workspace?.trim() || albertSourceRoot() || getSettings().projectFolder?.trim() || process.cwd()
  const env = {
    ...codexSpawnEnv(),
    CURSOR_API_KEY: getSettings().cursorApiKey?.trim() || process.env.CURSOR_API_KEY || ''
  }

  pauseLiveHmr()

  status = {
    running: true,
    pid: null,
    workspace: cwd,
    prompt: trimmed,
    log: '',
    lastError: null,
    startedAt: Date.now()
  }

  return new Promise((resolve) => {
    const args = [
      '-p',
      '--output-format',
      'text',
      '--force',
      '--sandbox',
      'disabled',
      '--workspace',
      cwd,
      trimmed
    ]
    const proc = spawn(bin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    child = proc
    status = { ...status, pid: proc.pid ?? null }
    let stdout = ''
    let stderr = ''

    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
    }, 8 * 60_000)

    proc.stdout?.on('data', (buf: Buffer) => {
      const text = buf.toString('utf8')
      stdout += text
      emitProgress(text)
    })
    proc.stderr?.on('data', (buf: Buffer) => {
      const text = buf.toString('utf8')
      stderr += text
      emitProgress(text)
    })
    proc.on('error', (err) => {
      clearTimeout(timer)
      child = null
      resumeLiveHmr()
      status = { ...idleStatus(), lastError: err.message, log: status.log }
      resolve({ ok: false, result: `Cursor agent failed to start: ${err.message}` })
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      child = null
      const output = (stdout.trim() || stderr.trim() || `Cursor agent exited ${code ?? '?'}`).slice(0, 8_000)
      const ok = code === 0
      const root = albertSourceRoot()
      const editedSelf = Boolean(ok && root && resolvePath(cwd) === resolvePath(root))
      const rebuild = editedSelf ? startAppUpdate(true) : null
      if (!rebuild?.ok) resumeLiveHmr()
      status = {
        ...idleStatus(),
        log: output,
        lastError: ok ? null : output.slice(0, 400),
        workspace: cwd,
        prompt: trimmed
      }
      resolve({
        ok,
        result: ok
          ? [
              `Cursor agent finished against ${cwd}.`,
              rebuild?.result ||
                'Live reload was paused so the running app would not crash. Call update_app to load UI changes.',
              output.slice(0, 2_000)
            ].join('\n')
          : `Cursor agent exited ${code}.\n${output.slice(0, 2_000)}`
      })
    })
  })
}

export function openInCursor(workspace?: string): { ok: boolean; result: string } {
  const cwd = workspace?.trim() || albertSourceRoot() || getSettings().projectFolder?.trim()
  if (!cwd) return { ok: false, result: 'No workspace to open.' }
  try {
    spawn('open', ['-a', 'Cursor', cwd], { stdio: 'ignore', detached: true }).unref()
    return { ok: true, result: `Opened Cursor on ${cwd}. Paste the request there if you want the IDE tab; otherwise use cursor_agent for a headless run.` }
  } catch (err) {
    return { ok: false, result: err instanceof Error ? err.message : String(err) }
  }
}
