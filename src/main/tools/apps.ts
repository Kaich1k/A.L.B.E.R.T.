import { execFile } from 'child_process'
import { promisify } from 'util'
import type { ToolDefinition } from './types'

const execFileAsync = promisify(execFile)

export const appTools: ToolDefinition[] = [
  {
    name: 'open_app',
    description: 'Open a macOS application by name (e.g. "Safari", "Cursor", "Notes", "Spotify").',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Application name as shown in /Applications' }
      },
      required: ['name']
    },
    execute: async (args) => {
      const name = String(args.name ?? '').trim()
      if (!name) return { ok: false, result: 'App name is required.' }
      try {
        await execFileAsync('open', ['-a', name])
        return { ok: true, result: `Opened ${name}.` }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, result: `Failed to open ${name}: ${message}` }
      }
    }
  },
  {
    name: 'list_running_apps',
    description: 'List currently running macOS applications and the frontmost app.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    execute: async () => {
      const script = `
        tell application "System Events"
          set appList to name of every process whose background only is false
          set frontApp to name of first process whose frontmost is true
        end tell
        return "frontmost=" & frontApp & linefeed & "apps=" & (appList as string)
      `
      try {
        const { stdout } = await execFileAsync('osascript', ['-e', script])
        return { ok: true, result: stdout.trim() }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, result: `Failed to list apps: ${message}` }
      }
    }
  },
  {
    name: 'open_path',
    description: 'Open a file or folder path with the default macOS application.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to open' }
      },
      required: ['path']
    },
    dangerous: true,
    execute: async (args) => {
      const path = String(args.path ?? '').trim()
      if (!path) return { ok: false, result: 'Path is required.' }
      try {
        await execFileAsync('open', [path])
        return { ok: true, result: `Opened ${path}.` }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, result: `Failed to open path: ${message}` }
      }
    }
  },
  {
    name: 'get_datetime',
    description: 'Get the current local date and time.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    execute: async () => {
      const now = new Date()
      return {
        ok: true,
        result: `${now.toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`
      }
    }
  }
]
