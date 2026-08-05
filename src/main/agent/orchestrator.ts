import type { MessageParam, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages'
import { BrowserWindow } from 'electron'
import { v4 as uuid } from 'uuid'
import { ALBERT_SYSTEM_PROMPT } from './prompt'
import { selectModelTier } from './router'
import { createAnthropic } from '../anthropic/client'
import { persistChatImages, loadChatImageData } from '../chat/images'
import { getSettings } from '../config'
import {
  addMessage,
  getRecentMessages,
  recallMemories
} from '../memory/service'
import { executeTool, getAnthropicToolSchemas } from '../tools/registry'
import { ollamaChatCompletion, type OllamaChatMessage } from '../ollama/client'
import { groqChatCompletion } from '../groq/client'
import {
  extractTextToolCalls,
  looksLikeTextToolCall,
  normalizeToolCalls
} from './textToolCalls'
import { buildPersonalityPromptBlock, normalizePersonality } from '../../shared/personality'
import { isEndVoiceCommand } from '../../shared/voiceCommands'
import { activeBrainReply, isActiveBrainQuestion } from '../../shared/brainIdentity'
import type {
  AgentStreamEvent,
  ChatImageRef,
  ChatMessage,
  ChatSendPayload
} from '../../shared/types'

function emit(win: BrowserWindow | null, event: AgentStreamEvent): void {
  win?.webContents.send('albert:chat:event', event)
}

/** Never show raw [OK]/[FAIL] tool lines as the chat reply. */
function humanizeToolFallback(summaries: string[]): string {
  const last = summaries[summaries.length - 1] || ''
  const failed = summaries.some((s) => /FAILURE|NOT confirmed|Do NOT|\[FAIL\]/i.test(s))
  if (/computer_youtube/i.test(last)) {
    return failed
      ? "Couldn't pull up that YouTube video in Computer, sir — want me to try again?"
      : "It's up in my Computer window, sir."
  }
  if (/computer_open_tab|computer_navigate/i.test(last)) {
    return failed
      ? "Couldn't open that in Computer, sir."
      : 'Opened in my Computer window, sir.'
  }
  if (/spotify_control/i.test(last)) {
    if (/SUCCESS/i.test(last) && !failed) {
      return "It's playing, sir."
    }
    return "Couldn't finish playing that on Spotify, sir — I'll keep at it if you want another go."
  }
  if (/desktop_screenshot/i.test(last)) {
    return failed
      ? "Screenshot didn't go through, sir — Screen Recording permission may be off."
      : 'Got the screen, sir. Still finishing the click.'
  }
  if (/desktop_click|desktop_hotkey|desktop_type/i.test(last)) {
    return failed ? "That desktop move didn't land, sir." : 'Clicked through, sir.'
  }
  if (failed) {
    return "That didn't fully work, sir — say the word and I'll retry."
  }
  return 'Task finished, sir.'
}

function looksLikeRawToolDump(text: string): boolean {
  return (
    /^\[(OK|FAIL)\]/i.test(text.trim()) ||
    /\[SCREENSHOT\] Captured display/i.test(text) ||
    /Image attached for your vision/i.test(text) ||
    /\(\d+\s*bytes\)/i.test(text) ||
    looksLikeTextToolCall(text)
  )
}

function parseDataUrl(dataUrl: string): { mediaType: string; data: string } | null {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(dataUrl)
  if (!m) return null
  return { mediaType: m[1]!, data: m[2]! }
}

async function resolveImageBytes(
  img: ChatImageRef
): Promise<{ mediaType: ChatImageRef['mediaType']; data: string } | null> {
  if (img.dataUrl) {
    const parsed = parseDataUrl(img.dataUrl)
    if (parsed) {
      const mt = parsed.mediaType as ChatImageRef['mediaType']
      if (
        mt === 'image/png' ||
        mt === 'image/jpeg' ||
        mt === 'image/gif' ||
        mt === 'image/webp'
      ) {
        return { mediaType: mt, data: parsed.data }
      }
      return { mediaType: img.mediaType, data: parsed.data }
    }
  }
  const loaded = await loadChatImageData(img.fileName)
  if (!loaded) return null
  return { mediaType: loaded.mediaType, data: loaded.data }
}

async function anthropicContentForMessage(
  m: ChatMessage
): Promise<MessageParam['content']> {
  if (m.role !== 'user' || !m.images?.length) return m.content

  const blocks: Array<
    | { type: 'text'; text: string }
    | {
        type: 'image'
        source: {
          type: 'base64'
          media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
          data: string
        }
      }
  > = []

  const text = m.content.trim()
  if (text && text !== '(image)' && !/^\(\d+ images\)$/.test(text)) {
    blocks.push({ type: 'text', text })
  } else {
    blocks.push({ type: 'text', text: 'See attached image(s).' })
  }

  for (const img of m.images.slice(0, 4)) {
    const bytes = await resolveImageBytes(img)
    if (!bytes) continue
    blocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: bytes.mediaType,
        data: bytes.data
      }
    })
  }

  return blocks.length > 1 || blocks.some((b) => b.type === 'image') ? blocks : m.content
}

async function ollamaMessagesFromHistory(
  system: string,
  history: ChatMessage[],
  maxTurns = 16
): Promise<OllamaChatMessage[]> {
  // Keep Ollama/Groq payloads small — cloud 413/500s on huge histories / reattached images
  const rows = history
    .filter((row) => row.role === 'user' || row.role === 'assistant')
    .slice(-Math.max(4, maxTurns))

  const lastUserWithImages = [...rows]
    .reverse()
    .find((m) => m.role === 'user' && Boolean(m.images?.length))

  const messages: OllamaChatMessage[] = [{ role: 'system', content: system }]

  for (const m of rows) {
    if (m.role === 'assistant') {
      messages.push({ role: 'assistant', content: m.content })
      continue
    }

    if (!m.images?.length) {
      messages.push({ role: 'user', content: m.content })
      continue
    }

    // Older imaged turns: text only (avoid re-sending megabytes of base64)
    if (!lastUserWithImages || m.id !== lastUserWithImages.id) {
      messages.push({
        role: 'user',
        content: `${m.content}\n[${m.images.length} image(s) attached]`
      })
      continue
    }

    const parts: Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    > = []
    const text = m.content.trim() || 'See attached image(s).'
    parts.push({ type: 'text', text })
    const nativeImages: string[] = []
    for (const img of m.images.slice(0, 2)) {
      const bytes = await resolveImageBytes(img)
      if (!bytes) continue
      nativeImages.push(bytes.data)
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${bytes.mediaType};base64,${bytes.data}` }
      })
    }
    messages.push({
      role: 'user',
      content: parts.length > 1 ? parts : text,
      images: nativeImages.length ? nativeImages : undefined
    })
  }

  return messages
}

export async function runChatTurn(
  payload: string | ChatSendPayload,
  win: BrowserWindow | null
): Promise<ChatMessage> {
  const text =
    typeof payload === 'string' ? payload.trim() : String(payload?.text ?? '').trim()
  const imagePayloads = typeof payload === 'string' ? undefined : payload?.images
  const images = await persistChatImages(imagePayloads)
  if (!text && !images.length) throw new Error('Empty message')

  const displayContent =
    text || (images.length === 1 ? '(image)' : `(${images.length} images)`)

  const userMessage = addMessage({
    role: 'user',
    content: displayContent,
    images
  })
  emit(win, { type: 'message', message: userMessage })

  // App-layer standby — never let the model roleplay “Standby engaged” while voice keeps listening
  if (text && !images.length && isEndVoiceCommand(text)) {
    const assistantMessage = addMessage({
      role: 'assistant',
      content: 'Standing by, sir.'
    })
    emit(win, { type: 'standby' })
    emit(win, { type: 'message', message: assistantMessage })
    emit(win, { type: 'done' })
    return assistantMessage
  }

  const route = selectModelTier(text || 'look at this image', { hasImages: images.length > 0 })
  emit(win, {
    type: 'route',
    model: route.model,
    tier: route.tier,
    reason: route.reason
  })

  // Small models can repeat an older assistant claim even when the system note
  // says otherwise. Resolve this factual UI question deterministically so the
  // spoken answer and Route readout can never contradict each other.
  if (text && !images.length && isActiveBrainQuestion(text)) {
    const content = activeBrainReply(route)
    const assistantMessage = addMessage({ role: 'assistant', content })
    emit(win, { type: 'token', content })
    emit(win, { type: 'message', message: assistantMessage })
    emit(win, { type: 'done' })
    return assistantMessage
  }

  const memories = await recallMemories(text || 'image', 6)
  const memoryBlock =
    memories.length > 0
      ? `\n\nRelevant long-term memories:\n${memories
          .map((m) => `- [${m.category}] ${m.content}`)
          .join('\n')}`
      : ''

  const localLabel =
    route.provider === 'groq' ? 'Groq Cloud' : route.provider === 'ollama' ? 'Ollama' : null

  const routingNote =
    localLabel
      ? `\n\n=== ACTIVE BRAIN (THIS TURN) ===
Provider: ${localLabel}. Model: ${route.model}. Tier: QUICK.
You ARE on ${localLabel} right now — not Haiku, not Opus.
If chat history has you saying you were on Haiku, that was an older turn. Do NOT claim Haiku/fallback unless THIS system message says fallback.
If Kai asks which brain you're on, answer ${localLabel} and name ${route.model}.
${route.provider === 'groq' ? 'Groq is cloud inference, not an on-device/local-private model.' : ''}
Keep it light; for heavy coding, suggest Haiku/Opus.
${images.length ? `Kai attached image(s). Vision on ${localLabel} is best-effort — describe what you can; if you cannot see them, say so briefly and suggest Haiku.` : ''}
=== END BRAIN ===`
      : route.tier === 'fast'
        ? `\n\n=== ACTIVE BRAIN (THIS TURN) ===
Provider: Anthropic. Model: ${route.model}. Tier: HAIKU.
You are on Haiku this turn — not Ollama/Groq. Say so only if asked; don't invent outages.
${images.length ? 'Kai attached image(s) in this message — look at them and respond accordingly.' : ''}
=== END BRAIN ===`
        : `\n\n=== ACTIVE BRAIN (THIS TURN) ===
Provider: Anthropic. Model: ${route.model}. Tier: OPUS.
You are on Opus this turn — not Ollama/Groq. Thorough when it matters, still no fluff.
${images.length ? 'Kai attached image(s) in this message — look at them and respond accordingly.' : ''}
=== END BRAIN ===`

  const settings = getSettings()
  const projectFolder = settings.projectFolder?.trim()
  const projectBlock = projectFolder
    ? `\n\nConfigured project folder: ${projectFolder}`
    : '\n\nNo project folder configured yet.'
  const modeBlock = `\n\nAccess mode: God mode ${settings.godMode ? 'ON' : 'OFF'}. confirmDangerousTools=${settings.confirmDangerousTools ? 'ON' : 'OFF'}.${
    settings.confirmDangerousTools
      ? ' Confirmations ON — wait for Allow/Deny UI only, never invent Always Allow.'
      : ' Confirmations OFF — standing permission for screenshots/clicks/AppleScript/Spotify. Never ask “should I proceed?” Just use tools and finish.'
  }`
  const personality = normalizePersonality(settings.personality)
  const personalityBlock = buildPersonalityPromptBlock(personality)
  // Repeat dials at the end — models weight late system instructions more
  const personalityTail = `\n\nREMINDER before you answer:
- sarcasm=${personality.sarcasm}, warmth=${personality.warmth}, verbosity=${personality.verbosity}. Warm crewmate + dry TARS/JARVIS — no cringe similes.
- SIR: address Kai as “sir” a lot — “Yes sir,” “On it, sir,” “Task finished, sir,” “No offense taken, sir.” Most replies should include it.
- BRAIN: ${localLabel || 'Anthropic'} / ${route.model} this turn. Never contradict that.
- TRUTH: never claim Spotify/tools succeeded unless the tool result confirms it. No illusions.
- ACT: never ask permission for screenshots/clicks when confirms are OFF. Never paste [OK]/[FAIL]/file paths as your reply.
- EXPERIMENT: keep trying with Kai; don't pawn the task off on him as plan A.
- VOICE: you can speak — just reply; TTS handles it. Never say you're text-only.`

  const system =
    ALBERT_SYSTEM_PROMPT +
    personalityBlock +
    memoryBlock +
    projectBlock +
    modeBlock +
    routingNote +
    personalityTail

  if (route.provider === 'ollama' || route.provider === 'groq') {
    return runOpenAiLocalTurn(displayContent, system, route.model, win, route.provider)
  }

  return runAnthropicTurn(displayContent, system, route.model, route.tier, win)
}

async function runOpenAiLocalTurn(
  _userText: string,
  system: string,
  model: string,
  win: BrowserWindow | null,
  provider: 'ollama' | 'groq'
): Promise<ChatMessage> {
  const label = provider === 'groq' ? 'Groq' : 'Ollama'
  const chat = provider === 'groq' ? groqChatCompletion : ollamaChatCompletion
  // Free cloud models can reject fat histories + long system prompts — keep QUICK tight
  const history = getRecentMessages(provider === 'groq' ? 8 : 18)
  const messages: OllamaChatMessage[] = await ollamaMessagesFromHistory(
    system,
    history,
    provider === 'groq' ? 8 : 14
  )

  let loops = 0
  let finalText = ''
  let activeModel = model
  const lastToolSummaries: string[] = []
  let screenshotNudgeSent = false
  // Local tier: allow light tools; escalate to Haiku if tool-heavy / needs vision click
  while (loops < 8) {
    loops += 1
    let result
    try {
      result = await chat({
        model: activeModel,
        messages,
        tools: true,
        onToken: (delta) => emit(win, { type: 'token', content: delta })
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const short = message.replace(/\s+/g, ' ').slice(0, 100)
      emit(win, {
        type: 'route',
        model: getSettings().fastModel || 'claude-haiku-4-5',
        tier: 'fast',
        reason: `QUICK (${label}) failed → Haiku this turn (${short})`
      })
      return runAnthropicTurn(
        _userText,
        system +
          `\n\n=== ACTIVE BRAIN (THIS TURN — FALLBACK) ===
${label} failed (${short}). You are NOW on Anthropic Haiku (${getSettings().fastModel || 'claude-haiku-4-5'}).
Kai still has QUICK selected — only this turn fell back. If asked, say ${label} errored and Haiku covered it.
Do not keep claiming fallback on later turns unless this note appears again.
=== END BRAIN ===`,
        getSettings().fastModel || 'claude-haiku-4-5',
        'fast',
        win
      )
    }

    if (result.model && result.model !== activeModel) {
      emit(win, {
        type: 'route',
        model: result.model,
        tier: 'local',
        reason: `${label} model fallback · ${activeModel} unavailable`
      })
      activeModel = result.model
    }

    const toolCalls = (() => {
      const structured = normalizeToolCalls(result.tool_calls || [])
      if (structured.length) return structured
      const fromText = extractTextToolCalls(result.content || '')
      if (fromText.calls.length) {
        result = { ...result, content: fromText.cleaned, tool_calls: fromText.calls }
        return fromText.calls
      }
      return []
    })()
    if (!toolCalls.length) {
      const raw = result.content.trim()
      const shotWithoutClick =
        lastToolSummaries.some((s) => /desktop_screenshot/i.test(s) && /\[OK\]/i.test(s)) &&
        !lastToolSummaries.some((s) => /desktop_click/i.test(s))

      if (shotWithoutClick && !screenshotNudgeSent) {
        screenshotNudgeSent = true
        messages.push({
          role: 'user',
          content:
            'Continue immediately: click the correct Play/song control with desktop_click. Do not ask permission. Do not reply with tool logs — finish the task, then one short human sentence.'
        })
        continue
      }

      if (shotWithoutClick) {
        emit(win, {
          type: 'route',
          model: getSettings().fastModel || 'claude-haiku-4-5',
          tier: 'fast',
          reason: 'Escalated — desktop click needs vision → Haiku'
        })
        return runAnthropicTurn(
          _userText,
          system +
            `\n\n(Escalated from ${label}: screenshot was taken but the click was not finished. Take a fresh desktop_screenshot if needed, desktop_click the correct control, and finish the user's task. Never ask permission. Never dump raw tool output — one short human sentence when done.)`,
          getSettings().fastModel || 'claude-haiku-4-5',
          'fast',
          win
        )
      }

      if (raw && !/^done\.?$/i.test(raw) && !looksLikeRawToolDump(raw)) {
        finalText = raw
      } else if (lastToolSummaries.length) {
        finalText = humanizeToolFallback(lastToolSummaries)
      } else {
        finalText = raw && !looksLikeRawToolDump(raw)
          ? raw
          : "I didn't catch a clear result — want me to try again?"
      }
      break
    }

    if (toolCalls.length >= 2 && loops === 1) {
      emit(win, {
        type: 'route',
        model: getSettings().fastModel || 'claude-haiku-4-5',
        tier: 'fast',
        reason: 'Escalated — multi-tool task → Haiku'
      })
      return runAnthropicTurn(
        _userText,
        system +
          `\n\n(Escalated from ${label} for tool-heavy work. Never ask permission for screenshots/clicks. Never dump raw tool output.)`,
        getSettings().fastModel || 'claude-haiku-4-5',
        'fast',
        win
      )
    }

    messages.push({
      role: 'assistant',
      content: result.content || '',
      tool_calls: toolCalls
    })

    for (const call of toolCalls) {
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>
      } catch {
        args = {}
      }
      emit(win, { type: 'tool_start', toolName: call.function.name, toolArgs: args })
      const toolResult = await executeTool(call.function.name, args)
      const summary = `[${toolResult.ok ? 'OK' : 'FAIL'}] ${call.function.name}: ${toolResult.result}`
      lastToolSummaries.push(summary)
      emit(win, {
        type: 'tool_end',
        toolName: call.function.name,
        toolArgs: args,
        toolResult: toolResult.result,
        ok: toolResult.ok
      })
      addMessage({
        role: 'tool',
        content: toolResult.result,
        toolName: call.function.name,
        toolCallId: call.id
      })
      messages.push({
        role: 'tool',
        content: `${toolResult.ok ? 'SUCCESS' : 'FAILURE'}: ${toolResult.result}`,
        tool_call_id: call.id
      })
    }
  }

  if (!finalText || looksLikeRawToolDump(finalText)) {
    finalText = lastToolSummaries.length
      ? humanizeToolFallback(lastToolSummaries)
      : "I didn't get a clear result — want me to try again?"
  }

  const assistantMessage = addMessage({
    id: uuid(),
    role: 'assistant',
    content: finalText
  })
  emit(win, { type: 'message', message: assistantMessage })
  emit(win, { type: 'done' })
  return assistantMessage
}

async function runAnthropicTurn(
  _userText: string,
  system: string,
  startModel: string,
  startTier: 'fast' | 'power' | 'local',
  win: BrowserWindow | null
): Promise<ChatMessage> {
  const history = getRecentMessages(60)
  const messages: MessageParam[] = []
  for (const m of history.filter((row) => row.role === 'user' || row.role === 'assistant')) {
    messages.push({
      role: m.role as 'user' | 'assistant',
      content: await anthropicContentForMessage(m)
    })
  }

  const anthropic = createAnthropic()
  const tools = getAnthropicToolSchemas()
  let finalText = ''
  let loops = 0
  let model = startModel
  const tier = startTier === 'local' ? 'fast' : startTier

  while (loops < 16) {
    loops += 1

    const stream = anthropic.messages.stream({
      model,
      max_tokens: model.includes('haiku') ? 4096 : 8192,
      system,
      messages,
      tools
    })

    let assistantText = ''
    stream.on('text', (delta) => {
      assistantText += delta
      emit(win, { type: 'token', content: delta })
    })

    const response = await stream.finalMessage()
    const toolUses = response.content.filter(
      (block): block is ToolUseBlock => block.type === 'tool_use'
    )

    if (toolUses.length === 0) {
      finalText = assistantText.trim() || 'Task finished, sir.'
      break
    }

    if (tier === 'fast' && loops === 1 && toolUses.length >= 2) {
      const power = getSettings().powerModel || 'claude-opus-5'
      if (power !== model) {
        model = power
        emit(win, {
          type: 'route',
          model,
          tier: 'power',
          reason: 'Escalated — multi-tool task → Opus'
        })
      }
    }

    messages.push({
      role: 'assistant',
      content: response.content
    })

    const toolResults: Array<{
      type: 'tool_result'
      tool_use_id: string
      content:
        | string
        | Array<
            | { type: 'text'; text: string }
            | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
          >
      is_error?: boolean
    }> = []

    for (const call of toolUses) {
      const args = (call.input || {}) as Record<string, unknown>
      emit(win, {
        type: 'tool_start',
        toolName: call.name,
        toolArgs: args
      })

      const result = await executeTool(call.name, args)

      emit(win, {
        type: 'tool_end',
        toolName: call.name,
        toolArgs: args,
        toolResult: result.result,
        ok: result.ok
      })

      addMessage({
        role: 'tool',
        content: result.result,
        toolName: call.name,
        toolCallId: call.id
      })

      const content = result.image
        ? [
            { type: 'text' as const, text: result.result },
            {
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: result.image.mediaType,
                data: result.image.data
              }
            }
          ]
        : result.result

      toolResults.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content,
        is_error: !result.ok
      })
    }

    messages.push({
      role: 'user',
      content: toolResults
    } as MessageParam)
  }

  if (!finalText) {
    const completion = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      system,
      messages
    })
    finalText =
      completion.content
        .filter((b) => b.type === 'text')
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('')
        .trim() || 'Task finished, sir.'
    emit(win, { type: 'token', content: finalText })
  }

  const assistantMessage = addMessage({
    id: uuid(),
    role: 'assistant',
    content: finalText
  })
  emit(win, { type: 'message', message: assistantMessage })
  emit(win, { type: 'done' })
  return assistantMessage
}
