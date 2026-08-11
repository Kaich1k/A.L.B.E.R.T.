import { useCallback, useEffect, useRef, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { HomePanel } from './components/HomePanel'
import { ConversationPanel } from './components/ConversationPanel'
import { MissionsPanel } from './components/MissionsPanel'
import { MemoryPanel } from './components/MemoryPanel'
import { ActivityPanel } from './components/ActivityPanel'
import { CommandPalette } from './components/CommandPalette'
import { StartupSequence } from './components/StartupSequence'
import { SystemStatusRail } from './components/SystemStatusRail'
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
  const busy = useAlbertStore((s) => s.busy)
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
  const [systemEvent, setSystemEvent] = useState<{ text: string; tone: 'normal' | 'ok' | 'warn' } | null>(null)
  const [settingsReady, setSettingsReady] = useState(false)
  const systemEventTimer = useRef(0)

  function flashSystemEvent(text: string, tone: 'normal' | 'ok' | 'warn' = 'normal'): void {
    window.clearTimeout(systemEventTimer.current)
    setSystemEvent({ text, tone })
    systemEventTimer.current = window.setTimeout(() => setSystemEvent(null), 3600)
  }

  useEffect(() => {
    document.body.classList.toggle('perf-mode', settings.performanceMode !== false)
    document.body.dataset.hudDensity = settings.hudDensity || 'cinematic'
  }, [settings.performanceMode, settings.hudDensity])

  useEffect(() => {
    const onVis = (): void => {
      document.body.classList.toggle('window-hidden', document.hidden)
      // After sleep / long background, mic tracks and wake timers often die quietly
      if (!document.hidden) {
        const idle = useAlbertStore.getState().voiceState === 'idle' && !sessionRef.current
        if (idle && useAlbertStore.getState().settings.wakeWordEnabled !== false) {
          wakeRef.current?.kick()
        }
      }
    }
    onVis()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onVis)
    }
  }, [])

  const startVoice = useCallback(async (): Promise<void> => {
    if (startingVoiceRef.current) return
    if (sessionRef.current) return

    const current = useAlbertStore.getState().settings
    // Local Ollama needs no API key — only the daemon + a model
    const hasBrain = Boolean(
      current.anthropicApiKey?.trim() ||
        current.ollamaApiKey?.trim() ||
        current.groqApiKey?.trim() ||
        current.geminiApiKey?.trim() ||
        current.localProvider === 'ollama'
    )
    if (!hasBrain) {
      setError('Add an Anthropic, Groq, Gemini, or Ollama key under Systems to talk.')
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
      setVoiceStatus(`Voice startup fault · ${message}`)
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
      setVoiceStatus(`Voice startup fault · ${message}`)
      setVoiceState('idle')
      sessionRef.current = null
    }
  }

  useEffect(() => {
    const toggle = (): void => { void toggleVoice() }
    window.addEventListener('albert:voice-toggle', toggle)
    return () => window.removeEventListener('albert:voice-toggle', toggle)
  }, [voiceState, startVoice, stopVoice])

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
      } finally {
        setSettingsReady(true)
      }
    })()

    const off = window.albert.onChatEvent((event) => {
      if (event.type === 'settings' && event.settings) {
        setSettings(event.settings)
      } else if (event.type === 'route') {
        const tier =
          event.tier === 'power' ? 'POWER' : event.tier === 'local' ? 'QUICK' : 'FAST'
        setRouteInfo(`${tier} · ${event.model}${event.reason ? ` — ${event.reason}` : ''}`)
        flashSystemEvent(`ROUTING INTELLIGENCE / ${tier} / ${event.model || 'MODEL READY'}`)
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
        flashSystemEvent(
          event.type === 'tool_start'
            ? `EXECUTING PROTOCOL / ${(event.toolName || 'TOOL').replaceAll('_', ' ').toUpperCase()}`
            : `${event.ok === false ? 'PROTOCOL FAULT' : 'PROTOCOL COMPLETE'} / ${(event.toolName || 'TOOL').replaceAll('_', ' ').toUpperCase()}`,
          event.type === 'tool_end' ? (event.ok === false ? 'warn' : 'ok') : 'normal'
        )
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
      } else if (event.type === 'chat_synced') {
        void window.albert.getChatHistory().then((history) => {
          setMessages(history.filter((message) => message.role === 'user' || message.role === 'assistant'))
        }).catch((err) => setError(err instanceof Error ? err.message : String(err)))
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
      window.clearTimeout(systemEventTimer.current)
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
          } else if (detail?.startsWith('heard:')) {
            // Brief diagnostic so it’s obvious the mic/Whisper path is alive
            const heard = detail.slice('heard:'.length).trim()
            if (heard && useAlbertStore.getState().voiceState === 'idle') {
              setVoiceStatus(`Wake heard: “${heard}”`)
            }
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
        // start() is idempotent; resume() alone missed teardown races after standby
        wakeRef.current.start()
      }, 350)
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
    <div className={`app-shell system-${voiceState} ${busy ? 'system-busy' : ''} ${settingsReady ? 'app-ready' : 'app-hydrating'}`}>
      {settingsReady && settings.startupAnimationEnabled !== false ? (
        <StartupSequence
          performanceMode={settings.performanceMode !== false}
          operatorName="sir"
          brainConfigured={Boolean(
            settings.anthropicApiKey?.trim() ||
            settings.ollamaApiKey?.trim() ||
            settings.groqApiKey?.trim() ||
            settings.geminiApiKey?.trim() ||
            settings.localProvider === 'ollama'
          )}
        />
      ) : null}
      <div className="hud-atmosphere" aria-hidden="true">
        <div className="hud-grid-plane" />
        <div className="hud-scan-beam" />
        <div className="hud-vignette" />
        <span className="hud-corner top-left" />
        <span className="hud-corner top-right" />
        <span className="hud-corner bottom-left" />
        <span className="hud-corner bottom-right" />
      </div>
      <CommandPalette />
      {systemEvent ? <div className={`system-event ${systemEvent.tone}`} role="status"><i />{systemEvent.text}</div> : null}
      <div className="drag-bar" />
      <Sidebar />
      <main className="main">
        {panel === 'home' ? <HomePanel onTalk={() => void toggleVoice()} /> : null}
        {panel === 'conversation' ? (
          <ConversationPanel
            onTalk={() => void toggleVoice()}
            onStandby={stopVoice}
          />
        ) : null}
        {panel === 'missions' ? <MissionsPanel /> : null}
        {panel === 'memory' ? <MemoryPanel /> : null}
        {panel === 'activity' ? <ActivityPanel /> : null}
        {panel === 'settings' ? <SettingsPanel /> : null}
      </main>
      <SystemStatusRail />
    </div>
  )
}
