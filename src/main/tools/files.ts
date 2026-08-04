import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { randomBytes } from 'crypto'
import { getAllowedRoots, resolveAllowedPath } from './paths'
import type { ToolDefinition } from './types'

async function atomicWrite(target: string, content: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  const tmp = join(dirname(target), `.albert-tmp-${randomBytes(8).toString('hex')}`)
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, target)
}

export const fileTools: ToolDefinition[] = [
  {
    name: 'list_allowed_roots',
    description:
      'List filesystem roots Albert may access right now (project + Documents/Desktop/Downloads, or home when God mode is on).',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      const roots = getAllowedRoots()
      return {
        ok: true,
        result: roots.length ? roots.join('\n') : '(no roots — set project folder or enable God mode)'
      }
    }
  },
  {
    name: 'list_dir',
    description: 'List a directory under allowed roots (or home in God mode).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        maxEntries: { type: 'number' }
      },
      required: ['path']
    },
    execute: async (args) => {
      try {
        const target = resolveAllowedPath(String(args.path ?? ''))
        const max = Math.min(Number(args.maxEntries || 100), 400)
        const entries = await readdir(target, { withFileTypes: true })
        const lines = entries
          .slice(0, max)
          .map((e) => `${e.isDirectory() ? 'dir' : 'file'}\t${e.name}`)
        return { ok: true, result: lines.join('\n') || '(empty)' }
      } catch (err) {
        return { ok: false, result: err instanceof Error ? err.message : String(err) }
      }
    }
  },
  {
    name: 'read_file',
    description: 'Read a text file under allowed roots (max ~400KB). Use read_project_file for the project when possible.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path']
    },
    execute: async (args) => {
      try {
        const target = resolveAllowedPath(String(args.path ?? ''))
        const info = await stat(target)
        if (!info.isFile()) return { ok: false, result: 'Not a file.' }
        if (info.size > 400_000) return { ok: false, result: 'File too large (>400KB).' }
        return { ok: true, result: await readFile(target, 'utf8') }
      } catch (err) {
        return { ok: false, result: err instanceof Error ? err.message : String(err) }
      }
    }
  },
  {
    name: 'write_file',
    description:
      'Create/overwrite a text file under allowed roots. Prefer apply_project_patch / write_project_file inside the project. Logged to Activity.',
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
        const target = resolveAllowedPath(String(args.path ?? ''))
        const content = String(args.content ?? '')
        if (content.length > 1_500_000) {
          return { ok: false, result: 'Content too large (>1.5MB).' }
        }
        await atomicWrite(target, content)
        return { ok: true, result: `[WRITE] Wrote ${content.length} chars → ${target}` }
      } catch (err) {
        return { ok: false, result: err instanceof Error ? err.message : String(err) }
      }
    }
  },
  {
    name: 'apply_patch',
    description: 'Search/replace edit for a file under allowed roots (exact old_string → new_string).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
        replace_all: { type: 'boolean' }
      },
      required: ['path', 'old_string', 'new_string']
    },
    dangerous: true,
    execute: async (args) => {
      try {
        const target = resolveAllowedPath(String(args.path ?? ''))
        const oldStr = String(args.old_string ?? '')
        const newStr = String(args.new_string ?? '')
        if (!oldStr) return { ok: false, result: 'old_string is required.' }
        const before = await readFile(target, 'utf8')
        if (!before.includes(oldStr)) {
          return { ok: false, result: 'old_string not found.' }
        }
        const after = Boolean(args.replace_all)
          ? before.split(oldStr).join(newStr)
          : before.replace(oldStr, newStr)
        await atomicWrite(target, after)
        return { ok: true, result: `[WRITE] Patched ${target}` }
      } catch (err) {
        return { ok: false, result: err instanceof Error ? err.message : String(err) }
      }
    }
  },
  {
    name: 'delete_file',
    description: 'Delete a file under allowed roots.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path']
    },
    dangerous: true,
    execute: async (args) => {
      try {
        const target = resolveAllowedPath(String(args.path ?? ''))
        const info = await stat(target)
        if (!info.isFile()) return { ok: false, result: 'Only files can be deleted.' }
        await unlink(target)
        return { ok: true, result: `[WRITE] Deleted ${target}` }
      } catch (err) {
        return { ok: false, result: err instanceof Error ? err.message : String(err) }
      }
    }
  }
]
