/**
 * Locate the `codex` CLI.
 *
 * Electron apps launched from Finder inherit a minimal PATH (`/usr/bin:/bin:…`),
 * so the usual install locations have to be probed explicitly or Codex looks
 * "not installed" only when A.L.B.E.R.T. runs as a bundled app.
 */
import { execFileSync } from 'child_process'
import { accessSync, constants, existsSync, openSync, readSync, closeSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { CodexFault } from './protocol'

export const CODEX_INSTALL_HINT =
  'Install it with `npm install -g @openai/codex` (Node 22+), then reopen A.L.B.E.R.T.'

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Directories worth probing, most specific first. */
export function codexSearchDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const dirs: string[] = []
  const explicit = env.ALBERT_CODEX_BIN?.trim()
  if (explicit) dirs.push(explicit.replace(/\/codex$/, ''))

  for (const entry of (env.PATH || '').split(':')) {
    if (entry.trim()) dirs.push(entry)
  }

  const home = env.HOME || homedir()
  dirs.push(
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    join(home, '.local', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.npm-global', 'bin'),
    join(home, '.nvm', 'current', 'bin')
  )

  // Electron's PATH often omits the global npm prefix even when `codex` is there.
  try {
    const prefix = execFileSync('npm', ['prefix', '-g'], {
      encoding: 'utf8',
      timeout: 3_000,
      stdio: ['ignore', 'pipe', 'ignore'],
      env
    }).trim()
    if (prefix) dirs.push(join(prefix, 'bin'))
  } catch {
    // npm missing or too slow — the other probes still run.
  }

  return [...new Set(dirs.filter(Boolean))]
}

let cached: string | null = null

/** Absolute path to the `codex` binary, or null when it isn't installed. */
export function findCodexBinary(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.ALBERT_CODEX_BIN?.trim()
  if (explicit && existsSync(explicit) && isExecutable(explicit)) return explicit
  if (cached && existsSync(cached)) return cached

  for (const dir of codexSearchDirs(env)) {
    const candidate = join(dir, 'codex')
    if (existsSync(candidate) && isExecutable(candidate)) {
      cached = candidate
      return candidate
    }
  }

  // Last resort: ask the user's login shell, which knows nvm/asdf shims.
  try {
    const shell = env.SHELL || '/bin/zsh'
    const found = execFileSync(shell, ['-lic', 'command -v codex'], {
      encoding: 'utf8',
      timeout: 4_000,
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .trim()
      .split('\n')
      .pop()
      ?.trim()
    if (found && existsSync(found) && isExecutable(found)) {
      cached = found
      return found
    }
  } catch {
    // No shell, no codex — fall through to null.
  }

  return null
}

export function requireCodexBinary(env: NodeJS.ProcessEnv = process.env): string {
  const bin = findCodexBinary(env)
  if (!bin) {
    throw new CodexFault(
      'notInstalled',
      `The Codex CLI isn't on this Mac, sir. ${CODEX_INSTALL_HINT}`
    )
  }
  return bin
}

/** Reported by `codex --version`, e.g. "codex-cli 0.153.4" → "0.153.4". */
export function codexVersion(bin = findCodexBinary(), env: NodeJS.ProcessEnv = process.env): string | null {
  if (!bin) return null
  try {
    const spawnEnv = codexSpawnEnv(env)
    const launch = resolveCodexLaunch(bin, spawnEnv)
    const out = execFileSync(launch.command, [...launch.args, '--version'], {
      encoding: 'utf8',
      timeout: 8_000,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: spawnEnv
    })
    return /(\d+\.\d+\.\d+)/.exec(out)?.[1] ?? (out.trim() || null)
  } catch {
    return null
  }
}

/**
 * PATH the bundled app should use for Codex.
 *
 * Finder-launched Electron only inherits `/usr/bin:/bin:/usr/sbin:/sbin`.
 * The Homebrew `codex` shim is `#!/usr/bin/env node`, so without these dirs
 * the child exits 127 even though we found the script itself.
 */
export function codexSpawnEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  // Probe extra dirs without the inherited PATH so Homebrew/nvm win over the
  // stripped Finder PATH (`/usr/bin:/bin`) that cannot see `node`.
  const extras = codexSearchDirs({ ...env, PATH: '' })
  const existing = (env.PATH || process.env.PATH || '').split(':').filter(Boolean)
  return {
    ...process.env,
    ...env,
    PATH: [...new Set([...extras, ...existing])].join(':')
  }
}

let cachedNode: string | null = null

/** Absolute path to a Node 22+ binary Codex's shim can exec. */
export function findNodeBinary(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.ALBERT_NODE_BIN?.trim()
  if (explicit && existsSync(explicit) && isExecutable(explicit)) return explicit
  if (cachedNode && existsSync(cachedNode)) return cachedNode

  for (const dir of codexSearchDirs(env)) {
    const candidate = join(dir, 'node')
    if (existsSync(candidate) && isExecutable(candidate)) {
      cachedNode = candidate
      return candidate
    }
  }
  return null
}

/** True when the file is a `#!/usr/bin/env node` (or similar) script. */
export function looksLikeNodeScript(bin: string): boolean {
  try {
    const fd = openSync(bin, 'r')
    const buf = Buffer.alloc(80)
    const n = readSync(fd, buf, 0, buf.length, 0)
    closeSync(fd)
    const head = buf.slice(0, n).toString('utf8')
    return /^#!.*\bnode\b/.test(head.split('\n')[0] ?? '')
  } catch {
    return false
  }
}

/**
 * How to actually launch the CLI from a GUI app.
 *
 * Prefer `node /path/to/codex.js` over exec'ing the shim so we never depend
 * on `env` finding `node` in a stripped PATH.
 */
export function resolveCodexLaunch(
  bin: string,
  env: NodeJS.ProcessEnv = process.env
): { command: string; args: string[] } {
  if (looksLikeNodeScript(bin)) {
    const node = findNodeBinary(env)
    if (node) return { command: node, args: [bin] }
  }
  return { command: bin, args: [] }
}

/** Test seam — drops the memoized path. */
export function resetCodexBinaryCache(): void {
  cached = null
  cachedNode = null
}
