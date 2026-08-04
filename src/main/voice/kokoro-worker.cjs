/**
 * Isolated Node process for Kokoro TTS.
 * Must NOT run inside Electron's renderer/browser main — onnxruntime SIGSEGVs there.
 * Launched with ELECTRON_RUN_AS_NODE=1.
 */
const { createRequire } = require('module')
const { join, dirname } = require('path')
const { mkdirSync, existsSync } = require('fs')

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
  throw new Error('Could not locate package.json for Kokoro worker')
}

const requireFrom = createRequire(resolvePackageJson())

let tts = null
let cacheDir = null

function encodeWav(samples, sampleRate) {
  const dataSize = samples.length * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    buffer.writeInt16LE(s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), 44 + i * 2)
  }
  return buffer
}

function configureCache(dir) {
  cacheDir = dir
  mkdirSync(dir, { recursive: true })
  process.env.HF_HOME = dir
  process.env.TRANSFORMERS_CACHE = dir
  process.env.HF_HUB_CACHE = join(dir, 'hub')

  try {
    const kokoroEntry = requireFrom.resolve('kokoro-js')
    const tfPath = requireFrom.resolve('@huggingface/transformers', {
      paths: [dirname(kokoroEntry)]
    })
    const { env } = requireFrom(tfPath)
    env.cacheDir = dir
    env.allowRemoteModels = true
    env.allowLocalModels = true
  } catch (err) {
    process.send?.({
      type: 'progress',
      status: 'warn',
      message: `Cache configure warn: ${err.message || err}`
    })
  }
}

async function ensureTts() {
  if (tts) return tts
  process.send?.({
    type: 'progress',
    status: 'loading',
    message: 'Loading Kokoro in worker…'
  })
  const { KokoroTTS } = requireFrom('kokoro-js')
  tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
    dtype: 'q8',
    device: 'cpu',
    progress_callback: (p) => {
      if (!p) return
      const pct = typeof p.progress === 'number' ? Math.round(p.progress) : undefined
      process.send?.({
        type: 'progress',
        status: p.status || 'progress',
        file: p.file,
        progress: pct,
        message:
          pct != null ? `Downloading Kokoro… ${pct}%` : p.status === 'done' ? 'Download done…' : 'Loading Kokoro…'
      })
    }
  })
  process.send?.({ type: 'progress', status: 'ready', message: 'Kokoro ready' })
  return tts
}

process.on('message', async (msg) => {
  if (!msg || typeof msg !== 'object') return
  const { id, type } = msg
  try {
    if (type === 'init') {
      configureCache(msg.cacheDir)
      await ensureTts()
      process.send({ type: 'ok', id, result: 'ready' })
      return
    }
    if (type === 'synthesize') {
      if (!cacheDir && msg.cacheDir) configureCache(msg.cacheDir)
      const model = await ensureTts()
      process.send?.({ type: 'progress', status: 'generating', message: 'Generating speech…' })
      const voice = msg.voice || 'am_michael'
      const speed = Math.min(1.3, Math.max(0.7, Number(msg.speed) || 1))
      const text = String(msg.text || '').replace(/\s+/g, ' ').trim().slice(0, 2500)
      if (!text) throw new Error('Nothing to speak')
      const audio = await model.generate(text, { voice, speed })
      if (!audio?.audio?.length) throw new Error('Kokoro returned empty audio')
      const wav = encodeWav(audio.audio, audio.sampling_rate || 24000)
      process.send({ type: 'ok', id, base64: wav.toString('base64') })
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

process.send?.({ type: 'progress', status: 'started', message: 'Kokoro worker started' })
