import { execFile } from 'child_process'
import { promisify } from 'util'
import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile
} from 'fs/promises'
import { dirname, join, relative } from 'path'
import { randomBytes } from 'crypto'
import {
  assertCommandAllowed,
  getProjectFolder,
  resolveProjectPath
} from './paths'
import type { ToolDefinition } from './types'

const execFileAsync = promisify(execFile)

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  '.next',
  'coverage',
  '.turbo',
  'Pods'
])

async function walkFiles(
  root: string,
  dir: string,
  out: string[],
  max: number
): Promise<void> {
  if (out.length >= max) return
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (out.length >= max) return
    if (e.name.startsWith('.') && e.name !== '.env.example') continue
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      await walkFiles(root, full, out, max)
    } else if (e.isFile()) {
      out.push(relative(root, full))
    }
  }
}

function matchGlob(relPath: string, pattern: string): boolean {
  // Very small glob: ** / * and suffix patterns
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DS::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DS::/g, '.*')
  return new RegExp(`^${escaped}$`).test(relPath) || new RegExp(`^${escaped}$`).test(relPath.replace(/\\/g, '/'))
}

async function atomicWrite(target: string, content: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  const tmp = join(dirname(target), `.albert-tmp-${randomBytes(8).toString('hex')}`)
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, target)
}

export const projectTools: ToolDefinition[] = [
  {
    name: 'list_project_files',
    description: 'List files/dirs under the configured project folder.',
    parameters: {
      type: 'object',
      properties: {
        subpath: { type: 'string', description: 'Optional relative subfolder' },
        maxEntries: { type: 'number', description: 'Max entries (default 100)' }
      }
    },
    execute: async (args) => {
      try {
        const project = getProjectFolder()
        const subpath = String(args.subpath || '.').trim() || '.'
        const maxEntries = Math.min(Number(args.maxEntries || 100), 400)
        const target =
          subpath === '.' ? project : resolveProjectPath(join(project, subpath))
        const entries = await readdir(target, { withFileTypes: true })
        const lines = entries
          .slice(0, maxEntries)
          .map((e) => `${e.isDirectory() ? 'dir' : 'file'}\t${e.name}`)
        return { ok: true, result: lines.join('\n') || '(empty)' }
      } catch (err) {
        return { ok: false, result: err instanceof Error ? err.message : String(err) }
      }
    }
  },
  {
    name: 'read_project_file',
    description: 'Read a text file under the project folder (max ~400KB). Prefer for coding.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path within the project' }
      },
      required: ['path']
    },
    execute: async (args) => {
      try {
        const rel = String(args.path ?? '').trim()
        if (!rel) return { ok: false, result: 'Path is required.' }
        const target = resolveProjectPath(rel)
        const info = await stat(target)
        if (!info.isFile()) return { ok: false, result: 'Path is not a file.' }
        if (info.size > 400_000) {
          return { ok: false, result: 'File too large (>400KB). Use grep_project or read a smaller slice via shell.' }
        }
        const content = await readFile(target, 'utf8')
        return { ok: true, result: content }
      } catch (err) {
        return { ok: false, result: err instanceof Error ? err.message : String(err) }
      }
    }
  },
  {
    name: 'glob_project',
    description: 'Find files in the project by glob (e.g. src/**/*.ts). Skips node_modules/.git.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob relative to project root' },
        maxEntries: { type: 'number' }
      },
      required: ['pattern']
    },
    execute: async (args) => {
      try {
        const project = getProjectFolder()
        const pattern = String(args.pattern ?? '').trim().replace(/^\.\//, '')
        if (!pattern) return { ok: false, result: 'pattern is required.' }
        const max = Math.min(Number(args.maxEntries || 80), 200)
        const all: string[] = []
        await walkFiles(project, project, all, 8000)
        const hits = all.filter((p) => matchGlob(p, pattern)).slice(0, max)
        return {
          ok: true,
          result: hits.length ? hits.join('\n') : '(no matches)'
        }
      } catch (err) {
        return { ok: false, result: err instanceof Error ? err.message : String(err) }
      }
    }
  },
  {
    name: 'grep_project',
    description: 'Search file contents in the project (ripgrep if available, else slow scan).',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        glob: { type: 'string', description: 'Optional glob filter e.g. *.{ts,tsx}' },
        maxMatches: { type: 'number' },
        caseInsensitive: { type: 'boolean' }
      },
      required: ['query']
    },
    execute: async (args) => {
      try {
        const project = getProjectFolder()
        const query = String(args.query ?? '')
        if (!query) return { ok: false, result: 'query is required.' }
        const max = Math.min(Number(args.maxMatches || 40), 120)
        const glob = args.glob ? String(args.glob) : undefined
        const ci = Boolean(args.caseInsensitive)

        try {
          const rgArgs = ['-n', '--no-heading', '--color', 'never', '-m', String(max)]
          if (ci) rgArgs.push('-i')
          if (glob) rgArgs.push('-g', glob)
          rgArgs.push('--', query, '.')
          const { stdout } = await execFileAsync('rg', rgArgs, {
            cwd: project,
            timeout: 20000,
            maxBuffer: 2_000_000
          })
          return { ok: true, result: stdout.trim() || '(no matches)' }
        } catch (rgErr) {
          const msg = rgErr instanceof Error ? rgErr.message : String(rgErr)
          if (!msg.includes('ENOENT') && !/rg/.test(msg)) {
            // rg found but no matches exits 1
            if ((rgErr as { code?: number }).code === 1) {
              return { ok: true, result: '(no matches)' }
            }
          }
        }

        // Fallback scan
        const files: string[] = []
        await walkFiles(project, project, files, 3000)
        const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), ci ? 'i' : '')
        const lines: string[] = []
        for (const rel of files) {
          if (glob && !matchGlob(rel, glob) && !matchGlob(rel.split('/').pop() || rel, glob)) {
            continue
          }
          if (/\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|eot|mp3|mp4|zip|gz|wasm|onnx)$/i.test(rel)) {
            continue
          }
          try {
            const text = await readFile(join(project, rel), 'utf8')
            const fileLines = text.split(/\r?\n/)
            for (let i = 0; i < fileLines.length; i++) {
              if (re.test(fileLines[i])) {
                lines.push(`${rel}:${i + 1}:${fileLines[i].slice(0, 240)}`)
                if (lines.length >= max) break
              }
            }
          } catch {
            /* skip binary */
          }
          if (lines.length >= max) break
        }
        return { ok: true, result: lines.join('\n') || '(no matches)' }
      } catch (err) {
        return { ok: false, result: err instanceof Error ? err.message : String(err) }
      }
    }
  },
  {
    name: 'write_project_file',
    description:
      'Create or overwrite a file in the project folder. Prefer apply_project_patch for existing files. Logged to Activity.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' }
      },
      required: ['path', 'content']
    },
    dangerous: true,
    execute: async (args) => {
      try {
        const rel = String(args.path ?? '').trim()
        const content = String(args.content ?? '')
        if (!rel) return { ok: false, result: 'Path is required.' }
        if (content.length > 1_500_000) {
          return { ok: false, result: 'Content too large (>1.5MB).' }
        }
        const target = resolveProjectPath(rel)
        await atomicWrite(target, content)
        return {
          ok: true,
          result: `[WRITE] Wrote ${content.length} chars → ${rel}. If you changed the running app, rebuild with npm run update:app (or ask the user to restart).`
        }
      } catch (err) {
        return { ok: false, result: err instanceof Error ? err.message : String(err) }
      }
    }
  },
  {
    name: 'apply_project_patch',
    description:
      'Edit a project file by replacing an exact old_string with new_string (search/replace). Prefer this over write_project_file for surgical edits.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
        replace_all: { type: 'boolean', description: 'Replace every occurrence (default false)' }
      },
      required: ['path', 'old_string', 'new_string']
    },
    dangerous: true,
    execute: async (args) => {
      try {
        const rel = String(args.path ?? '').trim()
        const oldStr = String(args.old_string ?? '')
        const newStr = String(args.new_string ?? '')
        const replaceAll = Boolean(args.replace_all)
        if (!rel) return { ok: false, result: 'Path is required.' }
        if (!oldStr) return { ok: false, result: 'old_string is required.' }
        const target = resolveProjectPath(rel)
        const before = await readFile(target, 'utf8')
        if (!before.includes(oldStr)) {
          return {
            ok: false,
            result: 'old_string not found in file. Re-read the file and retry with exact text.'
          }
        }
        let after: string
        if (replaceAll) {
          after = before.split(oldStr).join(newStr)
        } else {
          const idx = before.indexOf(oldStr)
          after = before.slice(0, idx) + newStr + before.slice(idx + oldStr.length)
        }
        if (before === after) {
          return { ok: false, result: 'Patch produced no change.' }
        }
        await atomicWrite(target, after)
        const count = replaceAll
          ? before.split(oldStr).length - 1
          : 1
        return {
          ok: true,
          result: `[WRITE] Patched ${rel} (${count} replacement${count === 1 ? '' : 's'}). Rebuild/restart if you changed the live app.`
        }
      } catch (err) {
        return { ok: false, result: err instanceof Error ? err.message : String(err) }
      }
    }
  },
  {
    name: 'delete_project_file',
    description: 'Delete a file inside the project folder.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path']
    },
    dangerous: true,
    execute: async (args) => {
      try {
        const rel = String(args.path ?? '').trim()
        const target = resolveProjectPath(rel)
        const info = await stat(target)
        if (!info.isFile()) return { ok: false, result: 'Only files can be deleted with this tool.' }
        await unlink(target)
        return { ok: true, result: `[WRITE] Deleted ${rel}` }
      } catch (err) {
        return { ok: false, result: err instanceof Error ? err.message : String(err) }
      }
    }
  },
  {
    name: 'run_project_command',
    description:
      'Run a shell command with cwd = project folder. Without God mode, only allowlisted single commands (npm, git, tsc, rg, …). Use for tests/builds after edits.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Single command line' },
        timeoutMs: { type: 'number', description: 'Timeout ms (default 60000, max 300000)' }
      },
      required: ['command']
    },
    dangerous: true,
    execute: async (args) => {
      try {
        const command = String(args.command ?? '').trim()
        if (!command) return { ok: false, result: 'command is required.' }
        assertCommandAllowed(command)
        const project = getProjectFolder()
        const timeout = Math.min(Math.max(Number(args.timeoutMs || 60_000), 1000), 300_000)
        const { stdout, stderr } = await execFileAsync('/bin/zsh', ['-lc', command], {
          cwd: project,
          timeout,
          maxBuffer: 4_000_000,
          env: { ...process.env, FORCE_COLOR: '0' }
        })
        const out = [stdout, stderr].filter(Boolean).join('\n').trim()
        return {
          ok: true,
          result: `[EXEC cwd=${project}] ${command}\n${out.slice(0, 12000) || '(no output)'}`
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
