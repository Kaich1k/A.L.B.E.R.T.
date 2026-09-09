import { v4 as uuid } from 'uuid'
import type { MissionArtifact } from '../../shared/types'
import { getDb } from '../memory/db'

export function listArtifacts(limit = 80): MissionArtifact[] {
  return getDb()
    .prepare(
      `SELECT id, mission_id as missionId, kind, title, body, source, version, created_at as createdAt
       FROM mission_artifacts ORDER BY created_at DESC LIMIT ?`
    )
    .all(limit) as MissionArtifact[]
}

export function saveArtifact(input: {
  title: string
  body: string
  kind?: string
  source?: string
  missionId?: string
}): MissionArtifact {
  const title = input.title.trim() || 'Untitled artifact'
  const body = String(input.body || '')
  const kind = (input.kind || 'note').trim() || 'note'
  const now = Date.now()
  const prior = getDb()
    .prepare(
      `SELECT version FROM mission_artifacts WHERE title = ? AND kind = ? ORDER BY version DESC LIMIT 1`
    )
    .get(title, kind) as { version: number } | undefined
  const version = (prior?.version || 0) + 1
  const id = uuid()
  getDb()
    .prepare(
      `INSERT INTO mission_artifacts (id, mission_id, kind, title, body, source, version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, input.missionId || null, kind, title, body, input.source || 'session', version, now)
  return {
    id,
    missionId: input.missionId,
    kind,
    title,
    body,
    source: input.source || 'session',
    version,
    createdAt: now
  }
}

export function getArtifact(id: string): MissionArtifact | null {
  return (
    (getDb()
      .prepare(
        `SELECT id, mission_id as missionId, kind, title, body, source, version, created_at as createdAt
         FROM mission_artifacts WHERE id = ?`
      )
      .get(id) as MissionArtifact | undefined) || null
  )
}
