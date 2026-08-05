import {
  addMissionStep,
  createCapture,
  createApproval,
  createMission,
  createRoutine,
  getOperationsSnapshot,
  updateMission,
  updateMissionStep
} from '../operations/service'
import type { MissionPriority, MissionState } from '../../shared/types'
import type { ToolDefinition } from './types'

export const operationsTools: ToolDefinition[] = [
  {
    name: 'mission_create',
    description: 'Create a persistent mission/objective with an optional definition of done and initial steps. Use when the user asks to track, plan, or keep working on an outcome.',
    parameters: { type: 'object', properties: { title: { type: 'string' }, outcome: { type: 'string' }, priority: { type: 'string', enum: ['low','normal','high','critical'] }, steps: { type: 'array', items: { type: 'string' } } }, required: ['title'], additionalProperties: false },
    execute: async (args) => {
      const mission = createMission({ title: String(args.title || ''), outcome: args.outcome ? String(args.outcome) : undefined, priority: (args.priority as MissionPriority) || 'normal', steps: Array.isArray(args.steps) ? args.steps.map(String) : undefined, source: 'chat' })
      return { ok: true, result: `Mission created: ${mission.title} (${mission.id})` }
    }
  },
  {
    name: 'mission_list',
    description: 'List current persistent missions, their status, progress, and steps.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => {
      const { missions } = getOperationsSnapshot()
      return { ok: true, result: missions.length ? missions.map((m) => `${m.id}\t${m.state}\t${m.progress}%\t${m.title}`).join('\n') : '(no missions)' }
    }
  },
  {
    name: 'mission_update',
    description: 'Update a mission state or progress. Only mark complete when the outcome is actually achieved and verified.',
    parameters: { type: 'object', properties: { id: { type: 'string' }, state: { type: 'string', enum: ['draft','queued','active','waiting','approval','blocked','complete','cancelled'] }, progress: { type: 'number' } }, required: ['id'], additionalProperties: false },
    execute: async (args) => {
      const mission = updateMission(String(args.id), { state: args.state as MissionState | undefined, progress: args.progress === undefined ? undefined : Number(args.progress) })
      return mission ? { ok: true, result: `Mission updated: ${mission.title} — ${mission.state}, ${mission.progress}%` } : { ok: false, result: 'Mission not found.' }
    }
  },
  {
    name: 'mission_add_step',
    description: 'Add a concrete step to an existing mission.',
    parameters: { type: 'object', properties: { missionId: { type: 'string' }, title: { type: 'string' } }, required: ['missionId','title'], additionalProperties: false },
    execute: async (args) => { const step = addMissionStep(String(args.missionId), String(args.title)); return { ok: true, result: `Step added: ${step.title} (${step.id})` } }
  },
  {
    name: 'mission_complete_step',
    description: 'Mark a mission step complete with an optional human-readable verification note.',
    parameters: { type: 'object', properties: { id: { type: 'string' }, verification: { type: 'string' } }, required: ['id'], additionalProperties: false },
    execute: async (args) => { const step = updateMissionStep(String(args.id), { state: 'complete', verification: args.verification ? String(args.verification) : undefined }); return step ? { ok: true, result: `Step completed: ${step.title}` } : { ok: false, result: 'Step not found.' } }
  },
  {
    name: 'routine_create',
    description: 'Schedule a recurring preparation. Supported schedules are HH:MM, "daily at HH:MM", or "every N minutes/hours". Due routines create a reviewable mission.',
    parameters: { type: 'object', properties: { name: { type: 'string' }, prompt: { type: 'string' }, schedule: { type: 'string' } }, required: ['name','prompt','schedule'], additionalProperties: false },
    execute: async (args) => { const routine = createRoutine({ name: String(args.name), prompt: String(args.prompt), schedule: String(args.schedule) }); return { ok: true, result: `Routine armed: ${routine.name}; next ${routine.nextRunAt ? new Date(routine.nextRunAt).toLocaleString() : 'manual review'}.` } }
  },
  {
    name: 'approval_request',
    description: 'Stage a consequential action for human review in the Approval Inbox. Use before sending, publishing, purchasing, deleting, or other external/irreversible action when it should not run immediately.',
    parameters: { type: 'object', properties: { missionId: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, actionLabel: { type: 'string' }, risk: { type: 'string' }, preview: { type: 'string' } }, required: ['title','description','actionLabel','risk'], additionalProperties: false },
    execute: async (args) => {
      const approval = createApproval({ missionId: args.missionId ? String(args.missionId) : undefined, title: String(args.title), description: String(args.description), actionLabel: String(args.actionLabel), risk: String(args.risk), preview: args.preview ? String(args.preview) : undefined })
      return { ok: true, result: `Approval staged: ${approval.title} (${approval.id}). No external action was taken.` }
    }
  },
  {
    name: 'capture',
    description: 'Save a thought, task, idea, URL, receipt note, or reference to the universal capture inbox.',
    parameters: { type: 'object', properties: { content: { type: 'string' }, kind: { type: 'string', enum: ['note','task','idea','url','receipt','reference'] } }, required: ['content'], additionalProperties: false },
    execute: async (args) => { const item = createCapture(String(args.content), (args.kind as 'note') || 'note'); return { ok: true, result: `Captured as ${item.kind}.` } }
  }
]
