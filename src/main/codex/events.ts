/**
 * Translate Codex app-server notifications into a small vocabulary A.L.B.E.R.T.
 * understands. Pure on purpose — no Electron, no I/O — so the mapping is unit
 * testable against recorded protocol traffic.
 */
import {
  classifyCodexError,
  type CodexFault,
  type CodexRateLimitSnapshot,
  type CodexThreadItem,
  type CodexTurnError
} from './protocol'

export interface CodexPlanStep {
  step: string
  status: string
}

export type CodexBridgeEvent =
  /** Streaming assistant text. Visual only — speech waits for the final message. */
  | { kind: 'delta'; text: string }
  | { kind: 'agentMessage'; text: string; phase: string | null; final: boolean }
  | { kind: 'reasoning'; text: string }
  | { kind: 'plan'; steps: CodexPlanStep[]; explanation: string | null }
  | { kind: 'diff'; diff: string }
  | { kind: 'commandStart'; itemId: string; command: string; cwd: string | null }
  | {
      kind: 'commandEnd'
      itemId: string
      command: string
      exitCode: number | null
      output: string
      ok: boolean
    }
  | { kind: 'fileChange'; itemId: string; paths: string[]; ok: boolean }
  | { kind: 'toolCall'; itemId: string; name: string; ok: boolean }
  | { kind: 'threadStarted'; threadId: string }
  | { kind: 'turnStarted'; turnId: string }
  | { kind: 'turnCompleted'; turnId: string; status: string }
  | { kind: 'error'; fault: CodexFault; willRetry: boolean }
  | { kind: 'rateLimits'; snapshot: CodexRateLimitSnapshot }
  | { kind: 'tokenUsage'; total: number; contextWindow: number | null }
  | { kind: 'accountUpdated'; authMode: string | null; planType: string | null }
  | { kind: 'loginCompleted'; success: boolean; error: string | null }
  | { kind: 'ignored'; method: string }

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function firstText(item: CodexThreadItem): string {
  if (typeof item.text === 'string') return item.text
  if (Array.isArray(item.summary)) return item.summary.filter((s) => typeof s === 'string').join(' ')
  return ''
}

function changedPaths(item: CodexThreadItem): string[] {
  const raw = item.changes
  if (Array.isArray(raw)) {
    return raw.map((c) => str(asRecord(c).path)).filter(Boolean)
  }
  // Some server versions key changes by path instead of listing them.
  const byPath = asRecord(item.changes)
  return Object.keys(byPath)
}

/**
 * Codex only sometimes labels a message `final_answer`; the protocol says treat
 * a missing phase as unknown and stay compatible. Commentary is explicitly
 * mid-turn narration, so everything that is not commentary counts as final.
 */
export function isFinalAgentMessage(phase: string | null | undefined): boolean {
  return phase !== 'commentary'
}

function itemEvents(item: CodexThreadItem, completed: boolean): CodexBridgeEvent[] {
  const itemId = str(item.id)

  switch (item.type) {
    case 'agentMessage': {
      if (!completed) return []
      const text = firstText(item).trim()
      if (!text) return []
      const phase = typeof item.phase === 'string' ? item.phase : null
      return [{ kind: 'agentMessage', text, phase, final: isFinalAgentMessage(phase) }]
    }
    case 'reasoning': {
      const text = firstText(item).trim()
      return text ? [{ kind: 'reasoning', text: text.slice(0, 400) }] : []
    }
    case 'plan': {
      const text = firstText(item).trim()
      return text
        ? [{ kind: 'plan', steps: [{ step: text, status: 'pending' }], explanation: null }]
        : []
    }
    case 'commandExecution': {
      const command = str(item.command)
      if (!completed) {
        return [{ kind: 'commandStart', itemId, command, cwd: str(item.cwd) || null }]
      }
      const exitCode = typeof item.exitCode === 'number' ? item.exitCode : null
      const status = str(item.status)
      return [
        {
          kind: 'commandEnd',
          itemId,
          command,
          exitCode,
          output: str(item.aggregatedOutput),
          // Treat "no exit code reported" as success unless the status says otherwise.
          ok: exitCode === null ? status !== 'failed' : exitCode === 0
        }
      ]
    }
    case 'fileChange': {
      if (!completed) return []
      return [
        {
          kind: 'fileChange',
          itemId,
          paths: changedPaths(item),
          ok: str(item.status) !== 'failed'
        }
      ]
    }
    case 'mcpToolCall':
    case 'functionCallOutput': {
      if (!completed) return []
      return [
        { kind: 'toolCall', itemId, name: str(item.name) || item.type, ok: str(item.status) !== 'failed' }
      ]
    }
    default:
      return []
  }
}

/** Single entry point: one notification in, zero or more bridge events out. */
export function mapCodexNotification(method: string, rawParams: unknown): CodexBridgeEvent[] {
  const params = asRecord(rawParams)

  switch (method) {
    case 'item/agentMessage/delta': {
      const text = str(params.delta)
      return text ? [{ kind: 'delta', text }] : []
    }

    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/textDelta': {
      const text = str(params.delta)
      return text ? [{ kind: 'reasoning', text }] : []
    }

    case 'item/started':
      return itemEvents(asRecord(params.item) as CodexThreadItem, false)

    case 'item/completed':
      return itemEvents(asRecord(params.item) as CodexThreadItem, true)

    case 'turn/plan/updated': {
      const raw = Array.isArray(params.plan) ? params.plan : []
      const steps: CodexPlanStep[] = raw.map((entry) => {
        const row = asRecord(entry)
        return { step: str(row.step), status: str(row.status) || 'pending' }
      })
      return [
        {
          kind: 'plan',
          steps: steps.filter((s) => s.step),
          explanation: str(params.explanation) || null
        }
      ]
    }

    case 'turn/diff/updated': {
      const diff = str(params.diff)
      return diff ? [{ kind: 'diff', diff }] : []
    }

    case 'thread/started': {
      const threadId = str(params.threadId) || str(asRecord(params.thread).id)
      return threadId ? [{ kind: 'threadStarted', threadId }] : []
    }

    case 'turn/started': {
      const turnId = str(asRecord(params.turn).id) || str(params.turnId)
      return turnId ? [{ kind: 'turnStarted', turnId }] : []
    }

    case 'turn/completed': {
      const turn = asRecord(params.turn)
      const turnId = str(turn.id) || str(params.turnId)
      return [{ kind: 'turnCompleted', turnId, status: str(turn.status) || 'completed' }]
    }

    case 'error': {
      const error = (params.error ?? params) as CodexTurnError
      return [
        {
          kind: 'error',
          fault: classifyCodexError(error),
          willRetry: params.willRetry === true
        }
      ]
    }

    case 'account/rateLimits/updated': {
      const snapshot = asRecord(params.rateLimits) as CodexRateLimitSnapshot
      return [{ kind: 'rateLimits', snapshot }]
    }

    case 'thread/tokenUsage/updated': {
      const usage = asRecord(params.tokenUsage)
      const total = asRecord(usage.total)
      const value =
        typeof total.totalTokens === 'number'
          ? total.totalTokens
          : typeof total.total === 'number'
            ? total.total
            : 0
      const contextWindow =
        typeof usage.modelContextWindow === 'number' ? usage.modelContextWindow : null
      return [{ kind: 'tokenUsage', total: value, contextWindow }]
    }

    case 'account/updated':
      return [
        {
          kind: 'accountUpdated',
          authMode: str(params.authMode) || null,
          planType: str(params.planType) || null
        }
      ]

    case 'account/login/completed':
      return [
        {
          kind: 'loginCompleted',
          success: params.success === true,
          error: str(params.error) || null
        }
      ]

    default:
      return [{ kind: 'ignored', method }]
  }
}

/**
 * Progress line for the HUD. Kept terse because it also feeds the spoken cue
 * path, where a long sentence would talk over Kai.
 */
export function progressLabel(event: CodexBridgeEvent): string | null {
  switch (event.kind) {
    case 'turnStarted':
      return 'ChatGPT is working'
    case 'reasoning':
      return 'Thinking'
    case 'delta':
      return 'Writing'
    case 'commandStart': {
      const head = event.command.split('\n')[0]!.trim()
      return head ? `Running ${head.slice(0, 80)}` : 'Running a command'
    }
    case 'commandEnd':
      return event.ok ? null : `Command failed (exit ${event.exitCode ?? '?'})`
    case 'fileChange':
      if (!event.paths.length) return 'Editing files'
      return event.paths.length === 1
        ? `Editing ${event.paths[0]!.split('/').pop()}`
        : `Editing ${event.paths.length} files`
    case 'plan': {
      const active = event.steps.find((s) => s.status === 'in_progress' || s.status === 'inProgress')
      return active ? active.step.slice(0, 90) : null
    }
    default:
      return null
  }
}
