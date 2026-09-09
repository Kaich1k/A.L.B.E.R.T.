import type { AgentStreamEvent, VoiceState } from '../../../shared/types'
import {
  applyPersonalityAdjust,
  normalizePersonality,
  parsePersonalityVoiceCommand,
  personalityAdjustReply
} from '../../../shared/personality'
import { useAlbertStore } from '../store'
import { decodeBlobToMono16k, trimSilence } from './audio'
import { LiveKeywordMonitor } from './liveKeywords'
import {
  commandConfident,
  contentWordCount,
  createNoiseFloor,
  endOfUtteranceSilenceMs,
  shouldTranscribe,
  speechThresholds,
  updateNoiseFloor
} from '../../../shared/voiceGate'
import { speakText, stopSpeaking, StreamingTtsQueue } from './tts'
import {
  correctTranscript,
  isEndVoiceCommand,
  isHideCommand,
  isLikelyHallucination,
  isMuteCommand,
  isShowCommand
} from './voiceCommands'

type VoiceListener = (state: VoiceState) => void
type TranscriptListener = (role: 'user' | 'assistant', text: string) => void
type StatusListener = (msg: string) => void

/** Lossless split — never drop characters between speak / rest. */
function splitAt(text: string, index: number): { speak: string; rest: string } {
  if (index <= 0) return { speak: '', rest: text }
  if (index >= text.length) return { speak: text, rest: '' }
  return {
    speak: text.slice(0, index).replace(/^\s+|\s+$/g, ''),
    rest: text.slice(index).replace(/^\s+/g, '')
  }
}

/** Trailing title / latin abbrev — not a real sentence end. */
function endsWithAbbreviation(candidate: string): boolean {
  return /(?:^|[\s("'])(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|e\.g|i\.e)\.?["')\]]?$/i.test(
    candidate.trim()
  )
}

/**
 * Pull speakable text from a streaming buffer.
 * Cuts at completed sentence ends so TTS can start on sentence 1 while tokens
 * (and later synth of sentence 2+) continue. Eager mode allows a soft clause
 * cut for the first audio of a turn when no period has landed yet.
 *
 * Markdown bullet lines rarely end with periods — treat newlines / next-bullet
 * markers as boundaries so long lists don’t become one giant skipped clip.
 */
export function takeSpeakableUnits(
  buffer: string,
  final: boolean,
  eager = false
): { speak: string; rest: string } {
  const text = buffer
  if (!text.trim()) return { speak: '', rest: '' }

  // Scan every terminator — skip "Mr." / short crumbs, keep looking
  const re = /[.!?]["')\]]?(?:\s+|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length
    const candidate = text.slice(0, end).replace(/\s+/g, ' ').trim()
    if (!candidate) continue
    if (endsWithAbbreviation(candidate)) continue
    // Single-letter initial ("A.") — keep scanning
    if (/^[A-Za-z]\.$/.test(candidate)) continue
    // "Yes sir." is 8 chars — must fire early (old min of 12 blocked Albert openers)
    if (candidate.length >= 5) return splitAt(text, end)
  }

  // List / paragraph breaks (common in parts lists — often no trailing period)
  const lineRe = /\n+\s*(?:[-*•]\s+|\d+\.\s+)?/g
  let lineMatch: RegExpExecArray | null
  while ((lineMatch = lineRe.exec(text))) {
    const end = lineMatch.index
    const candidate = text.slice(0, end).replace(/\s+/g, ' ').trim()
    // Need a real line of content before the break (skip leading blank / marker-only)
    if (candidate.length >= 12 && end > 0) {
      return splitAt(text, lineMatch.index + lineMatch[0].length)
    }
  }

  // First audio of the turn: start synth on a clause while the LLM still streams
  if (eager && !final) {
    const trimmed = text.replace(/\s+/g, ' ').trim()
    if (trimmed.length >= 48) {
      const window = text.slice(0, Math.min(text.length, 110))
      const soft = Math.max(
        window.lastIndexOf(', '),
        window.lastIndexOf('; '),
        window.lastIndexOf(' — '),
        window.lastIndexOf(': ')
      )
      if (soft >= 24) return splitAt(text, soft + 1)
    }
    if (trimmed.length >= 90) {
      const cut = text.lastIndexOf(' ', Math.min(text.length, 80))
      if (cut >= 36) return splitAt(text, cut)
    }
  }

  // Hard cap — never hand Kokoro a novel-sized unit (silent truncation / skips)
  if (text.replace(/\s+/g, ' ').trim().length >= 420) {
    const window = text.slice(0, Math.min(text.length, 400))
    let cut = Math.max(
      window.lastIndexOf('. '),
      window.lastIndexOf('! '),
      window.lastIndexOf('? '),
      window.lastIndexOf('\n'),
      window.lastIndexOf(', ')
    )
    if (cut < 80) cut = window.lastIndexOf(' ')
    if (cut >= 80) return splitAt(text, cut + 1)
  }

  if (final) {
    return { speak: text.replace(/\s+/g, ' ').trim(), rest: '' }
  }

  return { speak: '', rest: text }
}

/**
 * Drain finished sentences into separate synth jobs.
 * Final flush still splits by sentence so sentence N+1 can synthesize while N plays.
 */
export function drainSpeakableUnits(
  buffer: string,
  final: boolean,
  eagerFirst = false
): { units: string[]; rest: string } {
  const units: string[] = []
  let rest = buffer
  let eager = eagerFirst

  for (let i = 0; i < 32; i++) {
    const next = takeSpeakableUnits(rest, false, eager)
    if (!next.speak) {
      rest = next.rest
      break
    }
    units.push(next.speak)
    rest = next.rest
    eager = false
    if (!rest) break
  }

  if (final) {
    const tail = rest.replace(/\s+/g, ' ').trim()
    if (tail) units.push(tail)
    return { units, rest: '' }
  }

  return { units, rest }
}

/**
 * Local voice path:
 * mic (renderer) → Whisper worker (child process) → Claude/Groq/Ollama → TTS
 */
export class ClaudeVoiceSession {
  private onState: VoiceListener
  private onTranscript: TranscriptListener
  private onStatus: StatusListener
  private onSessionEnd: (() => void) | null
  private running = false
  private busy = false
  private stream: MediaStream | null = null
  private mediaRecorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private timerId = 0
  private silenceMs = 0
  private spokeMs = 0
  /** Wall-clock: last time mic was clearly above speech threshold */
  private lastSpeechAt = 0
  private recording = false
  private speaking = false
  private bargeIn = false
  private muted = false
  private levelBuffer: Uint8Array<ArrayBuffer> | null = null
  private liveKeywords: LiveKeywordMonitor | null = null
  private muteWatchRecorder: MediaRecorder | null = null
  private muteWatchBusy = false
  private muteWatchBusyGen = 0
  private muteWatchGen = 0
  private muteWatchTimer = 0
  private muteWatchPending: { blob: Blob; generation: number } | null = null
  private bargeHoldMs = 0
  private voiceTurnNote: string | null = null
  private lifecycleGen = 0
  private standbyInFlight = false
  private readonly ttsQueue = new StreamingTtsQueue()
  private readonly pollQuietMs = 80
  private readonly pollActiveMs = 40
  /**
   * Rolling estimate of the room's idle level. Thresholds are derived from this
   * rather than fixed, because a fan or a warm laptop used to sit permanently
   * above the old hardcoded speech bar — which is how Albert "heard" things
   * nobody said and cut himself off mid-sentence.
   */
  private noiseFloor = createNoiseFloor()
  /**
   * Sustained voice needed before an interruption counts. 140ms was short
   * enough that a keyboard clack or a door read as speech.
   */
  private readonly bargeHoldNeedMs = 400
  private readonly minSpeechMs = 320
  /**
   * Mic stays hot during TTS / barge so the next request isn’t clipped.
   * While true, we won't endpoint an utterance until Albert finishes speaking.
   */
  private hotMic = false

  constructor(
    onState: VoiceListener,
    onTranscript: TranscriptListener,
    onStatus: StatusListener = () => undefined,
    onSessionEnd: (() => void) | null = null
  ) {
    this.onState = onState
    this.onTranscript = onTranscript
    this.onStatus = onStatus
    this.onSessionEnd = onSessionEnd
  }

  async start(): Promise<void> {
    if (this.running) await this.stop()
    const generation = ++this.lifecycleGen
    this.onState('connecting')
    this.onStatus('Preparing local speech engine…')

    // Ask for the mic while Whisper starts. These were sequential before, so
    // voice could not enter Listening until both startup delays had elapsed.
    const voiceWarm = window.albert.warmVoice()
    void window.albert.warmKokoro().catch(() => false)
    const microphone = navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1
        }
      })

    const [warmResult, microphoneResult] = await Promise.allSettled([voiceWarm, microphone])
    if (generation !== this.lifecycleGen) {
      if (microphoneResult.status === 'fulfilled') {
        microphoneResult.value.getTracks().forEach((track) => track.stop())
      }
      return
    }
    if (microphoneResult.status === 'rejected') {
      throw new Error(
        'Microphone access denied. Allow mic for A.L.B.E.R.T. in System Settings → Privacy & Security → Microphone.'
      )
    }
    const stream = microphoneResult.value
    if (warmResult.status === 'rejected') {
      stream.getTracks().forEach((track) => track.stop())
      const message = warmResult.reason instanceof Error ? warmResult.reason.message : String(warmResult.reason)
      throw new Error(`Could not start speech engine: ${message}`)
    }

    if (generation !== this.lifecycleGen) {
      stream.getTracks().forEach((track) => track.stop())
      return
    }

    this.stream = stream
    this.running = true
    this.muted = false
    this.onStatus('Listening — say “standby” to end, “mute” to cut him off, “hide”/“show” for the window')
    this.beginUtteranceCapture()
  }

  async stop(): Promise<void> {
    this.lifecycleGen += 1
    const wasRunning = this.running
    this.running = false
    this.busy = false
    this.recording = false
    this.speaking = false
    this.bargeIn = false
    this.muted = false
    this.stopLiveKeywords()
    this.stopMuteWatch()
    if (this.timerId) window.clearTimeout(this.timerId)
    this.timerId = 0
    try {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop()
      }
    } catch {
      // ignore
    }
    this.mediaRecorder = null
    this.chunks = []
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.analyser?.disconnect()
    this.analyser = null
    await this.audioContext?.close().catch(() => undefined)
    this.audioContext = null
    stopSpeaking()
    this.onStatus('')
    this.onState('idle')
    if (wasRunning) this.onSessionEnd?.()
  }

  /** Immediate cut — no goodbye speech. */
  muteNow(): void {
    this.muted = true
    this.bargeIn = true
    stopSpeaking()
    this.ttsQueue.reset({
      shouldCancel: () => true
    })
    this.speaking = false
    this.stopLiveKeywords()
    this.stopMuteWatch()
    // Arm mic immediately — barge speech is the next command, not “muted forever.”
    this.armHotMic('barge')
    this.onStatus('Listening — go ahead')
    if (this.running) this.onState('listening')
  }

  /**
   * Start (or keep) capture while a turn is still busy/speaking so Kai’s next
   * sentence isn’t clipped at “project thing, alright…”.
   */
  private armHotMic(_reason: 'tts' | 'barge' | 'think'): void {
    if (!this.running || !this.stream) return
    this.hotMic = true
    if (this.recording) return
    this.beginUtteranceCapture({ force: true })
  }

  /**
   * @param allowStandby — false while Thinking. Web Speech / Whisper often
   * hallucinate “bye”/“sleep” on silence and were killing the session before TTS.
   */
  private startLiveKeywords(allowStandby = true): void {
    this.stopLiveKeywords()
    this.liveKeywords = new LiveKeywordMonitor((key) => {
      if (key === 'mute') {
        this.muteNow()
        return
      }
      if (key === 'hide') {
        void window.albert.hideWindow()
        this.onStatus('Window hidden')
        return
      }
      if (key === 'show') {
        void window.albert.showWindow()
        this.onStatus('Window shown')
        return
      }
      if (key === 'standby') {
        void this.engageStandbyFromLive()
      }
    })
    this.liveKeywords.start({ allowStandby })
  }

  private stopLiveKeywords(): void {
    this.liveKeywords?.stop()
    this.liveKeywords = null
  }

  /** The Whisper watchdog is CPU-heavy, so reserve it for live playback. */
  private muteWatchWanted(): boolean {
    return this.running && !this.muted && this.speaking
  }

  /**
   * Whisper mute watchdog — Web Speech is unreliable in Electron while we hold
   * getUserMedia (same class of bug as wake). Runs only while speaking so it
   * cannot compete with Kokoro synthesis during the thinking handoff.
   */
  private startMuteWatch(): void {
    this.stopMuteWatch()
    if (!this.stream) return
    this.armMuteWatchSlice(this.muteWatchGen)
  }

  private armMuteWatchSlice(gen: number): void {
    if (gen !== this.muteWatchGen || !this.stream || !this.muteWatchWanted()) return

    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : ''

    let recorder: MediaRecorder
    try {
      recorder = mime
        ? new MediaRecorder(this.stream, { mimeType: mime })
        : new MediaRecorder(this.stream)
    } catch {
      return
    }

    this.muteWatchRecorder = recorder
    const chunks: Blob[] = []
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    recorder.onstop = () => {
      if (this.muteWatchRecorder === recorder) this.muteWatchRecorder = null
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
      void this.checkMuteWatchChunk(blob, gen)
      if (gen === this.muteWatchGen && this.muteWatchWanted()) {
        this.muteWatchTimer = window.setTimeout(() => this.armMuteWatchSlice(gen), 30)
      }
    }

    try {
      recorder.start()
    } catch {
      this.muteWatchRecorder = null
      return
    }

    // Shorter slices → faster “mute” (was 1s + full Whisper lag)
    this.muteWatchTimer = window.setTimeout(() => {
      if (gen !== this.muteWatchGen) return
      try {
        if (recorder.state === 'recording') recorder.stop()
      } catch {
        /* ignore */
      }
    }, 700)
  }

  private stopMuteWatch(): void {
    this.muteWatchGen++
    window.clearTimeout(this.muteWatchTimer)
    this.muteWatchTimer = 0
    this.muteWatchPending = null
    try {
      if (this.muteWatchRecorder && this.muteWatchRecorder.state !== 'inactive') {
        this.muteWatchRecorder.stop()
      }
    } catch {
      /* ignore */
    }
    this.muteWatchRecorder = null
    this.muteWatchBusy = false
    this.muteWatchBusyGen = this.muteWatchGen
  }

  private async checkMuteWatchChunk(blob: Blob, generation: number): Promise<void> {
    if (generation !== this.muteWatchGen || this.muted || !this.muteWatchWanted()) return
    if (blob.size < 1200) return

    if (this.muteWatchBusy) {
      this.muteWatchPending = { blob, generation }
      return
    }

    this.muteWatchBusy = true
    this.muteWatchBusyGen = generation
    try {
      const audio = await decodeBlobToMono16k(blob)
      if (audio.length < 1800) return
      const raw = (await window.albert.transcribeAudio(audio)).trim()
      if (generation !== this.muteWatchGen || !this.muteWatchWanted()) return
      const text = correctTranscript(raw)
      if (!text || isLikelyHallucination(text) || isLikelyHallucination(raw)) return

      if (
        isMuteCommand(text) ||
        isMuteCommand(raw) ||
        /\b(mute|shut\s*up|be\s*quiet|stop\s+talking|quiet\s+down)\b/i.test(text) ||
        /\b(mute|shut\s*up|be\s*quiet|stop\s+talking|quiet\s+down)\b/i.test(raw)
      ) {
        this.muteNow()
        return
      }
      // Standby via mute-watch only while audio is actually playing — never during
      // the Thinking window (silence → Whisper “Bye.” was ending voice before TTS).
      if (
        this.speaking &&
        (isEndVoiceCommand(text) || isEndVoiceCommand(raw)) &&
        /\b(standby|stand\s*by|take\s*(a\s*)?(5|five)|end\s+voice|go\s+to\s+sleep)\b/i.test(
          text
        )
      ) {
        void this.engageStandbyFromLive()
      }
    } catch {
      /* ignore watch errors */
    } finally {
      // An obsolete transcription must never unlock or drain a newer watchdog.
      if (this.muteWatchBusyGen !== generation || generation !== this.muteWatchGen) return
      this.muteWatchBusy = false
      if (
        this.muteWatchPending?.generation === generation &&
        this.muteWatchWanted() &&
        !this.muted
      ) {
        const next = this.muteWatchPending
        this.muteWatchPending = null
        void this.checkMuteWatchChunk(next.blob, next.generation)
      }
    }
  }

  private markSpeaking(): void {
    if (this.speaking) return
    this.speaking = true
    this.onState('speaking')
    this.onStatus('Speaking… (say “mute” / “standby” anytime)')
    // Capture over the end of TTS — next command often starts before he finishes.
    this.armHotMic('tts')
    // Now that audio is live, standby keywords are safe again
    this.startLiveKeywords(true)
    this.startMuteWatch()
  }

  /** Speak a short local command and expose Speaking only when playback really starts. */
  private async speakDirect(text: string, opts?: { allowMuted?: boolean }): Promise<void> {
    const generation = this.lifecycleGen
    this.speaking = false
    try {
      const result = await speakText(text, {
        shouldCancel: () =>
          generation !== this.lifecycleGen ||
          !this.running ||
          this.bargeIn ||
          (!opts?.allowMuted && this.muted),
        onStart: () => {
          if (generation === this.lifecycleGen && this.running) this.markSpeaking()
        }
      })
      if (result.fallbackFrom) {
        this.voiceTurnNote = `${result.fallbackFrom} recovered through the system voice`
      }
    } finally {
      if (generation === this.lifecycleGen) {
        this.stopMuteWatch()
        this.stopLiveKeywords()
        this.speaking = false
      }
    }
  }

  /** Live keyword / safety-net path into real standby (stops the session). */
  private async engageStandbyFromLive(): Promise<void> {
    if (!this.running || this.standbyInFlight) return
    this.standbyInFlight = true
    try {
      this.onStatus('Standing by…')
      this.muted = true
      stopSpeaking()
      // A Codex turn keeps running in main after voice stops — stand down means
      // stop working, not just stop talking.
      void window.albert.interruptCodex().catch(() => undefined)
      this.ttsQueue.reset({ shouldCancel: () => true })
      try {
        await this.speakDirect('Standing by, sir.', { allowMuted: true })
      } catch {
        /* ignore */
      }
      await this.stop()
    } finally {
      this.standbyInFlight = false
    }
  }

  /** Model sometimes roleplays standby — force a real stop when the user meant it. */
  private looksLikeFakeStandbyReply(reply: string): boolean {
    return /\b(standby engaged|standing by|going (to |into )?standby|entering standby|going to sleep)\b/i.test(
      reply
    )
  }

  private userLikelyWantedStandby(userText: string): boolean {
    if (isEndVoiceCommand(userText)) return true
    // Do NOT treat bare “sleep” in normal chat (“sleep schedule”, etc.) as standby
    return /\b(standby|stand\s*by|take\s*(a\s*)?(5|five)|end\s+voice|go\s+to\s+sleep)\b/i.test(
      userText
    )
  }

  /**
   * Speak as tokens stream: start on the first full sentence, then schedule each
   * following sentence onto a gapless Web Audio timeline (no HTMLAudio dead air).
   */
  private async sendChatAndSpeak(
    userText: string,
    lifecycleGeneration = this.lifecycleGen
  ): Promise<void> {
    let buffer = ''
    let fedAny = false
    const current = (): boolean =>
      this.running && lifecycleGeneration === this.lifecycleGen

    this.ttsQueue.reset({
      shouldCancel: () => !current() || this.bargeIn || this.muted,
      onFirstStart: () => {
        if (current()) this.markSpeaking()
      },
      onFallback: (error) => {
        const detail = error.message.replace(/\s+/g, ' ').slice(0, 90)
        this.voiceTurnNote = `Neural voice recovered through macOS · ${detail}`
        this.onStatus(`System voice fallback active · ${detail}`)
      }
    })

    const feed = (final: boolean): void => {
      if (this.muted || this.bargeIn || !current()) return
      // Eager first cut so sentence 1 synths while tokens (and later sentences) arrive
      const { units, rest } = drainSpeakableUnits(buffer, final, !fedAny)
      buffer = rest
      for (const unit of units) {
        fedAny = true
        // Synth starts immediately; playback is scheduled gaplessly in order
        this.ttsQueue.enqueue(unit)
      }
    }

    const off = window.albert.onChatEvent((event: AgentStreamEvent) => {
      if (this.muted || this.bargeIn || !current()) return
      if (event.type !== 'token' || !event.content) return
      buffer += event.content
      feed(false)
    })

    try {
      this.onStatus('Thinking…')
      // Open the mic during Thinking — Kai often starts the next ask before TTS.
      this.armHotMic('think')
      // Mute/hide only while waiting on the model — standby waits until audio plays
      this.startLiveKeywords(false)

      const reply = await window.albert.sendChat(userText)
      if (!current()) return
      this.onTranscript('assistant', reply.content)

      if (this.muted || this.bargeIn) return

      // Safety: brain roleplayed standby instead of the app-layer matcher catching it
      if (
        this.looksLikeFakeStandbyReply(reply.content) &&
        this.userLikelyWantedStandby(userText)
      ) {
        // Main safety-net already said “Standing by, sir.” — just stop
        if (/^standing by/i.test(reply.content.trim())) {
          await this.stop()
          return
        }
        await this.engageStandbyFromLive()
        return
      }

      if (buffer.trim()) {
        feed(true)
      } else if (!fedAny && reply.content.trim()) {
        buffer = reply.content
        feed(true)
      }

      // If tokens never streamed, still speak the final units (sentence-split for overlap)
      if (!this.ttsQueue.hasStarted && fedAny) {
        this.onStatus('Synthesizing voice…')
      }

      await this.ttsQueue.flush()
    } finally {
      off()
      if (lifecycleGeneration === this.lifecycleGen) {
        this.stopMuteWatch()
        this.stopLiveKeywords()
        this.speaking = false
        this.bargeHoldMs = 0
      }
    }
  }

  private beginUtteranceCapture(opts?: { force?: boolean }): void {
    if (!this.running || !this.stream) return
    // Hot-mic path may start while the previous turn is still busy/speaking.
    if (this.busy && !opts?.force && !this.hotMic) return
    if (this.recording) return
    const recordingGeneration = this.lifecycleGen

    // One level-monitor loop only — overlapping timers never hit a clean silence window
    if (this.timerId) window.clearTimeout(this.timerId)
    this.timerId = 0

    this.chunks = []
    this.silenceMs = 0
    this.spokeMs = 0
    this.lastSpeechAt = 0
    this.recording = true
    // Hot-mic during TTS must not cancel playback or clear barge state mid-turn.
    if (!opts?.force) {
      this.bargeIn = false
      this.muted = false
      this.ttsQueue.reset({
        shouldCancel: () => !this.running || this.bargeIn || this.muted
      })
    } else {
      // Barge path: keep listening after interrupt; clear sticky mute so replies work.
      this.muted = false
    }

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
      if (recordingGeneration === this.lifecycleGen) {
        void this.processRecording(recordingGeneration)
      }
    }

    if (!this.audioContext) {
      this.audioContext = new AudioContext()
      const source = this.audioContext.createMediaStreamSource(this.stream)
      this.analyser = this.audioContext.createAnalyser()
      this.analyser.fftSize = 2048
      // Keep the graph alive so Analyser levels update in Electron
      const silent = this.audioContext.createGain()
      silent.gain.value = 0
      source.connect(this.analyser)
      this.analyser.connect(silent)
      silent.connect(this.audioContext.destination)
    }
    if (this.audioContext.state === 'suspended') {
      void this.audioContext.resume().catch(() => undefined)
    }

    this.mediaRecorder.start(50)
    if (!this.speaking) this.onState('listening')
    this.monitorLevels()
  }

  private monitorLevels(): void {
    if (!this.running || !this.analyser) return

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

    const settings = useAlbertStore.getState().settings
    const preliminaryThresholds = speechThresholds(this.noiseFloor, settings.micSensitivity)
    // Capture begins immediately, so `!recording` is never true in this loop.
    // Learn likely-idle frames before speech starts without learning Kai's voice.
    if (
      !this.speaking &&
      this.spokeMs === 0 &&
      rms < preliminaryThresholds.speech * 0.82
    ) {
      this.noiseFloor = updateNoiseFloor(this.noiseFloor, rms)
    } else if (!this.speaking && rms < this.noiseFloor.value) {
      this.noiseFloor = updateNoiseFloor(this.noiseFloor, rms)
    }

    const thresholds = speechThresholds(this.noiseFloor, settings.micSensitivity)
    const speakingNow = this.speaking ? rms > thresholds.barge : rms > thresholds.speech
    const silentNow = rms < thresholds.silence
    const bargeNow = rms > thresholds.barge
    const tickMs =
      speakingNow || this.speaking ? this.pollActiveMs : this.pollQuietMs

    const allowBargeIn = settings.allowBargeIn !== false
    // Barge-in only while Albert is actually playing audio — NOT during Thinking.
    if (this.speaking && allowBargeIn && !this.muted) {
      if (bargeNow) {
        this.bargeHoldMs += tickMs
        if (this.bargeHoldMs >= this.bargeHoldNeedMs) {
          this.muteNow()
          this.onStatus('Interrupted — listening')
          this.bargeHoldMs = 0
        }
      } else {
        this.bargeHoldMs = 0
      }
    } else {
      this.bargeHoldMs = 0
    }

    if (this.recording) {
      if (speakingNow) {
        this.spokeMs += tickMs
        this.silenceMs = 0
        this.lastSpeechAt = Date.now()
      } else if (silentNow && this.spokeMs > this.minSpeechMs * 0.55) {
        this.silenceMs += tickMs
      }

      const quietLongEnough =
        this.lastSpeechAt > 0 &&
        Date.now() - this.lastSpeechAt >= endOfUtteranceSilenceMs(this.spokeMs)

      // Never cut while the previous turn is still busy/speaking — processRecording
      // early-returns when busy and would drop the blob on the floor.
      const canEndpoint = !this.speaking && !this.busy

      if (canEndpoint && this.spokeMs > this.minSpeechMs && quietLongEnough) {
        this.hotMic = false
        this.finishUtterance()
        return
      }

    }

    this.timerId = window.setTimeout(() => this.monitorLevels(), tickMs)
  }

  private finishUtterance(): void {
    if (!this.mediaRecorder || this.mediaRecorder.state !== 'recording') return
    this.recording = false
    if (this.timerId) window.clearTimeout(this.timerId)
    this.timerId = 0
    try {
      this.mediaRecorder.stop()
    } catch {
      /* ignore */
    }
  }

  private async processRecording(lifecycleGeneration = this.lifecycleGen): Promise<void> {
    if (
      !this.running ||
      this.busy ||
      lifecycleGeneration !== this.lifecycleGen
    ) return
    const current = (): boolean =>
      this.running && lifecycleGeneration === this.lifecycleGen
    const blob = new Blob(this.chunks, {
      type: this.mediaRecorder?.mimeType || 'audio/webm'
    })
    this.chunks = []

    if (blob.size < 2800 || this.spokeMs < this.minSpeechMs) {
      if (this.running) this.beginUtteranceCapture()
      return
    }

    this.busy = true
    this.voiceTurnNote = null
    this.onState('thinking')
    this.onStatus('Transcribing…')

    try {
      // Softer trim + longer pad — aggressive silence trim was eating leading words.
      const audio = trimSilence(await decodeBlobToMono16k(blob), 16_000, 0.006, 320)
      if (!current()) return
      // Room tone, HVAC and keyboard clicks used to reach Whisper, which turns
      // them into "you" / "the" / "thank you". Require the buffer to be loud
      // relative to this room AND mostly voiced before spending a pass on it.
      const gate = shouldTranscribe({
        samples: audio,
        floor: this.noiseFloor,
        sensitivity: useAlbertStore.getState().settings.micSensitivity
      })
      if (!gate.ok) {
        this.onStatus('Listening — mute / hide / show / standby work anytime')
        return
      }
      const raw = (await window.albert.transcribeAudio(audio)).trim()
      if (!current()) return
      const text = correctTranscript(raw)

      if (!text || isLikelyHallucination(text) || isLikelyHallucination(raw)) {
        this.onStatus('Listening — mute / hide / show / standby work anytime')
        return
      }

      const words = contentWordCount(text)
      // Marginal audio that produced nothing but filler is noise, not an ask.
      if (gate.voicedRatio < 0.32 && words < 1) {
        this.onStatus('Listening — mute / hide / show / standby work anytime')
        return
      }

      this.onTranscript('user', text)

      // Session-changing commands need a confidently voiced utterance behind
      // them — a noise crumb that Whisper renders as "standby" must not end
      // the session.
      const confident = commandConfident(gate.voicedRatio, words)

      if (confident && (isMuteCommand(text) || isMuteCommand(raw))) {
        this.muteNow()
        return
      }

      if (confident && (isHideCommand(text) || isHideCommand(raw))) {
        await window.albert.hideWindow()
        if (!current()) return
        this.onStatus('Window minimized')
        await this.speakDirect('Hiding, sir.')
        return
      }

      if (confident && (isShowCommand(text) || isShowCommand(raw))) {
        await window.albert.showWindow()
        if (!current()) return
        this.onStatus('Window shown')
        return
      }

      if (confident && (isEndVoiceCommand(text) || isEndVoiceCommand(raw))) {
        await this.engageStandbyFromLive()
        return
      }

      const personalityAdj = parsePersonalityVoiceCommand(text)
      if (personalityAdj) {
        // Prefer sendChat so main-process orchestrator owns persistence + UI sync.
        // Keep a local fallback path if chat is unavailable.
        try {
          await this.sendChatAndSpeak(text, lifecycleGeneration)
          return
        } catch {
          const currentPersonality = normalizePersonality(
            useAlbertStore.getState().settings.personality
          )
          const next = applyPersonalityAdjust(currentPersonality, personalityAdj)
          const updated = await window.albert.setSettings({ personality: next })
          if (!current()) return
          useAlbertStore.getState().setSettings(updated)
          const reply = personalityAdjustReply(personalityAdj, next, currentPersonality)
          this.onTranscript('assistant', reply)
          await this.speakDirect(reply)
          return
        }
      }

      this.onStatus(`Heard: “${text}”`)
      this.bargeIn = false
      await this.sendChatAndSpeak(text, lifecycleGeneration)
    } catch (err) {
      if (!current()) return
      const message = err instanceof Error ? err.message : String(err)
      this.voiceTurnNote = `Last turn fault · ${message.replace(/\s+/g, ' ').slice(0, 110)}`
      this.onStatus(message)
      if (this.running && !this.muted) {
        try {
          await this.speakDirect(`I hit an error, sir. ${message}`)
        } catch (voiceError) {
          const detail = voiceError instanceof Error ? voiceError.message : String(voiceError)
          this.voiceTurnNote = `Voice output unavailable · ${detail.replace(/\s+/g, ' ').slice(0, 100)}`
          this.onStatus(`${message} · Voice output unavailable: ${detail}`)
        }
      }
    } finally {
      if (lifecycleGeneration !== this.lifecycleGen) return
      this.busy = false
      this.speaking = false
      this.hotMic = false
      this.stopMuteWatch()
      if (current()) {
        this.onStatus(
          this.voiceTurnNote
            ? `Listening · ${this.voiceTurnNote}`
            : 'Listening — mute / hide / show / standby work anytime'
        )
        // Hot-mic may already be rolling with the start of Kai's next sentence.
        if (this.recording) {
          // If we only captured Albert/TTS bleed, scrap it and listen clean.
          if (this.spokeMs < this.minSpeechMs * 0.5) {
            this.discardHotCapture()
            this.beginUtteranceCapture()
          } else {
            this.onState('listening')
            // User may have finished during TTS — endpoint now that busy cleared.
            const quietLongEnough =
              this.lastSpeechAt > 0 &&
              Date.now() - this.lastSpeechAt >= endOfUtteranceSilenceMs(this.spokeMs)
            if (this.spokeMs > this.minSpeechMs && quietLongEnough) {
              this.finishUtterance()
            } else if (!this.timerId) {
              this.monitorLevels()
            }
          }
        } else {
          this.beginUtteranceCapture()
        }
      } else {
        this.onState('idle')
      }
    }
  }

  /** Drop an in-flight hot-mic recorder without processing (TTS-only bleed). */
  private discardHotCapture(): void {
    this.recording = false
    this.chunks = []
    this.spokeMs = 0
    this.silenceMs = 0
    this.lastSpeechAt = 0
    if (this.timerId) window.clearTimeout(this.timerId)
    this.timerId = 0
    const rec = this.mediaRecorder
    this.mediaRecorder = null
    if (rec) {
      rec.ondataavailable = null
      rec.onstop = null
      try {
        if (rec.state !== 'inactive') rec.stop()
      } catch {
        /* ignore */
      }
    }
  }
}
