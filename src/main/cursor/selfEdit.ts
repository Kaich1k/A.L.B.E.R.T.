import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { app } from 'electron'
import { getSettings } from '../config'
import { expandPath, resolveAllowedPath, resolveProjectPath } from '../tools/paths'
import { commandLooksLikeLiveSourceWrite, isLiveSourcePath } from '../../shared/liveSource'

function looksLikeAlbertRepo(root: string): boolean {
  try {
    const raw = readFileSync(join(root, 'package.json'), 'utf8')
    const pkg = JSON.parse(raw) as { name?: string }
    return pkg.name === 'albert'
  } catch {
    return false
  }
}

export function albertSourceRoot(): string | null {
  const folder = getSettings().projectFolder?.trim()
  if (folder) {
    const root = resolve(expandPath(folder))
    if (looksLikeAlbertRepo(root)) return root
  }
  const cwd = process.cwd()
  if (looksLikeAlbertRepo(cwd)) return cwd
  const homeGuess = join(homedir(), 'Documents/VS/ALBERT')
  if (looksLikeAlbertRepo(homeGuess)) return homeGuess
  return null
}

export function isDevLiveReload(): boolean {
  return Boolean(process.env.ELECTRON_RENDERER_URL) || !app.isPackaged
}

export function isProtectedLivePath(absPath: string): boolean {
  const target = resolve(absPath)
  if (app.isPackaged) {
    const bundled = app.getAppPath()
    return target === bundled || target.startsWith(bundled + '/')
  }
  const root = albertSourceRoot()
  if (!root || !isDevLiveReload()) return false
  return isLiveSourcePath(target, root)
}

export function liveWriteBlockMessage(absPath: string): string {
  return [
    `Live ALBERT source is protected (${absPath}).`,
    'Writing it while the app is running is what crashed last time (HMR + half-written files).',
    'Call cursor_agent with the change request so Cursor edits the repo in a separate process — the same agent as the IDE tab.',
    'Then call update_app so the installed app rebuilds detached.'
  ].join(' ')
}

const WRITE_TOOLS = new Set([
  'write_file',
  'write_project_file',
  'apply_patch',
  'apply_project_patch',
  'delete_file',
  'delete_project_file'
])

const SHELL_TOOLS = new Set(['run_shell', 'run_project_command'])

export function blockedLiveWrite(name: string, args: Record<string, unknown>): string | null {
  if (SHELL_TOOLS.has(name)) {
    const command = String(args.command || '')
    if (isDevLiveReload() && commandLooksLikeLiveSourceWrite(command)) {
      return liveWriteBlockMessage(command)
    }
    return null
  }
  if (!WRITE_TOOLS.has(name)) return null
  const raw = String(args.path || args.file_path || args.target || '')
  if (!raw) return null
  try {
    const abs = name.includes('project') ? resolveProjectPath(raw) : resolveAllowedPath(raw)
    if (isProtectedLivePath(abs)) return liveWriteBlockMessage(abs)
  } catch {
    return null
  }
  return null
}
