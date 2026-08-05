import { v4 as uuid } from 'uuid'
import type {
  ApprovalRequest,
  CaptureItem,
  Mission,
  MissionPriority,
  MissionState,
  MissionStep,
  OperationsSnapshot,
  Routine
} from '../../shared/types'
import { getDb } from '../memory/db'

type MissionRow = Omit<Mission, 'steps' | 'deadline' | 'budgetCents'> & {
  deadline: number | null
  budgetCents: number | null
}
type StepRow = Omit<MissionStep, 'toolArgs'> & { toolArgs: string | null }

function event(entityType: string, entityId: string, eventType: string, detail = ''): void {
  getDb().prepare(
    `INSERT INTO operation_events (id, entity_type, entity_id, event_type, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(uuid(), entityType, entityId, eventType, detail, Date.now())
}

function stepsFor(missionId: string): MissionStep[] {
  const rows = getDb().prepare(
    `SELECT id, mission_id as missionId, position, title, state, tool_name as toolName,
            tool_args as toolArgs, result, verification, created_at as createdAt, updated_at as updatedAt
     FROM mission_steps WHERE mission_id = ? ORDER BY position ASC`
  ).all(missionId) as StepRow[]
  return rows.map((row) => ({
    ...row,
    toolName: row.toolName || undefined,
    toolArgs: row.toolArgs ? JSON.parse(row.toolArgs) as Record<string, unknown> : undefined,
    result: row.result || undefined,
    verification: row.verification || undefined
  }))
}

export function listMissions(): Mission[] {
  const rows = getDb().prepare(
    `SELECT id, title, outcome, state, priority, progress, deadline,
            budget_cents as budgetCents, risk, source, created_at as createdAt, updated_at as updatedAt
     FROM missions ORDER BY
       CASE state WHEN 'approval' THEN 0 WHEN 'active' THEN 1 WHEN 'blocked' THEN 2 ELSE 3 END,
       updated_at DESC`
  ).all() as MissionRow[]
  return rows.map((row) => ({
    ...row,
    deadline: row.deadline ?? undefined,
    budgetCents: row.budgetCents ?? undefined,
    steps: stepsFor(row.id)
  }))
}

export function createMission(input: {
  title: string
  outcome?: string
  priority?: MissionPriority
  deadline?: number
  risk?: Mission['risk']
  source?: Mission['source']
  steps?: string[]
}): Mission {
  const title = input.title.trim()
  if (!title) throw new Error('Mission title is required.')
  const now = Date.now()
  const id = uuid()
  const stepTitles = (input.steps || []).map((step) => step.trim()).filter(Boolean).slice(0, 20)
  const transaction = getDb().transaction(() => {
    getDb().prepare(
      `INSERT INTO missions (id, title, outcome, state, priority, progress, deadline, budget_cents, risk, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, NULL, ?, ?, ?, ?)`
    ).run(id, title, input.outcome?.trim() || title, stepTitles.length ? 'queued' : 'draft', input.priority || 'normal', input.deadline ?? null, input.risk || 'prepare', input.source || 'user', now, now)
    const insert = getDb().prepare(
      `INSERT INTO mission_steps (id, mission_id, position, title, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`
    )
    stepTitles.forEach((step, index) => insert.run(uuid(), id, index, step, now, now))
  })
  transaction()
  event('mission', id, 'created', title)
  return listMissions().find((mission) => mission.id === id)!
}

export function updateMission(id: string, patch: Partial<Pick<Mission, 'title' | 'outcome' | 'state' | 'priority' | 'progress' | 'deadline' | 'budgetCents' | 'risk'>>): Mission | null {
  const current = listMissions().find((mission) => mission.id === id)
  if (!current) return null
  const next = {
    ...current,
    title: patch.title ?? current.title,
    outcome: patch.outcome ?? current.outcome,
    state: patch.state ?? current.state,
    priority: patch.priority ?? current.priority,
    progress: Math.max(0, Math.min(100, patch.progress ?? current.progress)),
    deadline: patch.deadline ?? current.deadline,
    budgetCents: patch.budgetCents ?? current.budgetCents,
    risk: patch.risk ?? current.risk,
    updatedAt: Date.now()
  }
  getDb().prepare(
    `UPDATE missions SET title=?, outcome=?, state=?, priority=?, progress=?, deadline=?, budget_cents=?, risk=?, updated_at=? WHERE id=?`
  ).run(next.title.trim(), next.outcome.trim(), next.state, next.priority, next.progress, next.deadline ?? null, next.budgetCents ?? null, next.risk, next.updatedAt, id)
  event('mission', id, 'updated', JSON.stringify(patch))
  return listMissions().find((mission) => mission.id === id) ?? null
}

export function deleteMission(id: string): boolean {
  const transaction = getDb().transaction(() => {
    getDb().prepare('DELETE FROM mission_steps WHERE mission_id = ?').run(id)
    getDb().prepare('DELETE FROM approvals WHERE mission_id = ?').run(id)
    return getDb().prepare('DELETE FROM missions WHERE id = ?').run(id).changes > 0
  })
  const removed = transaction()
  if (removed) event('mission', id, 'deleted')
  return removed
}

export function addMissionStep(missionId: string, title: string): MissionStep {
  const clean = title.trim()
  if (!clean) throw new Error('Step title is required.')
  const mission = listMissions().find((item) => item.id === missionId)
  if (!mission) throw new Error('Mission not found.')
  const now = Date.now()
  const id = uuid()
  getDb().prepare(
    `INSERT INTO mission_steps (id, mission_id, position, title, state, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)`
  ).run(id, missionId, mission.steps.length, clean, now, now)
  updateMission(missionId, { state: mission.state === 'draft' ? 'queued' : mission.state })
  event('mission', missionId, 'step_added', clean)
  return stepsFor(missionId).find((step) => step.id === id)!
}

export function updateMissionStep(id: string, patch: Partial<Pick<MissionStep, 'title' | 'state' | 'result' | 'verification'>>): MissionStep | null {
  const row = getDb().prepare(`SELECT mission_id as missionId FROM mission_steps WHERE id=?`).get(id) as { missionId: string } | undefined
  if (!row) return null
  const current = stepsFor(row.missionId).find((step) => step.id === id)!
  const next = {
    ...current,
    title: patch.title ?? current.title,
    state: patch.state ?? current.state,
    result: patch.result ?? current.result,
    verification: patch.verification ?? current.verification,
    updatedAt: Date.now()
  }
  getDb().prepare(`UPDATE mission_steps SET title=?, state=?, result=?, verification=?, updated_at=? WHERE id=?`)
    .run(next.title, next.state, next.result ?? null, next.verification ?? null, next.updatedAt, id)
  const steps = stepsFor(row.missionId)
  const complete = steps.filter((step) => step.state === 'complete' || step.state === 'skipped').length
  const progress = steps.length ? Math.round((complete / steps.length) * 100) : 0
  const state: MissionState = progress === 100 ? 'complete' : next.state === 'approval' ? 'approval' : next.state === 'active' ? 'active' : (listMissions().find((m) => m.id === row.missionId)?.state || 'queued')
  updateMission(row.missionId, { progress, state })
  event('mission', row.missionId, 'step_updated', JSON.stringify({ id, ...patch }))
  return stepsFor(row.missionId).find((step) => step.id === id) ?? null
}

function nextRun(schedule: string, from = Date.now()): number | undefined {
  const interval = schedule.match(/^every\s+(\d+)\s*(minute|minutes|hour|hours)$/i)
  if (interval) return from + Number(interval[1]) * (interval[2].toLowerCase().startsWith('hour') ? 3_600_000 : 60_000)
  const daily = schedule.match(/^(?:daily\s+)?(?:at\s+)?(\d{1,2}):(\d{2})$/i)
  if (daily) {
    const date = new Date(from)
    date.setHours(Number(daily[1]), Number(daily[2]), 0, 0)
    if (date.getTime() <= from) date.setDate(date.getDate() + 1)
    return date.getTime()
  }
  return undefined
}

export function listRoutines(): Routine[] {
  const rows = getDb().prepare(
    `SELECT id, name, prompt, schedule, enabled, quiet_start as quietStart, quiet_end as quietEnd,
            last_run_at as lastRunAt, next_run_at as nextRunAt, created_at as createdAt, updated_at as updatedAt
     FROM routines ORDER BY enabled DESC, next_run_at ASC, created_at DESC`
  ).all() as Array<Omit<Routine, 'enabled'> & { enabled: number }>
  return rows.map((row) => ({ ...row, enabled: Boolean(row.enabled), quietStart: row.quietStart || undefined, quietEnd: row.quietEnd || undefined, lastRunAt: row.lastRunAt || undefined, nextRunAt: row.nextRunAt || undefined }))
}

export function createRoutine(input: { name: string; prompt: string; schedule: string; enabled?: boolean }): Routine {
  if (!input.name.trim() || !input.prompt.trim() || !input.schedule.trim()) throw new Error('Name, action, and schedule are required.')
  const now = Date.now()
  const id = uuid()
  getDb().prepare(
    `INSERT INTO routines (id,name,prompt,schedule,enabled,next_run_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`
  ).run(id, input.name.trim(), input.prompt.trim(), input.schedule.trim(), input.enabled === false ? 0 : 1, nextRun(input.schedule, now) ?? null, now, now)
  event('routine', id, 'created', input.name)
  return listRoutines().find((routine) => routine.id === id)!
}

export function updateRoutine(id: string, patch: Partial<Pick<Routine, 'name' | 'prompt' | 'schedule' | 'enabled'>>): Routine | null {
  const current = listRoutines().find((routine) => routine.id === id)
  if (!current) return null
  const next = {
    ...current,
    name: patch.name ?? current.name,
    prompt: patch.prompt ?? current.prompt,
    schedule: patch.schedule ?? current.schedule,
    enabled: patch.enabled ?? current.enabled,
    updatedAt: Date.now()
  }
  getDb().prepare(`UPDATE routines SET name=?,prompt=?,schedule=?,enabled=?,next_run_at=?,updated_at=? WHERE id=?`)
    .run(next.name, next.prompt, next.schedule, next.enabled ? 1 : 0, next.enabled ? (nextRun(next.schedule) ?? null) : null, next.updatedAt, id)
  event('routine', id, 'updated', JSON.stringify(patch))
  return listRoutines().find((routine) => routine.id === id) ?? null
}

export function deleteRoutine(id: string): boolean {
  const removed = getDb().prepare('DELETE FROM routines WHERE id=?').run(id).changes > 0
  if (removed) event('routine', id, 'deleted')
  return removed
}

export function listApprovals(): ApprovalRequest[] {
  return getDb().prepare(
    `SELECT id, mission_id as missionId, title, description, action_label as actionLabel, risk, preview,
            state, created_at as createdAt, COALESCE(updated_at, resolved_at, created_at) as updatedAt,
            resolved_at as resolvedAt FROM approvals ORDER BY state='pending' DESC, created_at DESC`
  ).all() as ApprovalRequest[]
}

export function createApproval(input: Omit<ApprovalRequest, 'id' | 'state' | 'createdAt' | 'updatedAt' | 'resolvedAt'>): ApprovalRequest {
  const id = uuid(); const now = Date.now()
  getDb().prepare(`INSERT INTO approvals (id,mission_id,title,description,action_label,risk,preview,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'pending',?,?)`)
    .run(id, input.missionId ?? null, input.title, input.description, input.actionLabel, input.risk, input.preview ?? null, now, now)
  if (input.missionId) updateMission(input.missionId, { state: 'approval' })
  event('approval', id, 'created', input.title)
  return listApprovals().find((approval) => approval.id === id)!
}

export function resolveApproval(id: string, resolution: 'approved' | 'declined'): ApprovalRequest | null {
  const current = listApprovals().find((approval) => approval.id === id)
  if (!current || current.state !== 'pending') return current ?? null
  const now = Date.now()
  getDb().prepare(`UPDATE approvals SET state=?, resolved_at=?, updated_at=? WHERE id=?`).run(resolution, now, now, id)
  if (current.missionId) updateMission(current.missionId, { state: resolution === 'approved' ? 'active' : 'blocked' })
  event('approval', id, resolution)
  return listApprovals().find((approval) => approval.id === id) ?? null
}

export function listCaptures(): CaptureItem[] {
  return getDb().prepare(`SELECT id,content,kind,state,created_at as createdAt,COALESCE(updated_at,created_at) as updatedAt FROM captures ORDER BY created_at DESC`).all() as CaptureItem[]
}

export function createCapture(content: string, kind: CaptureItem['kind'] = 'note'): CaptureItem {
  const clean = content.trim(); if (!clean) throw new Error('Capture cannot be empty.')
  const id = uuid(); const now = Date.now()
  getDb().prepare(`INSERT INTO captures (id,content,kind,state,created_at,updated_at) VALUES (?,?,?,'inbox',?,?)`).run(id, clean, kind, now, now)
  event('capture', id, 'created', kind)
  return listCaptures().find((capture) => capture.id === id)!
}

export function updateCapture(id: string, state: CaptureItem['state']): CaptureItem | null {
  getDb().prepare(`UPDATE captures SET state=?,updated_at=? WHERE id=?`).run(state, Date.now(), id)
  event('capture', id, state)
  return listCaptures().find((capture) => capture.id === id) ?? null
}

export function getOperationsSnapshot(): OperationsSnapshot {
  return { missions: listMissions(), routines: listRoutines(), approvals: listApprovals(), captures: listCaptures(), generatedAt: Date.now() }
}

export function getDueRoutines(now = Date.now()): Routine[] {
  return listRoutines().filter((routine) => routine.enabled && routine.nextRunAt && routine.nextRunAt <= now)
}

export function markRoutineRun(id: string, at = Date.now()): Routine | null {
  const current = listRoutines().find((routine) => routine.id === id)
  if (!current) return null
  getDb().prepare(`UPDATE routines SET last_run_at=?,next_run_at=?,updated_at=? WHERE id=?`)
    .run(at, nextRun(current.schedule, at) ?? null, at, id)
  event('routine', id, 'triggered', current.prompt)
  return listRoutines().find((routine) => routine.id === id) ?? null
}
