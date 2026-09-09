import { captureCapsule, deleteCapsule, describeCapsule, listCapsules, restoreCapsule } from '../context/capsules'
import { getProjectPulse } from '../pulse/projectPulse'
import type { ToolDefinition } from './types'

export const contextTools: ToolDefinition[] = [
  {
    name: 'save_context_capsule',
    description:
      'Seal the current operating position (mission, Computer tabs, front apps, project folder, and a note) so Kai can later say “resume <name>”.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        notes: { type: 'string' }
      },
      additionalProperties: false
    },
    execute: async (args) => {
      const capsule = await captureCapsule({
        title: args.title ? String(args.title) : undefined,
        notes: args.notes ? String(args.notes) : undefined
      })
      return { ok: true, result: `Capsule sealed: ${describeCapsule(capsule)}` }
    }
  },
  {
    name: 'list_context_capsules',
    description: 'List saved context capsules Kai can resume.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => {
      const capsules = listCapsules()
      return {
        ok: true,
        result: capsules.length
          ? capsules.map((capsule) => `${capsule.id}\t${describeCapsule(capsule)}`).join('\n')
          : '(no capsules)'
      }
    }
  },
  {
    name: 'restore_context_capsule',
    description:
      'Restore a sealed context capsule by id or name. Reopens Computer tabs and prepares mission/project notes.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false
    },
    execute: async (args) => {
      const { capsule, reply } = await restoreCapsule(String(args.query || ''))
      return { ok: Boolean(capsule), result: reply }
    }
  },
  {
    name: 'delete_context_capsule',
    description: 'Delete a saved context capsule by id.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false
    },
    execute: async (args) => {
      const ok = deleteCapsule(String(args.id || ''))
      return { ok, result: ok ? 'Capsule deleted.' : 'Capsule not found.' }
    }
  },
  {
    name: 'project_pulse',
    description:
      'Read live repo health for the configured project folder: branch, dirty files, recent commits, stale branches, TODOs, and recent test/build faults.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => {
      const pulse = await getProjectPulse(true)
      const lines = [
        pulse.projectFolder || 'No project folder',
        pulse.branch ? `branch ${pulse.branch}` : 'not a git repo',
        pulse.score != null ? `score ${pulse.score}/100` : 'score n/a',
        `${pulse.dirty.length} dirty`,
        `${pulse.todos.length} todos`,
        `${pulse.staleBranches.length} stale branches`,
        pulse.nextTask ? `next: ${pulse.nextTask}` : '',
        pulse.error || ''
      ].filter(Boolean)
      return { ok: !pulse.error || Boolean(pulse.projectFolder), result: lines.join(' · ') }
    }
  }
]
