import type {
  ApprovalRequest,
  CaptureItem,
  Mission,
  MissionPriority,
  MissionState,
  OperationsSnapshot,
  Routine
} from '../types'
import { newId } from './id'

function generated(snapshot: OperationsSnapshot): OperationsSnapshot {
  return { ...snapshot, generatedAt: Date.now() }
}

function missionProgress(steps: Mission['steps']): number {
  if (!steps.length) return 0
  const done = steps.filter((step) => step.state === 'complete' || step.state === 'skipped').length
  return Math.round((done / steps.length) * 100)
}

export function createLocalMission(
  snapshot: OperationsSnapshot,
  input: { title: string; outcome?: string; priority?: MissionPriority; steps?: string[] }
): { snapshot: OperationsSnapshot; mission: Mission } {
  const now = Date.now()
  const id = `mission_${newId()}`
  const steps = (input.steps || []).map((title, position) => ({
    id: `step_${newId()}`,
    missionId: id,
    position,
    title: title.trim(),
    state: 'pending' as const,
    createdAt: now,
    updatedAt: now
  })).filter((step) => step.title)
  const mission: Mission = {
    id,
    title: input.title.trim(),
    outcome: input.outcome?.trim() || input.title.trim(),
    state: steps.length ? 'queued' : 'draft',
    priority: input.priority || 'normal',
    progress: 0,
    risk: 'prepare',
    source: 'user',
    createdAt: now,
    updatedAt: now,
    steps
  }
  if (!mission.title) throw new Error('Mission title is required')
  return { snapshot: generated({ ...snapshot, missions: [mission, ...snapshot.missions] }), mission }
}

export function updateLocalMission(
  snapshot: OperationsSnapshot,
  id: string,
  patch: Partial<Pick<Mission, 'title' | 'outcome' | 'state' | 'priority' | 'deadline' | 'risk'>>
): OperationsSnapshot {
  const now = Date.now()
  return generated({
    ...snapshot,
    missions: snapshot.missions.map((mission) => mission.id === id
      ? {
          ...mission,
          ...patch,
          title: patch.title?.trim() || mission.title,
          progress: patch.state === 'complete' ? 100 : mission.progress,
          updatedAt: now
        }
      : mission)
  })
}

export function addLocalMissionStep(
  snapshot: OperationsSnapshot,
  missionId: string,
  title: string
): { snapshot: OperationsSnapshot; stepId: string } {
  const now = Date.now()
  const stepId = `step_${newId()}`
  const clean = title.trim()
  if (!clean) throw new Error('Step title is required')
  const missions = snapshot.missions.map((mission) => mission.id === missionId
    ? {
        ...mission,
        state: mission.state === 'draft' ? 'queued' as const : mission.state,
        updatedAt: now,
        steps: [...mission.steps, {
          id: stepId,
          missionId,
          position: mission.steps.length,
          title: clean,
          state: 'pending' as const,
          createdAt: now,
          updatedAt: now
        }]
      }
    : mission)
  return { snapshot: generated({ ...snapshot, missions }), stepId }
}

export function setLocalMissionStep(
  snapshot: OperationsSnapshot,
  stepId: string,
  state: Mission['steps'][number]['state']
): OperationsSnapshot {
  const now = Date.now()
  const missions = snapshot.missions.map((mission) => {
    if (!mission.steps.some((step) => step.id === stepId)) return mission
    const steps = mission.steps.map((step) => step.id === stepId ? { ...step, state, updatedAt: now } : step)
    const progress = missionProgress(steps)
    let missionState: MissionState = mission.state
    if (progress === 100) missionState = 'complete'
    else if (steps.some((step) => step.state === 'approval')) missionState = 'approval'
    else if (steps.some((step) => step.state === 'failed')) missionState = 'blocked'
    else if (steps.some((step) => step.state === 'active') || progress > 0) missionState = 'active'
    else if (mission.state === 'complete' || mission.state === 'approval' || mission.state === 'draft') {
      missionState = 'queued'
    }
    return { ...mission, steps, progress, state: missionState, updatedAt: now }
  })
  return generated({ ...snapshot, missions })
}

export function removeLocalMission(snapshot: OperationsSnapshot, id: string): OperationsSnapshot {
  return generated({
    ...snapshot,
    missions: snapshot.missions.filter((mission) => mission.id !== id),
    approvals: snapshot.approvals.filter((approval) => approval.missionId !== id)
  })
}

export function createLocalRoutine(
  snapshot: OperationsSnapshot,
  input: {
    name: string
    prompt: string
    schedule: string
    enabled?: boolean
    quietStart?: string
    quietEnd?: string
  }
): { snapshot: OperationsSnapshot; routine: Routine } {
  const now = Date.now()
  if (!input.name.trim() || !input.prompt.trim() || !input.schedule.trim()) {
    throw new Error('Routine name, action, and schedule are required')
  }
  const routine: Routine = {
    id: `routine_${newId()}`,
    name: input.name.trim(),
    prompt: input.prompt.trim(),
    schedule: input.schedule.trim(),
    enabled: input.enabled !== false,
    quietStart: input.quietStart?.trim() || undefined,
    quietEnd: input.quietEnd?.trim() || undefined,
    createdAt: now,
    updatedAt: now
  }
  return { snapshot: generated({ ...snapshot, routines: [routine, ...snapshot.routines] }), routine }
}

export function updateLocalRoutine(
  snapshot: OperationsSnapshot,
  id: string,
  patch: Partial<Pick<Routine, 'name' | 'prompt' | 'schedule' | 'enabled' | 'quietStart' | 'quietEnd'>>
): OperationsSnapshot {
  const now = Date.now()
  return generated({
    ...snapshot,
    routines: snapshot.routines.map((routine) => {
      if (routine.id !== id) return routine
      const next = {
        ...routine,
        ...patch,
        name: patch.name?.trim() || routine.name,
        prompt: patch.prompt?.trim() || routine.prompt,
        schedule: patch.schedule?.trim() || routine.schedule,
        quietStart: patch.quietStart === undefined
          ? routine.quietStart
          : patch.quietStart.trim() || undefined,
        quietEnd: patch.quietEnd === undefined
          ? routine.quietEnd
          : patch.quietEnd.trim() || undefined,
        updatedAt: now
      }
      if (!next.name || !next.prompt || !next.schedule) {
        throw new Error('Routine name, action, and schedule are required')
      }
      return next
    })
  })
}

export function toggleLocalRoutine(snapshot: OperationsSnapshot, id: string): OperationsSnapshot {
  const now = Date.now()
  return generated({
    ...snapshot,
    routines: snapshot.routines.map((routine) => routine.id === id
      ? { ...routine, enabled: !routine.enabled, updatedAt: now }
      : routine)
  })
}

export function removeLocalRoutine(snapshot: OperationsSnapshot, id: string): OperationsSnapshot {
  return generated({ ...snapshot, routines: snapshot.routines.filter((routine) => routine.id !== id) })
}

export function resolveLocalApproval(
  snapshot: OperationsSnapshot,
  id: string,
  resolution: 'approved' | 'declined'
): OperationsSnapshot {
  const now = Date.now()
  const approval = snapshot.approvals.find((item) => item.id === id)
  const approvals: ApprovalRequest[] = snapshot.approvals.map((item) => item.id === id && item.state === 'pending'
    ? { ...item, state: resolution, resolvedAt: now, updatedAt: now }
    : item)
  const missions = approval?.missionId
    ? snapshot.missions.map((mission) => mission.id === approval.missionId
        ? { ...mission, state: resolution === 'approved' ? 'active' as const : 'blocked' as const, updatedAt: now }
        : mission)
    : snapshot.missions
  return generated({ ...snapshot, approvals, missions })
}

export function createLocalCapture(
  snapshot: OperationsSnapshot,
  content: string,
  kind: CaptureItem['kind'] = 'note'
): { snapshot: OperationsSnapshot; capture: CaptureItem } {
  const now = Date.now()
  const clean = content.trim()
  if (!clean) throw new Error('Capture cannot be empty')
  const capture: CaptureItem = {
    id: `capture_${newId()}`,
    content: clean,
    kind,
    state: 'inbox',
    createdAt: now,
    updatedAt: now
  }
  return { snapshot: generated({ ...snapshot, captures: [capture, ...snapshot.captures] }), capture }
}

export function setLocalCaptureState(
  snapshot: OperationsSnapshot,
  id: string,
  state: CaptureItem['state']
): OperationsSnapshot {
  const now = Date.now()
  return generated({
    ...snapshot,
    captures: snapshot.captures.map((capture) => capture.id === id
      ? { ...capture, state, updatedAt: now }
      : capture)
  })
}
