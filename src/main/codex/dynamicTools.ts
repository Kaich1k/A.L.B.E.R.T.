/** Codex 0.153.4 dynamic-tool protocol. Kept pure to test without Electron or a live model. */
import { createHash } from 'node:crypto'

export interface DynamicToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export function codexDynamicTools(tools: DynamicToolDefinition[]) {
  return [{
    type: 'namespace' as const,
    name: 'albert',
    description: 'ALBERT computer, browser, files, memory, and companion controls. These use ALBERT’s existing permissions, activity history, and stop controls.',
    tools: [...tools].sort((a, b) => a.name.localeCompare(b.name)).map((tool) => ({
      type: 'function' as const,
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters
    }))
  }]
}

export function dynamicToolsFingerprint(tools: DynamicToolDefinition[]): string {
  return createHash('sha256').update(JSON.stringify(codexDynamicTools(tools))).digest('hex')
}

export interface DynamicToolResponse {
  contentItems: Array<{ type: 'inputText'; text: string } | { type: 'inputImage'; imageUrl: string }>
  success: boolean
}

interface DynamicToolResult {
  ok: boolean
  result: string
  image?: { mediaType: string; data: string }
}

interface DynamicToolExecutor {
  hasTool: (name: string) => boolean
  execute: (name: string, args: Record<string, unknown>) => Promise<DynamicToolResult>
}

export type DynamicCallCache = Map<string, { signature: string; result: Promise<DynamicToolResponse> }>

export interface DynamicToolContext {
  threadId: string
  turnId: string | null
  calls: DynamicCallCache
  /** Must include active-turn identity, interruption, and captured chat-turn scope. */
  isCurrent: () => boolean
  loadExecutor: () => Promise<DynamicToolExecutor>
}

function failure(text: string): DynamicToolResponse {
  return { success: false, contentItems: [{ type: 'inputText', text }] }
}

export function dynamicToolResponse(result: DynamicToolResult): DynamicToolResponse {
  const contentItems: DynamicToolResponse['contentItems'] = [{ type: 'inputText', text: result.result }]
  if (result.image?.data && /^image\/(png|jpeg|gif|webp)$/.test(result.image.mediaType)) {
    contentItems.push({ type: 'inputImage', imageUrl: `data:${result.image.mediaType};base64,${result.image.data}` })
  }
  return { success: result.ok, contentItems }
}

/** Reject stale/foreign calls before loading anything; retries never repeat a side effect. */
export async function dispatchCodexDynamicTool(raw: unknown, context: DynamicToolContext | null): Promise<DynamicToolResponse> {
  const params = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  if (!context || !context.isCurrent() || !context.turnId || params.threadId !== context.threadId || params.turnId !== context.turnId) {
    return failure('Interrupted or stale tool request. No action was run.')
  }
  if (params.namespace !== 'albert' || typeof params.tool !== 'string' || !params.tool.trim()) {
    return failure('Unknown ALBERT tool namespace or name. No action was run.')
  }
  if (typeof params.callId !== 'string' || !params.callId.trim()) {
    return failure('Missing tool call id. No action was run.')
  }
  if (!params.arguments || typeof params.arguments !== 'object' || Array.isArray(params.arguments)) {
    return failure('Tool arguments must be a JSON object. No action was run.')
  }
  const name = params.tool
  const args = params.arguments as Record<string, unknown>
  const signature = JSON.stringify([name, args])
  const previous = context.calls.get(params.callId)
  if (previous) {
    return previous.signature === signature
      ? previous.result
      : failure('This tool call id was already used with different arguments. No action was run.')
  }
  // Defer the executor import until after the promise has been cached, so even
  // concurrent duplicate protocol requests can execute at most once.
  const result = Promise.resolve().then(async (): Promise<DynamicToolResponse> => {
    try {
      const executor = await context.loadExecutor()
      if (!context.isCurrent()) return failure('Stopped before the action could run.')
      if (!executor.hasTool(name)) return failure(`Unknown ALBERT tool: ${name}`)
      const output = await executor.execute(name, args)
      if (!context.isCurrent()) return failure('Interrupted. The computer state was not confirmed after this step.')
      return dynamicToolResponse(output)
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error))
    }
  })
  context.calls.set(params.callId, { signature, result })
  return result
}

/** Notifications from an interrupted predecessor must not settle a new turn. */
export function notificationMatchesTurn(raw: unknown, turn: { threadId: string; turnId: string | null }): boolean {
  const params = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  if (typeof params.threadId === 'string' && params.threadId !== turn.threadId) return false
  const nested = params.turn && typeof params.turn === 'object' ? params.turn as Record<string, unknown> : {}
  const turnId = typeof params.turnId === 'string' ? params.turnId : typeof nested.id === 'string' ? nested.id : null
  return !turnId || (turn.turnId !== null && turnId === turn.turnId)
}

interface PendingNotification { method: string; params: unknown }

/** The correlated turn/start response owns the new id; unsolicited events cannot bind it. */
export class CodexTurnNotificationGate {
  private turnId: string | null = null
  private pending: PendingNotification[] = []
  private closed = false
  private threadId: string
  private release!: () => void
  readonly ready = new Promise<void>((resolve) => { this.release = resolve })

  constructor(threadId: string) { this.threadId = threadId }

  receive(method: string, params: unknown): PendingNotification[] {
    if (this.closed) return []
    if (this.turnId === null) {
      // A bounded queue covers events delivered before the request response.
      if (this.pending.length < 1000) this.pending.push({ method, params })
      return []
    }
    return notificationMatchesTurn(params, { threadId: this.threadId, turnId: this.turnId })
      ? [{ method, params }] : []
  }

  bind(turnId: string): PendingNotification[] {
    if (this.closed || !turnId || this.turnId !== null) return []
    this.turnId = turnId
    this.release()
    const pending = this.pending
    this.pending = []
    return pending.filter(({ params }) => notificationMatchesTurn(params, { threadId: this.threadId, turnId }))
  }

  close(): void {
    this.closed = true
    this.pending = []
    this.release()
  }
}
