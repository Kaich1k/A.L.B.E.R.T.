import { clipboard } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { ToolDefinition } from './types'

const execFileAsync = promisify(execFile)

export const systemTools: ToolDefinition[] = [
  {
    name: 'read_clipboard',
    description: 'Read the current text contents of the system clipboard.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    execute: async () => {
      const text = clipboard.readText()
      return { ok: true, result: text || '(clipboard empty)' }
    }
  },
  {
    name: 'write_clipboard',
    description: 'Write text to the system clipboard.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string' }
      },
      required: ['text']
    },
    execute: async (args) => {
      clipboard.writeText(String(args.text ?? ''))
      return { ok: true, result: 'Clipboard updated.' }
    }
  },
  {
    name: 'run_applescript',
    description:
      'Run a short AppleScript for macOS automation. Prefer dedicated tools when available — especially spotify_control for Spotify (do not hand-roll Spotify scripts). Prefer desktop_* / computer_* / file tools otherwise.',
    parameters: {
      type: 'object',
      properties: {
        script: { type: 'string', description: 'AppleScript source' }
      },
      required: ['script']
    },
    dangerous: true,
    execute: async (args) => {
      const script = String(args.script ?? '').trim()
      if (!script) return { ok: false, result: 'Script is required.' }
      if (script.length > 4000) return { ok: false, result: 'Script too long (max 4000 chars).' }
      try {
        const { stdout, stderr } = await execFileAsync('osascript', ['-e', script], {
          timeout: 15000
        })
        return { ok: true, result: (stdout || stderr || 'OK').trim() }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, result: `AppleScript failed: ${message}` }
      }
    }
  }
]
