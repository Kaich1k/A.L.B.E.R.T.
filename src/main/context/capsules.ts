import { execFile } from 'child_process'
import { promisify } from 'util'
import { v4 as uuid } from 'uuid'
import type { ContextCapsule, ContextCapsuleTab, PanelId } from '../../shared/types'
import { getSettings } from '../config'
import { getComputerState, openComputerTab } from '../computer/tabs'
import { getDb } from '../memory/db'
import { getOperationsSnapshot } from '../operations/service'

const execFileAsync = promisify(execFile)
const MAX_CAPSULES = 40
const MAX_TABS = 8

export interface CapsuleCaptureInput {
  title?: string
  notes?: string
  panel?: string
  missionId?: string
}

let pendingResumeNote = ''

export function consumePendingResumeNote(): string {
  const note = pendingResumeNote
  pendingResumeNote = ''
  return note
}

export function peekPendingResumeNote(): string {
  return pendingResumeNote
}

function rowToCapsule(row: {
  id: string
  title: string
  notes: string
  panel: string
  mission_id: string | null
  mission_title: string | null
  project_folder: string | null
  tabs_json: string
  apps_json: string
  created_at: number
  last_restored_at: number | null
}): ContextCapsule {
  let tabs: ContextCapsuleTab[] = []
  let apps: string[] = []
  try {
    const parsed = JSON.parse(row.tabs_json || '[]')
    if (Array.isArray(parsed)) {
      tabs = parsed
        .map((tab) => ({
          title: String((tab as ContextCapsuleTab)?.title || ''),
          url: String((tab as ContextCapsuleTab)?.url || '')
        }))
        .filter((tab) => tab.url)
    }
  } catch {
    tabs = []
  }
  try {
    const parsed = JSON.parse(row.apps_json || '[]')
    if (Array.isArray(parsed)) apps = parsed.map(String).filter(Boolean).slice(0, 12)
  } catch {
    apps = []
  }
  return {
    id: row.id,
    title: row.title,
    notes: row.notes || '',
    panel: row.panel || 'conversation',
    missionId: row.mission_id || undefined,
    missionTitle: row.mission_title || undefined,
    projectFolder: row.project_folder || undefined,
    tabs,
    apps,
    createdAt: row.created_at,
    lastRestoredAt: row.last_restored_at || undefined
  }
}

export function listCapsules(): ContextCapsule[] {
  return (
    getDb()
      .prepare(
        `SELECT id, title, notes, panel, mission_id, mission_title, project_folder,
                tabs_json, apps_json, created_at, last_restored_at
         FROM context_capsules ORDER BY created_at DESC LIMIT ?`
      )
      .all(MAX_CAPSULES) as Array<Parameters<typeof rowToCapsule>[0]>
  ).map(rowToCapsule)
}

export function getCapsule(id: string): ContextCapsule | null {
  const row = getDb()
    .prepare(
      `SELECT id, title, notes, panel, mission_id, mission_title, project_folder,
              tabs_json, apps_json, created_at, last_restored_at
       FROM context_capsules WHERE id = ?`
    )
    .get(id) as Parameters<typeof rowToCapsule>[0] | undefined
  return row ? rowToCapsule(row) : null
}

export function findCapsule(query: string): ContextCapsule | null {
  const needle = query.trim().toLowerCase()
  if (!needle) return null
  const all = listCapsules()
  return (
    all.find((capsule) => capsule.title.toLowerCase() === needle) ||
    all.find((capsule) => capsule.title.toLowerCase().includes(needle)) ||
    all.find((capsule) => `${capsule.notes} ${capsule.missionTitle || ''}`.toLowerCase().includes(needle)) ||
    null
  )
}

async function listFrontApps(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      'osascript',
      ['-e', 'tell application "System Events" to get name of every process whose background only is false'],
      { timeout: 1500, maxBuffer: 64_000 }
    )
    return stdout
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name && !/^(Finder|ALBERT|Electron|WindowServer)$/i.test(name))
      .slice(0, 10)
  } catch {
    return []
  }
}

export async function captureCapsule(input: CapsuleCaptureInput = {}): Promise<ContextCapsule> {
  const computer = getComputerState()
  const ops = getOperationsSnapshot()
  const mission =
    (input.missionId ? ops.missions.find((item) => item.id === input.missionId) : null) ||
    ops.missions.find((item) => item.state === 'active') ||
    ops.missions.find((item) => !['complete', 'cancelled'].includes(item.state)) ||
    null
  const title =
    input.title?.trim() ||
    mission?.title ||
    `Session ${new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
  const capsule: ContextCapsule = {
    id: uuid(),
    title,
    notes: (input.notes || '').trim(),
    panel: input.panel || 'conversation',
    missionId: mission?.id,
    missionTitle: mission?.title,
    projectFolder: getSettings().projectFolder?.trim() || undefined,
    tabs: computer.tabs.slice(0, MAX_TABS).map((tab) => ({
      title: tab.title || tab.url,
      url: tab.url
    })),
    apps: await listFrontApps(),
    createdAt: Date.now()
  }

  getDb()
    .prepare(
      `INSERT INTO context_capsules
        (id, title, notes, panel, mission_id, mission_title, project_folder, tabs_json, apps_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      capsule.id,
      capsule.title,
      capsule.notes,
      capsule.panel,
      capsule.missionId ?? null,
      capsule.missionTitle ?? null,
      capsule.projectFolder ?? null,
      JSON.stringify(capsule.tabs),
      JSON.stringify(capsule.apps),
      capsule.createdAt
    )

  const count = getDb().prepare('SELECT COUNT(*) as n FROM context_capsules').get() as { n: number }
  const overflow = count.n - MAX_CAPSULES
  if (overflow > 0) {
    getDb()
      .prepare(
        `DELETE FROM context_capsules WHERE id IN (
           SELECT id FROM context_capsules ORDER BY created_at ASC LIMIT ?
         )`
      )
      .run(overflow)
  }

  return capsule
}

export function importLegacyCapsules(raw: unknown): number {
  if (!Array.isArray(raw)) return 0
  let imported = 0
  const insert = getDb().prepare(
    `INSERT OR IGNORE INTO context_capsules
      (id, title, notes, panel, mission_id, mission_title, project_folder, tabs_json, apps_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const item of raw) {
    const row = item as Partial<ContextCapsule>
    if (!row || typeof row !== 'object') continue
    const title = String(row.title || '').trim()
    if (!title) continue
    insert.run(
      String(row.id || uuid()),
      title,
      String(row.notes || ''),
      String(row.panel || 'conversation'),
      row.missionId || null,
      row.missionTitle || null,
      row.projectFolder || null,
      JSON.stringify(Array.isArray(row.tabs) ? row.tabs : []),
      JSON.stringify(Array.isArray(row.apps) ? row.apps : []),
      Number(row.createdAt) || Date.now()
    )
    imported += 1
  }
  return imported
}

export async function restoreCapsule(idOrQuery: string): Promise<{
  capsule: ContextCapsule | null
  reply: string
}> {
  const capsule = getCapsule(idOrQuery) || findCapsule(idOrQuery)
  if (!capsule) {
    return {
      capsule: null,
      reply: `I don't have a context capsule matching “${idOrQuery}”, sir.`
    }
  }

  for (const tab of capsule.tabs.slice(0, MAX_TABS)) {
    try {
      openComputerTab(tab.url, tab.title)
    } catch {
      // A dead tab should not abort the rest of the restore.
    }
  }

  getDb()
    .prepare('UPDATE context_capsules SET last_restored_at = ? WHERE id = ?')
    .run(Date.now(), capsule.id)

  const bits = [
    `Restored “${capsule.title}”, sir.`,
    capsule.missionTitle ? `Mission: ${capsule.missionTitle}.` : '',
    capsule.tabs.length ? `${capsule.tabs.length} Computer tab${capsule.tabs.length === 1 ? '' : 's'} reopened.` : '',
    capsule.projectFolder ? `Project stays ${capsule.projectFolder}.` : '',
    capsule.notes ? `Note: ${capsule.notes}` : ''
  ].filter(Boolean)

  pendingResumeNote = [
    `Kai just restored context capsule “${capsule.title}”.`,
    capsule.missionTitle ? `Resume mission: ${capsule.missionTitle}.` : '',
    capsule.projectFolder ? `Project folder: ${capsule.projectFolder}.` : '',
    capsule.tabs.length
      ? `Open Computer tabs: ${capsule.tabs.map((tab) => tab.title || tab.url).join(', ')}.`
      : '',
    capsule.notes ? `Operator note: ${capsule.notes}` : '',
    'Continue from this operating position. Do not claim you changed the project folder unless a tool did.'
  ]
    .filter(Boolean)
    .join(' ')

  return { capsule: { ...capsule, lastRestoredAt: Date.now() }, reply: bits.join(' ') }
}

export function deleteCapsule(id: string): boolean {
  return getDb().prepare('DELETE FROM context_capsules WHERE id = ?').run(id).changes > 0
}

export function describeCapsule(capsule: ContextCapsule): string {
  const tabs = capsule.tabs.length ? `${capsule.tabs.length} tabs` : 'no tabs'
  const mission = capsule.missionTitle ? ` · ${capsule.missionTitle}` : ''
  return `${capsule.title}${mission} · ${tabs}`
}

export function isPanelId(value: string): value is PanelId {
  return ['home', 'conversation', 'missions', 'memory', 'activity', 'settings'].includes(value)
}
