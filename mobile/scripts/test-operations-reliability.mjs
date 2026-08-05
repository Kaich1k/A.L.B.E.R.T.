import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addLocalMissionStep,
  createLocalCapture,
  createLocalMission,
  createLocalRoutine,
  removeLocalMission,
  removeLocalRoutine,
  resolveLocalApproval,
  setLocalCaptureState,
  setLocalMissionStep,
  updateLocalMission,
  updateLocalRoutine
} from '../src/lib/operations.ts'
import { EMPTY_OPERATIONS } from '../src/types.ts'

function blank() {
  return { ...EMPTY_OPERATIONS, missions: [], routines: [], approvals: [], captures: [] }
}

test('standalone missions support creation, steps, progress, editing, and deletion', () => {
  const created = createLocalMission(blank(), {
    title: 'Prepare briefing',
    outcome: 'A verified morning brief',
    priority: 'high',
    steps: ['Collect sources', 'Draft brief']
  })
  assert.equal(created.mission.state, 'queued')
  assert.equal(created.mission.steps.length, 2)
  assert.equal(new Set(created.mission.steps.map((step) => step.id)).size, 2)

  const firstDone = setLocalMissionStep(
    created.snapshot,
    created.mission.steps[0].id,
    'complete'
  )
  assert.equal(firstDone.missions[0].progress, 50)
  assert.equal(firstDone.missions[0].state, 'active')

  const allDone = setLocalMissionStep(firstDone, created.mission.steps[1].id, 'complete')
  assert.equal(allDone.missions[0].progress, 100)
  assert.equal(allDone.missions[0].state, 'complete')
  const reopened = setLocalMissionStep(allDone, created.mission.steps[0].id, 'pending')
  assert.equal(reopened.missions[0].progress, 50)
  assert.equal(reopened.missions[0].state, 'active')

  const added = addLocalMissionStep(reopened, created.mission.id, 'Deliver brief')
  assert.equal(added.snapshot.missions[0].steps.length, 3)
  const edited = updateLocalMission(added.snapshot, created.mission.id, {
    priority: 'critical',
    state: 'waiting'
  })
  assert.equal(edited.missions[0].priority, 'critical')
  assert.equal(edited.missions[0].state, 'waiting')
  const manuallyCompleted = updateLocalMission(edited, created.mission.id, { state: 'complete' })
  assert.equal(manuallyCompleted.missions[0].progress, 100)
  assert.equal(removeLocalMission(manuallyCompleted, created.mission.id).missions.length, 0)
})

test('routine edits preserve omitted quiet hours and allow explicit clearing', () => {
  const created = createLocalRoutine(blank(), {
    name: 'Morning scan',
    prompt: 'Review the daily queue',
    schedule: '0 8 * * *',
    quietStart: '22:00',
    quietEnd: '07:00'
  })
  const renamed = updateLocalRoutine(created.snapshot, created.routine.id, {
    name: 'Daily scan',
    enabled: false
  })
  assert.equal(renamed.routines[0].quietStart, '22:00')
  assert.equal(renamed.routines[0].quietEnd, '07:00')
  assert.equal(renamed.routines[0].enabled, false)

  const cleared = updateLocalRoutine(renamed, created.routine.id, {
    quietStart: '',
    quietEnd: ''
  })
  assert.equal(cleared.routines[0].quietStart, undefined)
  assert.equal(cleared.routines[0].quietEnd, undefined)
  assert.equal(removeLocalRoutine(cleared, created.routine.id).routines.length, 0)
})

test('approval resolution updates its linked mission without bypassing an explicit choice', () => {
  const created = createLocalMission(blank(), { title: 'Sensitive action' })
  const now = Date.now()
  const snapshot = {
    ...created.snapshot,
    approvals: [{
      id: 'approval_test',
      missionId: created.mission.id,
      title: 'Authorize',
      description: 'Review before proceeding',
      actionLabel: 'Proceed',
      risk: 'External side effect',
      state: 'pending',
      createdAt: now,
      updatedAt: now
    }]
  }
  const approved = resolveLocalApproval(snapshot, 'approval_test', 'approved')
  assert.equal(approved.approvals[0].state, 'approved')
  assert.equal(approved.missions[0].state, 'active')
})

test('capture inbox supports durable local triage', () => {
  const created = createLocalCapture(blank(), 'Investigate local voice latency', 'idea')
  assert.equal(created.capture.state, 'inbox')
  const filed = setLocalCaptureState(created.snapshot, created.capture.id, 'filed')
  assert.equal(filed.captures[0].state, 'filed')
  assert.ok((filed.captures[0].updatedAt || 0) >= created.capture.createdAt)
})
