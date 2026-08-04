import type { AgentStreamEvent, VoiceState } from '../../../shared/types'
import {
  applyPersonalityAdjust,
  normalizePersonality,
  parsePersonalityVoiceCommand,
  PERSONALITY_META
} from '../../../shared/personality'
import { useAlbertStore } from '../store'
import { decodeBlobToMono16k } from './audio'
import { LiveKeywordMonitor } from './liveKeywords'
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
    speak: text.slice(0, index).replace(/\s+$/g, ''),
    rest: text.slice(index).replace(/^\s+/g, '')
  }
}

/**
 * Pull speakable text from a streaming buffer.
 * Cuts only at completed sentence ends (or final flush) — never mid-phrase.
 * Returns the *first* finished sentence so TTS can start ASAP while more tokens
 * still arrive; gapless Web Audio joins follow-up sentences without dead air.
 */
export function takeSpeakableUnits(
  buffer: string,
  final: boolean,
  _eager = false
): { speak: string; rest: string } {
  const text = buffer
  if (!text.trim()) return { speak: '', rest: '' }

  if (final) {
    return { speak: text.replace(/\s+/g, ' ').trim(), rest: '' }
  }

  // First completed sentence only — earliest start without word-crumbs
  const re = /[.!?]["')\]]?(?:\s+|$)/g
  const m = re.exec(text)
  if (m) {
    const end = m.index + m[0].length
    if (end >= 12) return splitAt(text, end)
  }

  return { speak: '', rest: text }
}

/** Drain every finished sentence currently buffered (each becomes one synth job). */
export function drainSpeakableUnits(
  buffer: string,
  final: boolean,
  _eagerFirst = false
): { units: string[]; rest: string } {
  if (final) {
    const next = takeSpeakableUnits(buffer, true)
    return next.speak ? { units: [next.speak], rest: '' } : { units: [], rest: '' }
  }

  const units: string[] = []
  let rest = buffer
  for (let i = 0; i < 24; i++) {
    const next = takeSpeakableUnits(rest, false)
    if (!next.speak) {
      rest = next.rest
      break
    }
    units.push(next.speak)
    rest = next.rest
    if (!rest) break
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
  private recording = false
  private speaking = false
  private bargeIn = false
  private muted = false
  private levelBuffer: Uint8Array<ArrayBuffer> | null = null
  private liveKeywords: LiveKeywordMonitor | null = null
  private muteWatchRecorder: MediaRecorder | null = null
  private muteWatchBusy = false
  private muteWatchGen = 0
  private muteWatchTimer = 0
  private muteWatchPending: Blob | null = null
  private bargeHoldMs = 0
  private readonly ttsQueue = new StreamingTtsQueue()
  private readonly pollQuietMs = 80
  private readonly pollActiveMs = 40
  private readonly speechRms = 0.05
  /** Lower bar while Albert talks — AEC often attenuates the user. */
  private readonly bargeRms = 0.022
  /** Need sustained voice so TTS bleed doesn’t false-trigger barge-in */
  private readonly bargeHoldNeedMs = 180
  private readonly minSpeechMs = 300
  /** Pause after user stops talking before we cut the utterance and reply */
  private readonly silenceToEndMs = 3000

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
    this.onState('connecting')
    this.onStatus('Preparing local speech engine…')

    try {
      // Warm Whisper + Kokoro in parallel so the first spoken reply isn’t waiting on cold TTS
      await Promise.all([
        window.albert.warmVoice(),
        window.albert.warmKokoro().catch(() => false)
      ])
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`Could not start speech engine: ${message}`)
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1
        }
      })
    } catch {
      throw new Error(
        'Microphone access denied. Allow mic for A.L.B.E.R.T. in System Settings → Privacy & Security → Microphone.'
      )
    }

    this.running = true
    this.muted = false
    this.onStatus('Listening — say “standby” to end, “mute” to cut him off, “hide”/“show” for the window')
    this.beginUtteranceCapture()
  }

  async stop(): Promise<void> {
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
    this.onStatus('Muted')
    if (this.running && !this.busy) {
      this.onState('listening')
    }
  }

  private startLiveKeywords(): void {
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
    this.liveKeywords.start()
  }

  private stopLiveKeywords(): void {
    this.liveKeywords?.stop()
    this.liveKeywords = null
  }

  /** True while we should listen for “mute” (thinking or speaking). */
  private muteWatchWanted(): boolean {
    return this.running && !this.muted && (this.speaking || this.busy)
  }

  /**
   * Whisper mute watchdog — Web Speech is unreliable in Electron while we hold
   * getUserMedia (same class of bug as wake). Runs during thinking + speaking.
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
      void this.checkMuteWatchChunk(blob)
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
  }

  private async checkMuteWatchChunk(blob: Blob): Promise<void> {
    if (this.muted || !this.muteWatchWanted()) return
    if (blob.size < 1200) return

    if (this.muteWatchBusy) {
      this.muteWatchPending = blob
      return
    }

    this.muteWatchBusy = true
    try {
      const audio = await decodeBlobToMono16k(blob)
      if (audio.length < 1800) return
      const raw = (await window.albert.transcribeAudio(audio)).trim()
      const text = correctTranscript(raw)
      if (
        isMuteCommand(text) ||
        isMuteCommand(raw) ||
        /\b(mute|shut\s*up|be\s*quiet|stop\s+talking|quiet\s+down)\b/i.test(text) ||
        /\b(mute|shut\s*up|be\s*quiet|stop\s+talking|quiet\s+down)\b/i.test(raw)
      ) {
        this.muteNow()
        return
      }
      if (isEndVoiceCommand(text) || isEndVoiceCommand(raw)) {
        void this.engageStandbyFromLive()
      }
    } catch {
      /* ignore watch errors */
    } finally {
      this.muteWatchBusy = false
      if (this.muteWatchPending && this.muteWatchWanted() && !this.muted) {
        const next = this.muteWatchPending
        this.muteWatchPending = null
        void this.checkMuteWatchChunk(next)
      }
    }
  }

  private markSpeaking(): void {
    if (this.speaking) return
    this.speaking = true
    this.onState('speaking')
    this.onStatus('Speaking… (say “mute” / “standby” anytime)')
    this.startLiveKeywords()
    this.startMuteWatch()
  }

  /** Live keyword / safety-net path into real standby (stops the session). */
  private async engageStandbyFromLive(): Promise<void> {
    if (!this.running) return
    this.onStatus('Standing by…')
    this.muted = true
    stopSpeaking()
    this.ttsQueue.reset({ shouldCancel: () => true })
    this.speaking = true
    this.onState('speaking')
    try {
      await speakText('Standing by, sir.', {
        shouldCancel: () => !this.running
      })
    } catch {
      /* ignore */
    }
    this.speaking = false
    await this.stop()
  }

  /** Model sometimes roleplays standby — force a real stop when the user meant it. */
  private looksLikeFakeStandbyReply(reply: string): boolean {
    return /\b(standby engaged|standing by|going (to |into )?standby|entering standby|going to sleep)\b/i.test(
      reply
    )
  }

  private userLikelyWantedStandby(userText: string): boolean {
    if (isEndVoiceCommand(userText)) return true
    return /\b(standby|stand\s*by|take\s*(a\s*)?(5|five)|end\s+voice|go\s+to\s+sleep|\bsleep\b)\b/i.test(
      userText
    )
  }

  /**
   * Speak as tokens stream: start on the first full sentence, then schedule each
   * following sentence onto a gapless Web Audio timeline (no HTMLAudio dead air).
   */
  private async sendChatAndSpeak(userText: string): Promise<void> {
    let buffer = ''
    let fedAny = false

    this.ttsQueue.reset({
      shouldCancel: () => !this.running || this.bargeIn || this.muted,
      onFirstStart: () => this.markSpeaking()
    })

    const feed = (final: boolean): void => {
      if (this.muted || this.bargeIn || !this.running) return
      const { units, rest } = drainSpeakableUnits(buffer, final)
      buffer = rest
      for (const unit of units) {
        fedAny = true
        // Synth starts immediately; playback is scheduled gaplessly in order
        this.ttsQueue.enqueue(unit)
      }
    }

    const off = window.albert.onChatEvent((event: AgentStreamEvent) => {
      if (this.muted || this.bargeIn || !this.running) return
      if (event.type !== 'token' || !event.content) return
      buffer += event.content
      feed(false)
    })

    try {
      this.onStatus('Thinking…')
      this.startLiveKeywords()
      this.startMuteWatch()

      const reply = await window.albert.sendChat(userText)
      if (!this.running) return
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

      await this.ttsQueue.flush()
    } finally {
      off()
      this.stopMuteWatch()
      this.stopLiveKeywords()
      this.speaking = false
      this.bargeHoldMs = 0
    }
  }

  private beginUtteranceCapture(): void {
    if (!this.running || !this.stream || this.busy) return

    this.chunks = []
    this.silenceMs = 0
    this.spokeMs = 0
    this.recording = true
    this.bargeIn = false
    this.muted = false
    this.ttsQueue.reset({
      shouldCancel: () => !this.running || this.bargeIn || this.muted
    })

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
      void this.processRecording()
    }

    if (!this.audioContext) {
      this.audioContext = new AudioContext()
      const source = this.audioContext.createMediaStreamSource(this.stream)
      this.analyser = this.audioContext.createAnalyser()
      this.analyser.fftSize = 2048
      source.connect(this.analyser)
    }

    this.mediaRecorder.start(100)
    this.onState('listening')
    this.monitorLevels()
  }

  private monitorLevels(): void {
    if (!this.running || !this.analyser) return

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
    const speakingNow = rms > this.speechRms
    const bargeNow = rms > this.bargeRms
    const tickMs =
      speakingNow || this.speaking ? this.pollActiveMs : this.pollQuietMs

    const allowBargeIn = useAlbertStore.getState().settings.allowBargeIn !== false
    if ((this.speaking || this.busy) && allowBargeIn && !this.muted) {
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

    if (this.recording && !this.busy) {
      if (speakingNow) {
        this.spokeMs += tickMs
        this.silenceMs = 0
      } else if (this.spokeMs > this.minSpeechMs * 0.55) {
        this.silenceMs += tickMs
      }

      if (this.spokeMs > this.minSpeechMs && this.silenceMs >= this.silenceToEndMs) {
        this.finishUtterance()
        return
      }

      if (this.spokeMs > 12000) {
        this.finishUtterance()
        return
      }
    }

    this.timerId = window.setTimeout(() => this.monitorLevels(), tickMs)
  }

  private finishUtterance(): void {
    if (!this.mediaRecorder || this.mediaRecorder.state !== 'recording') return
    this.recording = false
    this.mediaRecorder.stop()
  }

  private async processRecording(): Promise<void> {
    if (!this.running || this.busy) return
    const blob = new Blob(this.chunks, {
      type: this.mediaRecorder?.mimeType || 'audio/webm'
    })
    this.chunks = []

    if (blob.size < 2200 || this.spokeMs < this.minSpeechMs) {
      if (this.running) this.beginUtteranceCapture()
      return
    }

    this.busy = true
    this.onState('thinking')
    this.onStatus('Transcribing…')

    try {
      const audio = await decodeBlobToMono16k(blob)
      const raw = (await window.albert.transcribeAudio(audio)).trim()
      const text = correctTranscript(raw)

      if (!text || isLikelyHallucination(text)) {
        this.onStatus('Didn’t catch that — try again')
        return
      }

      this.onTranscript('user', text)

      if (isMuteCommand(text) || isMuteCommand(raw)) {
        this.muteNow()
        return
      }

      if (isHideCommand(text) || isHideCommand(raw)) {
        await window.albert.hideWindow()
        this.onStatus('Window minimized')
        this.speaking = true
        await speakText('Hiding, sir.', {
          shouldCancel: () => !this.running || this.bargeIn || this.muted
        })
        this.speaking = false
        return
      }

      if (isShowCommand(text) || isShowCommand(raw)) {
        await window.albert.showWindow()
        this.onStatus('Window shown')
        return
      }

      if (isEndVoiceCommand(text) || isEndVoiceCommand(raw)) {
        this.onStatus('Standing by…')
        this.speaking = true
        this.onState('speaking')
        this.startLiveKeywords()
        this.startMuteWatch()
        await speakText('Standing by, sir.', {
          shouldCancel: () => !this.running || this.bargeIn || this.muted
        })
        this.stopMuteWatch()
        this.stopLiveKeywords()
        this.speaking = false
        await this.stop()
        return
      }

      const personalityAdj = parsePersonalityVoiceCommand(text)
      if (personalityAdj) {
        const current = normalizePersonality(useAlbertStore.getState().settings.personality)
        const next = applyPersonalityAdjust(current, personalityAdj)
        const updated = await window.albert.setSettings({ personality: next })
        useAlbertStore.getState().setSettings(updated)
        const label = PERSONALITY_META[personalityAdj.key].label
        const value = next[personalityAdj.key]
        const reply = `${label} set to ${value}%, sir.`
        this.onTranscript('assistant', reply)
        this.speaking = true
        this.onState('speaking')
        this.startLiveKeywords()
        this.startMuteWatch()
        await speakText(reply, {
          shouldCancel: () => !this.running || this.bargeIn || this.muted
        })
        this.stopMuteWatch()
        this.stopLiveKeywords()
        this.speaking = false
        return
      }

      this.onStatus(`Heard: “${text}”`)
      this.bargeIn = false
      await this.sendChatAndSpeak(text)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.onStatus(message)
      if (this.running && !this.muted) {
        this.speaking = true
        this.startLiveKeywords()
        this.startMuteWatch()
        await speakText(`I hit an error, sir. ${message}`, {
          shouldCancel: () => !this.running || this.bargeIn || this.muted
        })
        this.stopMuteWatch()
        this.stopLiveKeywords()
        this.speaking = false
      }
    } finally {
      this.busy = false
      this.stopMuteWatch()
      if (this.running) {
        this.onStatus(
          this.muted
            ? 'Muted — listening again'
            : 'Listening — mute / hide / show / standby work anytime'
        )
        this.beginUtteranceCapture()
      } else {
        this.onState('idle')
      }
    }
  }
}
