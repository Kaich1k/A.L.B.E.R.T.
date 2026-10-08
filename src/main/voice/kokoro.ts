import { join } from 'path'
import { app, BrowserWindow } from 'electron'
import { mkdirSync, existsSync, copyFileSync } from 'fs'
import { fork, type ChildProcess } from 'child_process'
import { getSettings } from '../config'
import { IpcChannels } from '../../shared/ipc'

type ProgressPayload = {
  status: string
  file?: string
  progress?: number
  message?: string
}

type Pending = {
  resolve: (value: string) => void
  reject: (err: Error) => void
}

let worker: ChildProcess | null = null
let workerReady: Promise<void> | null = null
let reqId = 0
const pending = new Map<number, Pending>()
let lastProgress: ProgressPayload | null = null

/** Curated voices for the Systems picker (id → label). */
export const KOKORO_VOICE_OPTIONS: { id: string; label: string }[] = [
  { id: 'am_michael', label: 'Michael (US male) — recommended' },
  { id: 'am_fenrir', label: 'Fenrir (US male)' },
  { id: 'am_puck', label: 'Puck (US male)' },
  { id: 'am_echo', label: 'Echo (US male)' },
  { id: 'af_bella', label: 'Bella (US female)' },
  { id: 'af_nicole', label: 'Nicole (US female)' },
  { id: 'af_heart', label: 'Heart (US female)' },
  { id: 'af_sarah', label: 'Sarah (US female)' },
  { id: 'bm_george', label: 'George (UK male)' },
  { id: 'bm_daniel', label: 'Daniel (UK male)' },
  { id: 'bf_emma', label: 'Emma (UK female)' },
  { id: 'bf_isabella', label: 'Isabella (UK female)' }
]

function emitProgress(payload: ProgressPayload): void {
  lastProgress = payload
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.ttsKokoroProgress, payload)
  }
}

function cacheDir(): string {
  const dir = join(app.getPath('userData'), 'kokoro-cache')
  mkdirSync(dir, { recursive: true })
  return dir
}

function workerScriptPath(): string {
  // Packaged: prefer extraResources (plain Node can't load scripts from app.asar)
  const candidates = app.isPackaged
    ? [
        join(process.resourcesPath, 'kokoro-worker.cjs'),
        join(__dirname, 'kokoro-worker.cjs'),
        join(app.getAppPath(), 'out/main/kokoro-worker.cjs')
      ]
    : [
        join(__dirname, 'kokoro-worker.cjs'),
        join(app.getAppPath(), 'out/main/kokoro-worker.cjs'),
        join(__dirname, '../../src/main/voice/kokoro-worker.cjs')
      ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  throw new Error(
    'Kokoro worker script missing. Rebuild with npm run update:app (kokoro-worker.cjs).'
  )
}

/** Retire only this worker; its late exit/message must not reset a replacement. */
function retireWorker(child: ChildProcess, error: Error): void {
  if (worker !== child) return
  worker = null
  workerReady = null
  const waiting = [...pending.values()]
  pending.clear()
  for (const slot of waiting) slot.reject(error)
  try {
    if (!child.killed) child.kill()
  } catch {
    /* already exited */
  }
  emitProgress({ status: 'error', message: error.message })
}

function ensureWorker(): Promise<void> {
  if (worker && worker.connected && workerReady) return workerReady

  const script = workerScriptPath()
  emitProgress({ status: 'starting', message: 'Starting Kokoro worker…' })

  const child = fork(script, [], {
    execPath: process.execPath,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1'
    },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc']
  })
  worker = child

  child.stderr?.on('data', (buf) => {
    console.error('[kokoro-worker]', buf.toString())
  })

  child.on('message', (msg: {
    type: string
    id?: number
    base64?: string
    message?: string
    status?: string
    file?: string
    progress?: number
    result?: string
  }) => {
    if (worker !== child) return
    if (msg.type === 'progress') {
      emitProgress({
        status: msg.status || 'progress',
        file: msg.file,
        progress: msg.progress,
        message: msg.message
      })
      return
    }
    if (msg.id == null) return
    const slot = pending.get(msg.id)
    if (!slot) return
    pending.delete(msg.id)
    if (msg.type === 'ok') slot.resolve(msg.base64 || msg.result || '')
    else slot.reject(new Error(msg.message || 'Kokoro worker error'))
  })

  child.on('exit', (code) => {
    const err = new Error(`Kokoro worker exited (${code ?? '?'})`)
    retireWorker(child, err)
  })

  child.on('error', (err) => {
    retireWorker(child, err)
  })

  workerReady = new Promise<void>((resolve, reject) => {
    const id = ++reqId
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('Kokoro worker init timed out'))
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

    child.send({ type: 'init', id, cacheDir: cacheDir() }, (error) => {
      if (error && worker === child) retireWorker(child, error)
    })
  }).catch((error: unknown) => {
    const failure = error instanceof Error ? error : new Error(String(error))
    // A rejected readiness promise must never be cached for the next request.
    retireWorker(child, failure)
    throw failure
  })

  return workerReady
}

function callWorker(payload: Record<string, unknown>): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!worker || !worker.connected) {
      reject(new Error('Kokoro worker not running'))
      return
    }
    const id = ++reqId
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('Kokoro request timed out'))
    }, 300_000)
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

/** Lazy warm — safe; runs in a child Node process, not Electron main. */
export async function warmKokoro(): Promise<void> {
  try {
    await ensureWorker()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    emitProgress({ status: 'error', message: `Kokoro failed: ${message}` })
    throw err
  }
}

export function getKokoroProgress(): ProgressPayload | null {
  return lastProgress
}

/** Serialize synth jobs — worker model isn't safe for parallel generate(). */
let synthQueue: Promise<unknown> = Promise.resolve()
let synthGeneration = 0

export function cancelKokoroSynthesis(): void {
  synthGeneration += 1
}

function enqueueSynth<T>(fn: () => Promise<T>): Promise<T> {
  const run = synthQueue.then(fn, fn)
  synthQueue = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

export async function synthesizeKokoro(
  text: string,
  overrides?: { voiceId?: string }
): Promise<Buffer> {
  const generation = synthGeneration
  const settings = getSettings()
  const voice =
    (overrides?.voiceId || settings.kokoroVoiceId || 'am_michael').trim() || 'am_michael'
  const cleaned = text
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2500)
  if (!cleaned) throw new Error('Nothing to speak')

  return enqueueSynth(async () => {
    if (generation !== synthGeneration) throw new Error('Kokoro synthesis cancelled')
    await ensureWorker()
    if (generation !== synthGeneration) throw new Error('Kokoro synthesis cancelled')
    const speed = Math.min(1.3, Math.max(0.7, settings.ttsRate || 1))
    const base64 = await callWorker({
      type: 'synthesize',
      text: cleaned,
      voice,
      speed,
      cacheDir: cacheDir()
    })
    if (generation !== synthGeneration) throw new Error('Kokoro synthesis cancelled')
    return Buffer.from(base64, 'base64')
  })
}

/** Ensure worker script is available next to the compiled main bundle (dev + pack). */
export function installKokoroWorkerScript(): void {
  const dest = join(__dirname, 'kokoro-worker.cjs')
  if (existsSync(dest)) return
  const src = join(app.getAppPath(), 'src/main/voice/kokoro-worker.cjs')
  if (existsSync(src)) {
    try {
      copyFileSync(src, dest)
    } catch {
      /* pack uses extraResources */
    }
  }
}
