export function downsampleTo16k(input: Float32Array, fromSampleRate: number): Float32Array {
  if (!Number.isFinite(fromSampleRate) || fromSampleRate <= 0) throw new RangeError('Invalid sample rate')
  if (!input.length) return new Float32Array()
  if (fromSampleRate === 16000) return input
  const ratio = fromSampleRate / 16000
  const newLength = Math.round(input.length / ratio)
  const result = new Float32Array(newLength)
  // Windowed-sinc resampling filters frequencies that 16 kHz cannot represent.
  // Reusing fractional-phase kernels keeps long recordings inexpensive.
  const radius = Math.ceil(12 * Math.max(1, ratio))
  const cutoff = 0.47 / Math.max(1, ratio)
  const phases = 256
  const kernels = new Map<number, Float64Array>()
  const kernelFor = (phase: number): Float64Array => {
    const cached = kernels.get(phase)
    if (cached) return cached
    const fraction = phase / phases
    const kernel = new Float64Array(radius * 2 + 1)
    let total = 0
    for (let tap = -radius; tap <= radius; tap++) {
      const distance = tap - fraction
      const x = 2 * cutoff * distance
      const sinc = Math.abs(x) < 1e-12 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)
      const window = Math.abs(distance) <= radius ? 0.5 + 0.5 * Math.cos(Math.PI * distance / radius) : 0
      const weight = 2 * cutoff * sinc * window
      kernel[tap + radius] = weight
      total += weight
    }
    for (let i = 0; i < kernel.length; i++) kernel[i] /= total
    kernels.set(phase, kernel)
    return kernel
  }
  for (let i = 0; i < newLength; i++) {
    const position = i * ratio
    const base = Math.floor(position)
    const kernel = kernelFor(Math.round((position - base) * phases))
    let value = 0
    for (let tap = -radius; tap <= radius; tap++) {
      const index = Math.max(0, Math.min(input.length - 1, base + tap))
      value += input[index]! * kernel[tap + radius]!
    }
    result[i] = value
  }
  return result
}

/** Select the VAD-observed speech interval; padding is audio context, not speech evidence. */
export function speechWindow(
  samples: Float32Array,
  firstSpeechMs: number,
  lastSpeechMs: number,
  paddingMs = 0,
  sampleRate = 16_000
): Float32Array {
  if (!Number.isFinite(firstSpeechMs) || !Number.isFinite(lastSpeechMs) || lastSpeechMs <= firstSpeechMs) {
    return new Float32Array()
  }
  const start = Math.max(0, Math.floor((firstSpeechMs - paddingMs) * sampleRate / 1000))
  const end = Math.min(samples.length, Math.ceil((lastSpeechMs + paddingMs) * sampleRate / 1000))
  return samples.subarray(Math.min(start, end), end)
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
