import {
  isEndVoiceCommand,
  isHideCommand,
  isMuteCommand,
  isShowCommand
} from './voiceCommands'

type LiveKeyword = 'mute' | 'hide' | 'show' | 'standby'

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionEventLike = {
  resultIndex: number
  results: ArrayLike<{
    isFinal: boolean
    0: { transcript: string }
  }>
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
}

function getCtor(): (new () => SpeechRecognitionLike) | null {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

/**
 * Lightweight listener while Albert is speaking/thinking — mute / hide / show / standby.
 * Uses loose live matching (Web Speech is messy) plus whole-utterance rules.
 */
export class LiveKeywordMonitor {
  private recognition: SpeechRecognitionLike | null = null
  private active = false
  private onKeyword: (k: LiveKeyword) => void
  private restartTimer = 0
  private lastFired = ''
  private lastFiredAt = 0

  constructor(onKeyword: (k: LiveKeyword) => void) {
    this.onKeyword = onKeyword
  }

  start(): void {
    const Ctor = getCtor()
    if (!Ctor) return
    this.active = true
    this.lastFired = ''
    this.lastFiredAt = 0
    if (!this.recognition) {
      const rec = new Ctor()
      rec.continuous = true
      rec.interimResults = true
      rec.lang = 'en-US'
      rec.maxAlternatives = 1
      rec.onresult = (event) => {
        let heard = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
          heard += event.results[i][0]?.transcript || ''
        }
        const text = heard.trim()
        if (!text) return

        const key = matchLiveKeyword(text)
        if (!key) return
        const now = Date.now()
        // Allow re-fire after 1.2s so “mute” isn’t stuck forever after a false start
        if (this.lastFired === key && now - this.lastFiredAt < 1200) return
        this.lastFired = key
        this.lastFiredAt = now
        this.onKeyword(key)
      }
      rec.onerror = () => {
        /* ignore — restart on end */
      }
      rec.onend = () => {
        if (!this.active) return
        window.clearTimeout(this.restartTimer)
        // Faster restart — 800ms gaps made “mute” easy to miss
        this.restartTimer = window.setTimeout(() => {
          if (!this.active) return
          try {
            this.recognition?.start()
          } catch {
            /* ignore */
          }
        }, 250)
      }
      this.recognition = rec
    }
    try {
      this.recognition.start()
    } catch {
      /* already started */
    }
  }

  stop(): void {
    this.active = false
    window.clearTimeout(this.restartTimer)
    try {
      this.recognition?.stop()
    } catch {
      /* ignore */
    }
  }

  /** True when the browser exposes speech recognition (Electron often does). */
  static isSupported(): boolean {
    return Boolean(getCtor())
  }
}

export function matchLiveKeyword(text: string): LiveKeyword | null {
  const t = text.trim()
  if (!t) return null

  // Prefer the latest short clause (SR buffers grow)
  const parts = t
    .split(/[.!?]|,\s+/)
    .map((p) => p.trim())
    .filter(Boolean)
  const tail = parts.length ? parts[parts.length - 1]! : t
  const lastWords = t.split(/\s+/).slice(-5).join(' ')

  const candidates = [tail, lastWords, t]

  for (const chunk of candidates) {
    if (chunk.split(/\s+/).length > 14) continue

    // Loose live mute — Web Speech rarely returns a clean whole utterance
    if (/\b(mute|shut\s*up|be\s*quiet|stop\s+talking|quiet\s+down)\b/i.test(chunk)) {
      return 'mute'
    }
    // Single-word / short SR hits
    if (/^(mute|quiet)$/i.test(chunk.trim())) return 'mute'
    if (isMuteCommand(chunk)) return 'mute'
    if (isHideCommand(chunk)) return 'hide'
    if (isShowCommand(chunk)) return 'show'
    // Standby / take 5 while he is still thinking or speaking
    if (
      isEndVoiceCommand(chunk) ||
      /\b(standby|stand\s*by|take\s*(a\s*)?(5|five)|end\s+voice)\b/i.test(chunk)
    ) {
      return 'standby'
    }
  }
  return null
}
