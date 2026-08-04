import { useCallback, useEffect, useRef } from 'react'
import { Sidebar } from './components/Sidebar'
import { HomePanel } from './components/HomePanel'
import { ConversationPanel } from './components/ConversationPanel'
import { MemoryPanel } from './components/MemoryPanel'
import { ActivityPanel } from './components/ActivityPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { ClaudeVoiceSession } from './voice/claudeVoiceSession'
import { isWakeWordSupported, WakeWordListener } from './voice/wakeWord'
import { useAlbertStore } from './store'

type ActiveVoice = ClaudeVoiceSession

export default function App(): React.JSX.Element {
  const panel = useAlbertStore((s) => s.panel)
  const setPanel = useAlbertStore((s) => s.setPanel)
  const setSettings = useAlbertStore((s) => s.setSettings)
  const setMessages = useAlbertStore((s) => s.setMessages)
  const appendMessage = useAlbertStore((s) => s.appendMessage)
  const setStreamingText = useAlbertStore((s) => s.setStreamingText)
  const appendStreamingText = useAlbertStore((s) => s.appendStreamingText)
  const setBusy = useAlbertStore((s) => s.setBusy)
  const setError = useAlbertStore((s) => s.setError)
  const setVoiceState = useAlbertStore((s) => s.setVoiceState)
  const setVoiceStatus = useAlbertStore((s) => s.setVoiceStatus)
  const setRouteInfo = useAlbertStore((s) => s.setRouteInfo)
  const setActivity = useAlbertStore((s) => s.setActivity)
  const setWakeArmed = useAlbertStore((s) => s.setWakeArmed)
  const voiceState = useAlbertStore((s) => s.voiceState)
  const settings = useAlbertStore((s) => s.settings)
  const sessionRef = useRef<ActiveVoice | null>(null)
  const wakeRef = useRef<WakeWordListener | null>(null)
  const startingVoiceRef = useRef(false)
  const startVoiceRef = useRef<() => Promise<void>>(async () => undefined)

  useEffect(() => {
    document.body.classList.toggle('perf-mode', settings.performanceMode !== false)
  }, [settings.performanceMode])

  useEffect(() => {
    const onVis = (): void => {
      document.body.classList.toggle('window-hidden', document.hidden)
    }
    onVis()
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const startVoice = useCallback(async (): Promise<void> => {
    if (startingVoiceRef.current) return
    if (sessionRef.current) return

    const current = useAlbertStore.getState().settings
    const hasBrain = Boolean(
      current.anthropicApiKey?.trim() ||
        current.ollamaApiKey?.trim() ||
        current.groqApiKey?.trim()
    )
    if (!hasBrain) {
      setError('Add an Anthropic, Groq, or Ollama API key under Systems to talk.')
      setPanel('settings')
      return
    }

    // Jump to Comm once we know we can engage
    setPanel('conversation')

    startingVoiceRef.current = true
    wakeRef.current?.pause()
    try {
      setError(null)
      setVoiceState('connecting')
      setVoiceStatus('Starting local voice…')
      setPanel('conversation')

      const session = new ClaudeVoiceSession(
        (state) => setVoiceState(state),
        (role, text) => {
          const content = text.trim()
          if (!content) return
          appendMessage({
            id: `voice-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            role,
            content,
            createdAt: Date.now()
          })
        },
        (status) => setVoiceStatus(status),
        () => {
          // Session ended itself (e.g. “standby”) — clear ref so wake word can re-arm
          if (sessionRef.current === session) sessionRef.current = null
          setVoiceState('idle')
          setVoiceStatus('')
          if (useAlbertStore.getState().settings.wakeWordEnabled) {
            wakeRef.current?.resume()
          }
        }
      )
      sessionRef.current = session
      await session.start()
    } catch (err) {
      let message = err instanceof Error ? err.message : String(err)
      const nested = message.match(/Error invoking remote method[^:]+: Error: ([\s\S]+)$/)
      if (nested?.[1]) message = nested[1]
      setError(message)
      setVoiceStatus('')
      setVoiceState('idle')
      sessionRef.current = null
      setPanel('conversation')
      if (useAlbertStore.getState().settings.wakeWordEnabled) {
        wakeRef.current?.resume()
      }
    } finally {
      startingVoiceRef.current = false
    }
  }, [appendMessage, setError, setPanel, setVoiceState, setVoiceStatus])

  startVoiceRef.current = startVoice

  const stopVoice = useCallback(async (): Promise<void> => {
    if (sessionRef.current) {
      await sessionRef.current.stop()
      sessionRef.current = null
    }
    setVoiceState('idle')
    setVoiceStatus('')
    if (useAlbertStore.getState().settings.wakeWordEnabled) {
      wakeRef.current?.resume()
    }
  }, [setVoiceState, setVoiceStatus])

  const stopVoiceRef = useRef(stopVoice)
  stopVoiceRef.current = stopVoice

  async function toggleVoice(): Promise<void> {
    try {
      setError(null)
      if (voiceState !== 'idle' && sessionRef.current) {
        await stopVoice()
        return
      }
      await startVoice()
    } catch (err) {
      let message = err instanceof Error ? err.message : String(err)
      const nested = message.match(/Error invoking remote method[^:]+: Error: ([\s\S]+)$/)
      if (nested?.[1]) message = nested[1]
      setError(message)
      setVoiceStatus('')
      setVoiceState('idle')
      sessionRef.current = null
    }
  }

  useEffect(() => {
    // Populate TTS voice list (Chrome/Electron loads async)
    window.speechSynthesis.getVoices()
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.getVoices()
    }

    void (async () => {
      try {
        const [nextSettings, history, activity] = await Promise.all([
          window.albert.getSettings(),
          window.albert.getChatHistory(),
          window.albert.listActivity()
        ])
        setSettings(nextSettings)
        setMessages(history.filter((m) => m.role === 'user' || m.role === 'assistant'))
        setActivity(activity)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })()

    const off = window.albert.onChatEvent((event) => {
      if (event.type === 'route') {
        const tier =
          event.tier === 'power' ? 'POWER' : event.tier === 'local' ? 'LOCAL' : 'FAST'
        setRouteInfo(`${tier} · ${event.model}${event.reason ? ` — ${event.reason}` : ''}`)
        if (event.reason?.toLowerCase().includes('locked')) {
          void window.albert.getSettings().then(setSettings)
        }
      } else if (event.type === 'token' && event.content) {
        appendStreamingText(event.content)
      } else if (event.type === 'message' && event.message) {
        if (event.message.role === 'assistant' || event.message.role === 'user') {
          appendMessage(event.message)
        }
        if (event.message.role === 'assistant') {
          setStreamingText('')
        }
      } else if (event.type === 'tool_start' || event.type === 'tool_end') {
        void window.albert.listActivity().then(setActivity)
        if (event.type === 'tool_start' && event.toolName?.startsWith('computer_')) {
          void window.albert.showComputer()
        }
      } else if (event.type === 'standby') {
        // Main (or chat) confirmed an end-voice command — actually leave voice
        void stopVoiceRef.current()
      } else if (event.type === 'chat_cleared') {
        setMessages([])
        setStreamingText('')
      } else if (event.type === 'done') {
        setBusy(false)
        setStreamingText('')
      } else if (event.type === 'error') {
        setError(event.error || 'Unknown error')
        setBusy(false)
        setStreamingText('')
      }
    })

    return () => {
      off()
      void sessionRef.current?.stop()
      // Do NOT stop wake here — React StrictMode remounts this effect on launch
      // and aborting SpeechRecognition causes the macOS mic indicator to flicker.
    }
  }, [])

  // Single owner for wake-word mic lifecycle (avoids start/pause races that flicker the OS mic icon)
  useEffect(() => {
    const enabled = settings.wakeWordEnabled !== false
    if (!enabled) {
      wakeRef.current?.stop()
      wakeRef.current = null
      setWakeArmed(false)
      return
    }

    if (!isWakeWordSupported()) {
      setWakeArmed(false)
      setError(
        'Wake word needs microphone access. Use Engage or ⌘⇧A if the mic is unavailable.'
      )
      return
    }

    if (!wakeRef.current) {
      wakeRef.current = new WakeWordListener(
        () => {
          // Wake from Home / standby → show, Comm, engage
          setVoiceStatus('Wake phrase heard — engaging…')
          void window.albert.showWindow()
          useAlbertStore.getState().setPanel('conversation')
          void startVoiceRef.current()
        },
        (armed, detail) => {
          setWakeArmed(armed)
          if (detail === 'mic-denied') {
            setError(
              'Wake word needs the microphone. Allow mic for A.L.B.E.R.T. in System Settings → Privacy & Security → Microphone.'
            )
          }
        }
      )
    }

    let armTimer = 0
    const idle = voiceState === 'idle' && !sessionRef.current
    if (idle) {
      // Debounce past React StrictMode remount — don't tear down/recreate
      armTimer = window.setTimeout(() => {
        if (!wakeRef.current) return
        if (useAlbertStore.getState().voiceState !== 'idle' || sessionRef.current) return
        wakeRef.current.start()
      }, 500)
    } else {
      wakeRef.current.pause()
    }

    return () => {
      window.clearTimeout(armTimer)
    }
    // startVoice via ref — do not re-arm on callback identity churn
  }, [settings.wakeWordEnabled, voiceState, setWakeArmed, setError, setVoiceStatus])

  // True teardown only when the window is closing
  useEffect(() => {
    const onUnload = (): void => {
      wakeRef.current?.stop()
      wakeRef.current = null
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [])

  return (
    <div className="app-shell">
      <div className="drag-bar" />
      <Sidebar />
      <main className="main">
        {panel === 'home' ? <HomePanel onTalk={() => void toggleVoice()} /> : null}
        {panel === 'conversation' ? (
          <ConversationPanel
            onTalk={() => void toggleVoice()}
            onStandby={() => void stopVoice()}
          />
        ) : null}
        {panel === 'memory' ? <MemoryPanel /> : null}
        {panel === 'activity' ? <ActivityPanel /> : null}
        {panel === 'settings' ? <SettingsPanel /> : null}
      </main>
    </div>
  )
}
