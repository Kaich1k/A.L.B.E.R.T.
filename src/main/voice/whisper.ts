import { app } from 'electron'
import { mkdirSync, existsSync, copyFileSync } from 'fs'
import { join } from 'path'
import { fork, type ChildProcess } from 'child_process'
import { mergeTranscriptChunks } from '../../shared/voiceReliability'

type Pending = {
  resolve: (value: string) => void
  reject: (err: Error) => void
}

let worker: ChildProcess | null = null
let workerReady: Promise<void> | null = null
let reqId = 0
const pending = new Map<number, Pending>()
/** Serialize ASR — onnxruntime in the worker is not safe for parallel Runs. */
let queue: Promise<unknown> = Promise.resolve()

function cacheDir(): string {
  const dir = join(app.getPath('userData'), 'albert-data', 'whisper-cache')
  mkdirSync(dir, { recursive: true })
  return dir
}

function workerScriptPath(): string {
  // Packaged: prefer extraResources (plain Node can't load scripts from app.asar)
  const candidates = app.isPackaged
    ? [
        join(process.resourcesPath, 'whisper-worker.cjs'),
        join(__dirname, 'whisper-worker.cjs'),
        join(app.getAppPath(), 'out/main/whisper-worker.cjs')
      ]
    : [
        join(__dirname, 'whisper-worker.cjs'),
        join(app.getAppPath(), 'out/main/whisper-worker.cjs'),
        join(__dirname, '../../src/main/voice/whisper-worker.cjs')
      ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  throw new Error(
    'Whisper worker script missing. Rebuild with npm run update:app (whisper-worker.cjs).'
  )
}

function rejectAllPending(err: Error): void {
  for (const [, slot] of pending) slot.reject(err)
  pending.clear()
}

function ensureWorker(): Promise<void> {
  if (worker && worker.connected && workerReady) return workerReady

  const script = workerScriptPath()
  // Stay on Electron-as-Node so native onnxruntime (rebuilt for Electron ABI) loads.
  // Limit threads to cut peak RAM — whisper-small Softmax alloc was SIGTRAPing workers.
  worker = fork(script, [], {
    execPath: process.execPath,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      OMP_NUM_THREADS: '1',
      ORT_NUM_THREADS: '1',
      TOKENIZERS_PARALLELISM: 'false'
    },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc']
  })

  worker.stderr?.on('data', (buf) => {
    console.error('[whisper-worker]', buf.toString())
  })

  worker.on('message', (msg: {
    type: string
    id?: number
    message?: string
    result?: string
  }) => {
    if (msg.type === 'progress') return
    if (msg.id == null) return
    const slot = pending.get(msg.id)
    if (!slot) return
    pending.delete(msg.id)
    if (msg.type === 'ok') slot.resolve(msg.result || '')
    else slot.reject(new Error(msg.message || 'Whisper worker error'))
  })

  worker.on('exit', (code) => {
    rejectAllPending(new Error(`Whisper worker exited (${code ?? '?'})`))
    worker = null
    workerReady = null
  })

  worker.on('error', (err) => {
    console.error('[whisper-worker] error', err)
  })

  workerReady = new Promise((resolve, reject) => {
    const id = ++reqId
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('Whisper worker init timed out'))
    }, 300_000)

    pending.set(id, {
      resolve: () => {
        clearTimeout(timer)
        resolve()
      },
      reject: (e) => {
        clearTimeout(timer)
        reject(e)
      }
    })

    worker!.send({ type: 'init', id, cacheDir: cacheDir() })
  })

  return workerReady
}

function callWorker(payload: Record<string, unknown>): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!worker || !worker.connected) {
      reject(new Error('Whisper worker not running'))
      return
    }
    const id = ++reqId
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('Whisper request timed out'))
    }, 120_000)
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      reject: (e) => {
        clearTimeout(timer)
        reject(e)
      }
    })
    worker.send({ ...payload, id })
  })
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

function samplesToBase64(samples: Float32Array | number[]): string {
  const f32 =
    samples instanceof Float32Array ? samples : Float32Array.from(samples)
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength).toString('base64')
}

/** Lazy warm — safe; runs in a child Node process, not Electron main. */
export async function warmWhisper(_onProgress?: (msg: string) => void): Promise<void> {
  await ensureWorker()
}

export async function transcribeFloat32(
  samples: Float32Array | number[],
  opts?: { prompt?: string } | ((msg: string) => void)
): Promise<string> {
  const prompt =
    typeof opts === 'object' && opts && 'prompt' in opts ? opts.prompt : undefined
  const raw =
    samples instanceof Float32Array ? samples : Float32Array.from(samples)
  if (raw.length < 2400) return ''

  return enqueue(async () => {
    // Keep every word from longer turns while respecting the worker's 20-second
    // memory ceiling. A small overlap gives Whisper context at each boundary.
    const chunkSamples = 16_000 * 18
    const overlapSamples = 16_000
    const chunks: Float32Array[] = []
    for (let start = 0; start < raw.length; start += chunkSamples - overlapSamples) {
      chunks.push(raw.subarray(start, Math.min(raw.length, start + chunkSamples)))
      if (start + chunkSamples >= raw.length) break
    }

    const transcripts: string[] = []
    for (const chunk of chunks) {
      try {
        await ensureWorker()
        transcripts.push(await callWorker({
          type: 'transcribe',
          pcmBase64: samplesToBase64(chunk),
          cacheDir: cacheDir(),
          prompt
        }))
      } catch (err) {
        // Worker may have died mid-run (OOM) — retry this chunk once fresh.
        const message = err instanceof Error ? err.message : String(err)
        if (!/exited|not running/i.test(message)) throw err
        worker = null
        workerReady = null
        await ensureWorker()
        transcripts.push(await callWorker({
          type: 'transcribe',
          pcmBase64: samplesToBase64(chunk),
          cacheDir: cacheDir(),
          prompt
        }))
      }
    }
    return mergeTranscriptChunks(transcripts)
  })
}

/** Ensure worker script is available next to the compiled main bundle (dev + pack). */
export function installWhisperWorkerScript(): void {
  const dest = join(__dirname, 'whisper-worker.cjs')
  if (existsSync(dest)) return
  const src = join(app.getAppPath(), 'src/main/voice/whisper-worker.cjs')
  if (existsSync(src)) {
    try {
      copyFileSync(src, dest)
    } catch {
      /* pack uses extraResources */
    }
  }
}
