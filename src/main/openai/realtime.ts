import { ALBERT_SYSTEM_PROMPT } from '../agent/prompt'
import { getSettings, requireOpenAIApiKey } from '../config'
import { recallMemories } from '../memory/service'
import { getRealtimeToolSchemas } from '../tools/registry'
import { getRealtimeModel, getVoice } from './client'
import type { RealtimeSessionConfig } from '../../shared/types'

export async function createRealtimeSession(): Promise<RealtimeSessionConfig> {
  const apiKey = requireOpenAIApiKey()
  const model = getRealtimeModel()
  const voice = getVoice()
  const settings = getSettings()
  const projectFolder = settings.projectFolder?.trim()

  const memories = await recallMemories('user preferences identity projects', 8)
  const memoryBlock =
    memories.length > 0
      ? `\n\nLong-term memories:\n${memories.map((m) => `- ${m.content}`).join('\n')}`
      : ''
  const projectBlock = projectFolder
    ? `\n\nConfigured project folder: ${projectFolder}`
    : ''
  const modeBlock = `\n\nAccess mode: God mode ${settings.godMode ? 'ON' : 'OFF'}. confirmDangerousTools=${settings.confirmDangerousTools ? 'ON' : 'OFF'}. If confirms are ON, wait for Allow/Deny — there is no Always Allow.`

  const instructions = ALBERT_SYSTEM_PROMPT + memoryBlock + projectBlock + modeBlock
  const tools = getRealtimeToolSchemas()

  // GA Realtime API — /v1/realtime/sessions (beta) was retired
  const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      expires_after: {
        anchor: 'created_at',
        seconds: 600
      },
      session: {
        type: 'realtime',
        model,
        instructions,
        tools,
        tool_choice: 'auto',
        audio: {
          input: {
            transcription: {
              model: 'whisper-1'
            }
          },
          output: {
            voice
          }
        }
      }
    })
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Failed to create Realtime session: ${response.status} ${errText}`)
  }

  const data = (await response.json()) as {
    value?: string
    client_secret?: string | { value?: string }
    session?: { model?: string }
  }

  const clientSecret =
    data.value ||
    (typeof data.client_secret === 'string'
      ? data.client_secret
      : data.client_secret?.value)

  if (!clientSecret) {
    throw new Error('Realtime session missing ephemeral client secret (value)')
  }

  return {
    clientSecret,
    model: data.session?.model || model,
    voice,
    instructions,
    tools
  }
}
