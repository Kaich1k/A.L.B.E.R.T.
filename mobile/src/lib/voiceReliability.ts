/** Match Mac end-of-utterance silence (~3s) before finalizing speech. */
export const INTERIM_TAIL_SILENCE_MS = 3_000
export const TTS_START_WATCHDOG_MS = 2_500

export type TranscriptSnapshot = {
  text: string
  isFinal: boolean
}

/** Safely reduce the native module's loosely typed event to the one transcript we use. */
export function readTranscriptEvent(event: Record<string, unknown>): TranscriptSnapshot | null {
  const results = Array.isArray(event.results) ? event.results : []
  const first = results[0]
  if (!first || typeof first !== 'object') return null
  const transcript = (first as { transcript?: unknown }).transcript
  if (typeof transcript !== 'string') return null
  const text = transcript.replace(/\s+/g, ' ').trim()
  if (!text) return null
  return { text, isFinal: event.isFinal === true }
}

/**
 * Holds the newest interim transcript until it has been quiet long enough to be
 * treated as an utterance. Native final results always win and clear the tail.
 */
export class InterimTranscriptTail {
  private text = ''
  private changedAt = 0

  observe(snapshot: TranscriptSnapshot, now: number): string | null {
    if (snapshot.isFinal) {
      this.clear()
      return snapshot.text
    }
    if (snapshot.text !== this.text) {
      this.text = snapshot.text
      this.changedAt = now
    }
    return null
  }

  flush(now: number, silenceMs = INTERIM_TAIL_SILENCE_MS): string | null {
    if (!this.text || now - this.changedAt < silenceMs) return null
    const text = this.text
    this.clear()
    return text
  }

  clear(): void {
    this.text = ''
    this.changedAt = 0
  }
}

/** A bounded fallback for platforms that omit a TTS completion callback. */
export function ttsCompletionWatchdogMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  // Roughly 150 wpm plus generous engine startup/queue slack.
  return Math.max(8_000, Math.min(60_000, Math.ceil((words / 2.5) * 1_000) + 6_000))
}

/** null means retrying cannot repair this error without user/system intervention. */
export function speechRetryDelayMs(errorCode: string, attempt: number): number | null {
  if (['not-allowed', 'service-not-allowed', 'language-not-supported'].includes(errorCode)) {
    return null
  }
  if (errorCode === 'aborted' || errorCode === 'interrupted') return null
  if (errorCode === 'no-speech' || errorCode === 'speech-timeout') return 250
  const base = errorCode === 'busy' ? 450 : errorCode === 'network' ? 1_200 : 700
  return Math.min(6_000, base * 2 ** Math.max(0, Math.min(attempt, 3)))
}

export function voiceGenerationIsCurrent(opts: {
  expected: number
  current: number
  appActive: boolean
}): boolean {
  return opts.appActive && opts.expected === opts.current
}
