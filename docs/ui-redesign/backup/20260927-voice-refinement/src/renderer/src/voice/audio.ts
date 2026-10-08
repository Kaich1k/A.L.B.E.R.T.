export function downsampleTo16k(input: Float32Array, fromSampleRate: number): Float32Array {
  if (fromSampleRate === 16000) return input
  const ratio = fromSampleRate / 16000
  const newLength = Math.round(input.length / ratio)
  const result = new Float32Array(newLength)
  for (let i = 0; i < newLength; i++) {
    const idx = Math.min(input.length - 1, Math.floor(i * ratio))
    result[i] = input[idx]
  }
  return result
}

export async function decodeBlobToMono16k(blob: Blob): Promise<Float32Array> {
  const buffer = await blob.arrayBuffer()
  const audioCtx = new AudioContext()
  try {
    const decoded = await audioCtx.decodeAudioData(buffer.slice(0))
    const mono =
      decoded.numberOfChannels === 1 ? decoded.getChannelData(0) : mixToMono(decoded)
    return downsampleTo16k(mono, decoded.sampleRate)
  } finally {
    await audioCtx.close()
  }
}

/**
 * Remove the long quiet lead/tail produced by VAD-controlled MediaRecorder
 * sessions while retaining a small natural pad around speech. Frame RMS is
 * more robust than testing individual samples against background noise.
 */
export function trimSilence(
  samples: Float32Array,
  sampleRate = 16_000,
  threshold = 0.008,
  paddingMs = 180
): Float32Array {
  if (samples.length === 0) return samples
  const frameSize = Math.max(1, Math.floor(sampleRate * 0.01))
  let firstActive = -1
  let lastActive = -1

  for (let offset = 0; offset < samples.length; offset += frameSize) {
    const end = Math.min(samples.length, offset + frameSize)
    let sum = 0
    for (let i = offset; i < end; i++) {
      const value = samples[i]!
      sum += value * value
    }
    const rms = Math.sqrt(sum / Math.max(1, end - offset))
    if (rms >= threshold) {
      if (firstActive < 0) firstActive = offset
      lastActive = end
    }
  }

  if (firstActive < 0 || lastActive <= firstActive) return samples
  const pad = Math.floor(sampleRate * (paddingMs / 1000))
  return samples.subarray(
    Math.max(0, firstActive - pad),
    Math.min(samples.length, lastActive + pad)
  )
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const len = buffer.length
  const out = new Float32Array(len)
  const channels = buffer.numberOfChannels
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < len; i++) out[i] += data[i] / channels
  }
  return out
}
