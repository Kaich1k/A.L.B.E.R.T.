/**
 * Speech gating maths for the voice session.
 *
 * The old gate used fixed RMS thresholds, so a room with a fan or a warm laptop
 * sat permanently "above speech level": Whisper then invented words out of noise
 * and barge-in cut A.L.B.E.R.T. off mid-sentence. Everything here is relative to
 * a rolling estimate of the actual room floor instead.
 *
 * Pure functions — no Web Audio, no DOM — so the thresholds are unit testable.
 */

/** 0–100 from Systems. Higher = pick up quieter speech (and more noise). */
export const DEFAULT_MIC_SENSITIVITY = 50

/** Room tone is quiet but never zero; clamp so one silent buffer can't zero it. */
export const NOISE_FLOOR_MIN = 0.002
export const NOISE_FLOOR_MAX = 0.06

export interface NoiseFloor {
  /** Current estimate of the room's idle RMS. */
  value: number
  /** Frames folded in so far — used to skip gating until it has settled. */
  samples: number
}

export function createNoiseFloor(initial = 0.01): NoiseFloor {
  return { value: clamp(initial, NOISE_FLOOR_MIN, NOISE_FLOOR_MAX), samples: 0 }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Fold one frame into the estimate: drop fast toward quiet, rise slowly.
 *
 * The asymmetry matters. Falling fast means the floor follows a room going
 * quiet within a second; rising slowly means Kai talking for ten seconds does
 * not drag the floor up and deafen the gate afterwards.
 */
export function updateNoiseFloor(floor: NoiseFloor, rms: number): NoiseFloor {
  if (!Number.isFinite(rms) || rms < 0) return floor
  // Settle quickly during the first couple seconds, then follow quieter rooms
  // faster than louder ones. Callers only feed likely-idle frames here.
  const alpha = floor.samples < NOISE_FLOOR_WARMUP_FRAMES ? 0.08 : rms < floor.value ? 0.12 : 0.01
  return {
    value: clamp(floor.value * (1 - alpha) + rms * alpha, NOISE_FLOOR_MIN, NOISE_FLOOR_MAX),
    samples: Math.min(floor.samples + 1, 10_000)
  }
}

/** Frames needed before the floor is trusted; until then, fixed floors apply. */
export const NOISE_FLOOR_WARMUP_FRAMES = 25

export interface SpeechThresholds {
  /** Above this counts as speech while A.L.B.E.R.T. is quiet. */
  speech: number
  /** Below this counts as silence (hysteresis against noise flicker). */
  silence: number
  /** Above this counts as a real interruption while he's talking. */
  barge: number
}

/**
 * Thresholds for the current room and sensitivity setting.
 *
 * Barge sits well above the speech bar on purpose: cutting him off wrongly is
 * far more annoying than needing one extra beat to interrupt, and echo
 * cancellation leaks his own voice back into the mic.
 */
export function speechThresholds(
  floor: NoiseFloor,
  sensitivity: number = DEFAULT_MIC_SENSITIVITY
): SpeechThresholds {
  const s = clamp(Number.isFinite(sensitivity) ? sensitivity : DEFAULT_MIC_SENSITIVITY, 0, 100)
  // Keep the default below ordinary conversational mic levels. The previous
  // 0.054 startup threshold made the UI say Listening while ignoring Kai.
  // 0 → 2.8x floor + 0.010 (selective)
  // 50 → 2.0x floor + 0.006 (default)
  // 100 → 1.2x floor + 0.002 (sensitive)
  const multiplier = 2.8 - (s / 100) * 1.6
  const offset = 0.01 - (s / 100) * 0.008

  const trusted = floor.samples >= NOISE_FLOOR_WARMUP_FRAMES
  const base = trusted ? floor.value : 0.012
  const speech = clamp(base * multiplier + offset, 0.012, 0.12)

  return {
    speech,
    // 70% of the speech bar — a gap wide enough that noise riding the boundary
    // doesn't keep resetting the end-of-utterance timer.
    silence: speech * 0.7,
    // Comfortably above speech so his own TTS bleed can't trip it.
    barge: clamp(speech * 1.65, 0.035, 0.24)
  }
}

/**
 * Fraction of frames in a buffer whose energy clears `threshold`.
 *
 * Real speech is a run of loud frames separated by short gaps; a fan or a
 * keyboard click is a handful of spikes in a mostly-flat buffer. The ratio
 * separates the two far better than peak amplitude alone.
 */
export function voicedFrameRatio(
  samples: Float32Array | number[],
  threshold: number,
  frameSize = 320
): number {
  const length = samples.length
  if (!length || frameSize <= 0) return 0
  let frames = 0
  let voiced = 0

  for (let start = 0; start + frameSize <= length; start += frameSize) {
    let sum = 0
    for (let i = start; i < start + frameSize; i++) {
      const v = samples[i] as number
      sum += v * v
    }
    frames += 1
    if (Math.sqrt(sum / frameSize) > threshold) voiced += 1
  }

  return frames ? voiced / frames : 0
}

export function peakAmplitude(samples: Float32Array | number[]): number {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i] as number)
    if (a > peak) peak = a
  }
  return peak
}

export interface TranscribeGateInput {
  samples: Float32Array | number[]
  /** Rolling room floor at the moment the utterance ended. */
  floor: NoiseFloor
  sensitivity?: number
  /** 16kHz mono, so 3200 samples is 200ms. */
  minSamples?: number
}

export type TranscribeGate =
  | { ok: true; voicedRatio: number; peak: number }
  | { ok: false; reason: 'tooShort' | 'tooQuiet' | 'notVoiced'; voicedRatio: number; peak: number }

/** Minimum share of voiced frames before a buffer is worth transcribing. */
export const MIN_VOICED_RATIO = 0.18

/**
 * End short commands quickly while leaving more room for a pause in a longer
 * thought. The old fixed 2.6 second tail made every voice turn feel stalled.
 */
export function endOfUtteranceSilenceMs(spokeMs: number): number {
  if (spokeMs < 1_200) return 1_800
  if (spokeMs < 5_000) return 2_200
  return 2_600
}

/**
 * Final gate before paying for a Whisper pass. Rejecting here is what stops
 * A.L.B.E.R.T. "hearing" things nobody said.
 */
export function shouldTranscribe(input: TranscribeGateInput): TranscribeGate {
  const { samples, floor } = input
  const minSamples = input.minSamples ?? 3_200
  const thresholds = speechThresholds(floor, input.sensitivity)
  const peak = peakAmplitude(samples)
  // Require sustained frames to clear the speech bar. Using the lower silence
  // hysteresis threshold let periodic fan/keyboard spikes mark every frame voiced.
  const frameThreshold = thresholds.speech
  const voicedRatio = voicedFrameRatio(samples, frameThreshold)

  if (samples.length < minSamples) {
    return { ok: false, reason: 'tooShort', voicedRatio, peak }
  }
  // Peak must clear the room by a clear margin, not just the fixed 0.02 the old
  // gate used — that was below the noise floor of a warm laptop.
  if (peak < thresholds.speech * 1.2) {
    return { ok: false, reason: 'tooQuiet', voicedRatio, peak }
  }
  if (voicedRatio < MIN_VOICED_RATIO) {
    return { ok: false, reason: 'notVoiced', voicedRatio, peak }
  }
  return { ok: true, voicedRatio, peak }
}

/**
 * Whether an utterance is solid enough to act on a session-changing command
 * (standby, mute, hide, show).
 *
 * A flat "require two content words" rule would break the legitimate one-word
 * commands, so confidence comes from the audio instead: a spoken "standby" is
 * densely voiced, while a noise crumb that Whisper renders as "standby" is not.
 * Two or more content words is accepted as independent evidence, since noise
 * essentially never produces that.
 */
export function commandConfident(voicedRatio: number, contentWords: number): boolean {
  if (contentWords >= 2) return true
  return voicedRatio >= 0.32
}

/** Content words in an utterance, ignoring filler that Whisper hallucinates. */
export function contentWordCount(text: string): number {
  const stop = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'so', 'to', 'of', 'in', 'on', 'at', 'is', 'it',
    'you', 'i', 'me', 'my', 'we', 'us', 'he', 'she', 'they', 'them', 'this', 'that',
    'uh', 'um', 'ah', 'oh', 'hmm', 'mhm', 'yeah', 'yep', 'ok', 'okay', 'like', 'just',
    'well', 'right', 'now', 'here', 'there', 'do', 'be', 'am', 'are', 'was', 'were'
  ])
  return text
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !stop.has(word)).length
}
