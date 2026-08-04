import { useAlbertStore } from '../store'

let currentAudio: HTMLAudioElement | null = null
let currentObjectUrl: string | null = null
/** Generation token — bump to invalidate in-flight stream plays */
let speakGeneration = 0

/** Shared Web Audio graph for gapless streamed clips */
let gaplessCtx: AudioContext | null = null
let gaplessNextTime = 0
const gaplessSources = new Set<AudioBufferSourceNode>()

function pickVoice(preferredName: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return null

  if (preferredName) {
    const exact = voices.find((v) => v.name === preferredName)
    if (exact) return exact
  }

  const ranked = [
    /daniel.*(enhanced|premium)/i,
    /samantha.*(enhanced|premium)/i,
    /aaron.*(enhanced|premium)/i,
    /albert/i,
    /daniel/i,
    /samantha/i,
    /alex/i,
    /victoria/i,
    /fred/i
  ]

  for (const pattern of ranked) {
    const match = voices.find((v) => pattern.test(v.name) && v.lang.startsWith('en'))
    if (match) return match
  }

  return (
    voices.find((v) => v.lang.startsWith('en') && v.localService) ||
    voices.find((v) => v.lang.startsWith('en')) ||
    voices[0] ||
    null
  )
}

/**
 * Prep text for TTS.
 * System TTS: optional punctuation strip (macOS inserts long pauses on .!?).
 * Neural (Kokoro/ElevenLabs): keep punctuation — stripping causes odd joins / “skipped” words.
 */
function prepareForSpeech(text: string, stripPunctuation: boolean): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (!collapsed) return ''
  if (!stripPunctuation) {
    return collapsed
      .replace(/[—–]/g, ' — ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  const protected_ = collapsed.replace(
    /\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|e\.g|i\.e)\./gi,
    (_, a: string) => `${a}·`
  )

  return protected_
    .replace(/[—–]/g, ' ')
    .replace(/\.\.\./g, ' ')
    .replace(/\s*[;:]\s*/g, ' ')
    .replace(/[.!?]+/g, ' ')
    .replace(/,/g, ' ')
    .replace(/·/g, '.')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripPunctuationEnabled(): boolean {
  return useAlbertStore.getState().settings.ttsStripPunctuation !== false
}

/** System TTS: almost always ONE utterance — splitting causes dead air. */
function chunkForSystemTts(text: string): string[] {
  const cleaned = prepareForSpeech(text, stripPunctuationEnabled())
  if (!cleaned) return []
  if (cleaned.length <= 1600) return [cleaned]

  const chunks: string[] = []
  let remaining = cleaned
  while (remaining.length > 1600) {
    let cut = remaining.lastIndexOf(' ', 1500)
    if (cut < 600) cut = 1500
    chunks.push(remaining.slice(0, cut).trim())
    remaining = remaining.slice(cut).trim()
  }
  if (remaining) chunks.push(remaining)
  return chunks
}

/**
 * Neural TTS: keep as one clip whenever possible. Re-splitting into ~400-char
 * pieces caused audible gaps between each synth/play handoff.
 */
function chunkForApiTts(text: string): string[] {
  const cleaned = prepareForSpeech(text, false)
  if (!cleaned) return []
  if (cleaned.length <= 2400) return [cleaned]

  const chunks: string[] = []
  let remaining = cleaned
  while (remaining.length > 2400) {
    let cut = Math.max(
      remaining.lastIndexOf('. ', 2300),
      remaining.lastIndexOf('! ', 2300),
      remaining.lastIndexOf('? ', 2300)
    )
    if (cut < 800) cut = remaining.lastIndexOf(' ', 2300)
    if (cut < 800) cut = 2300
    else cut += 1
    chunks.push(remaining.slice(0, cut).trim())
    remaining = remaining.slice(cut).trim()
  }
  if (remaining) chunks.push(remaining)
  return chunks
}

function unwrapIpcError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err)
  const nested = raw.match(/Error invoking remote method[^:]+: Error: ([\s\S]+)$/)
  return new Error(nested?.[1]?.trim() || raw)
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function base64ToObjectUrl(base64: string, mime = 'audio/mpeg'): string {
  const bytes = base64ToBytes(base64)
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  const blob = new Blob([copy], { type: mime })
  return URL.createObjectURL(blob)
}

function stopGaplessPlayback(): void {
  for (const source of gaplessSources) {
    try {
      source.stop()
    } catch {
      /* already stopped */
    }
  }
  gaplessSources.clear()
  gaplessNextTime = 0
}

async function ensureGaplessCtx(): Promise<AudioContext> {
  if (!gaplessCtx) gaplessCtx = new AudioContext()
  if (gaplessCtx.state === 'suspended') await gaplessCtx.resume()
  return gaplessCtx
}

/**
 * Decode + schedule a clip to abut the previous one (no HTMLAudio gaps).
 * Resolves when the clip is scheduled — not when it finishes playing.
 */
async function scheduleGaplessBase64(
  base64: string,
  options?: {
    shouldCancel?: () => boolean
    generation?: number
    onStart?: () => void
  }
): Promise<{ ended: Promise<void> }> {
  const gen = options?.generation ?? speakGeneration
  if (options?.shouldCancel?.() || gen !== speakGeneration) {
    return { ended: Promise.resolve() }
  }

  const ctx = await ensureGaplessCtx()
  const bytes = base64ToBytes(base64)
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  let audioBuffer: AudioBuffer
  try {
    audioBuffer = await ctx.decodeAudioData(copy)
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err))
  }

  if (options?.shouldCancel?.() || gen !== speakGeneration) {
    return { ended: Promise.resolve() }
  }

  const source = ctx.createBufferSource()
  source.buffer = audioBuffer
  source.connect(ctx.destination)

  const now = ctx.currentTime
  // Abut previous clip; small pad only when the timeline is idle
  const startAt = gaplessNextTime > now + 0.005 ? gaplessNextTime : now + 0.015
  gaplessNextTime = startAt + audioBuffer.duration

  const delayMs = Math.max(0, (startAt - ctx.currentTime) * 1000 - 5)
  if (options?.onStart) {
    window.setTimeout(() => {
      if (options.shouldCancel?.() || gen !== speakGeneration) return
      options.onStart?.()
    }, delayMs)
  }

  gaplessSources.add(source)
  const ended = new Promise<void>((resolve) => {
    source.onended = () => {
      gaplessSources.delete(source)
      resolve()
    }
  })
  source.start(startAt)
  return { ended }
}

export function listTtsVoices(): SpeechSynthesisVoice[] {
  return window.speechSynthesis
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith('en'))
    .sort((a, b) => a.name.localeCompare(b.name))
}

let voicesReady: Promise<void> | null = null

function ensureVoicesLoaded(): Promise<void> {
  if (window.speechSynthesis.getVoices().length) return Promise.resolve()
  if (!voicesReady) {
    voicesReady = new Promise<void>((resolve) => {
      const done = (): void => {
        window.speechSynthesis.onvoiceschanged = null
        resolve()
      }
      window.speechSynthesis.onvoiceschanged = done
      window.setTimeout(done, 250)
    })
  }
  return voicesReady
}

async function speakSystem(
  chunks: string[],
  options?: { onStart?: () => void; shouldCancel?: () => boolean }
): Promise<void> {
  const settings = useAlbertStore.getState().settings
  await ensureVoicesLoaded()

  const voice = pickVoice(settings.ttsVoice || '')
  const rate = Math.min(2, Math.max(0.5, settings.ttsRate || 1.22))
  const pitch = Math.min(2, Math.max(0, settings.ttsPitch ?? 1))

  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    window.speechSynthesis.cancel()
  }
  try {
    window.speechSynthesis.resume()
  } catch {
    /* ignore */
  }
  options?.onStart?.()

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    if (options?.shouldCancel?.()) {
      window.speechSynthesis.cancel()
      return
    }

    await new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(chunk)
      utterance.rate = rate
      utterance.pitch = pitch
      utterance.volume = 1
      if (voice) utterance.voice = voice
      utterance.onend = () => resolve()
      utterance.onerror = () => resolve()
      window.speechSynthesis.speak(utterance)
      try {
        window.speechSynthesis.resume()
      } catch {
        /* ignore */
      }
    })
  }
}

type SpeakOptions = {
  onStart?: () => void
  shouldCancel?: () => boolean
  provider?: 'system' | 'kokoro' | 'elevenlabs'
  apiKey?: string
  voiceId?: string
  /**
   * When true, do not call stopSpeaking() before play — used for streamed
   * clips so chunk N+1 doesn’t kill chunk N mid-word.
   */
  append?: boolean
}

async function playAudioUrl(
  src: string,
  label: string,
  options?: { onStart?: () => void; shouldCancel?: () => boolean; generation?: number }
): Promise<void> {
  const gen = options?.generation ?? speakGeneration
  await new Promise<void>((resolve, reject) => {
    if (options?.shouldCancel?.() || gen !== speakGeneration) {
      resolve()
      return
    }

    const audio = new Audio(src)
    currentAudio = audio
    let playing = false

    audio.onended = () => {
      if (currentAudio === audio) currentAudio = null
      resolve()
    }
    audio.onerror = () => {
      if (currentAudio === audio) currentAudio = null
      reject(new Error(`${label} audio playback failed`))
    }

    const startPlay = (): void => {
      if (playing) return
      if (options?.shouldCancel?.() || gen !== speakGeneration) {
        resolve()
        return
      }
      playing = true
      options?.onStart?.()
      void audio.play().catch((err) => {
        reject(err instanceof Error ? err : new Error(String(err)))
      })
    }

    if (audio.readyState >= 2) {
      startPlay()
    } else {
      audio.oncanplaythrough = () => {
        audio.oncanplaythrough = null
        startPlay()
      }
      window.setTimeout(startPlay, 120)
    }
  })
}

async function playBase64Chunks(
  chunkAudio: Promise<string>[],
  mime: string,
  label: string,
  options?: SpeakOptions & { generation?: number }
): Promise<void> {
  if (!options?.append) {
    stopSpeaking()
  }

  let announced = false
  for (let i = 0; i < chunkAudio.length; i++) {
    if (options?.shouldCancel?.()) {
      if (!options?.append) stopSpeaking()
      return
    }
    if (options?.generation != null && options.generation !== speakGeneration) return

    let base64: string
    try {
      base64 = await chunkAudio[i]!
    } catch (err) {
      throw unwrapIpcError(err)
    }
    if (options?.shouldCancel?.()) return
    if (options?.generation != null && options.generation !== speakGeneration) return

    // Gapless path for streamed appends (Kokoro/ElevenLabs)
    if (options?.append) {
      const { ended } = await scheduleGaplessBase64(base64, {
        shouldCancel: options.shouldCancel,
        generation: options.generation,
        onStart: () => {
          if (!announced) {
            announced = true
            options.onStart?.()
          }
        }
      })
      await ended
      continue
    }

    const src = base64ToObjectUrl(base64, mime)
    const prevUrl = currentObjectUrl
    currentObjectUrl = src
    if (prevUrl && prevUrl !== src) {
      window.setTimeout(() => URL.revokeObjectURL(prevUrl), 500)
    }

    await playAudioUrl(src, label, {
      shouldCancel: options?.shouldCancel,
      generation: options?.generation,
      onStart: () => {
        if (!announced) {
          announced = true
          options?.onStart?.()
        }
      }
    })
  }
}

type SpeakHandle = {
  play: (playOpts?: { append?: boolean }) => Promise<void>
}

async function synthesizeNeuralParts(
  text: string,
  provider: 'kokoro' | 'elevenlabs',
  options?: SpeakOptions
): Promise<{ parts: Promise<string>[]; mime: string }> {
  const settings = useAlbertStore.getState().settings
  const chunks = chunkForApiTts(text)
  if (!chunks.length) return { parts: [], mime: 'audio/wav' }

  if (provider === 'elevenlabs') {
    const apiKey = (options?.apiKey ?? settings.elevenLabsApiKey)?.trim()
    const voiceId = (options?.voiceId ?? settings.elevenLabsVoiceId)?.trim()
    if (!apiKey || !voiceId) {
      throw new Error(
        'ElevenLabs needs an API key and Voice ID — fill both fields, then try Preview again.'
      )
    }
    return {
      mime: 'audio/mpeg',
      parts: chunks.map((chunk) => window.albert.speakElevenLabs(chunk, { apiKey, voiceId }))
    }
  }

  const voiceId = (options?.voiceId ?? settings.kokoroVoiceId)?.trim() || 'am_michael'
  return {
    mime: 'audio/wav',
    parts: chunks.map((chunk) => window.albert.speakKokoro(chunk, { voiceId }))
  }
}

/**
 * Begin TTS work immediately (API fetch starts now). Call `play()` when the
 * prior utterance finishes so speech can overlap synthesis of the next line.
 */
export function beginSpeak(text: string, options?: SpeakOptions): SpeakHandle {
  const settings = useAlbertStore.getState().settings
  const provider = options?.provider || settings.ttsProvider || 'system'
  const chunks =
    provider === 'system' ? chunkForSystemTts(text) : chunkForApiTts(text)
  if (!chunks.length) {
    return { play: async () => undefined }
  }

  const generation = speakGeneration

  if (provider === 'elevenlabs' || provider === 'kokoro') {
    const started = synthesizeNeuralParts(text, provider, options)
    return {
      play: async (playOpts) => {
        const { parts, mime } = await started
        return playBase64Chunks(parts, mime, provider === 'elevenlabs' ? 'ElevenLabs' : 'Kokoro', {
          ...options,
          append: playOpts?.append ?? options?.append,
          generation
        })
      }
    }
  }

  return {
    play: async () => {
      if (generation !== speakGeneration) return
      await speakSystem(chunks, options)
    }
  }
}

export async function speakText(text: string, options?: SpeakOptions): Promise<void> {
  await beginSpeak(text, options).play()
}

export function stopSpeaking(): void {
  speakGeneration += 1
  window.speechSynthesis.cancel()
  stopGaplessPlayback()
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.src = ''
    currentAudio = null
  }
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl)
    currentObjectUrl = null
  }
}

/**
 * Streamed replies: synth starts on enqueue; clips are scheduled on a shared
 * AudioContext timeline so sentence N+1 abuts N with no HTMLAudio dead air.
 */
export class StreamingTtsQueue {
  private scheduleChain: Promise<void> = Promise.resolve()
  private playbackEnds: Promise<void>[] = []
  private started = false
  private generation = 0
  private shouldCancel: () => boolean = () => false
  private onFirstStart: (() => void) | null = null

  reset(opts?: { shouldCancel?: () => boolean; onFirstStart?: () => void }): void {
    stopSpeaking()
    this.generation = speakGeneration
    this.scheduleChain = Promise.resolve()
    this.playbackEnds = []
    this.started = false
    this.shouldCancel = opts?.shouldCancel ?? (() => false)
    this.onFirstStart = opts?.onFirstStart ?? null
  }

  enqueue(text: string): void {
    const piece = text.replace(/\s+/g, ' ').trim()
    if (!piece) return
    if (this.shouldCancel()) return

    const gen = this.generation
    const settings = useAlbertStore.getState().settings
    const provider = settings.ttsProvider || 'system'
    const cancelled = (): boolean => this.shouldCancel() || gen !== speakGeneration

    const announce = (): void => {
      if (this.started) return
      this.started = true
      this.onFirstStart?.()
    }

    // System voice: no Web Audio buffers — keep sequential utterance play
    if (provider === 'system') {
      this.scheduleChain = this.scheduleChain
        .then(async () => {
          if (cancelled()) return
          await speakSystem(chunkForSystemTts(piece), {
            shouldCancel: cancelled,
            onStart: announce
          })
        })
        .catch(() => undefined)
      return
    }

    // Neural: start synth immediately; schedule onto gapless timeline in order
    const synthPromise = synthesizeNeuralParts(
      piece,
      provider === 'elevenlabs' ? 'elevenlabs' : 'kokoro'
    ).catch((err) => {
      throw unwrapIpcError(err)
    })

    this.scheduleChain = this.scheduleChain
      .then(async () => {
        if (cancelled()) return
        let parts: Promise<string>[]
        try {
          ;({ parts } = await synthPromise)
        } catch {
          return
        }
        for (const part of parts) {
          if (cancelled()) return
          let base64: string
          try {
            base64 = await part
          } catch {
            return
          }
          if (cancelled()) return
          try {
            const { ended } = await scheduleGaplessBase64(base64, {
              shouldCancel: cancelled,
              generation: gen,
              onStart: announce
            })
            this.playbackEnds.push(ended)
          } catch {
            return
          }
        }
      })
      .catch(() => undefined)
  }

  get hasStarted(): boolean {
    return this.started
  }

  async flush(): Promise<void> {
    await this.scheduleChain.catch(() => undefined)
    await Promise.all(this.playbackEnds.map((p) => p.catch(() => undefined)))
  }
}
