import { BrowserWindow, app, ipcMain, shell } from 'electron'
import { IpcChannels } from '../../shared/ipc'
import type { ChatSendPayload } from '../../shared/types'
import { getSettings, setSettings } from '../config'
import { runChatTurn } from '../agent/orchestrator'
import { loadChatImageData } from '../chat/images'
import {
  addMessage,
  clearActivity,
  clearMessages,
  deleteMemory,
  getRecentMessages,
  listActivity,
  listMemories,
  updateMemory
} from '../memory/service'
import { createRealtimeSession } from '../openai/realtime'
import { executeTool } from '../tools/registry'
import { transcribeFloat32, warmWhisper } from '../voice/whisper'
import {
  applyCompanionSettings,
  getCompanionStatus,
  revokeCompanionAccess,
  startCompanionServer
} from '../companion/server'
import { registerComputerIpc } from '../computer/tabs'
import { synthesizeElevenLabs } from '../voice/elevenlabs'
import { synthesizeKokoro, warmKokoro } from '../voice/kokoro'
import { probeOllama, pullOllamaModel } from '../ollama/client'
import { probeGroq } from '../groq/client'
import { randomBytes } from 'crypto'
import type { AlbertSettings } from '../../shared/types'
import {
  addMissionStep,
  createCapture,
  createMission,
  createRoutine,
  deleteMission,
  deleteRoutine,
  getOperationsSnapshot,
  resolveApproval,
  updateCapture,
  updateMission,
  updateMissionStep,
  updateRoutine
} from '../operations/service'

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  registerComputerIpc()
  const changed = (): void => getWindow()?.webContents.send('albert:operations:changed')

  ipcMain.handle(IpcChannels.operationsGet, () => getOperationsSnapshot())
  ipcMain.handle(IpcChannels.missionCreate, (_e, input) => { const value = createMission(input); changed(); return value })
  ipcMain.handle(IpcChannels.missionUpdate, (_e, { id, patch }) => { const value = updateMission(id, patch); changed(); return value })
  ipcMain.handle(IpcChannels.missionDelete, (_e, id: string) => { const value = deleteMission(id); changed(); return value })
  ipcMain.handle(IpcChannels.missionStepAdd, (_e, { missionId, title }) => { const value = addMissionStep(missionId, title); changed(); return value })
  ipcMain.handle(IpcChannels.missionStepUpdate, (_e, { id, patch }) => { const value = updateMissionStep(id, patch); changed(); return value })
  ipcMain.handle(IpcChannels.routineCreate, (_e, input) => { const value = createRoutine(input); changed(); return value })
  ipcMain.handle(IpcChannels.routineUpdate, (_e, { id, patch }) => { const value = updateRoutine(id, patch); changed(); return value })
  ipcMain.handle(IpcChannels.routineDelete, (_e, id: string) => { const value = deleteRoutine(id); changed(); return value })
  ipcMain.handle(IpcChannels.approvalResolve, (_e, { id, resolution }) => { const value = resolveApproval(id, resolution); changed(); return value })
  ipcMain.handle(IpcChannels.captureCreate, (_e, { content, kind }) => { const value = createCapture(content, kind); changed(); return value })
  ipcMain.handle(IpcChannels.captureUpdate, (_e, { id, state }) => { const value = updateCapture(id, state); changed(); return value })

  ipcMain.handle(IpcChannels.windowHide, () => {
    const win = getWindow()
    if (!win) return false
    win.hide()
    return true
  })

  ipcMain.handle(IpcChannels.windowShow, () => {
    const win = getWindow()
    if (!win) return false
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    if (process.platform === 'darwin') {
      app.dock?.show()
      app.focus({ steal: true })
    }
    win.moveTop()
    return true
  })

  ipcMain.handle(IpcChannels.windowToggle, () => {
    const win = getWindow()
    if (!win) return false
    if (win.isVisible() && win.isFocused()) {
      win.minimize()
    } else {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
    return true
  })

  ipcMain.handle(IpcChannels.ollamaProbe, () => probeOllama())
  ipcMain.handle(IpcChannels.ollamaPull, (_e, model?: string) => pullOllamaModel(model))
  ipcMain.handle(IpcChannels.groqProbe, () => probeGroq())

  /** Open the relevant macOS Privacy & Security pane for desktop automation. */
  ipcMain.handle(
    IpcChannels.openPrivacyPane,
    async (_e, pane: 'accessibility' | 'screen' | 'automation' | 'microphone') => {
      const urls: Record<typeof pane, string[]> = {
        accessibility: [
          'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
          'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility'
        ],
        screen: [
          'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
          'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture'
        ],
        automation: [
          'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
          'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Automation'
        ],
        microphone: [
          'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
          'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone'
        ]
      }
      const candidates = urls[pane] || urls.accessibility
      for (const url of candidates) {
        try {
          await shell.openExternal(url)
          return true
        } catch {
          // try next URL style (older vs newer macOS)
        }
      }
      // Fallback: open Privacy & Security root
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension'
      )
      return true
    }
  )

  ipcMain.handle(IpcChannels.settingsGet, () => {
    const settings = getSettings()
    // Mask key slightly for UI display if desired — still return full for local settings edit
    return settings
  })

  ipcMain.handle(IpcChannels.settingsSet, async (_e, partial: Partial<AlbertSettings>) => {
    const next = setSettings(partial)
    if (
      partial.companionEnabled !== undefined ||
      partial.companionPort !== undefined ||
      partial.companionToken !== undefined
    ) {
      await applyCompanionSettings()
    }
    return { ...next, ...getSettings() }
  })

  ipcMain.handle(IpcChannels.chatHistory, () => getRecentMessages(200))

  ipcMain.handle(IpcChannels.chatClear, () => {
    clearMessages()
    return true
  })

  ipcMain.handle(
    IpcChannels.chatAppend,
    (
      _e,
      payload: { role: 'user' | 'assistant'; content: string }
    ) => addMessage({ role: payload.role, content: payload.content })
  )

  ipcMain.handle(
    IpcChannels.chatSend,
    async (_e, payload: string | ChatSendPayload) => {
      try {
        return await runChatTurn(payload, getWindow())
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        getWindow()?.webContents.send('albert:chat:event', {
          type: 'error',
          error: message
        })
        throw err
      }
    }
  )

  ipcMain.handle(IpcChannels.chatImageData, async (_e, fileName: string) => {
    const loaded = await loadChatImageData(String(fileName || ''))
    return loaded?.dataUrl ?? null
  })

  ipcMain.handle(IpcChannels.memoryList, () => listMemories())

  ipcMain.handle(IpcChannels.memoryDelete, (_e, id: string) => deleteMemory(id))

  ipcMain.handle(
    IpcChannels.memoryUpdate,
    (_e, payload: { id: string; content: string; category?: string }) =>
      updateMemory(payload.id, payload.content, payload.category)
  )

  ipcMain.handle(IpcChannels.activityList, () => listActivity(150))

  ipcMain.handle(IpcChannels.activityClear, () => {
    clearActivity()
    return true
  })

  ipcMain.handle(IpcChannels.realtimeSession, async () => createRealtimeSession())

  ipcMain.handle(
    IpcChannels.toolExecute,
    async (
      _e,
      payload: { name: string; args: Record<string, unknown>; confirmed?: boolean }
    ) => executeTool(payload.name, payload.args ?? {}, { confirmed: payload.confirmed })
  )

  ipcMain.handle(IpcChannels.voiceWarm, async () => {
    await warmWhisper()
    return true
  })

  ipcMain.handle(
    IpcChannels.voiceTranscribe,
    async (_e, payload: { samples: number[]; prompt?: string }) => {
      try {
        return await transcribeFloat32(payload.samples ?? [], {
          prompt: payload.prompt
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        throw new Error(`Speech transcription failed: ${message}`)
      }
    }
  )

  ipcMain.handle(IpcChannels.companionStatus, () => getCompanionStatus())

  ipcMain.handle(IpcChannels.companionApply, async () => applyCompanionSettings())

  ipcMain.handle(IpcChannels.companionRotateToken, async () => {
    const token = randomBytes(24).toString('hex')
    setSettings({ companionToken: token })
    if (getSettings().companionEnabled) await startCompanionServer()
    return getCompanionStatus()
  })
  ipcMain.handle(IpcChannels.companionRevokeDevice, (_event, deviceId: string) =>
    revokeCompanionAccess(deviceId)
  )

  ipcMain.handle(
    IpcChannels.ttsSpeak,
    async (
      _e,
      payload: string | { text: string; apiKey?: string; voiceId?: string }
    ) => {
      try {
        const text = typeof payload === 'string' ? payload : payload?.text
        const overrides =
          typeof payload === 'string'
            ? undefined
            : { apiKey: payload?.apiKey, voiceId: payload?.voiceId }
        const audio = await synthesizeElevenLabs(String(text || ''), overrides)
        return audio.toString('base64')
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        throw new Error(message)
      }
    }
  )

  ipcMain.handle(
    IpcChannels.ttsKokoro,
    async (_e, payload: { text: string; voiceId?: string }) => {
      try {
        const audio = await synthesizeKokoro(String(payload?.text || ''), {
          voiceId: payload?.voiceId
        })
        return audio.toString('base64')
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        throw new Error(message)
      }
    }
  )

  ipcMain.handle(IpcChannels.ttsKokoroWarm, async () => {
    try {
      warmKokoro()
      // Force the load promise to settle (download + init)
      await synthesizeKokoro('Ready.', {})
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(message)
    }
  })
}
