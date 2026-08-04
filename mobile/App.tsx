import {
  Orbitron_500Medium,
  Orbitron_700Bold,
  useFonts as useOrbitron
} from '@expo-google-fonts/orbitron'
import {
  Rajdhani_500Medium,
  Rajdhani_700Bold,
  useFonts as useRajdhani
} from '@expo-google-fonts/rajdhani'
import { ShareTechMono_400Regular, useFonts as useMono } from '@expo-google-fonts/share-tech-mono'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { HudBackground } from './src/components/HudBackground'
import { TabBar } from './src/components/TabBar'
import { chatWithProvider } from './src/lib/chat'
import { newId } from './src/lib/id'
import {
  loadChat,
  loadConfig,
  loadMemories,
  saveChat,
  saveConfig,
  saveMemories,
  upsertLocalMemory
} from './src/lib/storage'
import {
  checkMacHealth,
  clearChatOnMac,
  deleteMemoryOnMac,
  fullSyncWithMac,
  syncChatWithMac,
  syncMemoriesWithMac
} from './src/lib/sync'
import { useAlbertVoice } from './src/lib/voiceSession'
import { ChatScreen } from './src/screens/ChatScreen'
import { HomeScreen } from './src/screens/HomeScreen'
import { MemoryScreen } from './src/screens/MemoryScreen'
import { PairScreen } from './src/screens/PairScreen'
import { colors } from './src/theme'
import type { ChatMessage, CompanionConfig, MemoryFact, TabId } from './src/types'

export default function App(): React.JSX.Element {
  const [orbitronLoaded] = useOrbitron({ Orbitron_500Medium, Orbitron_700Bold })
  const [rajdhaniLoaded] = useRajdhani({ Rajdhani_500Medium, Rajdhani_700Bold })
  const [monoLoaded] = useMono({ ShareTechMono_400Regular })
  const fontsReady = orbitronLoaded && rajdhaniLoaded && monoLoaded

  const [ready, setReady] = useState(false)
  const [tab, setTab] = useState<TabId>('home')
  const [config, setConfig] = useState<CompanionConfig>({
    provider: 'anthropic',
    anthropicApiKey: '',
    groqApiKey: '',
    model: 'claude-haiku-4-5',
    macBaseUrl: '',
    macToken: ''
  })
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [memories, setMemories] = useState<MemoryFact[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [macOnline, setMacOnline] = useState<boolean | null>(null)
  const [syncNote, setSyncNote] = useState<string | null>(null)
  const deletedMemoryIdsRef = useRef<string[]>([])
  const messagesRef = useRef(messages)
  const memoriesRef = useRef(memories)
  const configRef = useRef(config)
  messagesRef.current = messages
  memoriesRef.current = memories
  configRef.current = config

  useEffect(() => {
    void (async () => {
      const [c, chat, mem] = await Promise.all([loadConfig(), loadChat(), loadMemories()])
      setConfig(c)
      setMessages(chat)
      setMemories(mem)
      setReady(true)
    })()
  }, [])

  useEffect(() => {
    if (!ready) return
    void saveChat(messages)
  }, [messages, ready])

  useEffect(() => {
    if (!ready) return
    void saveMemories(memories)
  }, [memories, ready])

  const paired = Boolean(config.macBaseUrl.trim() && config.macToken.trim())

  const syncAll = useCallback(async (opts?: { quiet?: boolean }) => {
    const c = configRef.current
    if (!c.macBaseUrl.trim() || !c.macToken.trim()) {
      setMacOnline(null)
      return
    }
    if (!opts?.quiet) {
      setBusy(true)
      setError(null)
      setSyncNote(null)
    }
    try {
      const deleted = deletedMemoryIdsRef.current
      const result = await fullSyncWithMac({
        baseUrl: c.macBaseUrl,
        token: c.macToken,
        messages: messagesRef.current,
        memories: memoriesRef.current,
        deletedMemoryIds: deleted
      })
      deletedMemoryIdsRef.current = []
      setMessages(result.messages)
      setMemories(result.memories)
      setMacOnline(true)
      if (!opts?.quiet) {
        setSyncNote(
          `Synced — ${result.messages.length} msgs · ${result.memories.length} memories`
        )
      }
    } catch (err) {
      setMacOnline(false)
      if (!opts?.quiet) {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      if (!opts?.quiet) setBusy(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    if (!ready || !paired) return
    void syncAll({ quiet: true })
    const id = setInterval(() => void syncAll({ quiet: true }), 25_000)
    return () => clearInterval(id)
  }, [ready, paired, syncAll, config.macBaseUrl, config.macToken])

  useEffect(() => {
    let cancelled = false
    async function ping(): Promise<void> {
      if (!config.macBaseUrl.trim()) {
        if (!cancelled) setMacOnline(null)
        return
      }
      const health = await checkMacHealth(config.macBaseUrl)
      if (!cancelled) setMacOnline(health.ok)
    }
    void ping()
    const id = setInterval(() => void ping(), 20_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [config.macBaseUrl])

  const statusLabel = useMemo(() => {
    if (macOnline === null) return 'Mac link not configured — Pair to share Comm'
    return macOnline
      ? 'Mac online — shared Comm & memory'
      : 'Mac offline — local until link returns'
  }, [macOnline])

  const statusTone = useMemo(() => {
    if (macOnline === true) return 'ok' as const
    if (macOnline === false) return 'bad' as const
    return 'neutral' as const
  }, [macOnline])

  const persistConfig = useCallback(async (next: CompanionConfig) => {
    setConfig(next)
    await saveConfig(next)
  }, [])

  const pushChatIfOnline = useCallback(
    async (nextMessages: ChatMessage[]) => {
      const c = configRef.current
      if (!c.macBaseUrl.trim() || !c.macToken.trim() || macOnline !== true) return
      try {
        const merged = await syncChatWithMac({
          baseUrl: c.macBaseUrl,
          token: c.macToken,
          messages: nextMessages
        })
        setMessages(merged)
      } catch {
        setSyncNote('Saved locally — Mac chat sync failed')
      }
    },
    [macOnline]
  )

  const runChatTurn = useCallback(
    async (text: string, prior: ChatMessage[]): Promise<string> => {
      const userMsg: ChatMessage = {
        id: newId(),
        role: 'user',
        content: text,
        createdAt: Date.now()
      }
      const withUser = [...prior, userMsg]
      setMessages(withUser)

      const { reply, newMemories } = await chatWithProvider({
        config: configRef.current,
        messages: withUser,
        memories: memoriesRef.current
      })

      let nextMemories = memoriesRef.current
      for (const m of newMemories) {
        nextMemories = upsertLocalMemory(nextMemories, {
          id: newId(),
          content: m.content,
          category: m.category
        })
      }
      if (newMemories.length) {
        setMemories(nextMemories)
        if (macOnline === true) {
          try {
            const merged = await syncMemoriesWithMac({
              baseUrl: configRef.current.macBaseUrl,
              token: configRef.current.macToken,
              memories: nextMemories
            })
            setMemories(merged)
          } catch {
            /* keep local */
          }
        }
      }

      const assistantMsg: ChatMessage = {
        id: newId(),
        role: 'assistant',
        content: reply,
        createdAt: Date.now()
      }
      const withReply = [...withUser, assistantMsg]
      setMessages(withReply)
      await pushChatIfOnline(withReply)
      return reply
    },
    [macOnline, pushChatIfOnline]
  )

  const sendMessage = useCallback(async () => {
    const text = draft.trim()
    if (!text || busy) return
    setDraft('')
    setBusy(true)
    setError(null)
    try {
      await runChatTurn(text, messagesRef.current)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [busy, draft, runChatTurn])

  const voice = useAlbertVoice({
    onUserUtterance: async (text) => {
      setBusy(true)
      setError(null)
      try {
        return await runChatTurn(text, messagesRef.current)
      } finally {
        setBusy(false)
      }
    }
  })

  const purgeChat = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      setMessages([])
      const c = configRef.current
      if (c.macBaseUrl.trim() && c.macToken.trim() && macOnline) {
        await clearChatOnMac({ baseUrl: c.macBaseUrl, token: c.macToken })
        setSyncNote('Comm purged on phone + Mac')
      } else {
        setSyncNote('Comm purged locally')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [macOnline])

  const deleteMemory = useCallback(
    async (id: string) => {
      setMemories((prev) => prev.filter((m) => m.id !== id))
      deletedMemoryIdsRef.current = [...deletedMemoryIdsRef.current, id]
      const c = configRef.current
      if (c.macBaseUrl.trim() && c.macToken.trim() && macOnline) {
        try {
          await deleteMemoryOnMac({
            baseUrl: c.macBaseUrl,
            token: c.macToken,
            id
          })
          deletedMemoryIdsRef.current = deletedMemoryIdsRef.current.filter((x) => x !== id)
        } catch {
          /* will retry via sync deletedIds */
        }
      }
    },
    [macOnline]
  )

  if (!fontsReady || !ready) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color={colors.accent} />
        <StatusBar style="light" />
      </View>
    )
  }

  return (
    <SafeAreaProvider>
      <HudBackground>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
          <StatusBar style="light" />
          <TabBar active={tab} onChange={setTab} />
          <View style={styles.main}>
            {tab === 'home' ? (
              <HomeScreen
                macOnline={macOnline}
                statusLabel={statusLabel}
                voicePhase={voice.phase}
                voiceStatus={voice.status}
                voiceSupported={voice.supported}
                onToggleVoice={() => void voice.toggle()}
                onOpenComm={() => setTab('chat')}
              />
            ) : null}
            {tab === 'chat' ? (
              <ChatScreen
                messages={messages}
                draft={draft}
                busy={busy}
                statusLabel={statusLabel}
                statusTone={statusTone}
                syncNote={syncNote}
                error={error}
                voicePhase={voice.phase}
                voiceStatus={voice.status}
                voiceSupported={voice.supported}
                onChangeDraft={setDraft}
                onSend={() => void sendMessage()}
                onPurge={() => void purgeChat()}
                onToggleVoice={() => void voice.toggle()}
              />
            ) : null}
            {tab === 'memory' ? (
              <MemoryScreen
                memories={memories}
                busy={busy}
                canSync={paired}
                refreshing={refreshing}
                onSync={() => void syncAll()}
                onRefresh={() => {
                  setRefreshing(true)
                  void syncAll({ quiet: true })
                }}
                onDelete={(id) => void deleteMemory(id)}
              />
            ) : null}
            {tab === 'pair' ? (
              <PairScreen
                config={config}
                busy={busy}
                error={error}
                syncNote={syncNote}
                onChange={setConfig}
                onSave={() => void persistConfig({
                  ...config,
                  macBaseUrl: config.macBaseUrl.trim().replace(/\/+$/, '')
                })}
                onSync={() => {
                  void (async () => {
                    const next = {
                      ...configRef.current,
                      macBaseUrl: configRef.current.macBaseUrl.trim().replace(/\/+$/, '')
                    }
                    await persistConfig(next)
                    await syncAll()
                  })()
                }}
              />
            ) : null}
          </View>
        </SafeAreaView>
      </HudBackground>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    backgroundColor: colors.bg0,
    alignItems: 'center',
    justifyContent: 'center'
  },
  safe: { flex: 1 },
  main: { flex: 1 }
})
