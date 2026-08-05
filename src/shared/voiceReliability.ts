/** Pure voice-reliability decisions, kept DOM-free for deterministic tests. */

/**
 * Whisper can occasionally emit the same complete phrase twice when a long
 * VAD silence tail is included. Collapse only exact adjacent repetitions of
 * four or more words so intentional short emphasis ("no, no") is preserved.
 */
export function collapseRepeatedTranscript(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  const words = normalized.split(' ').filter(Boolean)
  if (words.length < 8) return normalized

  const keys = words.map((word) =>
    word
      .toLocaleLowerCase()
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
  )

  for (let blockSize = 4; blockSize <= Math.floor(words.length / 2); blockSize++) {
    if (words.length % blockSize !== 0) continue
    const copies = words.length / blockSize
    if (copies < 2) continue
    let identical = true
    for (let copy = 1; copy < copies && identical; copy++) {
      for (let i = 0; i < blockSize; i++) {
        if (keys[i] !== keys[copy * blockSize + i]) {
          identical = false
          break
        }
      }
    }
    if (identical) return words.slice(0, blockSize).join(' ')
  }

  return normalized
}

export function shouldUseSystemTtsFallback(input: {
  enqueued: number
  neuralEnqueued: boolean
  started: boolean
  cancelled: boolean
  generationCurrent: boolean
}): boolean {
  return (
    input.enqueued > 0 &&
    input.neuralEnqueued &&
    !input.started &&
    !input.cancelled &&
    input.generationCurrent
  )
}

export function isCurrentVoiceGeneration(
  captured: number,
  queueGeneration: number,
  playbackGeneration: number
): boolean {
  return captured === queueGeneration && captured === playbackGeneration
}

/** Recover from the first failed sentence onward so speech order stays intact. */
export function ttsRecoveryTail(pieces: string[], failedPieceIndex: number | null): string {
  const start = Math.max(0, Math.min(failedPieceIndex ?? 0, pieces.length))
  return pieces.slice(start).join(' ').trim()
}
