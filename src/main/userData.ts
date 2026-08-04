import { app } from 'electron'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync
} from 'fs'
import { join } from 'path'

/**
 * Stable forever — never derive userData from package.json name/productName.
 * Renaming the npm package or Electron productName must not wipe settings/chat.
 */
export const STABLE_USER_DATA_DIRNAME = 'albert'

/**
 * Pin userData before app.ready, and pull settings/DB forward from any
 * legacy folders created when package/product names changed.
 */
export function initStableUserData(): string {
  const appData = app.getPath('appData')
  const stable = join(appData, STABLE_USER_DATA_DIRNAME)
  mkdirSync(stable, { recursive: true })
  app.setPath('userData', stable)

  migrateAlbertData(stable, [
    join(appData, 'a.l.b.e.r.t'),
    join(appData, 'ALBERT'),
    join(appData, 'A.L.B.E.R.T'),
    join(appData, 'A.L.B.E.R.T.')
  ])

  return stable
}

function dataDir(root: string): string {
  return join(root, 'albert-data')
}

function migrateAlbertData(stableRoot: string, legacyRoots: string[]): void {
  const dest = dataDir(stableRoot)
  mkdirSync(dest, { recursive: true })

  const destSettings = join(dest, 'settings.json')
  const destDb = join(dest, 'albert.sqlite')

  for (const root of legacyRoots) {
    if (!existsSync(root) || root === stableRoot) continue
    const src = dataDir(root)
    if (!existsSync(src)) continue

    const srcSettings = join(src, 'settings.json')
    if (existsSync(srcSettings) && !hasUsableSettings(destSettings)) {
      copyFileSync(srcSettings, destSettings)
    }

    const srcDb = join(src, 'albert.sqlite')
    if (existsSync(srcDb) && shouldReplaceDb(destDb, srcDb)) {
      for (const name of ['albert.sqlite', 'albert.sqlite-wal', 'albert.sqlite-shm']) {
        const from = join(src, name)
        const to = join(dest, name)
        if (existsSync(from)) copyFileSync(from, to)
        else if (name !== 'albert.sqlite' && existsSync(to)) rmSync(to, { force: true })
      }
    }

    for (const name of readdirSync(src)) {
      if (name.startsWith('albert.sqlite') || name === 'settings.json') continue
      const from = join(src, name)
      const to = join(dest, name)
      if (!existsSync(to) && statSync(from).isFile()) copyFileSync(from, to)
    }
  }
}

function hasUsableSettings(path: string): boolean {
  if (!existsSync(path)) return false
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { anthropicApiKey?: string }
    return Boolean(raw.anthropicApiKey?.trim())
  } catch {
    return false
  }
}

function shouldReplaceDb(dest: string, src: string): boolean {
  if (!existsSync(dest)) return true
  try {
    const destSize = statSync(dest).size
    const srcSize = statSync(src).size
    // Never clobber a larger (more complete) database with a smaller empty one
    if (srcSize <= destSize) return false
    if (destSize < 1024 && srcSize > destSize) return true
    return srcSize > destSize * 1.25
  } catch {
    return false
  }
}

// Side effect: pin path as soon as this module is imported.
initStableUserData()
