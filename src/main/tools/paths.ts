import { homedir } from 'os'
import { resolve, normalize, join } from 'path'
import { getSettings } from '../config'

const BLOCKED_PREFIXES = [
  '/System',
  '/usr/sbin',
  '/private/var/db',
  '/Library/Apple',
  '/Library/OSAnalytics'
]

/** Resolve and normalize; expand ~ */
export function expandPath(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return trimmed
  if (trimmed === '~') return homedir()
  if (trimmed.startsWith('~/')) return join(homedir(), trimmed.slice(2))
  return resolve(trimmed)
}

export function assertNotBlocked(fullPath: string): void {
  const full = resolve(fullPath)
  for (const blocked of BLOCKED_PREFIXES) {
    if (full === blocked || full.startsWith(blocked + '/')) {
      throw new Error(`Access to system path is blocked: ${blocked}`)
    }
  }
}

export function assertInsideRoot(targetPath: string, root: string): string {
  const base = resolve(root)
  const full = resolve(targetPath)
  assertNotBlocked(full)
  const prefix = base.endsWith('/') ? base : base + '/'
  if (full !== base && !full.startsWith(prefix)) {
    throw new Error(`Path is outside allowed root: ${base}`)
  }
  return full
}

export function getProjectFolder(): string {
  const folder = getSettings().projectFolder?.trim()
  if (!folder) {
    throw new Error('No project folder configured. Set one in Systems → Project folder.')
  }
  return resolve(expandPath(folder))
}

/** Roots Albert may read/write when god mode is off. */
export function getAllowedRoots(): string[] {
  const settings = getSettings()
  const home = homedir()
  const roots = new Set<string>()

  if (settings.projectFolder?.trim()) {
    roots.add(resolve(expandPath(settings.projectFolder.trim())))
  }

  const extras = (settings.allowedFsRoots || [])
    .map((r) => r.trim())
    .filter(Boolean)
  if (extras.length) {
    for (const r of extras) roots.add(resolve(expandPath(r)))
  } else {
    // Sensible defaults for Tier 2 without god mode
    roots.add(join(home, 'Documents'))
    roots.add(join(home, 'Desktop'))
    roots.add(join(home, 'Downloads'))
  }

  if (settings.godMode) {
    roots.add(home)
    roots.add('/tmp')
    roots.add(join(home, 'Library/Application Support/albert'))
  }

  return [...roots]
}

export function resolveAllowedPath(rawPath: string): string {
  const settings = getSettings()
  const full = expandPath(rawPath)
  assertNotBlocked(full)

  if (settings.godMode) {
    // Still keep writes under home + /tmp unless absolute under an allowed root
    const home = homedir()
    const ok =
      full === home ||
      full.startsWith(home + '/') ||
      full.startsWith('/tmp/') ||
      full === '/tmp'
    if (!ok) {
      throw new Error(
        'Even in god mode, paths must be under your home directory or /tmp. Refuse system-wide writes.'
      )
    }
    return resolve(full)
  }

  const roots = getAllowedRoots()
  for (const root of roots) {
    try {
      return assertInsideRoot(full, root)
    } catch {
      /* try next */
    }
  }
  throw new Error(
    `Path not under allowed roots (${roots.join(', ')}). Enable God mode in Systems for broader access, or add a root.`
  )
}

export function resolveProjectPath(relOrAbs: string): string {
  const project = getProjectFolder()
  const raw = relOrAbs.trim()
  const candidate = raw.startsWith('/') || raw.startsWith('~') ? expandPath(raw) : resolve(project, raw)
  return assertInsideRoot(candidate, project)
}

/** First token allowlist for shell / project commands when god mode is off. */
export const SAFE_COMMAND_ALLOWLIST = new Set([
  'npm',
  'npx',
  'node',
  'tsc',
  'git',
  'rg',
  'grep',
  'find',
  'ls',
  'cat',
  'head',
  'tail',
  'wc',
  'mkdir',
  'touch',
  'cp',
  'mv',
  'rm',
  'echo',
  'pwd',
  'which',
  'pnpm',
  'yarn',
  'bun',
  'python3',
  'python',
  'pip3',
  'pip',
  'cargo',
  'go',
  'make',
  'eslint',
  'prettier',
  'vitest',
  'jest',
  'swift',
  'xcodebuild',
  'screencapture',
  'osascript',
  'open',
  'curl',
  'jq',
  'sed',
  'awk',
  'diff',
  'patch',
  'tar',
  'unzip',
  'zip',
  'chmod',
  'true',
  'false',
  'test',
  'bash',
  'sh',
  'zsh'
])

/** Git subcommands blocked without god mode */
const BLOCKED_GIT_SUB = new Set(['push', 'push --force', 'reset', 'clean', 'filter-branch'])

export function assertCommandAllowed(command: string): void {
  const settings = getSettings()
  if (settings.godMode) return

  const trimmed = command.trim()
  if (!trimmed) throw new Error('Command is empty.')
  if (trimmed.includes('\n') || trimmed.includes(';') || trimmed.includes('&&') || trimmed.includes('||') || trimmed.includes('|') || trimmed.includes('`') || trimmed.includes('$(')) {
    throw new Error(
      'Chained/piped/substituted commands require God mode. Run a single allowlisted command, or enable God mode in Systems.'
    )
  }

  const parts = trimmed.split(/\s+/)
  const bin = parts[0]?.replace(/^.*\//, '') || ''
  if (!SAFE_COMMAND_ALLOWLIST.has(bin)) {
    throw new Error(
      `Command “${bin}” is not allowlisted. Enable God mode in Systems for unrestricted shell, or use an allowlisted tool (npm, git, tsc, rg, …).`
    )
  }

  if (bin === 'rm' && parts.includes('-rf')) {
    throw new Error('rm -rf requires God mode.')
  }
  if (bin === 'git') {
    const sub = parts[1] || ''
    if (sub === 'push' || sub === 'reset' || sub === 'clean') {
      throw new Error(`git ${sub} requires God mode.`)
    }
    if (BLOCKED_GIT_SUB.has(parts.slice(1).join(' '))) {
      throw new Error('That git operation requires God mode.')
    }
  }
  if ((bin === 'bash' || bin === 'sh' || bin === 'zsh') && parts.length > 1) {
    // Allow `bash -c` only in god mode
    throw new Error('Invoking a shell with arguments requires God mode.')
  }
}

export function normalizeRelPath(p: string): string {
  return normalize(p).replace(/^\.\//, '')
}
