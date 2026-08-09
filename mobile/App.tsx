import { Orbitron_500Medium } from '@expo-google-fonts/orbitron/500Medium'
import { Orbitron_700Bold } from '@expo-google-fonts/orbitron/700Bold'
import { Rajdhani_500Medium } from '@expo-google-fonts/rajdhani/500Medium'
import { Rajdhani_700Bold } from '@expo-google-fonts/rajdhani/700Bold'
import { ShareTechMono_400Regular } from '@expo-google-fonts/share-tech-mono/400Regular'
import * as Clipboard from 'expo-clipboard'
import { useFonts } from 'expo-font'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, AppState, StyleSheet, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { HudBackground } from './src/components/HudBackground'
import { StartupSequence } from './src/components/StartupSequence'
import { StatusRail } from './src/components/StatusRail'
import { TabBar } from './src/components/TabBar'
import { Toast } from './src/components/Toast'
import { chatWithProvider, modelsFor, ProviderRequestError } from './src/lib/chat'
import { newId } from './src/lib/id'
import { isLoopbackMacUrl, normalizeMacUrl, parsePairInfo } from './src/lib/pairInfo'
import {
  addLocalMissionStep,
  createLocalCapture,
  createLocalMission,
  createLocalRoutine,
  removeLocalMission,
  removeLocalRoutine,
  resolveLocalApproval,
  setLocalCaptureState,
  setLocalMissionStep,
  updateLocalMission,
  updateLocalRoutine
} from './src/lib/operations'
import {
  DEFAULT_CONFIG,
  loadConfig,
  loadDraft,
  loadLocalData,
  recordLocalMutation,
  saveConfig,
  saveDraft,
  saveLocalData,
  upsertLocalMemory
} from './src/lib/storage'
import {
  checkMacHealth,
  enrollWithMac,
  MacSyncError,
  normalizeBase,
  revokeThisDevice,
  syncAllWithMac,
  syncBackoffMs,
  SyncCoordinator
} from './src/lib/sync'
import { useAlbertVoice } from './src/lib/voiceSession'
import { ChatScreen } from './src/screens/ChatScreen'
import { HomeScreen } from './src/screens/HomeScreen'
import { MemoryScreen } from './src/screens/MemoryScreen'
import {
  OperationsScreen,
  type CreateMissionInput,
  type CreateRoutineInput,
  type OperationsSectionId,
  type UpdateMissionInput,
  type UpdateRoutineInput
} from './src/screens/OperationsScreen'
import { PairScreen } from './src/screens/PairScreen'
import { sizes } from './src/theme'
import {
  EMPTY_OPERATIONS,
  EMPTY_SYNC_STATE,
  type ActivityEntry,
  type CaptureItem,
  type ChatMessage,
  type CompanionConfig,
  type LocalData,
  type MacLinkState,
  type MemoryFact,
  type MissionStep,
  type TabId
} from './src/types'

type ToastState = {
  message: string
  tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'
}

type ChatTurnOptions = {
  existingUserId?: string
  contextMessages?: ChatMessage[]
}

type OperationsLanding = {
  section?: OperationsSectionId
  focusCapture?: boolean
}

function emptyLocalData(): LocalData {
  return {
    messages: [],
    memories: [],
    operations: { ...EMPTY_OPERATIONS, missions: [], routines: [], approvals: [], captures: [] },
    activity: [],
    sync: { ...EMPTY_SYNC_STATE, tombstones: [], outbox: [] }
  }
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatSyncLabel(timestamp?: number): string | undefined {
  if (!timestamp) return undefined
  return `Last sync ${new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

function appendActivity(
  activity: ActivityEntry[],
  toolName: string,
  args: Record<string, unknown>,
  result: string,
  ok = true
): ActivityEntry[] {
  return [{ id: `activity_${newId()}`, toolName, args, result, ok, createdAt: Date.now() }, ...activity]
    .slice(0, 100)
}

export default function App(): React.JSX.Element {
  const [fontsLoaded, fontError] = useFonts({
    Orbitron_500Medium,
    Orbitron_700Bold,
    Rajdhani_500Medium,
    Rajdhani_700Bold,
    ShareTechMono_400Regular
  })
  const [fontFallback, setFontFallback] = useState(false)
  const fontsReady = fontsLoaded || fontFallback

  const [bootReady, setBootReady] = useState(false)
  const [bootFault, setBootFault] = useState<string | null>(null)
  const [startupVisible, setStartupVisible] = useState(true)
  const [tab, setTab] = useState<TabId>('home')
  const [operationsLanding, setOperationsLanding] = useState<OperationsLanding>({})
  const [config, setConfigState] = useState<CompanionConfig>(DEFAULT_CONFIG)
  const [data, setData] = useState<LocalData>(emptyLocalData)
  const [draft, setDraft] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const [syncBusy, setSyncBusy] = useState(false)
  const [operationBusy, setOperationBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [syncNote, setSyncNote] = useState<string | null>(null)
  const [linkState, setLinkState] = useState<MacLinkState>('unconfigured')
  const [remoteName, setRemoteName] = useState<string | undefined>()
  const [toast, setToast] = useState<ToastState | null>(null)

  const mountedRef = useRef(true)
  const configRef = useRef(config)
  const dataRef = useRef(data)
  const persistenceRef = useRef<Promise<void>>(Promise.resolve())
  const syncCoordinatorRef = useRef(new SyncCoordinator())
  const chatTaskRef = useRef<Promise<string> | null>(null)
  const chatAbortRef = useRef<AbortController | null>(null)
  const mutationSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const performSyncRef = useRef<
    (options?: { quiet?: boolean; allowEnroll?: boolean }) => Promise<LocalData>
  >(async () => dataRef.current)

  configRef.current = config
  dataRef.current = data

  useEffect(() => {
    mountedRef.current = true
    const timer = setTimeout(() => setFontFallback(true), 4_500)
    return () => {
      mountedRef.current = false
      clearTimeout(timer)
      if (mutationSyncTimerRef.current) clearTimeout(mutationSyncTimerRef.current)
      chatAbortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (fontError) setFontFallback(true)
  }, [fontError])

  const showToast = useCallback((message: string, tone: ToastState['tone'] = 'accent') => {
    setToast({ message, tone })
  }, [])

  const queueDataSave = useCallback((next: LocalData) => {
    persistenceRef.current = persistenceRef.current
      .catch(() => undefined)
      .then(() => saveLocalData(next))
      .catch((error) => {
        if (!mountedRef.current) return
        setLinkError(`Local storage fault — ${messageFor(error)}`)
      })
  }, [])

  const commitData = useCallback(
    (updater: LocalData | ((current: LocalData) => LocalData)): LocalData => {
      const next = typeof updater === 'function' ? updater(dataRef.current) : updater
      dataRef.current = next
      if (mountedRef.current) setData(next)
      queueDataSave(next)
      return next
    },
    [queueDataSave]
  )

  const updateConfig = useCallback((next: CompanionConfig) => {
    configRef.current = next
    setConfigState(next)
  }, [])

  const loadApp = useCallback(async () => {
    setBootFault(null)
    try {
      const [storedConfig, storedData, storedDraft] = await Promise.all([
        loadConfig(),
        loadLocalData(),
        loadDraft()
      ])
      if (!mountedRef.current) return
      configRef.current = storedConfig
      dataRef.current = storedData
      setConfigState(storedConfig)
      setData(storedData)
      setDraft(storedDraft)
      setRemoteName(storedData.sync.remoteName)
      setLinkState(
        storedConfig.macBaseUrl && storedConfig.macCredential ? 'checking' : 'unconfigured'
      )
      setBootReady(true)
      // Persist normalized defaults and complete any v1 → v2 migration.
      await Promise.all([saveConfig(storedConfig), saveLocalData(storedData)])
    } catch (error) {
      if (mountedRef.current) setBootFault(`Local systems could not initialize. ${messageFor(error)}`)
    }
  }, [])

  useEffect(() => {
    void loadApp()
  }, [loadApp])

  useEffect(() => {
    if (!bootReady) return
    const timer = setTimeout(() => void saveDraft(draft), 320)
    return () => clearTimeout(timer)
  }, [bootReady, draft])

  const paired = Boolean(config.macBaseUrl.trim() && config.macCredential.trim())

  const persistConfig = useCallback(async () => {
    const current = configRef.current
    const next = { ...current, macBaseUrl: normalizeBase(current.macBaseUrl) }
    updateConfig(next)
    await saveConfig(next)
    setLinkError(null)
    showToast('Systems configuration secured on this device.', 'ok')
  }, [showToast, updateConfig])

  const performSync = useCallback(
    (options: { quiet?: boolean; allowEnroll?: boolean } = {}): Promise<LocalData> => {
      return syncCoordinatorRef.current.run(async () => {
        const quiet = options.quiet === true
        setSyncBusy(true)
        setRefreshing(!quiet)
        setLinkError(null)
        if (!quiet) setSyncNote(null)
        try {
          let currentConfig = configRef.current
          const normalizedUrl = normalizeBase(currentConfig.macBaseUrl)
          if (!normalizedUrl) throw new MacSyncError('Enter the Mac companion URL in Systems', 0, 'protocol')
          if (normalizedUrl !== currentConfig.macBaseUrl) {
            currentConfig = { ...currentConfig, macBaseUrl: normalizedUrl }
            updateConfig(currentConfig)
          }

          if (!currentConfig.macCredential.trim()) {
            if (!options.allowEnroll) {
              throw new MacSyncError('This phone is not enrolled with the Mac yet', 0, 'auth')
            }
            setLinkState('enrolling')
            const enrollment = await enrollWithMac({
              baseUrl: normalizedUrl,
              enrollmentToken: currentConfig.macToken,
              deviceId: currentConfig.deviceId,
              deviceName: currentConfig.deviceName
            })
            currentConfig = {
              ...currentConfig,
              macBaseUrl: normalizedUrl,
              macCredential: enrollment.credential,
              macToken: ''
            }
            updateConfig(currentConfig)
            await saveConfig(currentConfig)
            setRemoteName(enrollment.name)
            commitData((current) => ({
              ...current,
              sync: {
                ...current.sync,
                remoteName: enrollment.name,
                protocolVersion: enrollment.protocolVersion,
                lastError: undefined
              }
            }))
          }

          setLinkState('syncing')
          const merged = await syncAllWithMac({
            config: currentConfig,
            data: dataRef.current,
            getLatestData: () => dataRef.current
          })
          const next: LocalData = {
            ...merged,
            sync: {
              ...merged.sync,
              remoteName: remoteName || merged.sync.remoteName || 'A.L.B.E.R.T. Mac',
              protocolVersion: merged.sync.protocolVersion || 2,
              lastError: undefined,
              consecutiveFailures: 0
            }
          }
          commitData(next)
          setLinkState('authenticated')
          setSyncNote(
            `Synchronized · ${next.messages.length} messages · ${next.memories.length} memories · ${next.sync.outbox.length} queued`
          )
          if (!quiet) showToast('Mac and phone are synchronized.', 'ok')
          return next
        } catch (error) {
          let text = messageFor(error)
          const kind = error instanceof MacSyncError ? error.kind : 'server'
          if (
            (kind === 'offline' || kind === 'timeout') &&
            isLoopbackMacUrl(configRef.current.macBaseUrl)
          ) {
            text =
              'Mac companion is unreachable from this phone — replace localhost with the Mac’s LAN IP from Copy pair info (192.168…)'
          }
          setLinkState(kind === 'auth' ? 'auth-failed' : kind === 'offline' || kind === 'timeout' ? 'offline' : 'fault')
          setLinkError(text)
          commitData((current) => ({
            ...current,
            sync: {
              ...current.sync,
              lastAttemptAt: Date.now(),
              consecutiveFailures: current.sync.consecutiveFailures + 1,
              lastError: text
            }
          }))
          if (!quiet) showToast(text, 'danger')
          throw error
        } finally {
          setSyncBusy(false)
          setRefreshing(false)
        }
      })
    },
    [commitData, remoteName, showToast, updateConfig]
  )
  performSyncRef.current = performSync

  const scheduleSyncSoon = useCallback(() => {
    if (!configRef.current.autoSync || !configRef.current.macCredential) return
    if (mutationSyncTimerRef.current) clearTimeout(mutationSyncTimerRef.current)
    mutationSyncTimerRef.current = setTimeout(() => {
      mutationSyncTimerRef.current = null
      void performSyncRef.current({ quiet: true, allowEnroll: false }).catch(() => undefined)
    }, 850)
  }, [])

  useEffect(() => {
    if (!bootReady || !paired || !config.autoSync) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const run = async (): Promise<void> => {
      if (cancelled) return
      await performSyncRef.current({ quiet: true, allowEnroll: false }).catch(() => undefined)
      if (cancelled) return
      timer = setTimeout(run, syncBackoffMs(dataRef.current.sync.consecutiveFailures))
    }
    void run()
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void performSyncRef.current({ quiet: true, allowEnroll: false }).catch(() => undefined)
    })
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      appStateSubscription.remove()
    }
  }, [bootReady, config.autoSync, config.macBaseUrl, config.macCredential, paired])

  useEffect(() => {
    if (!bootReady || !paired || config.autoSync) return
    let cancelled = false
    setLinkState('checking')
    void checkMacHealth(config.macBaseUrl, config.macCredential).then((health) => {
      if (cancelled) return
      if (health.ok) {
        setLinkState('authenticated')
        setRemoteName(health.name)
        setLinkError(null)
        if (health.name || health.protocolVersion) {
          commitData((current) => ({
            ...current,
            sync: {
              ...current.sync,
              remoteName: health.name || current.sync.remoteName,
              protocolVersion: health.protocolVersion || current.sync.protocolVersion,
              lastError: undefined
            }
          }))
        }
      } else {
        const unreachable =
          health.error ||
          (isLoopbackMacUrl(config.macBaseUrl)
            ? 'Mac companion is unreachable from this phone — replace localhost with the Mac’s LAN IP from Copy pair info (192.168…)'
            : 'Mac companion is unavailable')
        setLinkState(health.authenticated === false ? 'auth-failed' : 'offline')
        setLinkError(unreachable)
      }
    })
    return () => {
      cancelled = true
    }
  }, [bootReady, commitData, config.autoSync, config.macBaseUrl, config.macCredential, paired])

  const runChatTurn = useCallback(
    async (rawText: string, options: ChatTurnOptions = {}): Promise<string> => {
      const text = rawText.replace(/\s+/g, ' ').trim()
      if (!text) throw new Error('Enter a message first')
      if (chatTaskRef.current) throw new Error('Albert is already processing a transmission')

      const controller = new AbortController()
      chatAbortRef.current = controller
      setChatBusy(true)
      setChatError(null)

      const task = (async (): Promise<string> => {
        const now = Date.now()
        let userId = options.existingUserId
        let committed: LocalData
        if (userId) {
          committed = commitData((current) => ({
            ...current,
            messages: current.messages.map((message) => message.id === userId
              ? { ...message, content: text, delivery: paired ? 'pending' : 'local', error: undefined }
              : message),
            sync: recordLocalMutation(current.sync, 'chat', userId!, 'upsert', now)
          }))
        } else {
          userId = `phone_${newId()}`
          const userMessage: ChatMessage = {
            id: userId,
            role: 'user',
            content: text,
            createdAt: now,
            origin: 'phone',
            delivery: paired ? 'pending' : 'local'
          }
          committed = commitData((current) => ({
            ...current,
            messages: [...current.messages, userMessage].slice(-300),
            sync: recordLocalMutation(current.sync, 'chat', userMessage.id, 'upsert', now)
          }))
        }

        const providerMessages = options.contextMessages
          ? options.contextMessages.map((message) => message.id === userId
              ? { ...message, content: text, delivery: paired ? 'pending' as const : 'local' as const, error: undefined }
              : message)
          : committed.messages

        try {
          const result = await chatWithProvider({
            config: configRef.current,
            messages: providerMessages,
            memories: dataRef.current.memories,
            signal: controller.signal
          })
          if (controller.signal.aborted) throw new ProviderRequestError({
            message: 'Response cancelled.',
            code: 'cancelled',
            provider: 'auto'
          })

          const completedAt = Date.now()
          const assistantMessage: ChatMessage = {
            id: `phone_${newId()}`,
            role: 'assistant',
            content: result.reply,
            createdAt: completedAt,
            provider: result.provider,
            model: result.model,
            origin: 'phone',
            delivery: paired ? 'pending' : 'local'
          }
          commitData((current) => {
            let memories = current.memories
            let sync = current.sync
            for (const learned of result.newMemories) {
              const memoryId = `memory_${newId()}`
              memories = upsertLocalMemory(memories, {
                id: memoryId,
                content: learned.content,
                category: learned.category,
                source: `${result.provider}:${result.model}`,
                confidence: 1,
                createdAt: completedAt,
                updatedAt: completedAt
              })
              sync = recordLocalMutation(sync, 'memory', memoryId, 'upsert', completedAt)
            }
            sync = recordLocalMutation(sync, 'chat', assistantMessage.id, 'upsert', completedAt)
            return {
              ...current,
              messages: [...current.messages, assistantMessage].slice(-300),
              memories,
              sync,
              activity: appendActivity(
                current.activity,
                'mobile_chat',
                { provider: result.provider, model: result.model, fallbackFrom: result.fallbackFrom },
                `Answered in ${result.latencyMs}ms`
              )
            }
          })
          scheduleSyncSoon()
          if (result.fallbackFrom) {
            showToast(`Auto rerouted from ${result.fallbackFrom} to ${result.provider}.`, 'warn')
          }
          return result.reply
        } catch (error) {
          const cancelled = error instanceof ProviderRequestError && error.code === 'cancelled'
          const detail = messageFor(error)
          commitData((current) => ({
            ...current,
            messages: current.messages.map((message) => message.id === userId
              ? {
                  ...message,
                  delivery: cancelled ? 'local' : 'failed',
                  error: cancelled ? 'Response cancelled' : detail
                }
              : message),
            activity: appendActivity(current.activity, 'mobile_chat', {}, detail, false)
          }))
          if (!cancelled) setChatError(detail)
          throw error
        }
      })()

      chatTaskRef.current = task
      try {
        return await task
      } finally {
        if (chatTaskRef.current === task) chatTaskRef.current = null
        if (chatAbortRef.current === controller) chatAbortRef.current = null
        setChatBusy(false)
      }
    },
    [commitData, paired, scheduleSyncSoon, showToast]
  )

  const voice = useAlbertVoice({
    onUserUtterance: (text) => runChatTurn(text),
    speakReplies: config.speakReplies,
    speechRate: config.voiceRate,
    ttsVoiceId: config.ttsVoiceId,
    wakeOnLaunch: config.wakeOnLaunch
  })

  const sendMessage = useCallback(async () => {
    const text = draft.trim()
    if (!text || chatBusy) return
    setDraft('')
    try {
      await runChatTurn(text)
    } catch {
      setDraft((current) => current.trim() ? current : text)
    }
  }, [chatBusy, draft, runChatTurn])

  const retryMessage = useCallback((message: ChatMessage) => {
    const index = dataRef.current.messages.findIndex((candidate) => candidate.id === message.id)
    const context = index >= 0 ? dataRef.current.messages.slice(0, index + 1) : undefined
    void runChatTurn(message.content, { existingUserId: message.id, contextMessages: context }).catch(() => undefined)
  }, [runChatTurn])

  const regenerateMessage = useCallback((assistant: ChatMessage) => {
    const index = dataRef.current.messages.findIndex((candidate) => candidate.id === assistant.id)
    const before = index >= 0 ? dataRef.current.messages.slice(0, index) : dataRef.current.messages
    const user = [...before].reverse().find((message) => message.role === 'user')
    if (!user) return
    const userIndex = before.findIndex((message) => message.id === user.id)
    void runChatTurn(user.content, {
      existingUserId: user.id,
      contextMessages: before.slice(0, userIndex + 1)
    }).catch(() => undefined)
  }, [runChatTurn])

  const cancelChat = useCallback(() => {
    chatAbortRef.current?.abort()
  }, [])

  const purgeChat = useCallback(() => {
    chatAbortRef.current?.abort()
    commitData((current) => {
      let sync = current.sync
      const deletedAt = Date.now()
      for (const message of current.messages) {
        sync = recordLocalMutation(sync, 'chat', message.id, 'delete', deletedAt)
      }
      return {
        ...current,
        messages: [],
        sync,
        activity: appendActivity(current.activity, 'clear_mobile_chat', {}, 'Comm history cleared')
      }
    })
    setChatError(null)
    setSyncNote('Comm cleared locally · deletion queued for the Mac')
    showToast('Comm history cleared.', 'ok')
    scheduleSyncSoon()
  }, [commitData, scheduleSyncSoon, showToast])

  const addMemory = useCallback((input: Pick<MemoryFact, 'content' | 'category'>) => {
    const now = Date.now()
    const id = `memory_${newId()}`
    commitData((current) => ({
      ...current,
      memories: upsertLocalMemory(current.memories, {
        id,
        ...input,
        source: 'phone',
        confidence: 1,
        createdAt: now,
        updatedAt: now
      }),
      sync: recordLocalMutation(current.sync, 'memory', id, 'upsert', now),
      activity: appendActivity(current.activity, 'memory_add', { category: input.category }, 'Memory catalogued')
    }))
    scheduleSyncSoon()
  }, [commitData, scheduleSyncSoon])

  const editMemory = useCallback((id: string, patch: Pick<MemoryFact, 'content' | 'category'>) => {
    const existing = dataRef.current.memories.find((memory) => memory.id === id)
    if (!existing) throw new Error('Memory record no longer exists')
    const now = Date.now()
    commitData((current) => ({
      ...current,
      memories: upsertLocalMemory(current.memories, { ...existing, ...patch, updatedAt: now }),
      sync: recordLocalMutation(current.sync, 'memory', id, 'upsert', now),
      activity: appendActivity(current.activity, 'memory_edit', { id }, 'Memory updated')
    }))
    scheduleSyncSoon()
  }, [commitData, scheduleSyncSoon])

  const deleteMemory = useCallback((id: string) => {
    const now = Date.now()
    commitData((current) => ({
      ...current,
      memories: current.memories.filter((memory) => memory.id !== id),
      sync: recordLocalMutation(current.sync, 'memory', id, 'delete', now),
      activity: appendActivity(current.activity, 'memory_delete', { id }, 'Memory deleted')
    }))
    scheduleSyncSoon()
  }, [commitData, scheduleSyncSoon])

  const undoDeleteMemory = useCallback((memory: MemoryFact) => {
    // A new identity makes Undo reliable even if the old tombstone already reached the Mac.
    const now = Date.now()
    const restoredId = `memory_${newId()}`
    commitData((current) => ({
      ...current,
      memories: upsertLocalMemory(current.memories, {
        ...memory,
        id: restoredId,
        source: memory.source || 'phone',
        createdAt: now,
        updatedAt: now
      }),
      sync: recordLocalMutation(current.sync, 'memory', restoredId, 'upsert', now),
      activity: appendActivity(current.activity, 'memory_restore', { previousId: memory.id }, 'Memory restored')
    }))
    showToast('Memory restored as a new durable record.', 'ok')
    scheduleSyncSoon()
  }, [commitData, scheduleSyncSoon, showToast])

  const createMission = useCallback((input: CreateMissionInput) => {
    commitData((current) => {
      const created = createLocalMission(current.operations, input)
      let sync = recordLocalMutation(
        current.sync,
        'mission',
        created.mission.id,
        'upsert',
        created.mission.updatedAt
      )
      for (const step of created.mission.steps) {
        sync = recordLocalMutation(sync, 'step', step.id, 'upsert', step.updatedAt)
      }
      return {
        ...current,
        operations: created.snapshot,
        sync,
        activity: appendActivity(
          current.activity,
          'mission_create',
          { id: created.mission.id, priority: created.mission.priority },
          'Mission created'
        )
      }
    })
    showToast('Mission added to the command deck.', 'ok')
    scheduleSyncSoon()
  }, [commitData, scheduleSyncSoon, showToast])

  const updateMission = useCallback((id: string, patch: UpdateMissionInput) => {
    const now = Date.now()
    commitData((current) => ({
      ...current,
      operations: updateLocalMission(current.operations, id, patch),
      sync: recordLocalMutation(current.sync, 'mission', id, 'upsert', now),
      activity: appendActivity(current.activity, 'mission_update', { id, ...patch }, 'Mission updated')
    }))
    scheduleSyncSoon()
  }, [commitData, scheduleSyncSoon])

  const deleteMission = useCallback((id: string) => {
    const now = Date.now()
    commitData((current) => {
      const mission = current.operations.missions.find((item) => item.id === id)
      const approvals = current.operations.approvals.filter((item) => item.missionId === id)
      let sync = recordLocalMutation(current.sync, 'mission', id, 'delete', now)
      for (const step of mission?.steps || []) {
        sync = recordLocalMutation(sync, 'step', step.id, 'delete', now)
      }
      for (const approval of approvals) {
        sync = recordLocalMutation(sync, 'approval', approval.id, 'delete', now)
      }
      return {
        ...current,
        operations: removeLocalMission(current.operations, id),
        sync,
        activity: appendActivity(current.activity, 'mission_delete', { id }, 'Mission deleted')
      }
    })
    scheduleSyncSoon()
  }, [commitData, scheduleSyncSoon])

  const addMissionStep = useCallback((missionId: string, title: string) => {
    const now = Date.now()
    commitData((current) => {
      const result = addLocalMissionStep(current.operations, missionId, title)
      let sync = recordLocalMutation(current.sync, 'step', result.stepId, 'upsert', now)
      sync = recordLocalMutation(sync, 'mission', missionId, 'upsert', now)
      return {
        ...current,
        operations: result.snapshot,
        sync,
        activity: appendActivity(current.activity, 'mission_step_add', { missionId }, 'Step added')
      }
    })
    scheduleSyncSoon()
  }, [commitData, scheduleSyncSoon])

  const setStepState = useCallback((
    missionId: string,
    stepId: string,
    state: MissionStep['state']
  ) => {
    setOperationBusy(true)
    setOperationError(null)
    try {
      const now = Date.now()
      commitData((current) => {
        const operations = setLocalMissionStep(current.operations, stepId, state)
        let sync = recordLocalMutation(current.sync, 'step', stepId, 'upsert', now)
        sync = recordLocalMutation(sync, 'mission', missionId, 'upsert', now)
        return {
          ...current,
          operations,
          sync,
          activity: appendActivity(current.activity, 'mission_step', { missionId, stepId, state }, 'Step updated')
        }
      })
      scheduleSyncSoon()
    } finally {
      setOperationBusy(false)
    }
  }, [commitData, scheduleSyncSoon])

  const resolveApproval = useCallback((id: string, resolution: 'approved' | 'declined') => {
    setOperationBusy(true)
    setOperationError(null)
    try {
      const now = Date.now()
      const approval = dataRef.current.operations.approvals.find((item) => item.id === id)
      commitData((current) => {
        let sync = recordLocalMutation(current.sync, 'approval', id, 'resolve', now)
        if (approval?.missionId) sync = recordLocalMutation(sync, 'mission', approval.missionId, 'upsert', now)
        return {
          ...current,
          operations: resolveLocalApproval(current.operations, id, resolution),
          sync,
          activity: appendActivity(current.activity, 'approval_resolve', { id, resolution }, `Approval ${resolution}`)
        }
      })
      showToast(`Request ${resolution}.`, resolution === 'approved' ? 'ok' : 'warn')
      scheduleSyncSoon()
    } finally {
      setOperationBusy(false)
    }
  }, [commitData, scheduleSyncSoon, showToast])

  const toggleRoutine = useCallback((id: string, enabled: boolean) => {
    const now = Date.now()
    commitData((current) => ({
      ...current,
      operations: {
        ...current.operations,
        generatedAt: now,
        routines: current.operations.routines.map((routine) => routine.id === id
          ? { ...routine, enabled, updatedAt: now }
          : routine)
      },
      sync: recordLocalMutation(current.sync, 'routine', id, 'upsert', now),
      activity: appendActivity(current.activity, 'routine_toggle', { id, enabled }, enabled ? 'Routine armed' : 'Routine paused')
    }))
    scheduleSyncSoon()
  }, [commitData, scheduleSyncSoon])

  const createRoutine = useCallback((input: CreateRoutineInput) => {
    commitData((current) => {
      const created = createLocalRoutine(current.operations, input)
      return {
        ...current,
        operations: created.snapshot,
        sync: recordLocalMutation(
          current.sync,
          'routine',
          created.routine.id,
          'upsert',
          created.routine.updatedAt
        ),
        activity: appendActivity(current.activity, 'routine_create', { id: created.routine.id }, 'Routine created')
      }
    })
    showToast('Routine armed in the operations deck.', 'ok')
    scheduleSyncSoon()
  }, [commitData, scheduleSyncSoon, showToast])

  const updateRoutine = useCallback((id: string, patch: UpdateRoutineInput) => {
    const now = Date.now()
    commitData((current) => ({
      ...current,
      operations: updateLocalRoutine(current.operations, id, patch),
      sync: recordLocalMutation(current.sync, 'routine', id, 'upsert', now),
      activity: appendActivity(current.activity, 'routine_update', { id }, 'Routine updated')
    }))
    scheduleSyncSoon()
  }, [commitData, scheduleSyncSoon])

  const deleteRoutine = useCallback((id: string) => {
    const now = Date.now()
    commitData((current) => ({
      ...current,
      operations: removeLocalRoutine(current.operations, id),
      sync: recordLocalMutation(current.sync, 'routine', id, 'delete', now),
      activity: appendActivity(current.activity, 'routine_delete', { id }, 'Routine deleted')
    }))
    scheduleSyncSoon()
  }, [commitData, scheduleSyncSoon])

  const addCapture = useCallback((input: Pick<CaptureItem, 'content' | 'kind'>) => {
    const created = createLocalCapture(dataRef.current.operations, input.content, input.kind)
    commitData((current) => ({
      ...current,
      operations: created.snapshot,
      sync: recordLocalMutation(current.sync, 'capture', created.capture.id, 'upsert', created.capture.createdAt),
      activity: appendActivity(current.activity, 'quick_capture', { kind: input.kind }, 'Capture stored')
    }))
    showToast('Capture added to the operations inbox.', 'ok')
    scheduleSyncSoon()
  }, [commitData, scheduleSyncSoon, showToast])

  const setCaptureState = useCallback((id: string, state: CaptureItem['state']) => {
    const now = Date.now()
    commitData((current) => ({
      ...current,
      operations: setLocalCaptureState(current.operations, id, state),
      sync: recordLocalMutation(current.sync, 'capture', id, 'upsert', now),
      activity: appendActivity(current.activity, 'capture_triage', { id, state }, `Capture ${state}`)
    }))
    scheduleSyncSoon()
  }, [commitData, scheduleSyncSoon])

  const unpair = useCallback(async () => {
    const current = configRef.current
    let remotelyRevoked = true
    try {
      await revokeThisDevice(current)
    } catch {
      remotelyRevoked = false
    }
    const next = { ...current, macBaseUrl: '', macToken: '', macCredential: '' }
    try {
      await saveConfig(next)
    } catch (error) {
      const text = `Secure storage could not remove the Mac link. ${messageFor(error)}`
      setLinkError(text)
      showToast(text, 'danger')
      throw error
    }
    updateConfig(next)
    setLinkState('unconfigured')
    setRemoteName(undefined)
    setLinkError(null)
    setSyncNote(null)
    showToast(
      remotelyRevoked
        ? 'Mac link revoked. Phone data remains available locally.'
        : 'Phone unpaired offline. Revoke this device from Mac Systems when available.',
      remotelyRevoked ? 'ok' : 'warn'
    )
  }, [showToast, updateConfig])

  const pastePairInfo = useCallback(async () => {
    const clipboard = await Clipboard.getStringAsync()
    const parsed = parsePairInfo(clipboard)
    if (!parsed.macBaseUrl && !parsed.macToken) {
      throw new Error('Clipboard does not contain A.L.B.E.R.T. Mac pairing information')
    }
    let macBaseUrl = parsed.macBaseUrl || configRef.current.macBaseUrl
    if (parsed.macBaseUrl) {
      try {
        macBaseUrl = normalizeMacUrl(parsed.macBaseUrl)
      } catch (error) {
        throw error instanceof Error ? error : new Error(String(error))
      }
    }
    const next = {
      ...configRef.current,
      macBaseUrl,
      macToken: parsed.macToken || configRef.current.macToken
    }
    updateConfig(next)
    setLinkError(null)
    if (isLoopbackMacUrl(macBaseUrl)) {
      showToast(
        'Loaded localhost — that only works in the Simulator. On a phone, use the Mac’s 192.168… address.',
        'warn'
      )
    } else {
      showToast('Mac enrollment information loaded. Review it, then enroll & sync.', 'ok')
    }
  }, [showToast, updateConfig])

  const statusLabel = useMemo(() => {
    if (linkState === 'authenticated') return `${remoteName || 'Mac'} online · secure v2 sync ready`
    if (linkState === 'syncing') return 'Reconciling phone and Mac state…'
    if (linkState === 'enrolling') return 'Creating a revocable phone credential…'
    if (linkState === 'checking') return 'Verifying secure Mac link…'
    if (linkState === 'offline') return 'Mac offline · changes safely queued on phone'
    if (linkState === 'auth-failed') return 'Mac rejected this device · re-enrollment required'
    if (linkState === 'fault') return 'Mac link fault · local systems remain available'
    return 'Standalone mode · pair a Mac whenever you are ready'
  }, [linkState, remoteName])

  const statusTone = useMemo<'ok' | 'bad' | 'neutral'>(() => {
    if (linkState === 'authenticated') return 'ok'
    if (linkState === 'auth-failed' || linkState === 'fault' || linkState === 'offline') return 'bad'
    return 'neutral'
  }, [linkState])

  const routeLabel = useMemo(() => {
    const last = [...data.messages].reverse().find((message) => message.role === 'assistant' && message.provider)
    if (last?.provider) return `${last.provider}${last.model ? ` · ${last.model.replace(/^.*\//, '')}` : ''}`
    return `${config.provider} · ${config.model.replace(/^.*\//, '')}`
  }, [config.model, config.provider, data.messages])

  const priorityMission = useMemo(() => {
    const rank = { critical: 4, high: 3, normal: 2, low: 1 }
    return data.operations.missions
      .filter((mission) => !['complete', 'cancelled'].includes(mission.state))
      .sort((a, b) => rank[b.priority] - rank[a.priority] || b.updatedAt - a.updatedAt)[0] || null
  }, [data.operations.missions])
  const pendingApprovals = data.operations.approvals.filter((approval) => approval.state === 'pending').length
  const brainConfigured = Boolean(
    config.anthropicApiKey.trim() || config.groqApiKey.trim() || config.geminiApiKey.trim()
  )
  const systemsAttention = !brainConfigured || linkState === 'auth-failed' || linkState === 'fault'

  if (!bootReady || !fontsReady) {
    return (
      <SafeAreaProvider>
        <HudBackground>
          <StatusBar style="light" />
          <StartupSequence
            visible
            ready={bootReady && fontsReady}
            brainConfigured={brainConfigured}
            fault={bootFault}
            reducedMotion={config.reducedMotion}
            onRetry={() => void loadApp()}
            onContinueOffline={() => {
              const fallbackData = emptyLocalData()
              dataRef.current = fallbackData
              setData(fallbackData)
              setBootFault(null)
              setBootReady(true)
              setFontFallback(true)
            }}
          />
        </HudBackground>
      </SafeAreaProvider>
    )
  }

  return (
    <SafeAreaProvider>
      <HudBackground>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
          <StatusBar style="light" />
          <View style={styles.main}>
            {tab === 'home' ? (
              <HomeScreen
                macOnline={linkState === 'authenticated'}
                linkState={linkState}
                statusLabel={statusLabel}
                voicePhase={voice.phase}
                voiceStatus={voice.status}
                voiceSupported={voice.supported}
                wakeArmed={voice.wakeArmed}
                brainLabel={`PHONE · ${config.provider.toUpperCase()}`}
                modelLabel={config.model.replace(/^.*\//, '').toUpperCase()}
                memoryCount={data.memories.length}
                priorityMission={priorityMission}
                pendingApprovals={pendingApprovals}
                lastActivity={data.activity[0] || null}
                syncState={data.sync}
                reducedMotion={config.reducedMotion}
                error={linkState === 'fault' || linkState === 'auth-failed' ? linkError : null}
                onToggleVoice={() => void voice.toggle()}
                onOpenComm={() => setTab('chat')}
                onOpenOperations={() => {
                  setOperationsLanding({})
                  setTab('operations')
                }}
                onOpenMemory={() => setTab('memory')}
                onOpenSystems={() => setTab('systems')}
                onQuickCapture={() => {
                  setOperationsLanding({ section: 'captures', focusCapture: true })
                  setTab('operations')
                }}
              />
            ) : null}
            {tab === 'chat' ? (
              <ChatScreen
                messages={data.messages}
                draft={draft}
                busy={chatBusy}
                statusLabel={statusLabel}
                statusTone={statusTone}
                syncNote={syncNote}
                error={chatError}
                voicePhase={voice.phase}
                voiceStatus={voice.status}
                voiceSupported={voice.supported}
                linkState={linkState}
                routeLabel={routeLabel}
                bottomChromeHeight={sizes.bottomNav + sizes.minTarget}
                onChangeDraft={setDraft}
                onSend={() => void sendMessage()}
                onPurge={purgeChat}
                onToggleVoice={() => void voice.toggle()}
                onCancel={cancelChat}
                onRetryMessage={retryMessage}
                onCopyMessage={(message) => {
                  void Clipboard.setStringAsync(message.content)
                    .then(() => showToast('Message copied.', 'ok'))
                    .catch(() => showToast('Clipboard access failed.', 'warn'))
                }}
                onRegenerate={regenerateMessage}
                onDismissError={() => setChatError(null)}
                onOpenSystems={() => setTab('systems')}
              />
            ) : null}
            {tab === 'operations' ? (
              <OperationsScreen
                operations={data.operations}
                loading={syncBusy}
                refreshing={refreshing}
                busy={operationBusy}
                offline={paired && linkState !== 'authenticated'}
                error={operationError}
                initialSection={operationsLanding.section}
                focusCaptureOnMount={operationsLanding.focusCapture}
                onRefresh={() => void performSync({ quiet: false, allowEnroll: false }).catch(() => undefined)}
                onCreateMission={createMission}
                onUpdateMission={updateMission}
                onDeleteMission={deleteMission}
                onAddMissionStep={addMissionStep}
                onSetStepState={setStepState}
                onResolveApproval={resolveApproval}
                onToggleRoutine={toggleRoutine}
                onCreateRoutine={createRoutine}
                onUpdateRoutine={updateRoutine}
                onDeleteRoutine={deleteRoutine}
                onAddCapture={addCapture}
                onFileCapture={(id) => setCaptureState(id, 'filed')}
                onArchiveCapture={(id) => setCaptureState(id, 'archived')}
              />
            ) : null}
            {tab === 'memory' ? (
              <MemoryScreen
                memories={data.memories}
                busy={syncBusy}
                canSync={paired}
                refreshing={refreshing}
                offline={paired && linkState !== 'authenticated'}
                error={linkError}
                syncNote={syncNote}
                onSync={() => void performSync({ allowEnroll: false }).catch(() => undefined)}
                onRefresh={() => void performSync({ quiet: true, allowEnroll: false }).catch(() => undefined)}
                onDelete={deleteMemory}
                onAddMemory={addMemory}
                onEditMemory={editMemory}
                onUndoDelete={undoDeleteMemory}
              />
            ) : null}
            {tab === 'systems' ? (
              <PairScreen
                config={config}
                busy={syncBusy}
                error={linkError}
                syncNote={syncNote}
                linkState={linkState}
                syncState={data.sync}
                remoteName={remoteName}
                modelOptions={modelsFor(config.provider)}
                onChange={updateConfig}
                onSave={persistConfig}
                onSync={async () => {
                  await persistConfig()
                  await performSync({ allowEnroll: true })
                }}
                onPastePairInfo={pastePairInfo}
                onUnpair={unpair}
                onRequestVoicePermission={voice.requestPermission}
                onPreviewVoice={() => voice.previewSpeak('Standing by, sir.')}
                onOpenPrivacy={() => Alert.alert(
                  'Privacy & network behavior',
                  'Provider requests go directly from this phone using your own key. API keys and the Mac device credential use secure device storage. Mac sync stays local to the URL you configure and never places credentials in the URL. Operations remain local or approval-gated on the Mac.'
                )}
              />
            ) : null}
          </View>
          <Toast
            visible={Boolean(toast)}
            message={toast?.message || ''}
            tone={toast?.tone}
            reducedMotion={config.reducedMotion}
            onDismiss={() => setToast(null)}
          />
          <StatusRail
            voicePhase={voice.phase}
            linkState={linkState}
            routeLabel={config.provider}
            pendingCount={data.sync.outbox.length}
            lastSyncLabel={formatSyncLabel(data.sync.lastSyncAt)}
            onPressLink={() => setTab('systems')}
            onPressPending={() => setTab('systems')}
          />
          <TabBar
            active={tab}
            onChange={(nextTab) => {
              if (nextTab === 'operations' && tab !== 'operations') setOperationsLanding({})
              setTab(nextTab)
            }}
            pendingApprovals={pendingApprovals}
            systemsAttention={systemsAttention}
          />
          <StartupSequence
            visible={startupVisible}
            ready={bootReady && fontsReady}
            brainConfigured={brainConfigured}
            reducedMotion={config.reducedMotion}
            onComplete={() => setStartupVisible(false)}
          />
        </SafeAreaView>
      </HudBackground>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  main: { flex: 1, minHeight: 0 }
})
