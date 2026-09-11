import { useAlbertStore } from '../store'
import {
  chunkForSystemTts,
  joinGapSeconds,
  segmentForSpeech,
  stripMarkdownForSpeech,
  type SpeechPause
} from '../../../shared/speechText'
import {
  isCurrentVoiceGeneration,
  shouldUseSystemTtsFallback,
  ttsRecoveryTail
} from '../../../shared/voiceReliability'

export { stripMarkdownForSpeech }

let currentAudio: HTMLAudioElement | null = null
let currentObjectUrl: string | null = null
/** Generation token — bump to invalidate in-flight stream plays */
let speakGeneration = 0

/**
 * Neural TTS is intentionally bounded. A wedged worker used to leave a voice
 * turn looking complete in Comm while no audio ever arrived. The underlying
 * IPC request may still finish later, but this turn can recover immediately.
 */
const NEURAL_TTS_TIMEOUT_MS = 25_000

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds`))
    }, timeoutMs)

    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        window.clearTimeout(timer)
        reject(error)
      }
    )
  })
}

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

function stripPunctuationEnabled(): boolean {
  return useAlbertStore.getState().settings.ttsStripPunctuation !== false
}

function systemTtsChunks(text: string): string[] {
  return chunkForSystemTts(text, stripPunctuationEnabled())
}

const TTS_SILENCE_THRESHOLD = 0.012
const TTS_EDGE_PAD_SEC = 0.01
const TTS_FADE_SEC = 0.008

function channelRms(samples: Float32Array, start: number, end: number): number {
  let sum = 0
  const n = Math.max(1, end - start)
  for (let i = start; i < end; i++) {
    const value = samples[i] || 0
    sum += value * value
  }
  return Math.sqrt(sum / n)
}

/** Leading/trailing quiet in a Kokoro/ElevenLabs clip — used to join without stacked dead air. */
function ttsActiveWindow(buffer: AudioBuffer): { offsetSec: number; durationSec: number; trailingSilentSec: number } {
  const length = buffer.length
  const sampleRate = buffer.sampleRate
  const frame = Math.max(1, Math.floor(sampleRate * 0.008))
  let firstActive = -1
  let lastActive = -1
  for (let offset = 0; offset < length; offset += frame) {
    const end = Math.min(length, offset + frame)
    let energy = 0
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      energy = Math.max(energy, channelRms(buffer.getChannelData(channel), offset, end))
    }
    if (energy >= TTS_SILENCE_THRESHOLD) {
      if (firstActive < 0) firstActive = offset
      lastActive = end
    }
  }
  if (firstActive < 0 || lastActive <= firstActive) {
    return { offsetSec: 0, durationSec: buffer.duration, trailingSilentSec: 0 }
  }
  const pad = Math.floor(sampleRate * TTS_EDGE_PAD_SEC)
  const start = Math.max(0, firstActive - pad)
  const end = Math.min(length, lastActive + pad)
  return {
    offsetSec: start / sampleRate,
    durationSec: (end - start) / sampleRate,
    trailingSilentSec: Math.max(0, (length - lastActive) / sampleRate)
  }
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
  if (!gaplessCtx || gaplessCtx.state === 'closed') gaplessCtx = new AudioContext()
  if (gaplessCtx.state === 'suspended') {
    await withTimeout(gaplessCtx.resume(), 5_000, 'Voice audio output resume')
  }
  if (gaplessCtx.state !== 'running') {
    throw new Error(`Voice audio output is ${gaplessCtx.state}`)
  }
  return gaplessCtx
}

/**
 * Decode + schedule a clip to abut the previous one (no HTMLAudio gaps).
 * Resolves when the clip is scheduled — not when it finishes playing.
 * Pauses are Web Audio gaps, never SSML.
 */
async function scheduleGaplessBase64(
  base64: string,
  options?: {
    shouldCancel?: () => boolean
    generation?: number
    onStart?: () => void
    pauseAfter?: SpeechPause
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
    audioBuffer = await withTimeout(ctx.decodeAudioData(copy), 8_000, 'Voice audio decode')
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err))
  }

  let peak = 0
  let sumSquares = 0
  let sampleCount = 0
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
    const samples = audioBuffer.getChannelData(channel)
    for (let i = 0; i < samples.length; i += 4) {
      const amplitude = Math.abs(samples[i] || 0)
      peak = Math.max(peak, amplitude)
      sumSquares += amplitude * amplitude
      sampleCount += 1
    }
  }
  const rms = sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0
  if (!Number.isFinite(audioBuffer.duration) || audioBuffer.duration <= 0 || peak < 0.001 || rms < 0.0001) {
    throw new Error('Voice synthesis returned silent audio')
  }

  if (options?.shouldCancel?.() || gen !== speakGeneration) {
    return { ended: Promise.resolve() }
  }

  const active = ttsActiveWindow(audioBuffer)
  const maxDur = Math.max(0.02, audioBuffer.duration - active.offsetSec)
  const playDuration = Math.max(0.02, Math.min(active.durationSec, maxDur))
  const fade = Math.min(TTS_FADE_SEC, playDuration / 4)
  const gap = joinGapSeconds(options?.pauseAfter ?? 'sentence', TTS_EDGE_PAD_SEC)

  const source = ctx.createBufferSource()
  source.buffer = audioBuffer
  const gain = ctx.createGain()
  source.connect(gain)
  gain.connect(ctx.destination)

  const now = ctx.currentTime
  // Abut previous clip; small pad only when the timeline is idle
  const previousNextTime = gaplessNextTime
  const startAt = gaplessNextTime > now + 0.005 ? gaplessNextTime : now + 0.015
  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.linearRampToValueAtTime(1, startAt + fade)
  gain.gain.setValueAtTime(1, startAt + Math.max(fade, playDuration - fade))
  gain.gain.linearRampToValueAtTime(0.0001, startAt + playDuration)
  gaplessNextTime = startAt + playDuration + gap

  gaplessSources.add(source)
  let startPollTimer = 0
  let safetyTimer = 0
  let renderingStarted = false
  let settled = false
  let abortEnded = (): void => undefined
  const ended = new Promise<void>((resolve, reject) => {
    const cancelled = (): boolean =>
      Boolean(options?.shouldCancel?.() || gen !== speakGeneration)
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      window.clearTimeout(startPollTimer)
      window.clearTimeout(safetyTimer)
      gaplessSources.delete(source)
      source.onended = null
      if (error) {
        try {
          source.stop()
        } catch {
          /* already stopped */
        }
      }
      try {
        source.disconnect()
      } catch {
        /* already disconnected */
      }
      try {
        gain.disconnect()
      } catch {
        /* already disconnected */
      }
      if (error) reject(error)
      else resolve()
    }
    abortEnded = () => finish()

    const markStartedFromAudioClock = (): boolean => {
      if (renderingStarted) return true
      if (cancelled()) return false
      // AudioContext.currentTime advances only while the rendering graph is
      // running. This is stronger evidence than a wall-clock timeout firing.
      if (ctx.state === 'running' && ctx.currentTime >= startAt) {
        renderingStarted = true
        options?.onStart?.()
        return true
      }
      return false
    }

    const scheduledDelayMs = Math.max(0, (startAt - ctx.currentTime) * 1000)
    const startDeadline = window.performance.now() + scheduledDelayMs + 3_000
    const pollForStart = (): void => {
      if (cancelled()) {
        finish()
        return
      }
      if (markStartedFromAudioClock()) return
      if (ctx.state === 'closed' || window.performance.now() >= startDeadline) {
        finish(new Error(`Voice audio output did not start (${ctx.state})`))
        return
      }
      startPollTimer = window.setTimeout(pollForStart, 20)
    }

    source.onended = () => {
      if (cancelled()) {
        finish()
        return
      }
      if (!markStartedFromAudioClock()) {
        finish(new Error('Voice audio ended before output began'))
        return
      }
      finish()
    }
    startPollTimer = window.setTimeout(pollForStart, 0)
    safetyTimer = window.setTimeout(
      () => {
        if (cancelled()) {
          finish()
          return
        }
        const expectedEnd = startAt + playDuration
        if (markStartedFromAudioClock() && ctx.currentTime >= expectedEnd - 0.05) {
          finish()
          return
        }
        finish(new Error(`Voice audio output stalled (${ctx.state})`))
      },
      Math.max(5_000, Math.ceil((startAt - ctx.currentTime + playDuration) * 1000) + 3_000)
    )
  })
  try {
    source.start(startAt, active.offsetSec, playDuration)
  } catch (error) {
    gaplessNextTime = previousNextTime
    abortEnded()
    throw error
  }

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
  options?: { onStart?: () => void; shouldCancel?: () => boolean; append?: boolean }
): Promise<void> {
  const settings = useAlbertStore.getState().settings
  await ensureVoicesLoaded()

  const voice = pickVoice(settings.ttsVoice || '')
  const rate = Math.min(2, Math.max(0.5, settings.ttsRate || 1.22))
  const pitch = Math.min(2, Math.max(0, settings.ttsPitch ?? 1))

  if (
    !options?.append &&
    (window.speechSynthesis.speaking || window.speechSynthesis.pending)
  ) {
    window.speechSynthesis.cancel()
  }
  try {
    window.speechSynthesis.resume()
  } catch {
    /* ignore */
  }
  let announced = false

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    if (options?.shouldCancel?.()) {
      window.speechSynthesis.cancel()
      return
    }

    await new Promise<void>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(chunk)
      utterance.rate = rate
      utterance.pitch = pitch
      utterance.volume = 1
      if (voice) utterance.voice = voice
      let started = false
      let settled = false
      let startTimer = 0
      let completionTimer = 0
      let statePollTimer = 0
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        window.clearTimeout(startTimer)
        window.clearTimeout(completionTimer)
        window.clearTimeout(statePollTimer)
        utterance.onstart = null
        utterance.onend = null
        utterance.onerror = null
        if (error) reject(error)
        else resolve()
      }
      const pollNativeState = (): void => {
        if (settled || !started) return
        if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
          finish()
          return
        }
        statePollTimer = window.setTimeout(pollNativeState, 250)
      }
      utterance.onstart = () => {
        if (settled) return
        if (options?.shouldCancel?.()) {
          finish()
          window.speechSynthesis.cancel()
          return
        }
        started = true
        window.clearTimeout(startTimer)
        if (!announced) {
          announced = true
          options?.onStart?.()
        }
        const wordCount = Math.max(1, chunk.trim().split(/\s+/).length)
        const estimatedMs = (wordCount / Math.max(90, 180 * rate)) * 60_000
        completionTimer = window.setTimeout(() => {
          finish(new Error('System voice playback did not finish'))
          window.speechSynthesis.cancel()
        }, Math.min(180_000, Math.max(15_000, estimatedMs + 15_000)))
        statePollTimer = window.setTimeout(pollNativeState, 250)
      }
      utterance.onend = () => finish()
      utterance.onerror = (event) => {
        if (
          options?.shouldCancel?.() ||
          event.error === 'canceled' ||
          event.error === 'interrupted'
        ) {
          finish()
          return
        }
        finish(new Error(`System voice playback failed (${event.error || 'unknown error'})`))
      }
      // Chromium can omit onstart. Fail quickly enough to surface the fault,
      // but never mark a merely queued utterance as successfully spoken.
      startTimer = window.setTimeout(
        () => {
          finish(new Error('System voice playback did not start'))
          window.speechSynthesis.cancel()
        },
        8_000
      )
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
    let announced = false
    let settled = false
    let startupTimer = 0
    let playbackTimer = 0
    let delayedStartTimer = 0
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      window.clearTimeout(startupTimer)
      window.clearTimeout(playbackTimer)
      window.clearTimeout(delayedStartTimer)
      audio.onended = null
      audio.onerror = null
      audio.onplaying = null
      audio.oncanplaythrough = null
      if (currentAudio === audio) currentAudio = null
      if (error) {
        audio.pause()
        audio.removeAttribute('src')
        audio.load()
      }
      if (error) reject(error)
      else resolve()
    }
    startupTimer = window.setTimeout(
      () => finish(new Error(`${label} audio playback did not start`)),
      8_000
    )

    audio.onended = () => finish()
    audio.onerror = () => {
      if (options?.shouldCancel?.() || gen !== speakGeneration) finish()
      else finish(new Error(`${label} audio playback failed`))
    }
    audio.onplaying = () => {
      if (settled) return
      window.clearTimeout(startupTimer)
      const durationMs = Number.isFinite(audio.duration)
        ? Math.ceil(audio.duration * 1000) + 10_000
        : 240_000
      window.clearTimeout(playbackTimer)
      playbackTimer = window.setTimeout(
        () => finish(new Error(`${label} audio playback did not finish`)),
        Math.min(360_000, Math.max(15_000, durationMs))
      )
      if (announced) return
      announced = true
      options?.onStart?.()
    }

    const startPlay = (): void => {
      if (settled || playing) return
      if (options?.shouldCancel?.() || gen !== speakGeneration) {
        finish()
        return
      }
      playing = true
      void audio.play().catch((err) => {
        finish(err instanceof Error ? err : new Error(String(err)))
      })
    }

    if (audio.readyState >= 2) {
      startPlay()
    } else {
      audio.oncanplaythrough = () => {
        audio.oncanplaythrough = null
        startPlay()
      }
      delayedStartTimer = window.setTimeout(startPlay, 120)
    }
  })
}

type NeuralClip = {
  audio: Promise<string>
  pauseAfter: SpeechPause
}

async function playBase64Chunks(
  clips: NeuralClip[],
  _mime: string,
  label: string,
  options?: SpeakOptions & { generation?: number }
): Promise<void> {
  let activeGeneration = options?.generation
  if (!options?.append) {
    // If something cancelled this handle while synthesis was in flight, do not
    // revive it. Otherwise stop prior audio and adopt the newly-issued token.
    if (activeGeneration != null && activeGeneration !== speakGeneration) return
    stopSpeaking()
    activeGeneration = speakGeneration
  }

  let announced = false
  const endedList: Promise<void>[] = []
  for (let i = 0; i < clips.length; i++) {
    if (options?.shouldCancel?.()) {
      if (!options?.append) stopSpeaking()
      return
    }
    if (activeGeneration != null && activeGeneration !== speakGeneration) return

    let base64: string
    try {
      base64 = await withTimeout(clips[i]!.audio, NEURAL_TTS_TIMEOUT_MS, `${label} synthesis`)
    } catch (err) {
      throw unwrapIpcError(err)
    }
    if (options?.shouldCancel?.()) return
    if (activeGeneration != null && activeGeneration !== speakGeneration) return

    const { ended } = await scheduleGaplessBase64(base64, {
      shouldCancel: options?.shouldCancel,
      generation: activeGeneration,
      pauseAfter: clips[i]!.pauseAfter,
      onStart: () => {
        if (!announced) {
          announced = true
          options?.onStart?.()
        }
      }
    })
    endedList.push(ended)
  }
  await Promise.all(endedList)
}

type SpeakHandle = {
  play: (playOpts?: { append?: boolean }) => Promise<void>
}

async function synthesizeNeuralParts(
  text: string,
  provider: 'kokoro' | 'elevenlabs',
  options?: SpeakOptions
): Promise<{ clips: NeuralClip[]; mime: string }> {
  const settings = useAlbertStore.getState().settings
  const chunks = segmentForSpeech(text)
  if (!chunks.length) return { clips: [], mime: 'audio/wav' }

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
      clips: chunks.map((chunk) => ({
        audio: window.albert.speakElevenLabs(chunk.text, { apiKey, voiceId }),
        pauseAfter: chunk.pauseAfter
      }))
    }
  }

  const voiceId = (options?.voiceId ?? settings.kokoroVoiceId)?.trim() || 'am_michael'
  return {
    mime: 'audio/wav',
    clips: chunks.map((chunk) => ({
      audio: window.albert.speakKokoro(chunk.text, { voiceId }),
      pauseAfter: chunk.pauseAfter
    }))
  }
}

/**
 * Begin TTS work immediately (API fetch starts now). Call `play()` when the
 * prior utterance finishes so speech can overlap synthesis of the next line.
 */
export function beginSpeak(text: string, options?: SpeakOptions): SpeakHandle {
  const settings = useAlbertStore.getState().settings
  const provider = options?.provider || settings.ttsProvider || 'system'
  const generation = speakGeneration

  if (provider === 'elevenlabs' || provider === 'kokoro') {
    const started = synthesizeNeuralParts(text, provider, options)
    return {
      play: async (playOpts) => {
        const { clips, mime } = await started
        if (!clips.length) return
        return playBase64Chunks(clips, mime, provider === 'elevenlabs' ? 'ElevenLabs' : 'Kokoro', {
          ...options,
          append: playOpts?.append ?? options?.append,
          generation
        })
      }
    }
  }

  const chunks = systemTtsChunks(text)
  if (!chunks.length) {
    return { play: async () => undefined }
  }

  return {
    play: async () => {
      if (generation !== speakGeneration) return
      await speakSystem(chunks, options)
    }
  }
}

export type SpeakResult = {
  providerUsed: 'system' | 'kokoro' | 'elevenlabs'
  fallbackFrom?: 'kokoro' | 'elevenlabs'
  fallbackReason?: string
}

export async function speakText(text: string, options?: SpeakOptions): Promise<SpeakResult> {
  const settings = useAlbertStore.getState().settings
  const provider = options?.provider || settings.ttsProvider || 'system'
  let started = false
  const wrappedOptions: SpeakOptions = {
    ...options,
    onStart: () => {
      started = true
      options?.onStart?.()
    }
  }

  try {
    await beginSpeak(text, wrappedOptions).play()
    return { providerUsed: provider }
  } catch (error) {
    if (provider === 'system' || started || options?.shouldCancel?.()) throw error
    console.warn(`[voice] ${provider} TTS failed; falling back to the system voice`, error)
    await beginSpeak(text, { ...wrappedOptions, provider: 'system', append: false }).play()
    return {
      providerUsed: 'system',
      fallbackFrom: provider,
      fallbackReason: unwrapIpcError(error).message
    }
  }
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

type NeuralPartResult =
  | { ok: true; base64: string; pauseAfter: SpeechPause }
  | { ok: false; error: unknown }

type NeuralPartsResult =
  | { ok: true; parts: Promise<NeuralPartResult>[] }
  | { ok: false; error: Error }

/**
 * Streamed replies: each enqueue kicks off synthesis immediately. Clips are
 * scheduled onto a shared AudioContext timeline in order so sentence N plays
 * while N+1 (already fetching) finishes synth and abuts without dead air.
 */
export class StreamingTtsQueue {
  private scheduleChain: Promise<void> = Promise.resolve()
  private playbackEnds: Promise<void>[] = []
  private started = false
  private enqueued = 0
  private queuedText: string[] = []
  private generation = 0
  private shouldCancel: () => boolean = () => false
  private onFirstStart: (() => void) | null = null
  private onFallback: ((error: Error) => void) | null = null
  private firstFailure: Error | null = null
  private failedPieceIndex: number | null = null
  private fallbackUsed = false
  private neuralEnqueued = false

  reset(opts?: {
    shouldCancel?: () => boolean
    onFirstStart?: () => void
    onFallback?: (error: Error) => void
  }): void {
    stopSpeaking()
    this.generation = speakGeneration
    this.scheduleChain = Promise.resolve()
    this.playbackEnds = []
    this.started = false
    this.enqueued = 0
    this.queuedText = []
    this.shouldCancel = opts?.shouldCancel ?? (() => false)
    this.onFirstStart = opts?.onFirstStart ?? null
    this.onFallback = opts?.onFallback ?? null
    this.firstFailure = null
    this.failedPieceIndex = null
    this.fallbackUsed = false
    this.neuralEnqueued = false
  }

  private rememberFailure(
    error: unknown,
    generation = this.generation,
    pieceIndex?: number
  ): Error {
    const normalized = unwrapIpcError(error)
    if (isCurrentVoiceGeneration(generation, this.generation, speakGeneration)) {
      this.firstFailure ||= normalized
      if (pieceIndex != null) {
        this.failedPieceIndex =
          this.failedPieceIndex == null
            ? pieceIndex
            : Math.min(this.failedPieceIndex, pieceIndex)
      }
    }
    return normalized
  }

  enqueue(text: string): void {
    if (!stripMarkdownForSpeech(text).replace(/\s+/g, ' ').trim()) return
    if (this.shouldCancel()) return

    const gen = this.generation
    const settings = useAlbertStore.getState().settings
    const provider = settings.ttsProvider || 'system'
    const cancelled = (): boolean => this.shouldCancel() || gen !== speakGeneration
    const append = this.enqueued > 0
    const pieceIndex = this.queuedText.length
    this.enqueued += 1
    this.queuedText.push(text)

    const announce = (): void => {
      if (gen !== this.generation || gen !== speakGeneration) return
      if (this.started) return
      this.started = true
      this.onFirstStart?.()
    }

    // System voice: queue native utterances (no Web Audio). Still feed ASAP.
    if (provider === 'system') {
      this.scheduleChain = this.scheduleChain
        .then(async () => {
          if (cancelled()) return
          if (this.failedPieceIndex != null && pieceIndex > this.failedPieceIndex) return
          await speakSystem(systemTtsChunks(text), {
            shouldCancel: cancelled,
            onStart: announce,
            append
          })
        })
        .catch((error) => {
          this.rememberFailure(error, gen, pieceIndex)
        })
      return
    }

    this.neuralEnqueued = true

    // Neural: fire IPC synth NOW (overlaps prior sentence playback).
    // scheduleChain only orders decode/schedule — it must not await playback end.
    const audioParts: Promise<NeuralPartsResult> = synthesizeNeuralParts(
      text,
      provider === 'elevenlabs' ? 'elevenlabs' : 'kokoro'
    ).then(
      ({ clips }) => ({
        ok: true as const,
        parts: clips.map((clip) =>
          clip.audio.then<NeuralPartResult, NeuralPartResult>(
            (base64) => ({ ok: true, base64, pauseAfter: clip.pauseAfter }),
            (error) => ({ ok: false, error })
          )
        )
      }),
      (error) => ({
        ok: false as const,
        error: this.rememberFailure(error, gen, pieceIndex)
      })
    )

    this.scheduleChain = this.scheduleChain
      .then(async () => {
        if (cancelled()) return
        const synthesis = await audioParts
        if (!synthesis.ok) return
        if (this.failedPieceIndex != null && pieceIndex > this.failedPieceIndex) return
        for (const part of synthesis.parts) {
          if (cancelled()) return
          let partResult: NeuralPartResult
          try {
            partResult = await withTimeout(
              part,
              NEURAL_TTS_TIMEOUT_MS,
              'Neural voice synthesis'
            )
          } catch (error) {
            this.rememberFailure(error, gen, pieceIndex)
            break
          }
          if (!partResult.ok) {
            this.rememberFailure(partResult.error, gen, pieceIndex)
            break
          }
          if (cancelled()) return
          try {
            // Resolves when scheduled onto the timeline — not when audio ends
            const { ended } = await scheduleGaplessBase64(partResult.base64, {
              shouldCancel: cancelled,
              generation: gen,
              pauseAfter: partResult.pauseAfter,
              onStart: () => {
                if (gen !== this.generation || gen !== speakGeneration) return
                announce()
              }
            })
            this.playbackEnds.push(
              ended.catch((error) => {
                const recorded = this.rememberFailure(error, gen, pieceIndex)
                if (gen === this.generation && gen === speakGeneration) {
                  console.warn('[voice] Neural playback failed; stopping queued clips', recorded)
                  stopGaplessPlayback()
                }
              })
            )
          } catch (error) {
            this.rememberFailure(error, gen, pieceIndex)
            break
          }
        }
      })
      .catch(() => undefined)
  }

  get hasStarted(): boolean {
    return this.started
  }

  get usedFallback(): boolean {
    return this.fallbackUsed
  }

  async flush(): Promise<void> {
    const gen = this.generation
    const scheduleChain = this.scheduleChain
    await scheduleChain.catch(() => undefined)
    if (gen !== this.generation || gen !== speakGeneration) return
    const playbackEnds = [...this.playbackEnds]
    await Promise.all(playbackEnds)
    if (gen !== this.generation || gen !== speakGeneration) return

    // The old queue swallowed every synth/decode/playback error. That exactly
    // produced “assistant text exists, UI is listening, Albert says nothing.”
    // If no neural audio ever began, speak the whole reply through the local
    // system voice instead of silently discarding it.
    if (shouldUseSystemTtsFallback({
      enqueued: this.enqueued,
      neuralEnqueued: this.neuralEnqueued,
      started: this.started,
      cancelled: this.shouldCancel(),
      generationCurrent: this.generation === speakGeneration
    })) {
      const fallbackText = this.queuedText.join(' ').trim()
      if (!fallbackText) return
      const failure = this.firstFailure || new Error('Neural voice returned no playable audio')
      this.fallbackUsed = true
      console.warn('[voice] Streamed neural TTS failed; using the system voice', failure)
      await speakSystem(systemTtsChunks(fallbackText), {
        shouldCancel: this.shouldCancel,
        onStart: () => {
          if (gen !== this.generation || gen !== speakGeneration) return
          if (!this.started) {
            this.started = true
            this.onFirstStart?.()
          }
          this.onFallback?.(failure)
        }
      })
      return
    }

    // If an early sentence played but a later one could not synthesize or
    // render, recover only the unsaid tail through native speech. Repeating
    // the whole reply would sound like Albert started over mid-conversation.
    if (
      this.firstFailure &&
      this.started &&
      this.neuralEnqueued &&
      !this.shouldCancel() &&
      this.generation === speakGeneration
    ) {
      const unsaidTail = ttsRecoveryTail(this.queuedText, this.failedPieceIndex)
      if (unsaidTail) {
        const failure = this.firstFailure
        this.fallbackUsed = true
        await speakSystem(systemTtsChunks(unsaidTail), {
          shouldCancel: this.shouldCancel,
          onStart: () => {
            if (gen !== this.generation || gen !== speakGeneration) return
            this.onFallback?.(failure)
          }
        })
        return
      }
    }

    // A native-voice failure or a partial neural reply must remain visible.
    // Never turn a truncated/silent output into an apparently healthy turn.
    if (
      this.firstFailure &&
      !this.shouldCancel() &&
      this.generation === speakGeneration
    ) {
      throw this.firstFailure
    }
  }
}
