import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

type NativeResponse = { id: number; ok: boolean; result?: Record<string, unknown>; error?: { code?: string; message?: string } }
type Pending = { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }

/** A single owner for the helper's real AX references. Cancellation destroys them. */
export class NativeDesktopClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private pending = new Map<number, Pending>()
  private nextId = 0
  private queue: Promise<unknown> = Promise.resolve()

  private executable: () => string
  private launch: typeof spawn
  constructor(executable: () => string, launch: typeof spawn = spawn) {
    this.executable = executable
    this.launch = launch
  }

  dispose(reason = 'Desktop work stopped. Inspect the window again before continuing.'): void {
    const child = this.child
    this.child = null
    for (const entry of this.pending.values()) entry.reject(new Error(reason))
    this.pending.clear()
    if (child) {
      child.kill('SIGTERM')
      // Let a drag release its mouse button before escalating a hung helper.
      const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }, 2500)
      timer.unref()
      child.once('exit', () => clearTimeout(timer))
    }
  }

  request(payload: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const run = this.queue.then(() => this.send(payload, signal))
    this.queue = run.catch(() => undefined)
    return run
  }

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child
    const child = this.launch(this.executable(), [], { stdio: ['pipe', 'pipe', 'pipe'] }) as ChildProcessWithoutNullStreams
    this.child = child
    let buffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (this.child !== child) return
      buffer += chunk
      if (Buffer.byteLength(buffer) > 4_000_000) { this.dispose('Desktop helper response exceeded its limit.'); return }
      for (;;) {
        const end = buffer.indexOf('\n')
        if (end < 0) break
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        try {
          const response = JSON.parse(line) as NativeResponse
          const pending = this.pending.get(response.id)
          if (!pending) continue
          this.pending.delete(response.id)
          if (response.ok) pending.resolve(response.result ?? {})
          else pending.reject(new Error(`${response.error?.code || 'desktop_error'}: ${response.error?.message || 'Desktop operation failed.'}`))
        } catch { this.dispose('Desktop helper returned an invalid response.'); return }
      }
    })
    // Drain stderr without retaining UI text or accidentally logging it.
    child.stderr.on('data', () => undefined)
    child.on('error', (error) => { if (this.child === child) this.dispose(error.message) })
    child.on('exit', () => { if (this.child === child) this.dispose('Desktop helper exited. Inspect the window again.') })
    return child
  }

  private send(payload: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (signal?.aborted) return Promise.reject(new Error('Desktop work was interrupted before it ran.'))
    const child = this.ensureChild()
    return new Promise((resolve, reject) => {
      const id = ++this.nextId
      const abort = (): void => this.dispose('Desktop work interrupted. Inspect the window again before continuing.')
      const timer = setTimeout(() => this.dispose('Desktop operation timed out. Inspect the window again.'), 12_000)
      const finish = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
      this.pending.set(id, {
        resolve: (result) => { finish(); resolve(result) },
        reject: (error) => { finish(); reject(error) }
      })
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) { abort(); return }
      child.stdin.write(JSON.stringify({ ...payload, id }) + '\n', (error) => {
        if (error && this.child === child) this.dispose(error.message)
      })
    })
  }
}
