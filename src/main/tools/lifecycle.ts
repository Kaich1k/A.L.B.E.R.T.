import { getAppJobStatus, restartAlbertApp, startAppUpdate } from '../appLifecycle'
import type { ToolDefinition } from './types'

export const lifecycleTools: ToolDefinition[] = [
  {
    name: 'update_app',
    description:
      'Rebuild and reinstall ~/Applications/ALBERT.app (same as npm run update:app) in a detached process, then reopen ALBERT. Prefer this, or run npm run update:app in a shell — the host intercepts the shell and runs this same job.',
    parameters: {
      type: 'object',
      properties: {
        relaunch: {
          type: 'boolean',
          description: 'Reopen ALBERT after install (default true)'
        }
      },
      additionalProperties: false
    },
    execute: async (args) => startAppUpdate(args.relaunch !== false)
  },
  {
    name: 'restart_app',
    description:
      'Relaunch the running ALBERT process without rebuilding. Use after a detached update with relaunch false, or when Kai asks you to restart yourself.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => restartAlbertApp()
  },
  {
    name: 'app_update_status',
    description: 'Check whether a detached update or restart is in flight.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => {
      const status = getAppJobStatus()
      if (!status) return { ok: true, result: 'No update or restart job has been started this session.' }
      return {
        ok: true,
        result: [
          `kind=${status.kind}`,
          `pid=${status.pid ?? '?'}`,
          `finished=${status.finished}`,
          `exitCode=${status.exitCode ?? 'running'}`,
          status.logPath ? `log=${status.logPath}` : ''
        ]
          .filter(Boolean)
          .join(' ')
      }
    }
  }
]
