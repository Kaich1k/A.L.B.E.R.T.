/**
 * stdio JSON-RPC 2.0 transport for `codex app-server`.
 *
 * Framing is newline-delimited JSON. The server both answers our requests and
 * sends its own (approvals), so this is a symmetric peer, not a plain client.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { codexSpawnEnv, requireCodexBinary, resolveCodexLaunch } from './binary'
import { CODEX_CLIENT_CAPABILITIES, CODEX_CLIENT_NAME, CodexFault, type CodexInitializeResult } from './protocol'

export interface JsonRpcMessage {
  jsonrpc?: string
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: { code?: number; message?: string; data?: unknown }
}

/**
 * Split a raw stdout chunk stream into whole JSON messages.
 *
 * Returns the messages plus whatever trailing partial line must be carried into
 * the next chunk. Non-JSON lines (Rust log noise on stdout) are dropped rather
 * than throwing, since one bad line must not kill the session.
 */
export function decodeJsonLines(
  buffer: string
): { messages: JsonRpcMessage[]; rest: string } {
  const messages: JsonRpcMessage[] = []
  let rest = buffer

  for (;;) {
    const newline = rest.indexOf('\n')
    if (newline < 0) break
    const line = rest.slice(0, newline).trim()
    rest = rest.slice(newline + 1)
    if (!line) continue
    try {
      const parsed = JSON.parse(line) as JsonRpcMessage
      if (parsed && typeof parsed === 'object') messages.push(parsed)
    } catch {
      // Log line, not protocol. Ignore.
    }
  }

  return { messages, rest }
}

export type NotificationHandler = (method: string, params: unknown) => void

/**
 * Handles a server→client request. Resolve with the result payload; throw to
 * return a JSON-RPC error.
 */
export type ServerRequestHandler = (
  method: string,
  params: unknown
) => Promise<unknown> | unknown

interface Pending {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  method: string
  timer: NodeJS.Timeout | null
}

export interface CodexAppServerOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** Per-request timeout. Turns are notification-driven, so requests stay short. */
  requestTimeoutMs?: number
  onNotification?: NotificationHandler
  onServerRequest?: ServerRequestHandler
  onExit?: (code: number | null, signal: string | null) => void
  onLog?: (line: string) => void
}

export const CODEX_STDOUT_MAX_BYTES = 8_000_000
const RESTART_BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000]

export class CodexAppServer {
  private child: ChildProcessWithoutNullStreams | null = null
  private stdoutBuffer = ''
  private nextId = 1
  private readonly pending = new Map<number | string, Pending>()
  private starting: Promise<CodexInitializeResult> | null = null
  private initResult: CodexInitializeResult | null = null
  private restarts = 0
  private disposed = false
  private readonly options: CodexAppServerOptions

  constructor(options: CodexAppServerOptions = {}) {
    this.options = options
  }

  get running(): boolean {
    return Boolean(this.child && !this.child.killed && this.child.exitCode === null)
  }

  get initializeResult(): CodexInitializeResult | null {
    return this.initResult
  }

  /** Idempotent: concurrent callers share one spawn + handshake. */
  async start(): Promise<CodexInitializeResult> {
    if (this.disposed) throw new CodexFault('transport', 'Codex bridge was shut down, sir.')
    if (this.initResult && this.running) return this.initResult
    if (this.starting) return this.starting

    this.starting = this.spawnAndHandshake().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async spawnAndHandshake(): Promise<CodexInitializeResult> {
    const bin = requireCodexBinary(this.options.env)
    const env = codexSpawnEnv(this.options.env)
    const launch = resolveCodexLaunch(bin, env)
    const child = spawn(launch.command, [...launch.args, 'app-server'], {
      cwd: this.options.cwd || process.cwd(),
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    }) as ChildProcessWithoutNullStreams

    this.child = child
    this.stdoutBuffer = ''

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.ingest(chunk))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) {
        if (line.trim()) this.options.onLog?.(line.trim())
      }
    })

    child.on('error', (err) => this.failAllPending(new CodexFault('transport', err.message)))
    child.on('exit', (code, signal) => this.handleExit(code, signal))

    const result = (await this.request<CodexInitializeResult>('initialize', {
      clientInfo: {
        name: CODEX_CLIENT_NAME,
        title: 'A.L.B.E.R.T.',
        version: process.env.ALBERT_VERSION || '0.1.0'
      },
      capabilities: CODEX_CLIENT_CAPABILITIES
    })) as CodexInitializeResult

    // Required by the protocol: acknowledge before sending anything else.
    this.notify('initialized', {})
    this.initResult = result
    this.restarts = 0
    return result
  }

  private ingest(chunk: string): void {
    const next = this.stdoutBuffer + chunk
    if (next.length > CODEX_STDOUT_MAX_BYTES) {
      this.stdoutBuffer = ''
      this.failAllPending(
        new CodexFault(
          'transport',
          'Codex sent an oversized protocol line, sir — the turn was stopped so the Mac app would not run out of memory.'
        )
      )
      try {
        this.child?.kill('SIGTERM')
      } catch {
        /* ignore */
      }
      return
    }
    const { messages, rest } = decodeJsonLines(next)
    this.stdoutBuffer = rest
    for (const message of messages) this.dispatch(message)
  }

  private dispatch(message: JsonRpcMessage): void {
    // Response to one of our requests.
    if (message.id !== undefined && message.method === undefined) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (pending.timer) clearTimeout(pending.timer)
      if (message.error) {
        pending.reject(
          new CodexFault(
            'transport',
            message.error.message || `Codex rejected ${pending.method}`,
            JSON.stringify(message.error)
          )
        )
      } else {
        pending.resolve(message.result)
      }
      return
    }

    // Server→client request: must be answered with the same id.
    if (message.id !== undefined && message.method) {
      void this.answerServerRequest(message.id, message.method, message.params)
      return
    }

    if (message.method) {
      this.options.onNotification?.(message.method, message.params)
    }
  }

  private async answerServerRequest(
    id: number | string,
    method: string,
    params: unknown
  ): Promise<void> {
    const handler = this.options.onServerRequest
    if (!handler) {
      this.write({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Unhandled server request: ${method}` }
      })
      return
    }
    try {
      const result = await handler(method, params)
      this.write({ jsonrpc: '2.0', id, result: result ?? {} })
    } catch (err) {
      this.write({
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: err instanceof Error ? err.message : String(err) }
      })
    }
  }

  private handleExit(code: number | null, signal: string | null): void {
    this.child = null
    this.initResult = null
    this.failAllPending(
      new CodexFault(
        'transport',
        code === 127
          ? "Codex couldn't start, sir — its Node shim wasn't on PATH. Reopen A.L.B.E.R.T. after installing Node 22+ (Homebrew or nvm)."
          : `Codex app-server exited (code ${code ?? 'null'}), sir.`
      )
    )
    this.options.onExit?.(code, signal)

    if (this.disposed) return
    // Clean shutdowns (we asked) don't need a restart; crashes do.
    if (code === 0 && signal === null) return
    const delay = RESTART_BACKOFF_MS[Math.min(this.restarts, RESTART_BACKOFF_MS.length - 1)]!
    this.restarts += 1
    setTimeout(() => {
      if (this.disposed) return
      void this.start().catch(() => {
        // Next request surfaces the fault; nothing useful to do here.
      })
    }, delay).unref?.()
  }

  private failAllPending(err: Error): void {
    for (const [, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer)
      pending.reject(err)
    }
    this.pending.clear()
  }

  private write(message: Record<string, unknown>): void {
    const child = this.child
    if (!child || child.stdin.destroyed) {
      throw new CodexFault('transport', 'Codex app-server is not running, sir.')
    }
    child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  /** Fire-and-forget notification (no id, no response). */
  notify(method: string, params?: unknown): void {
    this.write({ jsonrpc: '2.0', method, params: params ?? {} })
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    // `initialize` is the one request allowed before the handshake completes.
    if (method !== 'initialize' && !this.running) await this.start()

    const id = this.nextId++
    const timeoutMs = this.options.requestTimeoutMs ?? 120_000

    return new Promise<T>((resolve, reject) => {
      const timer = timeoutMs
        ? setTimeout(() => {
            this.pending.delete(id)
            reject(new CodexFault('transport', `Codex request timed out: ${method}`))
          }, timeoutMs)
        : null
      timer?.unref?.()

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        method,
        timer
      })

      try {
        this.write({ jsonrpc: '2.0', id, method, params: params ?? {} })
      } catch (err) {
        this.pending.delete(id)
        if (timer) clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  /** Graceful stop; safe to call repeatedly. */
  stop(): void {
    this.disposed = true
    const child = this.child
    this.child = null
    this.initResult = null
    this.failAllPending(new CodexFault('transport', 'Codex bridge stopped, sir.'))
    if (!child) return
    try {
      child.stdin.end()
    } catch {
      // Already gone.
    }
    child.kill('SIGTERM')
    setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL')
    }, 2_000).unref?.()
  }
}
