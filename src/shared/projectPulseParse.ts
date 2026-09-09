import type { ProjectPulseChange, ProjectPulseCommit } from './types'

export function parseGitStatus(porcelain: string): ProjectPulseChange[] {
  return porcelain
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length >= 4)
    .map((line) => ({
      status: line.slice(0, 2).trim() || line.slice(0, 1),
      path: line.slice(3).trim()
    }))
    .filter((row) => row.path)
    .slice(0, 40)
}

export function parseGitLog(raw: string): ProjectPulseCommit[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [hash = '', date = '', ...rest] = line.split('\t')
      return { hash: hash.slice(0, 7), date, subject: rest.join('\t').slice(0, 140) }
    })
    .filter((row) => row.hash && row.subject)
    .slice(0, 8)
}

export function parseTodoLine(line: string): string | null {
  const match = line.match(/\b(TODO|FIXME|XXX|HACK)\b[:\s-]*(.*)$/i)
  if (!match) return null
  const text = `${match[1]} ${String(match[2] || '').trim()}`.trim()
  return text.length > 4 ? text.slice(0, 160) : null
}

export function pulseScore(input: {
  dirty: number
  stale: number
  todos: number
  failures: number
  blocked: number
}): number {
  return Math.max(
    12,
    Math.min(
      99,
      94 - input.dirty * 2 - input.stale * 4 - Math.min(input.todos, 12) - input.failures * 8 - input.blocked * 10
    )
  )
}
