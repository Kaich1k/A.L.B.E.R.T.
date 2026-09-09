import { existsSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { albertSourceRoot } from './selfEdit'

const STALE_MS = 15 * 60_000
let holds = 0

export function hmrPauseFile(): string | null {
  const root = albertSourceRoot()
  return root ? join(root, '.albert-hmr-pause') : null
}

export function isLiveHmrPaused(file = hmrPauseFile()): boolean {
  if (!file || !existsSync(file)) return false
  try {
    return Date.now() - statSync(file).mtimeMs < STALE_MS
  } catch {
    return false
  }
}

export function pauseLiveHmr(): void {
  const file = hmrPauseFile()
  if (!file) return
  holds += 1
  writeFileSync(file, `${Date.now()}\n`)
}

export function resumeLiveHmr(force = false): void {
  if (force) holds = 0
  else holds = Math.max(0, holds - 1)
  if (holds > 0) return
  const file = hmrPauseFile()
  if (file && existsSync(file)) {
    try {
      unlinkSync(file)
    } catch {
      /* ignore */
    }
  }
}
