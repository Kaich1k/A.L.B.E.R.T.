/** PCM-only speech trimming; independent of browser audio objects for testing. */
export interface SpeechAudioBuffer {
  length: number
  sampleRate: number
  duration: number
  numberOfChannels: number
  getChannelData(channel: number): Float32Array
}

export interface SpeechActiveWindow {
  offsetSec: number
  durationSec: number
  /** Quiet padding retained in the played window, not silence discarded. */
  leadingSilentSec: number
  trailingSilentSec: number
}

export function findSpeechActiveWindow(buffer: SpeechAudioBuffer): SpeechActiveWindow {
  const frameSize = Math.max(1, Math.floor(buffer.sampleRate * 0.008))
  const energies: number[] = []
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index))
  let peakFrameRms = 0
  for (let start = 0; start < buffer.length; start += frameSize) {
    const end = Math.min(buffer.length, start + frameSize)
    let rms = 0
    for (const samples of channels) {
      let sum = 0
      for (let index = start; index < end; index++) sum += (samples[index] || 0) ** 2
      rms = Math.max(rms, Math.sqrt(sum / Math.max(1, end - start)))
    }
    energies.push(rms)
    peakFrameRms = Math.max(peakFrameRms, rms)
  }

  // A fixed .012 cutoff was shaving quiet f/s/th sounds off otherwise normal
  // words. Trim only near-silence, with a level-relative threshold and bounds.
  const threshold = Math.min(0.0015, Math.max(0.00012, peakFrameRms * 0.01))
  const first = energies.findIndex((energy) => energy >= threshold)
  let last = energies.length - 1
  while (last >= first && energies[last]! < threshold) last--
  if (first < 0 || last < first) {
    return { offsetSec: 0, durationSec: buffer.duration, leadingSilentSec: 0, trailingSilentSec: 0 }
  }

  const firstActive = first * frameSize
  const lastActive = Math.min(buffer.length, (last + 1) * frameSize)
  const start = Math.max(0, firstActive - Math.round(buffer.sampleRate * 0.025))
  const end = Math.min(buffer.length, lastActive + Math.round(buffer.sampleRate * 0.035))
  return {
    offsetSec: start / buffer.sampleRate,
    durationSec: (end - start) / buffer.sampleRate,
    leadingSilentSec: (firstActive - start) / buffer.sampleRate,
    trailingSilentSec: (end - lastActive) / buffer.sampleRate
  }
}
