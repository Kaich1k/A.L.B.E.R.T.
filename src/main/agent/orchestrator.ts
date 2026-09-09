import type { MessageParam, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages'
import { BrowserWindow } from 'electron'
import { v4 as uuid } from 'uuid'
import { ALBERT_SYSTEM_PROMPT } from './prompt'
import { selectModelTier, type ModelRoute } from './router'
import { createAnthropic } from '../anthropic/client'
import { type CodexBridgeEvent } from '../codex/events'
import { CODEX_ESCALATION_PREFERENCE, CODEX_MODEL_PREFERENCE, pickModel } from '../codex/models'
import { CodexFault } from '../codex/protocol'
import {
  connectCodex,
  getCodexStatus,
  interruptCodexTurn,
  newCodexThread,
  refreshCodexAllowance,
  runCodexTurn as runCodexBridgeTurn,
  steerCodexTurn,
  codexTurnActive
} from '../codex/service'
import { persistChatImages, loadChatImageData } from '../chat/images'
import { getSettings, setSettings } from '../config'
import { startAppUpdate } from '../appLifecycle'
import { utteranceLooksLikeRebuildNow } from '../../shared/selfUpdate'
import {
  addMessage,
  getRecentMessages,
  listMemories,
  recallMemories,
  rememberFact
} from '../memory/service'
import { AUTO_MEMORY_CATEGORY, selectNewAutoMemories } from '../memory/autoRemember'
import { executeTool, getAnthropicToolSchemas } from '../tools/registry'
import { ollamaChatCompletion, type OllamaChatMessage } from '../ollama/client'
import { groqChatCompletion } from '../groq/client'
import { geminiChatCompletion } from '../gemini/client'
import {
  extractTextToolCalls,
  looksLikeTextToolCall,
  normalizeToolCalls
} from './textToolCalls'
import {
  applyPersonalityAdjust,
  buildPersonalityPromptBlock,
  buildPersonalityReminder,
  completionTokenBudget,
  extractPersonalityVoiceCommand,
  normalizePersonality,
  PERSONALITY_META,
  personalityAdjustReply
} from '../../shared/personality'
import {
  isEndVoiceCommand,
  isNewCodexThreadCommand,
  parseResumeCapsuleCommand,
  parseSaveCapsuleCommand
} from '../../shared/voiceCommands'
import { parseVoiceStackCommand, shortenAnswer } from '../../shared/voiceStack'
import { captureCapsule, consumePendingResumeNote, restoreCapsule } from '../context/capsules'
import { createCapture } from '../operations/service'
import { interruptCursorAgent } from '../cursor/agent'
import { showComputerWindow } from '../computer/window'
import {
  activeBrainReply,
  activeSurfacePromptBlock,
  activeSurfaceReply,
  isActiveBrainQuestion,
  isActiveSurfaceQuestion
} from '../../shared/brainIdentity'
import type {
  AgentStreamEvent,
  ChatImageRef,
  ChatMessage,
  ChatSendPayload
} from '../../shared/types'
import { DEFAULT_GEMINI_MODEL } from '../../shared/types'

function emit(win: BrowserWindow | null, event: AgentStreamEvent): void {
  const windows = BrowserWindow.getAllWindows()
  const targets = windows.length ? windows : win ? [win] : []
  for (const target of targets) {
    if (!target.isDestroyed()) target.webContents.send('albert:chat:event', event)
  }
}

/** Background: store lasting facts from this utterance. Never blocks the reply. */
async function persistAutoMemories(utterance: string, win: BrowserWindow | null): Promise<void> {
  try {
    const fresh = selectNewAutoMemories(
      utterance,
      listMemories().map((m) => m.content)
    )
    if (!fresh.length) return
    for (const fact of fresh) {
      await rememberFact(fact, AUTO_MEMORY_CATEGORY)
    }
    win?.webContents.send('albert:memory:changed')
  } catch {
    // Auto-memory must never take down a turn.
  }
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
  let text =
    typeof payload === 'string' ? payload.trim() : String(payload?.text ?? '').trim()
  const originalUtterance = text
  const imagePayloads = typeof payload === 'string' ? undefined : payload?.images
  const userMessageId = typeof payload === 'string' ? undefined : payload?.userMessageId
  const images = await persistChatImages(imagePayloads)
  if (!text && !images.length) throw new Error('Empty message')

  const displayContent =
    text || (images.length === 1 ? '(image)' : `(${images.length} images)`)

  const userMessage = addMessage({
    id: userMessageId,
    role: 'user',
    content: displayContent,
    images
  })
  emit(win, { type: 'message', message: userMessage })

  if (text && !images.length) {
    const saveCapsule = parseSaveCapsuleCommand(text)
    if (saveCapsule) {
      const capsule = await captureCapsule({ title: saveCapsule.title || undefined })
      const assistantMessage = addMessage({
        role: 'assistant',
        content: `Capsule sealed as “${capsule.title}”, sir. Say resume ${capsule.title} when you want that position back.`
      })
      emit(win, { type: 'message', message: assistantMessage })
      emit(win, { type: 'done' })
      win?.webContents.send('albert:capsules:changed')
      return assistantMessage
    }

    const resumeCapsule = parseResumeCapsuleCommand(text)
    if (resumeCapsule) {
      const restored = await restoreCapsule(resumeCapsule.query)
      win?.webContents.send('albert:capsules:changed')
      if (restored.capsule) {
        win?.webContents.send('albert:capsule:restored', restored.capsule)
      }
      if (!resumeCapsule.remainder || !restored.capsule) {
        const assistantMessage = addMessage({
          role: 'assistant',
          content: restored.reply
        })
        emit(win, { type: 'message', message: assistantMessage })
        emit(win, { type: 'done' })
        return assistantMessage
      }
      text = resumeCapsule.remainder
    }
  }

  if (text && !images.length) {
    const stack = parseVoiceStackCommand(text)
    if (stack) {
      const history = getRecentMessages(50)
      const original =
        [...history]
          .reverse()
          .find(
            (m) =>
              m.role === 'assistant' &&
              m.content &&
              !/^Short version,/i.test(m.content) &&
              !/^Paused,/i.test(m.content) &&
              !/^Queued for your phone/i.test(m.content)
          )?.content || ''
      let reply = ''
      if (stack === 'short') {
        reply = original
          ? `Short version, sir: ${shortenAnswer(original)} The original answer is still in the transcript.`
          : 'No prior answer to shorten, sir.'
      } else if (stack === 'original') {
        reply = original
          ? 'The original answer is still on-screen above, sir — I did not overwrite it.'
          : 'No original answer stored, sir.'
      } else if (stack === 'pause') {
        void interruptCodexTurn()
        interruptCursorAgent()
        emit(win, { type: 'pause_speech' })
        reply = 'Paused, sir. Original answer is intact.'
      } else if (stack === 'show') {
        showComputerWindow()
        win?.webContents.send('albert:operations:changed')
        emit(win, { type: 'theater' })
        reply = 'On the board, sir — Computer, artifacts, and the last tool map.'
      } else if (stack === 'phone') {
        const packet = original.slice(0, 4_000) || text
        createCapture(`Phone packet:\n${packet}`, 'note')
        reply = 'Queued for your phone, sir. The original stays in this transcript; companion sync will pick it up.'
      } else if (stack === 'hold') {
        const capsule = await captureCapsule({ notes: original.slice(0, 1_000), panel: 'conversation' })
        reply = `Held, sir. Capsule “${capsule.title}” sealed without dropping the last answer.`
      }
      const assistantMessage = addMessage({ role: 'assistant', content: reply })
      emit(win, { type: 'message', message: assistantMessage })
      emit(win, { type: 'done' })
      return assistantMessage
    }
  }

  if (text && !images.length && isNewCodexThreadCommand(text)) {
    newCodexThread()
    const assistantMessage = addMessage({
      role: 'assistant',
      content: 'Fresh Codex thread, sir — the next engineering turn starts clean.'
    })
    emit(win, { type: 'codex_status', codex: getCodexStatus() })
    emit(win, { type: 'message', message: assistantMessage })
    emit(win, { type: 'done' })
    return assistantMessage
  }

  // App-layer standby — never let the model roleplay “Standby engaged” while voice keeps listening
  if (text && !images.length && isEndVoiceCommand(text)) {
    // A Codex turn can outlive the voice session; stand down means stop working.
    void interruptCodexTurn()
    const assistantMessage = addMessage({
      role: 'assistant',
      content: 'Standing by, sir.'
    })
    emit(win, { type: 'standby' })
    emit(win, { type: 'message', message: assistantMessage })
    emit(win, { type: 'done' })
    return assistantMessage
  }

  // Personality dials — apply in the app layer so the model can't fake a change.
  // Compound asks (“…and also tune humor to 70%”) apply the dial, then continue
  // with the remaining request under a system note that the dial already moved.
  let dialAppliedNote = ''
  if (text && !images.length) {
    const extracted = extractPersonalityVoiceCommand(text)
    if (extracted) {
      const previousPersonality = normalizePersonality(getSettings().personality)
      const nextPersonality = applyPersonalityAdjust(previousPersonality, extracted.adj)
      const nextSettings = setSettings({ personality: nextPersonality })
      emit(win, { type: 'settings', settings: nextSettings })
      const confirm = personalityAdjustReply(
        extracted.adj,
        nextPersonality,
        previousPersonality
      )

      if (!extracted.remainder) {
        const assistantMessage = addMessage({ role: 'assistant', content: confirm })
        emit(win, { type: 'token', content: confirm })
        emit(win, { type: 'message', message: assistantMessage })
        emit(win, { type: 'done' })
        return assistantMessage
      }

      const label = PERSONALITY_META[extracted.adj.key].label
      const alias = extracted.adj.key === 'sarcasm' ? ' (humor)' : ''
      dialAppliedNote = `\n\n=== DIAL ALREADY APPLIED (THIS TURN) ===
App layer set ${label}${alias} from ${previousPersonality[extracted.adj.key]} to ${nextPersonality[extracted.adj.key]}.
Confirm briefly if useful (${JSON.stringify(confirm)}). Answer the remaining ask below.
Do NOT invent dial math ("X% more/less…"). Do NOT claim other dials changed.
Remaining ask: ${extracted.remainder}
=== END DIAL ===`
      // Route / recall / reply against the non-dial portion
      // (full utterance stays in chat history as Kai said it).
      text = extracted.remainder
    }
  }

  if (text && !images.length && utteranceLooksLikeRebuildNow(text)) {
    if (codexTurnActive()) void interruptCodexTurn()
    const started = startAppUpdate(true)
    const content = started.ok
      ? [
          'Started the detached rebuild, sir.',
          'Leave this window alone until I quit and reopen myself — a follow-up chat will not stop npm.',
          started.result
        ].join(' ')
      : started.result
    const assistantMessage = addMessage({ role: 'assistant', content })
    emit(win, { type: 'token', content })
    emit(win, { type: 'message', message: assistantMessage })
    emit(win, { type: 'done' })
    return assistantMessage
  }

  if (text && !images.length && codexTurnActive()) {
    const steered = await steerCodexTurn(text)
    const content = steered
      ? 'Folded that into the job already running, sir. I did not abort it.'
      : 'Still on the last job, sir. Say standby only if you want me to stop.'
    const assistantMessage = addMessage({ role: 'assistant', content })
    emit(win, { type: 'token', content })
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

  if (text && !images.length && isActiveSurfaceQuestion(text)) {
    const content = activeSurfaceReply('mac')
    const assistantMessage = addMessage({ role: 'assistant', content })
    emit(win, { type: 'token', content })
    emit(win, { type: 'message', message: assistantMessage })
    emit(win, { type: 'done' })
    return assistantMessage
  }

  if (originalUtterance && getSettings().autoRememberEnabled !== false) {
    void persistAutoMemories(originalUtterance, win)
  }

  const settings = getSettings()
  // Performance mode avoids a blocking embeddings request before every reply.
  // Local lexical recall is immediate; full semantic recall remains available
  // when performance mode is disabled.
  const memories = await recallMemories(text || 'image', 6, {
    semantic: settings.performanceMode === false
  })
  const memoryBlock =
    memories.length > 0
      ? `\n\nRelevant long-term memories:\n${memories
          .map((m) => `- [${m.category}] ${m.content}`)
          .join('\n')}`
      : ''

  const localLabel =
    route.provider === 'groq'
      ? 'Groq Cloud'
      : route.provider === 'gemini'
        ? 'Gemini / Google AI Studio'
        : route.provider === 'ollama'
          ? 'Ollama'
          : null

  const routingNote =
    route.provider === 'codex'
      ? `\n\n=== ACTIVE BRAIN (THIS TURN) ===
Provider: ChatGPT (OpenAI Codex on Kai's ChatGPT allowance). Tier: CHATGPT.
You are ChatGPT / Codex this turn — not Gemini, not Opus, not Ollama/Groq.
You have real shell, file editing, and test-running access inside the project sandbox.
Running npm run update:app / install:app is allowed: the Mac host intercepts it and starts a detached installer, then relaunches. Treat a declined shell plus “started detached” as success — do not retry. Never killall/pkill/osascript-quit ALBERT; call restart via the host instead.
After you edit ALBERT src/scripts/package.json, the host rebuilds when the turn finishes — including if the turn is interrupted. You do not have to reach the shell. Tell Kai that.
If Kai asks whether the update ran, or tells you to run npm run update:app / reopen the app now, the host starts that installer immediately.
Acknowledge once (“On it, sir.”), then work silently. Do not read files or say you are still working. One short final when done.
Finish the work, then report the outcome in one short spoken paragraph. Do not paste diffs or command logs as your reply — the UI already shows them.
If Kai asks which brain you're on, say ChatGPT (Codex) on your ChatGPT allowance.
=== END BRAIN ===`
      : localLabel
      ? `\n\n=== ACTIVE BRAIN (THIS TURN) ===
Provider: ${localLabel}. Model: ${route.model}. Tier: QUICK.
You ARE on ${localLabel} right now — not Haiku, not Opus.
If chat history has you saying you were on Haiku, that was an older turn. Do NOT claim Haiku/fallback unless THIS system message says fallback.
If Kai asks which brain you're on, answer ${localLabel} and name ${route.model}.
${route.provider === 'groq' ? 'Groq is cloud inference, not an on-device/local-private model.' : ''}
${route.provider === 'gemini' ? 'Gemini free tier is Google cloud inference; free-tier prompts may be used to improve Google products. Not on-device/private.' : ''}
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
  const brainLabel =
    route.provider === 'codex' ? 'ChatGPT' : localLabel || 'Anthropic'
  const personalityTail =
    buildPersonalityReminder(personality) +
    `\n- SURFACE: Mac desktop app this turn — not the phone companion. Never contradict that.
- BRAIN: ${brainLabel} / ${route.model} this turn. Never contradict that.
- ACT: never ask permission for screenshots/clicks when confirms are OFF. Never paste [OK]/[FAIL]/file paths as your reply.
- EXPERIMENT: keep trying with Kai; don't pawn the task off on him as plan A.
- VOICE: you can speak — just reply; TTS handles it. Never say you're text-only.`

  const surfaceBlock = `\n\n${activeSurfacePromptBlock('mac')}`
  const resumeNote = consumePendingResumeNote()
  const resumeBlock = resumeNote ? `\n\n=== RESTORED CONTEXT CAPSULE ===\n${resumeNote}\n=== END CAPSULE ===` : ''

  const system =
    ALBERT_SYSTEM_PROMPT +
    personalityBlock +
    memoryBlock +
    projectBlock +
    modeBlock +
    surfaceBlock +
    resumeBlock +
    routingNote +
    dialAppliedNote +
    personalityTail

  // Soft prompts get ignored by QUICK models — max_tokens must track the dial.
  const replyBudget = completionTokenBudget(personality.verbosity)
  const toolBudget = completionTokenBudget(personality.verbosity, { forTools: true })

  if (route.provider === 'codex') {
    return runCodexChatTurn({
      userText: text,
      displayContent,
      system,
      route,
      images,
      win,
      replyBudget,
      toolBudget
    })
  }

  if (route.provider === 'ollama' || route.provider === 'groq' || route.provider === 'gemini') {
    return runOpenAiLocalTurn(
      displayContent,
      system,
      route.model,
      win,
      route.provider,
      replyBudget,
      toolBudget
    )
  }

  // Codex and the QUICK providers returned above, so this is an Anthropic tier.
  return runAnthropicTurn(
    displayContent,
    system,
    route.model,
    route.tier === 'power' ? 'power' : 'fast',
    win,
    replyBudget,
    toolBudget
  )
}

/**
 * Anthropic is a paid brain, so nothing may escalate into it implicitly.
 * Returns the tier to escalate to, or null when Kai must be told it failed.
 */
function escalationTarget(): { provider: 'codex' | 'anthropic'; model: string } | null {
  const settings = getSettings()
  if (settings.codexEnabled !== false) {
    return { provider: 'codex', model: settings.codexModel || 'codex' }
  }
  if (settings.paidFallbackEnabled) {
    return { provider: 'anthropic', model: settings.fastModel || 'claude-haiku-4-5' }
  }
  return null
}

/**
 * A QUICK-tier turn needs a stronger brain. Prefer Codex (covered by Kai's
 * ChatGPT plan), use Anthropic only when he switched paid fallback on, and
 * otherwise say what happened rather than billing him by surprise.
 */
async function escalateFromQuick(opts: {
  displayContent: string
  system: string
  note: string
  reason: string
  win: BrowserWindow | null
  replyBudget?: number
  toolBudget?: number
}): Promise<ChatMessage> {
  const target = escalationTarget()
  const { win } = opts

  if (target?.provider === 'codex') {
    return runCodexChatTurn({
      userText: opts.displayContent,
      displayContent: opts.displayContent,
      system: opts.system + opts.note,
      route: {
        tier: 'codex',
        model: target.model,
        provider: 'codex',
        reason: opts.reason
      },
      images: [],
      win,
      replyBudget: opts.replyBudget ?? 320,
      toolBudget: opts.toolBudget ?? 768
    })
  }

  if (target?.provider === 'anthropic') {
    emit(win, { type: 'route', model: target.model, tier: 'fast', reason: opts.reason })
    return runAnthropicTurn(
      opts.displayContent,
      opts.system + opts.note,
      target.model,
      'fast',
      win,
      opts.replyBudget,
      opts.toolBudget
    )
  }

  const content =
    'That needs a stronger brain than QUICK, sir, and both escalation routes are off — ' +
    'turn Codex back on in Systems, or enable paid fallback.'
  const assistantMessage = addMessage({ id: uuid(), role: 'assistant', content })
  emit(win, { type: 'token', content })
  emit(win, { type: 'message', message: assistantMessage })
  emit(win, { type: 'done' })
  return assistantMessage
}

/** HUD-only; never spoken. File names and command lines stay off Comm. */
async function runCodexChatTurn(args: {
  userText: string
  displayContent: string
  system: string
  route: ModelRoute
  images: ChatImageRef[]
  win: BrowserWindow | null
  replyBudget: number
  toolBudget: number
}): Promise<ChatMessage> {
  const { system, route, images, win } = args
  const settings = getSettings()

  // Reuse the warm bridge between turns; reconnect only when startup has not
  // completed yet. This avoids repeating the account/allowance handshake.
  const cachedStatus = getCodexStatus()
  const status =
    cachedStatus.connected && cachedStatus.availableModels.length > 0
      ? cachedStatus
      : await connectCodex()
  if (!status.installed) {
    return codexFallback(
      args,
      new CodexFault(
        'notInstalled',
        `The Codex CLI isn't installed on this Mac, sir. ${status.installHint ?? ''}`.trim()
      )
    )
  }
  if (!status.signedIn) {
    return codexFallback(
      args,
      new CodexFault(
        'notSignedIn',
        'Codex is not signed in, sir — open Systems → Codex and sign in with ChatGPT.'
      )
    )
  }

  const models = status.availableModels.map((m) => ({
    id: m.id,
    displayName: m.displayName,
    description: '',
    efforts: m.efforts,
    defaultEffort: null,
    isDefault: false
  }))
  const model =
    (route.escalate
      ? pickModel(models, CODEX_ESCALATION_PREFERENCE, settings.codexEscalationModel)
      : pickModel(models, CODEX_MODEL_PREFERENCE, settings.codexModel)) || status.model

  emit(win, {
    type: 'route',
    model: model || 'codex',
    tier: 'codex',
    reason: route.reason
  })
  emit(win, { type: 'codex_status', codex: { ...status, model: model ?? status.model } })

  const input: Parameters<typeof runCodexBridgeTurn>[0]['input'] = []
  if (args.userText.trim()) input.push({ type: 'text', text: args.userText.trim() })
  for (const img of images.slice(0, 4)) {
    const bytes = await resolveImageBytes(img)
    if (!bytes) continue
    input.push({ type: 'image', url: `data:${bytes.mediaType};base64,${bytes.data}` })
  }
  if (!input.length) input.push({ type: 'text', text: args.displayContent })

  let lastProgressAt = 0
  let streamedAnswer = ''
  const openCommands = new Map<string, string>()
  emit(win, { type: 'codex_progress', content: 'On it, sir.' })

  const onEvent = (event: CodexBridgeEvent): void => {
    switch (event.kind) {
      case 'reasoning':
        break
      case 'delta':
        streamedAnswer += event.text
        emit(win, { type: 'token', content: event.text })
        if (Date.now() - lastProgressAt > 2_400) {
          lastProgressAt = Date.now()
          emit(win, { type: 'codex_progress', content: 'On it, sir.' })
        }
        break
      case 'plan':
        emit(win, { type: 'codex_plan', plan: event.steps })
        break
      case 'diff':
        emit(win, { type: 'codex_diff', diff: event.diff.slice(0, 8_000) })
        break
      case 'commandStart':
        openCommands.set(event.itemId, event.command)
        emit(win, {
          type: 'tool_start',
          toolName: 'codex_command',
          toolArgs: { command: event.command, cwd: event.cwd }
        })
        break
      case 'commandEnd':
        openCommands.delete(event.itemId)
        emit(win, {
          type: 'tool_end',
          toolName: 'codex_command',
          toolArgs: { command: event.command },
          toolResult: event.output.slice(-4_000),
          ok: event.ok
        })
        break
      case 'fileChange':
        emit(win, {
          type: 'tool_end',
          toolName: 'codex_edit',
          toolArgs: { paths: event.paths },
          toolResult: event.paths.join('\n'),
          ok: event.ok
        })
        break
      case 'toolCall':
        emit(win, {
          type: 'tool_end',
          toolName: `codex_${event.name}`,
          toolArgs: {},
          toolResult: event.ok ? 'ok' : 'failed',
          ok: event.ok
        })
        break
      case 'error':
        emit(win, { type: 'codex_progress', content: `Fault: ${event.fault.message}` })
        break
      default:
        break
    }
  }

  try {
    const result = await runCodexBridgeTurn({
      input,
      onEvent,
      developerInstructions: system,
      model: model || undefined,
      effort: status.effort
    })

    void refreshCodexAllowance().then((allowance) => {
      if (allowance) emit(win, { type: 'codex_status', codex: getCodexStatus() })
    })

    if (result.interrupted) {
      const content = 'Stopped there, sir.'
      const assistantMessage = addMessage({ role: 'assistant', content })
      emit(win, { type: 'token', content })
      emit(win, { type: 'message', message: assistantMessage })
      emit(win, { type: 'done' })
      return assistantMessage
    }

    const finalText =
      result.text.trim() ||
      (openCommands.size
        ? 'Codex stopped mid-command, sir — nothing conclusive to report.'
        : 'Codex finished but said nothing, sir — want me to run that again?')

    // Streamed deltas already reached the UI and voice queue. Only send a
    // missing suffix here; the final persisted message remains authoritative.
    if (!streamedAnswer) {
      emit(win, { type: 'token', content: finalText })
    } else if (finalText.startsWith(streamedAnswer)) {
      const tail = finalText.slice(streamedAnswer.length)
      if (tail) emit(win, { type: 'token', content: tail })
    }
    const assistantMessage = addMessage({ id: uuid(), role: 'assistant', content: finalText })
    emit(win, { type: 'message', message: assistantMessage })
    emit(win, { type: 'done' })
    return assistantMessage
  } catch (err) {
    return codexFallback(args, err)
  }
}

/**
 * Codex failed. Escalate only where Kai has opted in; otherwise say plainly
 * what broke instead of quietly spending Anthropic credit.
 */
async function codexFallback(
  args: {
    displayContent: string
    system: string
    win: BrowserWindow | null
    replyBudget: number
    toolBudget: number
  },
  err: unknown
): Promise<ChatMessage> {
  const fault =
    err instanceof CodexFault
      ? err
      : new CodexFault('unknown', err instanceof Error ? err.message : String(err))
  const { win } = args
  const settings = getSettings()

  if (settings.geminiApiKey?.trim()) {
    const model = settings.geminiModel || DEFAULT_GEMINI_MODEL
    emit(win, {
      type: 'route',
      model,
      tier: 'local',
      reason: `ChatGPT failed → Gemini`
    })
    return runOpenAiLocalTurn(
      args.displayContent,
      args.system +
        `\n\n=== ACTIVE BRAIN (THIS TURN — GEMINI FALLBACK) ===
ChatGPT/Codex failed: ${fault.message}
You are NOW on Gemini (${model}), the free fallback. Answer the ask. Do not claim to be ChatGPT. Do not narrate the ChatGPT fault unless Kai asks.
=== END BRAIN ===`,
      model,
      win,
      'gemini',
      args.replyBudget,
      args.toolBudget
    )
  }

  if (settings.paidFallbackEnabled && settings.anthropicApiKey?.trim()) {
    const model = settings.powerModel || 'claude-opus-5'
    emit(win, {
      type: 'route',
      model,
      tier: 'power',
      reason: `ChatGPT failed → Opus (paid)`
    })
    return runAnthropicTurn(
      args.displayContent,
      args.system +
        `\n\n=== ACTIVE BRAIN (THIS TURN — PAID FALLBACK) ===
ChatGPT/Codex failed: ${fault.message}
You are NOW on Anthropic Opus (${model}), which Kai pays for per token. He turned paid Opus fallback ON, so this is expected.
Answer the ask. Do not claim to be ChatGPT. Do not narrate the ChatGPT fault unless Kai asks.
=== END BRAIN ===`,
      model,
      'power',
      win,
      args.replyBudget,
      args.toolBudget
    )
  }

  const advice =
    fault.kind === 'notInstalled'
      ? ' Run `npm install -g @openai/codex` and reopen me.'
      : fault.kind === 'notSignedIn'
        ? ' Sign in from Systems → Brain.'
        : fault.kind === 'usageLimit'
          ? ' Add a Gemini key in Systems, or turn on paid Opus fallback.'
          : fault.kind === 'contextWindow'
            ? ' Say “new ChatGPT thread” and I’ll start clean.'
            : ' Gemini (free) or Opus (paid) can cover if you enable them in Systems.'
  const content = `${fault.message}${advice}`

  emit(win, { type: 'error', error: fault.message })
  const assistantMessage = addMessage({ id: uuid(), role: 'assistant', content })
  emit(win, { type: 'token', content })
  emit(win, { type: 'message', message: assistantMessage })
  emit(win, { type: 'done' })
  return assistantMessage
}

async function runOpenAiLocalTurn(
  _userText: string,
  system: string,
  model: string,
  win: BrowserWindow | null,
  provider: 'ollama' | 'groq' | 'gemini',
  replyTokens = 320,
  toolTokens = 768
): Promise<ChatMessage> {
  const label = provider === 'groq' ? 'Groq' : provider === 'gemini' ? 'Gemini' : 'Ollama'
  const chat =
    provider === 'groq'
      ? groqChatCompletion
      : provider === 'gemini'
        ? geminiChatCompletion
        : ollamaChatCompletion
  // Free cloud models can reject fat histories + long system prompts — keep QUICK tight
  const history = getRecentMessages(provider === 'ollama' ? 18 : 8)
  const messages: OllamaChatMessage[] = await ollamaMessagesFromHistory(
    system,
    history,
    provider === 'ollama' ? 14 : 8
  )

  let loops = 0
  let finalText = ''
  let activeModel = model
  const lastToolSummaries: string[] = []
  let screenshotNudgeSent = false
  // Local tier: allow light tools; escalate to Haiku if tool-heavy / needs vision click
  while (loops < 8) {
    loops += 1
    // Loop 1 may emit tools OR the final reply — keep tool headroom but still
    // scale with verbosity so ultra-terse dials aren't stuck at 768.
    const maxTokens =
      loops === 1
        ? Math.min(toolTokens, Math.max(replyTokens * 2, replyTokens + 120))
        : replyTokens
    let result
    try {
      result = await chat({
        model: activeModel,
        messages,
        tools: true,
        maxTokens,
        onToken: (delta) => emit(win, { type: 'token', content: delta })
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const short = message.replace(/\s+/g, ' ').slice(0, 100)
      return escalateFromQuick({
        displayContent: _userText,
        system,
        reason: `QUICK (${label}) failed → escalating (${short})`,
        note: `\n\n=== ACTIVE BRAIN (THIS TURN — FALLBACK) ===
${label} failed (${short}). You are NOT on ${label} any more; the brain named above is answering.
Kai still has QUICK selected — only this turn fell back. If asked, say ${label} errored and this brain covered it.
Do not keep claiming fallback on later turns unless this note appears again.
=== END BRAIN ===`,
        win,
        replyBudget: replyTokens,
        toolBudget: toolTokens
      })
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
        return escalateFromQuick({
          displayContent: _userText,
          system,
          reason: 'Escalated — desktop click needs vision',
          note: `\n\n(Escalated from ${label}: screenshot was taken but the click was not finished. Take a fresh desktop_screenshot if needed, desktop_click the correct control, and finish the user's task. Never ask permission. Never dump raw tool output — one short human sentence when done.)`,
          win,
          replyBudget: replyTokens,
          toolBudget: toolTokens
        })
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
      return escalateFromQuick({
        displayContent: _userText,
        system,
        reason: 'Escalated — multi-tool task',
        note: `\n\n(Escalated from ${label} for tool-heavy work. Never ask permission for screenshots/clicks. Never dump raw tool output.)`,
        win,
        replyBudget: replyTokens,
        toolBudget: toolTokens
      })
    }

    messages.push({
      role: 'assistant',
      content: result.content || '',
      tool_calls: toolCalls
    })

    // OpenAI-compatible APIs reject image parts on a `tool` message, so any
    // screenshot has to ride along in a follow-up user turn. Without this the
    // QUICK tier (Gemini especially) only ever saw a text description of the
    // screen and then guessed where to click.
    const toolImages: Array<{ mediaType: string; data: string; toolName: string }> = []

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
      if (toolResult.image) {
        toolImages.push({ ...toolResult.image, toolName: call.function.name })
      }
    }

    if (toolImages.length) {
      const parts: Array<
        { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
      > = [
        {
          type: 'text',
          text:
            `Here is the actual image from ${toolImages.map((i) => i.toolName).join(', ')}. ` +
            'Look at it and continue the task — click the real control you can see. Do not ask permission.'
        }
      ]
      for (const image of toolImages.slice(0, 2)) {
        parts.push({
          type: 'image_url',
          image_url: { url: `data:${image.mediaType};base64,${image.data}` }
        })
      }
      messages.push({
        role: 'user',
        content: parts,
        // Ollama takes raw base64 on its own `images` field.
        images: toolImages.slice(0, 2).map((i) => i.data)
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
  win: BrowserWindow | null,
  replyBudget = 320,
  toolBudget = 768
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
  const ceiling = model.includes('haiku') ? 4096 : 8192
  // Respect verbosity: do NOT floor every turn to 768 (that erased terse dials).
  const toolTokens = Math.min(Math.max(toolBudget, 256), ceiling)
  const textTokens = Math.min(Math.max(replyBudget, 64), ceiling)

  while (loops < 16) {
    loops += 1
    const maxTokens = loops === 1 ? toolTokens : textTokens

    const stream = anthropic.messages.stream({
      model,
      max_tokens: maxTokens,
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
      max_tokens: textTokens,
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
