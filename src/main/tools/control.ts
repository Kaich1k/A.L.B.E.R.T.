import { readdir, readFile, stat } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { matchNamePrefix } from '../../shared/computerIntent'
import { getAllowedRoots, resolveAllowedPath } from './paths'
import { automationEpoch, computerWorkStale } from '../computer/automation'
import type { ToolDefinition } from './types'

const execFileAsync = promisify(execFile)

async function osascript(script: string): Promise<string> {
  const epoch = automationEpoch()
  const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 12_000 })
  if (computerWorkStale(epoch)) throw new Error('Automation stopped.')
  return stdout.trim()
}

export const controlTools: ToolDefinition[] = [
  {
    name: 'activate_app',
    description: 'Bring an application to the front. Opens it if it is not running.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name']
    },
    execute: async (args) => {
      const name = String(args.name || '').trim()
      if (!name) return { ok: false, result: 'App name is required.' }
      try {
        await execFileAsync('open', ['-a', name], { timeout: 8_000 })
        const front = await osascript('tell application "System Events" to return name of first process whose frontmost is true')
        const ok = front.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(front.toLowerCase())
        return {
          ok,
          result: ok
            ? `${front} is frontmost.`
            : `Tried to open ${name}, but the frontmost app is ${front}. I am not claiming it is focused.`
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, result: `Could not activate ${name}: ${message}` }
      }
    }
  },
  {
    name: 'find_files',
    description:
      'Find files under allowed roots (Downloads by default) whose names start with a prefix. Does not delete or modify them.',
    parameters: {
      type: 'object',
      properties: {
        prefix: { type: 'string' },
        root: { type: 'string', description: 'Optional directory. Defaults to ~/Downloads when that root is allowed.' }
      },
      required: ['prefix']
    },
    execute: async (args) => {
      const prefix = String(args.prefix || '').trim()
      if (!prefix) return { ok: false, result: 'Prefix is required.' }
      try {
        const downloads = join(homedir(), 'Downloads')
        const allowed = getAllowedRoots()
        const requested = String(args.root || '').trim()
        const root = requested
          ? resolveAllowedPath(requested)
          : allowed.includes(downloads)
            ? downloads
            : allowed[0]
        if (!root) return { ok: false, result: 'No allowed folder is configured.' }
        const entries = await readdir(root)
        const matches = matchNamePrefix(entries, prefix)
        if (!matches.length) {
          return { ok: true, result: `No file in ${root} begins with “${prefix}”.` }
        }
        const details: string[] = []
        for (const name of matches.slice(0, 8)) {
          const full = join(root, name)
          const info = await stat(full)
          let preview = ''
          if (info.isFile() && info.size > 0 && info.size < 80_000) {
            const text = await readFile(full, 'utf8').catch(() => '')
            if (text && !text.includes('\u0000')) preview = ` — ${text.replace(/\s+/g, ' ').trim().slice(0, 240)}`
          }
          details.push(`${name} (${info.isDirectory() ? 'dir' : `${info.size} bytes`})${preview}`)
        }
        return { ok: true, result: `In ${root}: ${details.join(' | ')}` }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, result: message }
      }
    }
  }
]
