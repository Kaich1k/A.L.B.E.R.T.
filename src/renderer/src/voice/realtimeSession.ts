import type { RealtimeSessionConfig, VoiceState } from '../../../shared/types'

type VoiceListener = (state: VoiceState) => void
type TranscriptListener = (role: 'user' | 'assistant', text: string) => void

export class RealtimeVoiceSession {
  private pc: RTCPeerConnection | null = null
  private dc: RTCDataChannel | null = null
  private localStream: MediaStream | null = null
  private audioEl: HTMLAudioElement | null = null
  private onState: VoiceListener
  private onTranscript: TranscriptListener
  private running = false

  constructor(onState: VoiceListener, onTranscript: TranscriptListener) {
    this.onState = onState
    this.onTranscript = onTranscript
  }

  async start(config: RealtimeSessionConfig): Promise<void> {
    if (this.running) await this.stop()
    this.running = true
    this.onState('connecting')

    this.audioEl = document.createElement('audio')
    this.audioEl.autoplay = true

    this.pc = new RTCPeerConnection()
    this.pc.ontrack = (event) => {
      if (this.audioEl) {
        this.audioEl.srcObject = event.streams[0]
      }
    }

    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    for (const track of this.localStream.getTracks()) {
      this.pc.addTrack(track, this.localStream)
    }

    this.dc = this.pc.createDataChannel('oai-events')
    this.dc.onopen = () => {
      this.onState('listening')
      // Session config is attached to the ephemeral secret; nudge tools/instructions if needed
      this.dc?.send(
        JSON.stringify({
          type: 'session.update',
          session: {
            type: 'realtime',
            instructions: config.instructions,
            tools: config.tools,
            tool_choice: 'auto',
            audio: {
              input: {
                transcription: { model: 'whisper-1' }
              },
              output: {
                voice: config.voice
              }
            }
          }
        })
      )
    }
    this.dc.onmessage = (event) => {
      void this.handleServerEvent(event.data)
    }

    const offer = await this.pc.createOffer()
    await this.pc.setLocalDescription(offer)

    const response = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${config.clientSecret}`,
        'Content-Type': 'application/sdp'
      }
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`Realtime WebRTC failed: ${response.status} ${err}`)
    }

    const answer: RTCSessionDescriptionInit = {
      type: 'answer',
      sdp: await response.text()
    }
    await this.pc.setRemoteDescription(answer)
  }

  async stop(): Promise<void> {
    this.running = false
    this.dc?.close()
    this.pc?.getSenders().forEach((s) => s.track?.stop())
    this.pc?.close()
    this.localStream?.getTracks().forEach((t) => t.stop())
    if (this.audioEl) {
      this.audioEl.srcObject = null
      this.audioEl = null
    }
    this.dc = null
    this.pc = null
    this.localStream = null
    this.onState('idle')
  }

  private async handleServerEvent(raw: string): Promise<void> {
    let event: Record<string, unknown>
    try {
      event = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return
    }

    const type = String(event.type || '')

    if (type === 'input_audio_buffer.speech_started') {
      this.onState('listening')
    } else if (type === 'response.created' || type === 'response.output_item.added') {
      this.onState('thinking')
    } else if (
      type === 'output_audio_buffer.started' ||
      type === 'response.audio.delta' ||
      type === 'response.output_audio.delta'
    ) {
      this.onState('speaking')
    } else if (
      type === 'response.done' ||
      type === 'output_audio_buffer.stopped' ||
      type === 'response.output_audio.done'
    ) {
      this.onState('listening')
    }

    if (
      type === 'conversation.item.input_audio_transcription.completed' ||
      type === 'conversation.item.input_audio_transcription.done'
    ) {
      const transcript = String(event.transcript || '')
      if (transcript) this.onTranscript('user', transcript)
    }

    if (
      type === 'response.audio_transcript.done' ||
      type === 'response.output_audio_transcript.done'
    ) {
      const transcript = String(event.transcript || '')
      if (transcript) this.onTranscript('assistant', transcript)
    }

    if (type === 'response.function_call_arguments.done') {
      const name = String(event.name || '')
      const callId = String(event.call_id || '')
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(String(event.arguments || '{}')) as Record<string, unknown>
      } catch {
        args = {}
      }

      this.onState('thinking')
      // Never auto-confirm — dangerous tools must show Allow/Deny even in voice
      const result = await window.albert.executeTool(name, args, false)
      this.dc?.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: result.result
          }
        })
      )
      this.dc?.send(JSON.stringify({ type: 'response.create' }))
    }
  }
}
