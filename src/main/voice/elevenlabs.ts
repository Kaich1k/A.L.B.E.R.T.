import { getSettings } from '../config'

export type ElevenLabsSpeakOptions = {
  apiKey?: string
  voiceId?: string
}

export async function synthesizeElevenLabs(
  text: string,
  overrides?: ElevenLabsSpeakOptions
): Promise<Buffer> {
  const settings = getSettings()
  const apiKey = (overrides?.apiKey ?? settings.elevenLabsApiKey)?.trim()
  const voiceId = (overrides?.voiceId ?? settings.elevenLabsVoiceId)?.trim()
  if (!apiKey) throw new Error('Add your ElevenLabs API key under Systems')
  if (!voiceId) throw new Error('Add your ElevenLabs Voice ID under Systems')

  const cleaned = text.replace(/\s+/g, ' ').trim().slice(0, 4500)
  if (!cleaned) throw new Error('Nothing to speak')

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg'
    },
    body: JSON.stringify({
      text: cleaned,
      model_id: 'eleven_flash_v2_5',
      voice_settings: {
        stability: 0.4,
        similarity_boost: 0.75
      }
    })
  })

  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { detail?: { message?: string } | string }
      if (typeof body.detail === 'string') detail = body.detail
      else if (body.detail?.message) detail = body.detail.message
      else detail = JSON.stringify(body).slice(0, 240)
    } catch {
      detail = await res.text().catch(() => '')
    }
    throw new Error(
      detail
        ? `ElevenLabs TTS failed (${res.status}): ${detail.slice(0, 280)}`
        : `ElevenLabs TTS failed (${res.status})`
    )
  }

  const ab = await res.arrayBuffer()
  return Buffer.from(ab)
}
