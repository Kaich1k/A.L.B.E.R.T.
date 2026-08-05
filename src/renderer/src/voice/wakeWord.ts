import { repairAlbertMentions } from '../../../shared/albertName'
import { decodeBlobToMono16k, trimSilence } from './audio'

type WakeCallback = () => void

const TRAILING_WAKE_FILLER = /^(please|now|thanks|thank|you|already|man|dude|sir)$/i

const WAKE_WHISPER_PROMPT = 'Albert wake up. Wake up Albert. Hey Albert.'

/** Normalize STT quirks before matching wake phrases. */
export function normalizeWakeText(text: string): string {
  return repairAlbertMentions(text, { aggressive: true })
    .toLowerCase()
    .replace(
      /\b(what|week|make|wakee|woke|wait|weigh|wayne|work|walk|way|weight|bake|fake|lake|vague)\s+(up|cup|app|of|op)\b/g,
      'wake up'
    )
    .replace(/\bmakeup\b/g, 'wake up')
    .replace(/\bwake[\s\-]+up\b/g, 'wake up')
    .replace(/\bwakeup\b/g, 'wake up')
    .replace(/\b(waken|awaken|waking)\b/g, 'wake')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function hasAlbert(words: string[]): boolean {
  return words.some((w) => w === 'albert')
}

function hasWake(words: string[]): boolean {
  const joined = words.join(' ')
  return /\bwake(\s+up)?\b/.test(joined) || words.includes('wakeup')
}

export function isWakePhrase(text: string): boolean {
  const t = normalizeWakeText(text)
  if (!t) return false

  const words = t.split(/\s+/).filter(Boolean)
  while (words.length && TRAILING_WAKE_FILLER.test(words[words.length - 1]!)) {
    words.pop()
  }
  if (!words.length || words.length > 40) return false

  const joined = words.join(' ')

  for (let i = 0; i <= words.length - 3; i++) {
    const triple = `${words[i]} ${words[i + 1]} ${words[i + 2]}`
    if (triple === 'albert wake up' || triple === 'wake up albert') return true
  }
  for (let i = 0; i <= words.length - 2; i++) {
    const pair = `${words[i]} ${words[i + 1]}`
    if (
      pair === 'albert wake' ||
      pair === 'wake albert' ||
      pair === 'albert up'
    ) {
      return true
    }
  }

  if (/\balbert\b.{0,32}\bwake(\s+up)?\b/.test(joined)) return true
  if (/\bwake(\s+up)?\b.{0,32}\balbert\b/.test(joined)) return true
  if (/\balbert\b.{0,16}\bup\b/.test(joined)) return true
  if (/\bup\b.{0,16}\balbert\b/.test(joined)) return true

  if (/\b(hey|yo|okay|ok|hi|hello)\s+albert\b/.test(joined)) return true

  if (words.length <= 14 && hasAlbert(words) && hasWake(words)) return true

  return false
}

export function isWakeWordSupported(): boolean {
  return Boolean(navigator.mediaDevices?.getUserMedia)
}

function peakAbs(samples: Float32Array): number {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]!)
    if (a > peak) peak = a
  }
  return peak
}

/**
 * Wake listener — ALWAYS recording while armed (voice-session style).
 *
 * Prior bugs:
 * 1) Onset-gated MediaRecorder never started when Analyser looked “silent”
 * 2) Max segment length used spokeMs (never grew) → recorder stuck open forever
 * 3) Web Speech + getUserMedia together fight over the mic in Electron — Whisper only
 */
export class WakeWordListener {
  private wanted = false
  private paused = false
  private busy = false
  private starting = false
  private segmentGen = 0

  private stream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private silentGain: GainNode | null = null
  private mediaRecorder: MediaRecorder | null = null
  private levelBuffer: Uint8Array<ArrayBuffer> | null = null
  private pollTimer = 0
  private restartTimer = 0
  private spokeMs = 0
  private silenceMs = 0
  private segmentStartedAt = 0
  private recording = false

  private lastFireAt = 0
  private lastStatusArmed: boolean | null = null
  private pendingQueue: Blob[] = []

  private readonly onWake: WakeCallback
  private readonly onStatus: (armed: boolean, detail?: string) => void

  private readonly cooldownMs = 1500
  private readonly speechRms = 0.018
  private readonly minSpeechMs = 250
  private readonly silenceToEndMs = 900
  /** Hard cut even if VAD never marks speech */
  private readonly maxSegmentMs = 2800
  private readonly minSegmentMs = 900

  constructor(onWake: WakeCallback, onStatus: (armed: boolean, detail?: string) => void) {
    this.onWake = onWake
    this.onStatus = onStatus
  }

  start(): void {
    this.wanted = true
    this.paused = false
    void this.ensureRunning()
  }

  stop(): void {
    this.wanted = false
    this.paused = false
    this.teardownCapture()
    this.emitStatus(false)
  }

  pause(): void {
    if (this.paused) return
    this.paused = true
    this.teardownCapture()
    this.emitStatus(false, 'paused')
  }

  resume(): void {
    if (!this.wanted) return
    if (!this.paused && this.stream && this.analyser) {
      this.emitStatus(true)
      if (!this.pollTimer) this.pollLevels()
      if (!this.recording) this.beginSegment()
      return
    }
    this.paused = false
    void this.ensureRunning()
  }

  private emitStatus(armed: boolean, detail?: string): void {
    if (this.lastStatusArmed === armed && !detail) return
    this.lastStatusArmed = armed
    this.onStatus(armed, detail)
  }

  private tryFire(text: string): boolean {
    if (this.paused || !this.wanted) return false
    // Surface what Whisper heard so Home/Comm can show diagnostics
    this.onStatus(true, `heard:${text.slice(0, 80)}`)
    if (!isWakePhrase(text)) {
      console.warn('[wake] no match:', text)
      return false
    }
    const now = Date.now()
    if (now - this.lastFireAt < this.cooldownMs) return false
    this.lastFireAt = now
    console.info('[wake] matched:', text)
    this.onWake()
    return true
  }

  private teardownCapture(): void {
    this.segmentGen += 1
    if (this.pollTimer) window.clearTimeout(this.pollTimer)
    if (this.restartTimer) window.clearTimeout(this.restartTimer)
    this.pollTimer = 0
    this.restartTimer = 0
    this.recording = false
    this.spokeMs = 0
    this.silenceMs = 0
    this.busy = false
    this.pendingQueue = []
    this.starting = false

    try {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.ondataavailable = null
        this.mediaRecorder.onstop = null
        this.mediaRecorder.stop()
      }
    } catch {
      /* ignore */
    }
    this.mediaRecorder = null

    try {
      this.silentGain?.disconnect()
    } catch {
      /* ignore */
    }
    try {
      this.analyser?.disconnect()
    } catch {
      /* ignore */
    }
    this.silentGain = null
    this.analyser = null
    void this.audioContext?.close().catch(() => undefined)
    this.audioContext = null
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
  }

  private async ensureRunning(): Promise<void> {
    if (!this.wanted || this.paused || this.starting) return
    if (this.stream?.getTracks().some((t) => t.readyState === 'live') && this.analyser) {
      if (!this.pollTimer) this.pollLevels()
      if (!this.recording) this.beginSegment()
      this.emitStatus(true)
      return
    }

    this.starting = true
    try {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: true,
            channelCount: 1
          }
        })
      } catch (err) {
        console.warn('[wake] getUserMedia failed', err)
        this.wanted = false
        this.emitStatus(false, 'mic-denied')
        return
      }

      if (!this.wanted || this.paused) {
        this.teardownCapture()
        return
      }

      try {
        void window.albert.warmVoice()
      } catch {
        /* ignore */
      }

      this.audioContext = new AudioContext()
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume().catch(() => undefined)
      }
      const source = this.audioContext.createMediaStreamSource(this.stream)
      this.analyser = this.audioContext.createAnalyser()
      this.analyser.fftSize = 2048
      this.silentGain = this.audioContext.createGain()
      this.silentGain.gain.value = 0
      source.connect(this.analyser)
      this.analyser.connect(this.silentGain)
      this.silentGain.connect(this.audioContext.destination)

      this.emitStatus(true)
      this.beginSegment()
      this.pollLevels()
    } finally {
      this.starting = false
    }
  }

  private beginSegment(): void {
    if (!this.stream || this.paused || !this.wanted) return
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') return

    const gen = this.segmentGen
    const chunks: Blob[] = []
    this.spokeMs = 0
    this.silenceMs = 0
    this.segmentStartedAt = Date.now()
    this.recording = true

    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : ''

    let recorder: MediaRecorder
    try {
      recorder = mime
        ? new MediaRecorder(this.stream, { mimeType: mime })
        : new MediaRecorder(this.stream)
    } catch (err) {
      console.warn('[wake] MediaRecorder create failed', err)
      this.recording = false
      return
    }

    this.mediaRecorder = recorder
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    recorder.onstop = () => {
      if (gen !== this.segmentGen) return
      if (this.mediaRecorder === recorder) this.mediaRecorder = null
      this.recording = false
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
      void this.handleClip(blob)
      // Immediately arm the next slice while armed
      if (this.wanted && !this.paused) {
        this.restartTimer = window.setTimeout(() => {
          if (this.wanted && !this.paused && !this.recording) this.beginSegment()
        }, 40)
      }
    }

    try {
      recorder.start(100)
    } catch (err) {
      console.warn('[wake] recorder.start failed', err)
      this.mediaRecorder = null
      this.recording = false
    }
  }

  private pollLevels(): void {
    if (!this.wanted || this.paused || !this.analyser) return

    if (this.audioContext?.state === 'suspended') {
      void this.audioContext.resume().catch(() => undefined)
    }

    if (!this.levelBuffer || this.levelBuffer.length !== this.analyser.fftSize) {
      this.levelBuffer = new Uint8Array(this.analyser.fftSize) as Uint8Array<ArrayBuffer>
    }
    this.analyser.getByteTimeDomainData(this.levelBuffer)
    let sum = 0
    for (let i = 0; i < this.levelBuffer.length; i++) {
      const v = (this.levelBuffer[i]! - 128) / 128
      sum += v * v
    }
    const rms = Math.sqrt(sum / this.levelBuffer.length)
    const speaking = rms > this.speechRms
    const tickMs = 50
    const elapsed = Date.now() - this.segmentStartedAt

    if (this.recording) {
      if (speaking) {
        this.spokeMs += tickMs
        this.silenceMs = 0
      } else if (this.spokeMs > this.minSpeechMs * 0.3) {
        this.silenceMs += tickMs
      }

      const speechThenSilence =
        this.spokeMs >= this.minSpeechMs && this.silenceMs >= this.silenceToEndMs
      // Wall-clock cut — never depend on spokeMs growing (VAD can be stuck)
      const timedOut = elapsed >= this.maxSegmentMs && elapsed >= this.minSegmentMs

      if (speechThenSilence || timedOut) {
        this.finishSegment()
      }
    } else if (this.wanted && !this.paused) {
      // Safety: if somehow not recording, restart
      this.beginSegment()
    }

    this.pollTimer = window.setTimeout(() => this.pollLevels(), tickMs)
  }

  private finishSegment(): void {
    const rec = this.mediaRecorder
    if (!rec || rec.state !== 'recording') return
    try {
      rec.stop()
    } catch {
      /* ignore */
    }
  }

  private async handleClip(blob: Blob): Promise<void> {
    if (!this.wanted || this.paused) return
    if (blob.size < 800) return

    if (this.busy) {
      this.pendingQueue.push(blob)
      if (this.pendingQueue.length > 2) this.pendingQueue.shift()
      return
    }

    await this.transcribeAndFire(blob)
  }

  private async transcribeAndFire(blob: Blob): Promise<void> {
    this.busy = true
    try {
      const audio = await decodeBlobToMono16k(blob)
      const trimmed = trimSilence(audio)
      if (peakAbs(trimmed) < 0.012) return

      let capped =
        trimmed.length > 16_000 * 4 ? trimmed.subarray(trimmed.length - 16_000 * 4) : trimmed
      if (capped.length < 2400) {
        const pad = new Float32Array(2800)
        pad.set(capped, pad.length - capped.length)
        capped = pad
      }

      const text = (
        await window.albert.transcribeAudio(capped, {
          prompt: WAKE_WHISPER_PROMPT
        })
      ).trim()
      if (!text) return
      this.tryFire(text)
    } catch (err) {
      console.warn('[wake] whisper failed', err)
    } finally {
      this.busy = false
      if (this.pendingQueue.length && this.wanted && !this.paused) {
        const next = this.pendingQueue.shift()!
        void this.transcribeAndFire(next)
      }
    }
  }
}
