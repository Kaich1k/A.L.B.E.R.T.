import { execFile } from 'child_process'
import { promisify } from 'util'
import {
  assertCommandAllowed,
  expandPath,
  getAllowedRoots,
  getProjectFolder,
  resolveAllowedPath
} from './paths'
import { getSettings } from '../config'
import type { ToolDefinition } from './types'

const execFileAsync = promisify(execFile)

function resolveCwd(raw?: string): string {
  if (!raw?.trim()) {
    try {
      return getProjectFolder()
    } catch {
      return expandPath('~')
    }
  }
  return resolveAllowedPath(raw.trim())
}

export const shellTools: ToolDefinition[] = [
  {
    name: 'run_shell',
    description:
      'Run a shell command on the Mac. cwd must be under allowed roots (project/Documents/Desktop/Downloads). Without God mode: single allowlisted commands only (no pipes/chains). With God mode: freer, still under home+/tmp. Prefer run_project_command for project work.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        cwd: { type: 'string', description: 'Working directory (default: project folder)' },
        timeoutMs: { type: 'number' }
      },
      required: ['command']
    },
    dangerous: true,
    execute: async (args) => {
      try {
        const command = String(args.command ?? '').trim()
        if (!command) return { ok: false, result: 'command is required.' }

        const settings = getSettings()
        if (!settings.godMode) {
          assertCommandAllowed(command)
        } else if (command.length > 12_000) {
          return { ok: false, result: 'Command too long.' }
        }

        const cwd = resolveCwd(args.cwd ? String(args.cwd) : undefined)
        // Ensure cwd itself is allowed
        resolveAllowedPath(cwd)

        const timeout = Math.min(Math.max(Number(args.timeoutMs || 60_000), 1000), 300_000)
        const { stdout, stderr } = await execFileAsync('/bin/zsh', ['-lc', command], {
          cwd,
          timeout,
          maxBuffer: 4_000_000,
          env: { ...process.env, FORCE_COLOR: '0' }
        })
        const out = [stdout, stderr].filter(Boolean).join('\n').trim()
        const mode = settings.godMode ? 'god' : 'jailed'
        return {
          ok: true,
          result: `[EXEC mode=${mode} cwd=${cwd}] ${command}\n${out.slice(0, 12000) || '(no output)'}\n(allowed roots: ${getAllowedRoots().join(', ')})`
        }
      } catch (err) {
        const e = err as { message?: string; stdout?: string; stderr?: string }
        const out = [e.stdout, e.stderr, e.message].filter(Boolean).join('\n')
        return {
          ok: false,
          result: `[EXEC failed] ${String(args.command)}\n${out.slice(0, 12000)}`
        }
      }
    }
  }
]
