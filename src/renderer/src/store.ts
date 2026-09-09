import { create } from 'zustand'
import type {
  ActivityEntry,
  AlbertSettings,
  ChatMessage,
  CodexPlanStepView,
  CodexStatus,
  MemoryFact,
  PanelId,
  VoiceState
} from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'

interface AlbertState {
  panel: PanelId
  settings: AlbertSettings
  messages: ChatMessage[]
  streamingText: string
  busy: boolean
  error: string | null
  memories: MemoryFact[]
  activity: ActivityEntry[]
  voiceState: VoiceState
  voiceStatus: string
  routeInfo: string
  wakeArmed: boolean
  /** Latest Codex bridge status — drives the allowance readout. */
  codexStatus: CodexStatus | null
  /** Codex plan for the current turn (empty between turns). */
  codexPlan: CodexPlanStepView[]
  /** Newest Codex progress line (reasoning, command, edit). */
  codexProgress: string
  /** Unified diff Codex has produced so far this turn. */
  codexDiff: string
  setPanel: (panel: PanelId) => void
  setSettings: (settings: AlbertSettings) => void
  setMessages: (messages: ChatMessage[]) => void
  appendMessage: (message: ChatMessage) => void
  setStreamingText: (text: string) => void
  appendStreamingText: (token: string) => void
  setBusy: (busy: boolean) => void
  setError: (error: string | null) => void
  setMemories: (memories: MemoryFact[]) => void
  setActivity: (activity: ActivityEntry[]) => void
  setVoiceState: (state: VoiceState) => void
  setVoiceStatus: (status: string) => void
  setRouteInfo: (info: string) => void
  setWakeArmed: (armed: boolean) => void
  setCodexStatus: (status: CodexStatus | null) => void
  setCodexPlan: (plan: CodexPlanStepView[]) => void
  setCodexProgress: (line: string) => void
  setCodexDiff: (diff: string) => void
  /** Wipe per-turn Codex HUD state when a turn ends. */
  clearCodexTurn: () => void
}

export const useAlbertStore = create<AlbertState>((set) => ({
  panel: 'home',
  settings: DEFAULT_SETTINGS,
  messages: [],
  streamingText: '',
  busy: false,
  error: null,
  memories: [],
  activity: [],
  voiceState: 'idle',
  voiceStatus: '',
  routeInfo: '',
  wakeArmed: false,
  codexStatus: null,
  codexPlan: [],
  codexProgress: '',
  codexDiff: '',
  setPanel: (panel) => set({ panel }),
  setSettings: (settings) => set({ settings }),
  setMessages: (messages) => set({ messages }),
  appendMessage: (message) =>
    set((s) => {
      // Voice path + chat IPC can both surface the same turn — keep one
      const dup = s.messages.some(
        (m) =>
          m.role === message.role &&
          m.content === message.content &&
          Math.abs(m.createdAt - message.createdAt) < 12_000
      )
      if (dup) return s
      return {
        messages: [...s.messages.filter((m) => m.id !== message.id), message]
      }
    }),
  setStreamingText: (streamingText) => set({ streamingText }),
  appendStreamingText: (token) =>
    set((s) => ({ streamingText: s.streamingText + token })),
  setBusy: (busy) => set({ busy }),
  setError: (error) => set({ error }),
  setMemories: (memories) => set({ memories }),
  setActivity: (activity) => set({ activity }),
  setVoiceState: (voiceState) => set({ voiceState }),
  setVoiceStatus: (voiceStatus) => set({ voiceStatus }),
  setRouteInfo: (routeInfo) => set({ routeInfo }),
  setWakeArmed: (wakeArmed) => set({ wakeArmed }),
  setCodexStatus: (codexStatus) => set({ codexStatus }),
  setCodexPlan: (codexPlan) => set({ codexPlan }),
  setCodexProgress: (codexProgress) => set({ codexProgress }),
  setCodexDiff: (codexDiff) => set({ codexDiff }),
  clearCodexTurn: () => set({ codexPlan: [], codexProgress: '', codexDiff: '' })
}))
