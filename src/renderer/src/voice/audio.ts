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
