import { getDailyBrief } from '../brief/dailyBrief'
import { saveArtifact, listArtifacts } from '../artifacts/store'
import { interruptCursorAgent, openInCursor, runCursorAgent } from '../cursor/agent'
import type { ToolDefinition } from './types'

export const cursorTools: ToolDefinition[] = [
  {
    name: 'cursor_agent',
    description:
      'Run the Cursor agent CLI (same agent as the IDE) against the project. This is how ALBERT is allowed to code — including editing ALBERT himself. Live reload is paused for the run so the Mac UI does not crash. Use this for coding, refactors, and file edits. Does not inject into an already-open Composer tab.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        workspace: { type: 'string' }
      },
      required: ['prompt'],
      additionalProperties: false
    },
    dangerous: false,
    execute: async (args) =>
      runCursorAgent(String(args.prompt || ''), args.workspace ? String(args.workspace) : undefined)
  },
  {
    name: 'open_in_cursor',
    description: 'Open the workspace in the Cursor app so Kai can continue in the IDE tab.',
    parameters: {
      type: 'object',
      properties: { workspace: { type: 'string' } },
      additionalProperties: false
    },
    execute: async (args) => openInCursor(args.workspace ? String(args.workspace) : undefined)
  },
  {
    name: 'interrupt_cursor_agent',
    description: 'Stop a running Cursor agent dispatch.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => {
      const ok = interruptCursorAgent()
      return { ok, result: ok ? 'Cursor agent interrupted.' : 'No Cursor agent was running.' }
    }
  },
  {
    name: 'save_artifact',
    description: 'Store a versioned mission artifact (draft, plan, table, diff, screenshot note).',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
        kind: { type: 'string' },
        missionId: { type: 'string' }
      },
      required: ['title', 'body'],
      additionalProperties: false
    },
    execute: async (args) => {
      const row = saveArtifact({
        title: String(args.title || ''),
        body: String(args.body || ''),
        kind: args.kind ? String(args.kind) : 'note',
        missionId: args.missionId ? String(args.missionId) : undefined,
        source: 'tool'
      })
      return { ok: true, result: `Artifact saved: ${row.title} v${row.version}` }
    }
  },
  {
    name: 'list_artifacts',
    description: 'List versioned mission artifacts.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => {
      const rows = listArtifacts(30)
      return {
        ok: true,
        result: rows.length
          ? rows.map((row) => `${row.id}\tv${row.version}\t${row.kind}\t${row.title}`).join('\n')
          : '(no artifacts)'
      }
    }
  },
  {
    name: 'daily_brief',
    description: 'Build the daily brief: weather, calendar, active missions, overnight changes, recommended first move.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => {
      const brief = await getDailyBrief(true)
      return {
        ok: true,
        result: [
          brief.firstMove,
          `Weather: ${brief.weather}`,
          brief.calendar.length ? `Calendar: ${brief.calendar.join('; ')}` : 'Calendar: none readable',
          `Missions: ${brief.missions.join('; ') || 'none'}`,
          `Overnight: ${brief.overnight.join('; ')}`
        ].join('\n')
      }
    }
  }
]
