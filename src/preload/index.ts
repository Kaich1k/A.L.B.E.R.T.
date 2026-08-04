import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '../shared/ipc'
import type { AlbertApi } from '../shared/api'
import type { AgentStreamEvent, ComputerState } from '../shared/types'

const api: AlbertApi = {
  getSettings: () => ipcRenderer.invoke(IpcChannels.settingsGet),
  setSettings: (partial) => ipcRenderer.invoke(IpcChannels.settingsSet, partial),

  getChatHistory: () => ipcRenderer.invoke(IpcChannels.chatHistory),
  clearChat: () => ipcRenderer.invoke(IpcChannels.chatClear),
  appendChat: (role, content) =>
    ipcRenderer.invoke(IpcChannels.chatAppend, { role, content }),
  sendChat: (payload) => ipcRenderer.invoke(IpcChannels.chatSend, payload),
  getChatImageDataUrl: (fileName) =>
    ipcRenderer.invoke(IpcChannels.chatImageData, fileName),
  onChatEvent: (handler) => {
    const listener = (_: Electron.IpcRendererEvent, event: AgentStreamEvent): void =>
      handler(event)
    ipcRenderer.on('albert:chat:event', listener)
    return () => ipcRenderer.removeListener('albert:chat:event', listener)
  },

  listMemories: () => ipcRenderer.invoke(IpcChannels.memoryList),
  deleteMemory: (id) => ipcRenderer.invoke(IpcChannels.memoryDelete, id),
  updateMemory: (id, content, category) =>
    ipcRenderer.invoke(IpcChannels.memoryUpdate, { id, content, category }),

  listActivity: () => ipcRenderer.invoke(IpcChannels.activityList),
  clearActivity: () => ipcRenderer.invoke(IpcChannels.activityClear),

  createRealtimeSession: () => ipcRenderer.invoke(IpcChannels.realtimeSession),

  executeTool: (name, args, confirmed) =>
    ipcRenderer.invoke(IpcChannels.toolExecute, { name, args, confirmed }),

  warmVoice: () => ipcRenderer.invoke(IpcChannels.voiceWarm),
  transcribeAudio: (samples, opts) =>
    ipcRenderer.invoke(IpcChannels.voiceTranscribe, {
      samples: Array.from(samples instanceof Float32Array ? samples : samples),
      prompt: opts?.prompt
    }),

  getCompanionStatus: () => ipcRenderer.invoke(IpcChannels.companionStatus),
  applyCompanion: () => ipcRenderer.invoke(IpcChannels.companionApply),
  rotateCompanionToken: () => ipcRenderer.invoke(IpcChannels.companionRotateToken),

  speakElevenLabs: (text, overrides) =>
    ipcRenderer.invoke(IpcChannels.ttsSpeak, { text, ...overrides }),
  speakKokoro: (text, overrides) =>
    ipcRenderer.invoke(IpcChannels.ttsKokoro, { text, ...overrides }),
  warmKokoro: () => ipcRenderer.invoke(IpcChannels.ttsKokoroWarm),
  onKokoroProgress: (handler) => {
    const listener = (
      _: Electron.IpcRendererEvent,
      payload: { status: string; file?: string; progress?: number; message?: string }
    ): void => handler(payload)
    ipcRenderer.on(IpcChannels.ttsKokoroProgress, listener)
    return () => ipcRenderer.removeListener(IpcChannels.ttsKokoroProgress, listener)
  },

  getComputerState: () => ipcRenderer.invoke(IpcChannels.computerState),
  showComputer: () => ipcRenderer.invoke(IpcChannels.computerShow),
  openComputerTab: (url, title) =>
    ipcRenderer.invoke(IpcChannels.computerOpen, { url, title }),
  navigateComputerTab: (url, tabId) =>
    ipcRenderer.invoke(IpcChannels.computerNavigate, { url, tabId }),
  focusComputerTab: (tabId) => ipcRenderer.invoke(IpcChannels.computerFocus, tabId),
  closeComputerTab: (tabId) => ipcRenderer.invoke(IpcChannels.computerClose, tabId),
  updateComputerTab: (tabId, patch) =>
    ipcRenderer.invoke(IpcChannels.computerUpdateTab, { tabId, ...patch }),
  onComputerChanged: (handler) => {
    const listener = (_: Electron.IpcRendererEvent, state: ComputerState): void =>
      handler(state)
    ipcRenderer.on('albert:computer:changed', listener)
    return () => ipcRenderer.removeListener('albert:computer:changed', listener)
  },
  onComputerGetPage: (handler) => {
    const listener = (
      _: Electron.IpcRendererEvent,
      payload: { requestId: string; tabId: string }
    ): void => handler(payload)
    ipcRenderer.on('albert:computer:get-page', listener)
    return () => ipcRenderer.removeListener('albert:computer:get-page', listener)
  },
  replyComputerGetPage: (payload) => {
    ipcRenderer.send('albert:computer:get-page-result', payload)
  },

  hideWindow: () => ipcRenderer.invoke(IpcChannels.windowHide),
  showWindow: () => ipcRenderer.invoke(IpcChannels.windowShow),
  toggleWindow: () => ipcRenderer.invoke(IpcChannels.windowToggle),
  openPrivacyPane: (pane) => ipcRenderer.invoke(IpcChannels.openPrivacyPane, pane),
  probeOllama: () => ipcRenderer.invoke(IpcChannels.ollamaProbe),
  probeGroq: () => ipcRenderer.invoke(IpcChannels.groqProbe)
}

contextBridge.exposeInMainWorld('albert', api)
