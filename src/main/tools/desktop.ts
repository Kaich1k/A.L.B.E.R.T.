import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdir, readFile } from 'fs/promises'
import { join } from 'path'
import { getDataDir } from '../config'
import type { ToolDefinition } from './types'

const execFileAsync = promisify(execFile)

function escapeAppleScriptString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export const desktopTools: ToolDefinition[] = [
  {
    name: 'desktop_screenshot',
    description:
      'Capture the main display (or interactive selection). Returns a PNG Albert can see (vision) plus the saved path. Requires Screen Recording permission for the app. When confirmDangerousTools is OFF, call this without asking Kai — never ask “should I screenshot?”.',
    parameters: {
      type: 'object',
      properties: {
        interactive: {
          type: 'boolean',
          description: 'If true, user selects a region (screencapture -i)'
        }
      }
    },
    dangerous: true,
    execute: async (args) => {
      try {
        const dir = join(getDataDir(), 'screenshots')
        await mkdir(dir, { recursive: true })
        const file = join(dir, `shot-${Date.now()}.png`)
        const interactive = Boolean(args.interactive)
        const scArgs = interactive ? ['-i', file] : ['-x', file]
        await execFileAsync('screencapture', scArgs, { timeout: 120_000 })
        const buf = await readFile(file)
        if (buf.length > 4_500_000) {
          return {
            ok: true,
            result: `[SCREENSHOT] Saved ${file} (${buf.length} bytes) — too large to attach; open the file or capture a smaller region.`
          }
        }
        return {
          ok: true,
          result: `[SCREENSHOT] Captured display → ${file} (${buf.length} bytes). Image attached for your vision.`,
          image: { mediaType: 'image/png' as const, data: buf.toString('base64') }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          ok: false,
          result: `Screenshot failed: ${message}. Grant Screen Recording to A.L.B.E.R.T. in System Settings → Privacy & Security.`
        }
      }
    }
  },
  {
    name: 'desktop_click',
    description:
      'Click at screen coordinates (points). Requires Accessibility permission. Use after desktop_screenshot to aim.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        button: {
          type: 'string',
          enum: ['left', 'right'],
          description: 'Default left'
        },
        clicks: { type: 'number', description: '1 or 2 (double-click)' }
      },
      required: ['x', 'y']
    },
    dangerous: true,
    execute: async (args) => {
      const x = Math.round(Number(args.x))
      const y = Math.round(Number(args.y))
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return { ok: false, result: 'x and y are required numbers.' }
      }
      const button = String(args.button || 'left')
      const clicks = Math.min(Math.max(Number(args.clicks || 1), 1), 2)
      const clickCmd =
        button === 'right'
          ? `right click at {${x}, ${y}}`
          : clicks === 2
            ? `double click at {${x}, ${y}}`
            : `click at {${x}, ${y}}`
      const script = `
        tell application "System Events"
          ${clickCmd}
        end tell
      `
      try {
        await execFileAsync('osascript', ['-e', script], { timeout: 10_000 })
        return { ok: true, result: `[DESKTOP] ${clickCmd}` }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          ok: false,
          result: `Click failed: ${message}. Enable Accessibility for A.L.B.E.R.T. in System Settings → Privacy & Security.`
        }
      }
    }
  },
  {
    name: 'desktop_type_text',
    description:
      'Type text into the focused UI via System Events keystrokes. Requires Accessibility. Avoid passwords.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        delayMs: { type: 'number', description: 'Delay between keys (default 8)' }
      },
      required: ['text']
    },
    dangerous: true,
    execute: async (args) => {
      const text = String(args.text ?? '')
      if (!text) return { ok: false, result: 'text is required.' }
      if (text.length > 4000) return { ok: false, result: 'Text too long (max 4000).' }
      const delay = Math.min(Math.max(Number(args.delayMs || 8), 0), 200) / 1000
      const script = `
        tell application "System Events"
          keystroke "${escapeAppleScriptString(text)}"
        end tell
        delay ${delay}
      `
      try {
        await execFileAsync('osascript', ['-e', script], { timeout: 30_000 })
        return {
          ok: true,
          result: `[DESKTOP] Typed ${text.length} characters into focused UI.`
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          ok: false,
          result: `Type failed: ${message}. Enable Accessibility for A.L.B.E.R.T.`
        }
      }
    }
  },
  {
    name: 'desktop_hotkey',
    description:
      'Press a hotkey combo via System Events (e.g. key="c", modifiers=["command"] for copy).',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key character or name (e.g. "c", "return", "escape", "tab")' },
        modifiers: {
          type: 'array',
          items: { type: 'string' },
          description: 'command, option, control, shift'
        }
      },
      required: ['key']
    },
    dangerous: true,
    execute: async (args) => {
      const key = String(args.key ?? '').trim().toLowerCase()
      if (!key) return { ok: false, result: 'key is required.' }
      const mods = Array.isArray(args.modifiers)
        ? args.modifiers.map((m) => String(m).toLowerCase())
        : []
      const using: string[] = []
      if (mods.includes('command') || mods.includes('cmd')) using.push('command down')
      if (mods.includes('option') || mods.includes('alt')) using.push('option down')
      if (mods.includes('control') || mods.includes('ctrl')) using.push('control down')
      if (mods.includes('shift')) using.push('shift down')

      const special: Record<string, string> = {
        return: 'return',
        enter: 'return',
        escape: 'escape',
        esc: 'escape',
        tab: 'tab',
        space: 'space',
        delete: 'delete',
        backspace: 'delete',
        up: 'up arrow',
        down: 'down arrow',
        left: 'left arrow',
        right: 'right arrow'
      }

      const usingClause = using.length ? ` using {${using.join(', ')}}` : ''
      const keyCodes: Record<string, number> = {
        return: 36,
        enter: 36,
        escape: 53,
        esc: 53,
        tab: 48,
        space: 49,
        delete: 51,
        backspace: 51,
        up: 126,
        down: 125,
        left: 123,
        right: 124
      }
      let script: string
      if (special[key] && keyCodes[key] !== undefined) {
        script = `
          tell application "System Events"
            key code ${keyCodes[key]}${usingClause}
          end tell
        `
      } else {
        script = `
          tell application "System Events"
            keystroke "${escapeAppleScriptString(key.slice(0, 1))}"${usingClause}
          end tell
        `
      }

      try {
        await execFileAsync('osascript', ['-e', script], { timeout: 10_000 })
        return {
          ok: true,
          result: `[DESKTOP] hotkey key=${key} modifiers=${mods.join('+') || 'none'}`
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, result: `Hotkey failed: ${message}` }
      }
    }
  },
  {
    name: 'desktop_frontmost_app',
    description: 'Get the frontmost application name (for aiming desktop actions).',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      const script = `
        tell application "System Events"
          return name of first process whose frontmost is true
        end tell
      `
      try {
        const { stdout } = await execFileAsync('osascript', ['-e', script])
        return { ok: true, result: stdout.trim() }
      } catch (err) {
        return { ok: false, result: err instanceof Error ? err.message : String(err) }
      }
    }
  }
]
