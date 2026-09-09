import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { readdir, readFile, stat } from 'fs/promises'
import { join, relative } from 'path'
import { promisify } from 'util'
import type { ProjectPulse, ProjectPulseBranch, ProjectPulseTodo } from '../../shared/types'
import { parseGitLog, parseGitStatus, parseTodoLine, pulseScore } from '../../shared/projectPulseParse'
import { getSettings } from '../config'
import { listActivity } from '../memory/service'
import { getOperationsSnapshot } from '../operations/service'
import { expandPath } from '../tools/paths'

export { parseGitLog, parseGitStatus, parseTodoLine, pulseScore }

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
  'Pods',
  'vendor'
])

const CODE_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.swift',
  '.kt',
  '.java',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.m',
  '.mm',
  '.rb',
  '.php',
  '.md'
])

const STALE_MS = 21 * 24 * 60 * 60 * 1000
const PULSE_TTL_MS = 12_000
const GIT_TIMEOUT_MS = 2200

let cache: ProjectPulse | null = null


async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 256_000
  })
  return stdout.toString()
}

async function collectTodos(root: string): Promise<ProjectPulseTodo[]> {
  const files: string[] = []
  const started = Date.now()

  async function walk(dir: string): Promise<void> {
    if (files.length >= 90 || Date.now() - started > 1800) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (files.length >= 90 || Date.now() - started > 1800) return
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        await walk(full)
      } else if (entry.isFile()) {
        const ext = entry.name.includes('.') ? `.${entry.name.split('.').pop()}` : ''
        if (!CODE_EXT.has(ext)) continue
        files.push(full)
      }
    }
  }

  await walk(root)
  const todos: ProjectPulseTodo[] = []
  for (const file of files) {
    if (todos.length >= 24) break
    try {
      const info = await stat(file)
      if (info.size > 180_000) continue
      const text = await readFile(file, 'utf8')
      const lines = text.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const hit = parseTodoLine(lines[i] || '')
        if (!hit) continue
        todos.push({ path: relative(root, file), line: i + 1, text: hit })
        if (todos.length >= 24) break
      }
    } catch {
      // Skip unreadable files.
    }
  }
  return todos
}

export async function getProjectPulse(force = false): Promise<ProjectPulse> {
  if (!force && cache && Date.now() - cache.generatedAt < PULSE_TTL_MS) return cache

  const folder = getSettings().projectFolder?.trim()
  const ops = getOperationsSnapshot()
  const active =
    ops.missions.find((mission) => mission.state === 'active') ||
    ops.missions.find((mission) => !['complete', 'cancelled'].includes(mission.state)) ||
    null
  const nextStep = active?.steps.find((step) => step.state !== 'complete')?.title || null
  const blocked = ops.missions.filter((mission) => mission.state === 'blocked').length
  const testFailures = listActivity(80)
    .filter(
      (entry) =>
        !entry.ok &&
        /test|lint|typecheck|build|jest|vitest|npm/i.test(`${entry.toolName} ${entry.result}`)
    )
    .slice(0, 5)
    .map((entry) => ({
      toolName: entry.toolName,
      result: String(entry.result || '').slice(0, 220),
      createdAt: entry.createdAt
    }))

  if (!folder) {
    cache = {
      projectFolder: null,
      isGit: false,
      branch: null,
      dirty: [],
      recentCommits: [],
      staleBranches: [],
      todos: [],
      testFailures,
      nextTask: nextStep || 'Set a project folder in Systems to get repo pulse.',
      score: null,
      generatedAt: Date.now(),
      error: 'No project folder configured.'
    }
    return cache
  }

  const root = expandPath(folder)
  const empty: ProjectPulse = {
    projectFolder: root,
    isGit: existsSync(join(root, '.git')),
    branch: null,
    dirty: [],
    recentCommits: [],
    staleBranches: [],
    todos: [],
    testFailures,
    nextTask: nextStep,
    score: pulseScore({
      dirty: 0,
      stale: 0,
      todos: 0,
      failures: testFailures.length,
      blocked
    }),
    generatedAt: Date.now()
  }

  try {
    const [status, branch, log, todos] = await Promise.all([
      empty.isGit ? git(root, ['status', '--porcelain']).catch(() => '') : Promise.resolve(''),
      empty.isGit ? git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '') : Promise.resolve(''),
      empty.isGit
        ? git(root, ['log', '-8', '--pretty=format:%h\t%cr\t%s']).catch(() => '')
        : Promise.resolve(''),
      collectTodos(root)
    ])

    const dirty = parseGitStatus(status)
    const recentCommits = parseGitLog(log)
    let staleBranches: ProjectPulseBranch[] = []
    if (empty.isGit) {
      try {
        const refs = await git(root, [
          'for-each-ref',
          '--sort=-committerdate',
          '--format=%(refname:short)\t%(committerdate:unix)',
          'refs/heads'
        ])
        const now = Math.floor(Date.now() / 1000)
        staleBranches = refs
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const [name, unix] = line.split('\t')
            return { name: name || '', lastCommitAt: Number(unix || 0) * 1000 }
          })
          .filter(
            (row) =>
              row.name &&
              row.name !== branch.trim() &&
              row.lastCommitAt > 0 &&
              now * 1000 - row.lastCommitAt > STALE_MS
          )
          .slice(0, 8)
      } catch {
        staleBranches = []
      }
    }

    cache = {
      ...empty,
      branch: branch.trim() || null,
      dirty,
      recentCommits,
      staleBranches,
      todos,
      nextTask:
        nextStep ||
        todos[0]?.text ||
        (dirty[0] ? `Review ${dirty[0].path}` : empty.isGit ? 'Working tree looks quiet.' : 'No git repo here.'),
      score: pulseScore({
        dirty: dirty.length,
        stale: staleBranches.length,
        todos: todos.length,
        failures: testFailures.length,
        blocked
      })
    }
    return cache
  } catch (err) {
    cache = {
      ...empty,
      error: err instanceof Error ? err.message : String(err),
      nextTask: nextStep || empty.nextTask
    }
    return cache
  }
}
