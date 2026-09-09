import { BrowserWindow, app, clipboard, dialog, ipcMain, shell } from 'electron'
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
import {
  cancelCodexLogin,
  connectCodex,
  getCodexStatus,
  interruptCodexTurn,
  loginCodex,
  logoutCodexAccount,
  newCodexThread,
  onCodexStatus,
  refreshCodexAllowance
} from '../codex/service'
import { importChatGptExport, scanChatGptExport } from '../chatgptImport'
import { synthesizeElevenLabs } from '../voice/elevenlabs'
import { synthesizeKokoro, warmKokoro } from '../voice/kokoro'
import { probeOllama, pullOllamaModel } from '../ollama/client'
import { probeGroq } from '../groq/client'
import { probeGemini } from '../gemini/client'
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
import {
  captureCapsule,
  deleteCapsule,
  importLegacyCapsules,
  listCapsules,
  restoreCapsule
} from '../context/capsules'
import { getProjectPulse } from '../pulse/projectPulse'
import { getDailyBrief } from '../brief/dailyBrief'
import { listArtifacts, saveArtifact } from '../artifacts/store'
import { listTheaterEvents } from '../theater/bus'
import {
  getCursorAgentStatus,
  interruptCursorAgent,
  openInCursor,
  runCursorAgent
} from '../cursor/agent'
import {
  setAmbientHud,
  setHudRoam,
  dockHud,
  releaseHudDock,
  isHudDocked,
  dragAmbientHud,
  getHudRoam,
  getHudRuntime,
  reportHudRuntime,
  setHudClickThrough
} from '../hud/miniHud'

export function registerIpcHandlers(
  getWindow: () => BrowserWindow | null,
  ensureWindow?: () => BrowserWindow | null
): void {
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

  const capsulesChanged = (): void => getWindow()?.webContents.send('albert:capsules:changed')
  ipcMain.handle(IpcChannels.capsulesList, () => listCapsules())
  ipcMain.handle(IpcChannels.capsulesSave, async (_e, input) => {
    const value = await captureCapsule(input || {})
    capsulesChanged()
    return value
  })
  ipcMain.handle(IpcChannels.capsulesRestore, async (_e, idOrQuery: string) => {
    const value = await restoreCapsule(String(idOrQuery || ''))
    capsulesChanged()
    if (value.capsule) {
      getWindow()?.webContents.send('albert:capsule:restored', value.capsule)
    }
    return value
  })
  ipcMain.handle(IpcChannels.capsulesDelete, (_e, id: string) => {
    const value = deleteCapsule(String(id || ''))
    capsulesChanged()
    return value
  })
  ipcMain.handle(IpcChannels.capsulesImport, (_e, raw: unknown) => {
    importLegacyCapsules(raw)
    capsulesChanged()
    return listCapsules()
  })
  ipcMain.handle(IpcChannels.projectPulseGet, (_e, force?: boolean) => getProjectPulse(Boolean(force)))
  ipcMain.handle(IpcChannels.dailyBriefGet, (_e, force?: boolean) => getDailyBrief(Boolean(force)))
  ipcMain.handle(IpcChannels.artifactsList, () => listArtifacts())
  ipcMain.handle(IpcChannels.artifactsSave, (_e, input) => saveArtifact(input || {}))
  ipcMain.handle(IpcChannels.theaterList, () => listTheaterEvents())
  ipcMain.handle(IpcChannels.hudSnapshot, (): import('../../shared/types').HudSnapshot => {
    const ops = getOperationsSnapshot()
    const active = ops.missions.find((m) => m.state === 'active') || ops.missions.find((m) => !['complete', 'cancelled'].includes(m.state))
    const live = getHudRuntime()
    return {
      voiceState: live.voiceState,
      busy: live.busy,
      missionTitle: active?.title || live.tool || null,
      nextStep: active?.steps.find((s) => s.state !== 'complete')?.title || null,
      focusRemaining: 0,
      theaterCount: listTheaterEvents().length,
      roam: getHudRoam(),
      docked: isHudDocked()
    }
  })
  ipcMain.handle(IpcChannels.cursorStatus, () => getCursorAgentStatus())
  ipcMain.handle(IpcChannels.cursorRun, (_e, payload: { prompt: string; workspace?: string }) =>
    runCursorAgent(String(payload?.prompt || ''), payload?.workspace)
  )
  ipcMain.handle(IpcChannels.cursorOpen, (_e, workspace?: string) => openInCursor(workspace))
  ipcMain.handle(IpcChannels.cursorInterrupt, () => interruptCursorAgent())
  ipcMain.handle(IpcChannels.ambientHudSet, (_e, enabled: boolean) => {
    setAmbientHud(Boolean(enabled))
    return Boolean(enabled)
  })
  ipcMain.handle(IpcChannels.hudDrag, (_e, payload: { phase: 'start' | 'move' | 'end'; screenX: number; screenY: number }) => {
    dragAmbientHud(payload)
  })
  ipcMain.handle(IpcChannels.hudRoamSet, (_e, enabled: boolean) => setHudRoam(Boolean(enabled)))
  ipcMain.handle(
    IpcChannels.hudDock,
    (
      _e,
      slot?: { x: number; y: number; width: number; height: number; park?: boolean } | null
    ) => dockHud(slot)
  )
  ipcMain.handle(IpcChannels.hudUndock, () => {
    releaseHudDock()
  })
  ipcMain.handle(IpcChannels.hudRuntime, (_e, state: { voiceState?: import('../../shared/types').VoiceState; busy?: boolean; tool?: string }) => {
    reportHudRuntime(state || {})
  })
  ipcMain.handle(IpcChannels.hudClickThrough, (_e, ignore: boolean) => {
    setHudClickThrough(Boolean(ignore))
  })
  ipcMain.handle(IpcChannels.voiceToggle, () => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send('albert:voice-toggle')
  })
  ipcMain.handle(IpcChannels.clipboardImage, (): import('../../shared/types').ChatImagePayload | null => {
    const image = clipboard.readImage()
    if (image.isEmpty()) return null
    const png = image.toPNG()
    if (!png.length || png.length > 4_500_000) return null
    return { mediaType: 'image/png', data: png.toString('base64') }
  })

  ipcMain.handle(IpcChannels.windowHide, () => {
    const win = getWindow()
    if (!win) return false
    win.hide()
    return true
  })

  ipcMain.handle(IpcChannels.windowShow, () => {
    const win = ensureWindow?.() ?? getWindow()
    if (!win || win.isDestroyed()) return false
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
  ipcMain.handle(IpcChannels.geminiProbe, () => probeGemini())

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
    if (partial.ambientHudEnabled !== undefined) {
      setAmbientHud(next.ambientHudEnabled !== false)
    }
    if (partial.ambientHudRoam !== undefined) {
      setHudRoam(next.ambientHudRoam !== false)
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
        const win = getWindow()
        if (win && !win.isDestroyed()) {
          win.webContents.send('albert:chat:event', {
            type: 'error',
            error: message
          })
        }
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

  // Push Codex status (sign-in, allowance, faults) so the HUD stays live
  // without the renderer polling.
  onCodexStatus((status) => {
    getWindow()?.webContents.send('albert:chat:event', { type: 'codex_status', codex: status })
  })

  ipcMain.handle(IpcChannels.codexStatus, () => getCodexStatus())
  ipcMain.handle(IpcChannels.codexConnect, () => connectCodex())
  ipcMain.handle(IpcChannels.codexLogin, () => loginCodex())
  ipcMain.handle(IpcChannels.codexLoginCancel, () => cancelCodexLogin())
  ipcMain.handle(IpcChannels.codexLogout, () => logoutCodexAccount())
  ipcMain.handle(IpcChannels.codexRateLimits, () => refreshCodexAllowance())
  ipcMain.handle(IpcChannels.codexInterrupt, () => interruptCodexTurn())
  ipcMain.handle(IpcChannels.codexNewThread, () => {
    newCodexThread()
    return getCodexStatus()
  })

  ipcMain.handle(IpcChannels.chatgptImportPick, async () => {
    const win = getWindow()
    const options = {
      title: 'Choose your ChatGPT data export',
      message: 'Pick the export .zip, or the folder you already unzipped.',
      properties: ['openFile', 'openDirectory'] as Array<'openFile' | 'openDirectory'>,
      filters: [{ name: 'ChatGPT export', extensions: ['zip'] }]
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IpcChannels.chatgptImportScan, (_e, path: string) => {
    try {
      return scanChatGptExport(String(path || ''))
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle(
    IpcChannels.chatgptImportRun,
    async (_e, payload: { path: string; includeHistory?: boolean }) => {
      try {
        const result = await importChatGptExport(String(payload?.path || ''), {
          includeHistory: payload?.includeHistory !== false
        })
        getWindow()?.webContents.send('albert:memory:changed')
        return result
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    }
  )
}
