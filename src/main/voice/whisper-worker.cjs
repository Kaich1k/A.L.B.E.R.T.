/**
 * Isolated Node process for Whisper STT.
 * Must NOT run inside Electron's browser main — onnxruntime aborts/SIGTRAPs there
 * (seen as EXC_BREAKPOINT while waking / transcribing).
 * Launched with ELECTRON_RUN_AS_NODE=1.
 */
const { createRequire } = require('module')
const { join } = require('path')
const { mkdirSync, existsSync } = require('fs')

// Bias the decoder hard toward the assistant’s name (Whisper loves “Alfred” / “all bird”).
const WHISPER_PROMPT =
  'Albert. Hey Albert. Okay Albert. A.L.B.E.R.T. Albert. Albert wake up. Wake up Albert. Yo Albert. Albert standby. Albert take 5. Albert end voice. Albert Haiku. Albert Opus. Albert Groq. Albert Ollama. Albert Spotify. Albert YouTube. Albert Arduino. Albert Computer.'

function resolvePackageJson() {
  const candidates = [
    join(__dirname, '../../../package.json'), // dev: out/main → repo root
    join(__dirname, '../../package.json'),
    join(process.resourcesPath || '', 'app.asar', 'package.json'),
    join(process.resourcesPath || '', 'app.asar.unpacked', 'package.json'),
    join(process.resourcesPath || '', 'app', 'package.json')
  ]
  for (const p of candidates) {
    if (p && existsSync(p)) return p
  }
  throw new Error('Could not locate package.json for Whisper worker')
}

const requireFrom = createRequire(resolvePackageJson())

let asr = null
let cacheDir = null

function configureCache(dir) {
  cacheDir = dir
  mkdirSync(dir, { recursive: true })
  process.env.HF_HOME = dir
  process.env.TRANSFORMERS_CACHE = dir
  process.env.HF_HUB_CACHE = join(dir, 'hub')

  const { env } = requireFrom('@huggingface/transformers')
  env.cacheDir = dir
  env.allowRemoteModels = true
  env.useBrowserCache = false
}

function normalizeAudio(audio) {
  let peak = 0
  for (let i = 0; i < audio.length; i++) {
    const a = Math.abs(audio[i])
    if (a > peak) peak = a
  }
  if (peak < 0.01 || peak > 0.95) return audio
  const gain = Math.min(0.9 / peak, 8)
  const out = new Float32Array(audio.length)
  for (let i = 0; i < audio.length; i++) out[i] = audio[i] * gain
  return out
}

async function ensureAsr() {
  if (asr) return asr
  process.send?.({
    type: 'progress',
    status: 'loading',
    message: 'Loading speech model in worker…'
  })
  // base.en: much lower peak RAM than small.en (small was SIGTRAPing on Softmax alloc).
  // Still far better than tiny for short commands.
  const { pipeline } = requireFrom('@huggingface/transformers')
  asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base.en', {
    dtype: 'q8',
    device: 'cpu',
    progress_callback: (progress) => {
      if (!progress) return
      if (progress.status === 'progress' && typeof progress.progress === 'number') {
        process.send?.({
          type: 'progress',
          status: 'progress',
          progress: Math.round(progress.progress),
          message: `Loading speech model… ${Math.round(progress.progress)}%`
        })
      }
    }
  })
  process.send?.({ type: 'progress', status: 'ready', message: 'Speech model ready' })
  return asr
}

function samplesFromMessage(msg) {
  if (msg.pcmBase64) {
    const buf = Buffer.from(msg.pcmBase64, 'base64')
    // Copy into a fresh ArrayBuffer — ONNX dislikes sliced views sometimes
    const copy = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    return new Float32Array(copy)
  }
  if (Array.isArray(msg.samples)) {
    return Float32Array.from(msg.samples)
  }
  throw new Error('No audio samples provided')
}

process.on('message', async (msg) => {
  if (!msg || typeof msg !== 'object') return
  const { id, type } = msg
  try {
    if (type === 'init') {
      configureCache(msg.cacheDir)
      await ensureAsr()
      process.send({ type: 'ok', id, result: 'ready' })
      return
    }
    if (type === 'transcribe') {
      if (!cacheDir && msg.cacheDir) configureCache(msg.cacheDir)
      const raw = samplesFromMessage(msg)
      if (raw.length < 2400) {
        process.send({ type: 'ok', id, result: '' })
        return
      }
      // Cap length — long buffers + chunking was blowing BFCArena on Softmax
      const maxSamples = 16_000 * 20
      const clipped =
        raw.length > maxSamples ? raw.subarray(raw.length - maxSamples) : raw
      const audio = normalizeAudio(clipped)
      const model = await ensureAsr()
      process.send?.({ type: 'progress', status: 'transcribing', message: 'Transcribing…' })
      const durationSec = audio.length / 16_000
      const genOpts = {
        return_timestamps: false,
        temperature: 0,
        initial_prompt:
          typeof msg.prompt === 'string' && msg.prompt.trim()
            ? msg.prompt.trim()
            : WHISPER_PROMPT
      }
      // Only enable sliding windows for longer clips
      if (durationSec > 28) {
        genOpts.chunk_length_s = 20
        genOpts.stride_length_s = 4
      }
      const result = await model(audio, genOpts)
      const text = (Array.isArray(result) ? result[0]?.text : result.text)?.trim() || ''
      process.send({ type: 'ok', id, result: text })
      return
    }
    throw new Error(`Unknown worker message: ${type}`)
  } catch (err) {
    process.send({
      type: 'err',
      id,
      message: err instanceof Error ? err.message : String(err)
    })
  }
})

process.send?.({ type: 'progress', status: 'started', message: 'Whisper worker started' })
