import { decodeBlobToMono16k } from './audio'

type WakeCallback = () => void

const TRAILING_WAKE_FILLER = /^(please|now|thanks|thank|you|already|man|dude|sir)$/i

const WAKE_WHISPER_PROMPT =
  'Albert wake up. Hey Albert. Wake up Albert. Okay Albert. Yo Albert.'

/** Normalize STT quirks before matching wake phrases. */
export function normalizeWakeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/a\.?\s*l\.?\s*b\.?\s*e\.?\s*r\.?\s*t\.?/g, 'albert')
    .replace(/\bal\s*bert\b/g, 'albert')
    .replace(/\b(elbert|alberts|albert'?s|olbert|allbert|albird|albertt|alburt|halbert)\b/g, 'albert')
    .replace(/\b(all|ol|old|ow|ill|i'?ll)\s+(bird|burt|bert|but|burp|bred|bet)\b/g, 'albert')
    .replace(/\ba\s+bert\b/g, 'albert')
    .replace(/\b(what|week|make|wakee|woke|wait|weigh|wayne|work|walk|way|weight|bake|fake|lake)\s+(up|cup|app|of|op)\b/g, 'wake up')
    .replace(/\bmakeup\b/g, 'wake up')
    .replace(/\bwake[\s\-]+up\b/g, 'wake up')
    .replace(/\bwakeup\b/g, 'wake up')
    .replace(/\b(waken|awaken)\b/g, 'wake')
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

/**
 * Wake if the utterance contains the activation triad (lead-in / trailing fluff OK).
 * Kept loose — Whisper often drops “up” or mangles the name.
 */
export function isWakePhrase(text: string): boolean {
  const t = normalizeWakeText(text)
  if (!t) return false

  const words = t.split(/\s+/).filter(Boolean)
  while (words.length && TRAILING_WAKE_FILLER.test(words[words.length - 1]!)) {
    words.pop()
  }
  if (!words.length) return false
  if (words.length > 40) return false

  const joined = words.join(' ')

  for (let i = 0; i <= words.length - 3; i++) {
    const triple = `${words[i]} ${words[i + 1]} ${words[i + 2]}`
    if (triple === 'albert wake up' || triple === 'wake up albert') return true
  }

  for (let i = 0; i <= words.length - 2; i++) {
    const pair = `${words[i]} ${words[i + 1]}`
    if (pair === 'albert wake' || pair === 'wake albert') return true
  }

  if (/\balbert\b.{0,24}\bwake(\s+up)?\b/.test(joined)) return true
  if (/\bwake(\s+up)?\b.{0,24}\balbert\b/.test(joined)) return true

  const last2 = words.slice(-2).join(' ')
  if (last2 === 'wake up') {
    // Require name — bare “wake up” from TV/noise is too easy to false-fire
    if (hasAlbert(words)) return true
  }

  if (/\b(hey|yo|okay|ok|hi|hello)\s+albert\b/.test(joined)) return true
  if (last2 === 'hey albert' || last2 === 'okay albert' || last2 === 'ok albert') return true

  if (words.length <= 12 && hasAlbert(words) && hasWake(words)) return true

  return false
}

export function isWakeWordSupported(): boolean {
  return Boolean(navigator.mediaDevices?.getUserMedia)
}

/** Trim leading/trailing near-silence so Whisper sees the phrase, not dead air. */
function trimSilence(samples: Float32Array, sampleRate = 16_000): Float32Array {
  const thresh = 0.018
  let start = 0
  while (start < samples.length && Math.abs(samples[start]!) < thresh) start++
  let end = samples.length - 1
  while (end > start && Math.abs(samples[end]!) < thresh) end--
  if (end <= start) return samples
  const pad = Math.floor(sampleRate * 0.12)
  start = Math.max(0, start - pad)
  end = Math.min(samples.length - 1, end + pad)
  return samples.subarray(start, end + 1)
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
 * Always-on wake listener.
 *
 * Critical design: do NOT keep MediaRecorder running while Whisper is busy, and
 * do NOT freeze VAD during ASR. Wait for speech onset → record → silence end →
 * transcribe → then arm for the next onset. That matches ClaudeVoiceSession and
 * stops the “say it twice” failure mode.
 */
export class WakeWordListener {
  private wanted = false
  private paused = false
  private busy = false
  private starting = false

  private stream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private mediaRecorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private levelBuffer: Uint8Array<ArrayBuffer> | null = null
  private pollTimer = 0
  private spokeMs = 0
  private silenceMs = 0
  private onsetHoldMs = 0
  private recording = false

  private lastFireAt = 0
  private lastStatusArmed: boolean | null = null
  /** Up to two deferred clips while Whisper runs (rare with serial capture). */
  private pendingQueue: Blob[] = []
  private readonly onWake: WakeCallback
  private readonly onStatus: (armed: boolean, detail?: string) => void
  private readonly cooldownMs = 800
  private readonly speechRms = 0.034
  private readonly onsetHoldNeedMs = 90
  private readonly minSpeechMs = 280
  private readonly silenceToEndMs = 850

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
    if (!isWakePhrase(text)) return false
    const now = Date.now()
    if (now - this.lastFireAt < this.cooldownMs) return false
    this.lastFireAt = now
    this.onWake()
    return true
  }

  private teardownCapture(): void {
    if (this.pollTimer) window.clearTimeout(this.pollTimer)
    this.pollTimer = 0
    this.recording = false
    this.spokeMs = 0
    this.silenceMs = 0
    this.onsetHoldMs = 0
    this.chunks = []
    this.busy = false
    this.pendingQueue = []
    this.starting = false

    try {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.onstop = null
        this.mediaRecorder.stop()
      }
    } catch {
      /* ignore */
    }
    this.mediaRecorder = null
    this.analyser?.disconnect()
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
      this.emitStatus(true)
      return
    }

    this.starting = true
    try {
      try {
        // Weaker AEC/NS — wake phrases are short; heavy processing can chew “up”
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            channelCount: 1
          }
        })
      } catch {
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
        void window.albert.warmKokoro()
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
      source.connect(this.analyser)

      // Arm for speech onset — do not record silence forever
      this.recording = false
      this.emitStatus(true)
      this.pollLevels()
    } finally {
      this.starting = false
    }
  }

  private beginSegment(): void {
    if (!this.stream || this.paused || !this.wanted || this.busy) return
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') return

    this.chunks = []
    this.spokeMs = 0
    this.silenceMs = 0
    this.onsetHoldMs = 0
    this.recording = true

    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : ''

    this.mediaRecorder = mime
      ? new MediaRecorder(this.stream, { mimeType: mime })
      : new MediaRecorder(this.stream)

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data)
    }
    this.mediaRecorder.onstop = () => {
      void this.processSegment()
    }

    try {
      this.mediaRecorder.start(100)
    } catch {
      this.mediaRecorder = null
      this.recording = false
    }
  }

  private pollLevels(): void {
    if (!this.wanted || this.paused || !this.analyser) return

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
    const tickMs = speaking ? 40 : 80

    // While Whisper runs, do not open a new recorder (avoids silent open segments)
    if (!this.busy) {
      if (!this.recording) {
        if (speaking) {
          this.onsetHoldMs += tickMs
          if (this.onsetHoldMs >= this.onsetHoldNeedMs) {
            this.beginSegment()
            this.spokeMs = this.onsetHoldMs
          }
        } else {
          this.onsetHoldMs = 0
        }
      } else {
        if (speaking) {
          this.spokeMs += tickMs
          this.silenceMs = 0
        } else if (this.spokeMs > this.minSpeechMs * 0.4) {
          this.silenceMs += tickMs
        }

        if (this.spokeMs >= this.minSpeechMs && this.silenceMs >= this.silenceToEndMs) {
          this.finishSegment()
        } else if (this.spokeMs > 6000) {
          this.finishSegment()
        }
      }
    }

    this.pollTimer = window.setTimeout(() => this.pollLevels(), tickMs)
  }

  private finishSegment(): void {
    if (!this.mediaRecorder || this.mediaRecorder.state !== 'recording') return
    this.recording = false
    try {
      this.mediaRecorder.stop()
    } catch {
      /* ignore */
    }
  }

  private async processSegment(): Promise<void> {
    if (!this.wanted || this.paused) return

    const blob = new Blob(this.chunks, {
      type: this.mediaRecorder?.mimeType || 'audio/webm'
    })
    this.chunks = []
    const spoke = this.spokeMs
    this.spokeMs = 0
    this.silenceMs = 0
    this.onsetHoldMs = 0
    this.recording = false
    this.mediaRecorder = null

    // Do NOT start the next recorder here — wait until ASR finishes

    if (blob.size < 500 || spoke < this.minSpeechMs * 0.7) {
      return
    }

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
      if (peakAbs(trimmed) < 0.02) return
      const capped =
        trimmed.length > 16_000 * 6 ? trimmed.subarray(trimmed.length - 16_000 * 6) : trimmed
      if (capped.length < 1600) return

      const text = (
        await window.albert.transcribeAudio(Array.from(capped), {
          prompt: WAKE_WHISPER_PROMPT
        })
      ).trim()
      if (!text) return
      this.tryFire(text)
    } catch (err) {
      console.warn('[wake] transcribe failed', err)
    } finally {
      this.busy = false
      if (this.pendingQueue.length && this.wanted && !this.paused) {
        const next = this.pendingQueue.shift()!
        void this.transcribeAndFire(next)
      }
      // Next onset is handled by pollLevels once busy clears
    }
  }
}
