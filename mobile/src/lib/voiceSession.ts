import * as Speech from 'expo-speech'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, Linking, type AppStateStatus } from 'react-native'
import type { VoicePhase } from '../types'
import { getSpeechRecognitionPackage, isSpeechRecognitionAvailable } from './speechRecognition'
import { correctTranscript, isEndVoiceCommand, isMuteCommand } from './voiceCommands'
import {
  INTERIM_TAIL_SILENCE_MS,
  InterimTranscriptTail,
  readTranscriptEvent,
  speechRetryDelayMs,
  TTS_START_WATCHDOG_MS,
  ttsCompletionWatchdogMs,
  voiceGenerationIsCurrent
} from './voiceReliability'
import { isWakePhrase } from './wakePhrase'

export type VoiceHandlers = {
  onUserUtterance: (text: string) => Promise<string>
  onPhase?: (phase: VoicePhase) => void
  onStatus?: (msg: string) => void
  speakReplies?: boolean
  speechRate?: number
  wakeOnLaunch?: boolean
}

type ListeningMode = 'standby' | 'utterance'
type Timer = ReturnType<typeof setTimeout>

const UNAVAILABLE_STATUS =
  'Voice needs a dev build (Expo Go has no speech recognition). Comm still works.'

const WAKE_CONTEXT = [
  'Albert wake up',
  'Wake up Albert',
  'Hey Albert',
  'A.L.B.E.R.T. wake up'
]

const COMMAND_CONTEXT = [
  'take 5',
  'standby',
  'end voice',
  'mute',
  'A.L.B.E.R.T.',
  'Groq',
  'Haiku',
  'Ollama'
]

/**
 * Foreground phone voice session. Standby waits for a wake phrase; engaged mode
 * recognizes one utterance at a time, asks the configured brain, then speaks.
 */
export function useAlbertVoice(handlers: VoiceHandlers): {
  phase: VoicePhase
  status: string
  supported: boolean
  wakeArmed: boolean
  engage: () => Promise<void>
  requestPermission: () => Promise<void>
  standby: () => void
  toggle: () => Promise<void>
} {
  const nativeAvailable = isSpeechRecognitionAvailable()
  const [phase, setPhase] = useState<VoicePhase>('standby')
  const [status, setStatus] = useState(
    nativeAvailable
      ? handlers.wakeOnLaunch
        ? 'Standby — say “Albert, wake up”'
        : 'Standby — tap Engage Voice when ready'
      : UNAVAILABLE_STATUS
  )
  const [supported, setSupported] = useState(nativeAvailable)
  const [wakeArmed, setWakeArmed] = useState(false)

  const phaseRef = useRef<VoicePhase>('standby')
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const mountedRef = useRef(true)
  const appActiveRef = useRef(
    AppState.currentState !== 'background' && AppState.currentState !== 'inactive'
  )
  const permissionGrantedRef = useRef(false)
  const armedPreferenceRef = useRef(handlers.wakeOnLaunch === true)
  const processingRef = useRef(false)
  const generationRef = useRef(0)

  const desiredModeRef = useRef<ListeningMode | null>(null)
  const desiredGenerationRef = useRef(0)
  const recognitionActiveRef = useRef(false)
  const recognitionStartedAtRef = useRef(0)
  const recognitionAttemptRef = useRef(0)
  const restartTimerRef = useRef<Timer | null>(null)
  const interimTimerRef = useRef<Timer | null>(null)
  const transcriptTailRef = useRef(new InterimTranscriptTail())
  const activeSpeechCancelRef = useRef<(() => void) | null>(null)

  const publishStatus = useCallback((note: string) => {
    if (!mountedRef.current) return
    setStatus(note)
    handlersRef.current.onStatus?.(note)
  }, [])

  const setPhaseBoth = useCallback(
    (next: VoicePhase, note?: string) => {
      phaseRef.current = next
      if (mountedRef.current) {
        setPhase(next)
        handlersRef.current.onPhase?.(next)
      }
      if (note) publishStatus(note)
    },
    [publishStatus]
  )

  const isCurrentGeneration = useCallback((expected: number): boolean => {
    return (
      mountedRef.current &&
      voiceGenerationIsCurrent({
        expected,
        current: generationRef.current,
        appActive: appActiveRef.current
      })
    )
  }, [])

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current)
    restartTimerRef.current = null
  }, [])

  const clearInterimTimer = useCallback(() => {
    if (interimTimerRef.current) clearTimeout(interimTimerRef.current)
    interimTimerRef.current = null
  }, [])

  const cancelSpeech = useCallback(async (): Promise<void> => {
    const cancel = activeSpeechCancelRef.current
    activeSpeechCancelRef.current = null
    cancel?.()
    try {
      await Speech.stop()
    } catch {
      /* the native speech queue was already gone */
    }
  }, [])

  const cancelRecognition = useCallback(() => {
    clearRestartTimer()
    clearInterimTimer()
    desiredModeRef.current = null
    if (mountedRef.current) setWakeArmed(false)
    transcriptTailRef.current.clear()
    const wasActive = recognitionActiveRef.current
    recognitionActiveRef.current = false
    if (!wasActive) return
    const mod = getSpeechRecognitionPackage()?.ExpoSpeechRecognitionModule
    if (!mod) return
    try {
      mod.abort()
    } catch {
      try {
        mod.stop()
      } catch {
        /* native session was already gone */
      }
    }
  }, [clearInterimTimer, clearRestartTimer])

  const scheduleListeningRef = useRef(
    (_mode: ListeningMode, _generation: number, _delayMs?: number): void => undefined
  )

  const scheduleListening = useCallback(
    (mode: ListeningMode, generation: number, delayMs = 180) => {
      clearRestartTimer()
      desiredModeRef.current = mode
      desiredGenerationRef.current = generation
      if (mountedRef.current) setWakeArmed(mode === 'standby')
      restartTimerRef.current = setTimeout(() => {
        restartTimerRef.current = null
        if (!isCurrentGeneration(generation) || !permissionGrantedRef.current) return
        if (processingRef.current || desiredModeRef.current !== mode) return
        const expectedPhase: VoicePhase = mode === 'standby' ? 'standby' : 'listening'
        if (phaseRef.current !== expectedPhase || recognitionActiveRef.current) return

        const mod = getSpeechRecognitionPackage()?.ExpoSpeechRecognitionModule
        if (!mod) {
          setSupported(false)
          publishStatus(UNAVAILABLE_STATUS)
          return
        }

        try {
          recognitionActiveRef.current = true
          recognitionStartedAtRef.current = Date.now()
          mod.start({
            lang: 'en-US',
            interimResults: true,
            maxAlternatives: 1,
            contextualStrings: mode === 'standby' ? WAKE_CONTEXT : COMMAND_CONTEXT,
            // Utterances must stop/finalize after silence. Standby remains continuous,
            // with the interim-tail timer below as a cross-version wake fallback.
            continuous: mode === 'standby',
            addsPunctuation: true,
            iosTaskHint: mode === 'standby' ? 'confirmation' : 'dictation'
          })
        } catch (err) {
          recognitionActiveRef.current = false
          recognitionAttemptRef.current += 1
          const retryMs = Math.min(6_000, 350 * 2 ** Math.min(recognitionAttemptRef.current, 4))
          publishStatus(err instanceof Error ? `Mic unavailable — ${err.message}` : 'Mic unavailable')
          scheduleListeningRef.current(mode, generation, retryMs)
        }
      }, Math.max(0, delayMs))
    },
    [clearRestartTimer, isCurrentGeneration, publishStatus]
  )
  scheduleListeningRef.current = scheduleListening

  const speak = useCallback(
    async (text: string, generation: number, force = false): Promise<boolean> => {
      const clean = text.replace(/\s+/g, ' ').trim()
      if (!clean || !isCurrentGeneration(generation)) return false
      if (!force && handlersRef.current.speakReplies === false) return true

      cancelRecognition()
      await cancelSpeech()
      if (!isCurrentGeneration(generation)) return false
      setPhaseBoth('speaking', 'Preparing voice… (tap Take 5 to cut)')

      return new Promise<boolean>((resolve) => {
        let settled = false
        let startTimer: Timer | null = null
        let completionTimer: Timer | null = null

        const settle = (completed: boolean) => {
          if (settled) return
          settled = true
          if (startTimer) clearTimeout(startTimer)
          if (completionTimer) clearTimeout(completionTimer)
          if (activeSpeechCancelRef.current === cancel) activeSpeechCancelRef.current = null
          resolve(completed)
        }

        const cancel = () => settle(false)
        activeSpeechCancelRef.current = cancel

        startTimer = setTimeout(() => {
          void Speech.isSpeakingAsync()
            .then((isSpeaking) => {
              if (settled || isSpeaking) return
              void Speech.stop().catch(() => undefined)
              if (isCurrentGeneration(generation)) {
                publishStatus('Voice output did not start — listening resumed')
              }
              settle(false)
            })
            .catch(() => {
              // The completion watchdog remains the final guarantee.
            })
        }, TTS_START_WATCHDOG_MS)

        completionTimer = setTimeout(() => {
          void Speech.stop().catch(() => undefined)
          if (isCurrentGeneration(generation)) {
            publishStatus('Voice output timed out — listening resumed')
          }
          settle(false)
        }, ttsCompletionWatchdogMs(clean))

        try {
          Speech.speak(clean, {
            language: 'en-US',
            rate: Math.max(0.7, Math.min(1.35, handlersRef.current.speechRate ?? 1.05)),
            useApplicationAudioSession: false,
            onStart: () => {
              if (isCurrentGeneration(generation)) {
                setPhaseBoth('speaking', 'Speaking… (tap Take 5 to cut)')
              }
            },
            onDone: () => settle(true),
            onStopped: () => settle(false),
            onError: () => {
              if (isCurrentGeneration(generation)) publishStatus('Voice output failed')
              settle(false)
            }
          })
        } catch {
          if (isCurrentGeneration(generation)) publishStatus('Voice output failed')
          settle(false)
        }
      })
    },
    [cancelRecognition, cancelSpeech, isCurrentGeneration, publishStatus, setPhaseBoth]
  )

  const goStandby = useCallback(() => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    processingRef.current = false
    void cancelSpeech()
    cancelRecognition()
    armedPreferenceRef.current = true
    setPhaseBoth('standby', 'Standing by, sir. Say “Albert, wake up”.')
    if (permissionGrantedRef.current && appActiveRef.current) {
      scheduleListening('standby', generation, 350)
    }
  }, [cancelRecognition, cancelSpeech, scheduleListening, setPhaseBoth])

  const requestPermission = useCallback(async (): Promise<void> => {
    const mod = getSpeechRecognitionPackage()?.ExpoSpeechRecognitionModule
    if (!mod) {
      setSupported(false)
      publishStatus(UNAVAILABLE_STATUS)
      return
    }
    setPhaseBoth('permission', 'Requesting microphone and speech recognition access…')
    try {
      const current = await mod.getPermissionsAsync?.()
      if (current && !current.granted && current.canAskAgain === false) {
        permissionGrantedRef.current = false
        setSupported(false)
        setPhaseBoth('standby', 'Open Settings to enable Microphone and Speech Recognition')
        await Linking.openSettings()
        return
      }
      const result = current?.granted ? current : await mod.requestPermissionsAsync()
      if (!mountedRef.current) return
      permissionGrantedRef.current = result.granted
      setSupported(result.granted || result.canAskAgain !== false)
      setPhaseBoth('standby')
      publishStatus(
        result.granted
          ? 'Voice access ready — tap Engage Voice'
          : result.canAskAgain === false
            ? 'Mic permission denied — enable Microphone and Speech Recognition in Settings'
            : 'Mic permission is required for voice'
      )
    } catch {
      permissionGrantedRef.current = false
      setSupported(false)
      setPhaseBoth('fault', UNAVAILABLE_STATUS)
    }
  }, [publishStatus, setPhaseBoth])

  const engage = useCallback(async () => {
    if (!getSpeechRecognitionPackage()) {
      setSupported(false)
      publishStatus(UNAVAILABLE_STATUS)
      return
    }
    if (!permissionGrantedRef.current) {
      await requestPermission()
      if (!permissionGrantedRef.current) return
    }
    if (!appActiveRef.current) {
      publishStatus('Return to A.L.B.E.R.T. to engage voice')
      return
    }

    const generation = generationRef.current + 1
    generationRef.current = generation
    processingRef.current = false
    recognitionAttemptRef.current = 0
    armedPreferenceRef.current = true
    cancelRecognition()
    await cancelSpeech()
    if (!isCurrentGeneration(generation)) return
    setPhaseBoth('listening', 'Listening — pause when you finish speaking')
    scheduleListening('utterance', generation)
  }, [
    cancelRecognition,
    cancelSpeech,
    isCurrentGeneration,
    publishStatus,
    requestPermission,
    scheduleListening,
    setPhaseBoth
  ])

  const handleTranscript = useCallback(
    async (raw: string, observedGeneration: number) => {
      if (!isCurrentGeneration(observedGeneration) || processingRef.current) return
      const text = correctTranscript(raw).replace(/\s+/g, ' ').trim()
      if (!text) return
      const phaseNow = phaseRef.current

      if (phaseNow === 'standby') {
        if (!isWakePhrase(text)) return

        processingRef.current = true
        cancelRecognition()
        const generation = generationRef.current + 1
        generationRef.current = generation
        recognitionAttemptRef.current = 0
        setPhaseBoth('listening', 'Wake phrase confirmed')
        await speak('Online, sir.', generation, true)
        if (!isCurrentGeneration(generation)) return
        processingRef.current = false
        setPhaseBoth('listening', 'Listening — pause when you finish speaking')
        scheduleListening('utterance', generation, 220)
        return
      }

      if (phaseNow === 'speaking') {
        if (isMuteCommand(text)) {
          void cancelSpeech()
          processingRef.current = false
          setPhaseBoth('listening', 'Muted — listening')
          scheduleListening('utterance', observedGeneration, 220)
        } else if (isEndVoiceCommand(text)) {
          goStandby()
        }
        // Never send recognizer echo from TTS back to the model.
        return
      }

      if (phaseNow === 'thinking') return
      if (phaseNow !== 'listening') return

      if (isEndVoiceCommand(text)) {
        processingRef.current = true
        cancelRecognition()
        await speak('Standing by, sir.', observedGeneration, true)
        if (isCurrentGeneration(observedGeneration)) goStandby()
        return
      }

      if (isMuteCommand(text)) {
        void cancelSpeech()
        setPhaseBoth('listening', 'Listening')
        scheduleListening('utterance', observedGeneration, 180)
        return
      }

      processingRef.current = true
      cancelRecognition()
      setPhaseBoth('thinking', `Heard: “${text}”`)
      try {
        const reply = await handlersRef.current.onUserUtterance(text)
        if (!isCurrentGeneration(observedGeneration)) return
        await speak(reply || 'Done, sir.', observedGeneration)
        if (!isCurrentGeneration(observedGeneration)) return
        processingRef.current = false
        setPhaseBoth('listening', 'Listening — pause when you finish speaking')
        scheduleListening('utterance', observedGeneration, 220)
      } catch (err) {
        if (!isCurrentGeneration(observedGeneration)) return
        const msg = err instanceof Error ? err.message : String(err)
        publishStatus(msg)
        await speak(`I hit an error, sir. ${msg}`, observedGeneration)
        if (!isCurrentGeneration(observedGeneration)) return
        processingRef.current = false
        setPhaseBoth('listening', 'Listening')
        scheduleListening('utterance', observedGeneration, 220)
      } finally {
        if (generationRef.current === observedGeneration) processingRef.current = false
      }
    },
    [
      cancelRecognition,
      cancelSpeech,
      goStandby,
      isCurrentGeneration,
      publishStatus,
      scheduleListening,
      setPhaseBoth,
      speak
    ]
  )

  const handleTranscriptRef = useRef(handleTranscript)
  handleTranscriptRef.current = handleTranscript

  useEffect(() => {
    mountedRef.current = true
    const mod = getSpeechRecognitionPackage()?.ExpoSpeechRecognitionModule
    if (!mod) {
      setSupported(false)
      publishStatus(UNAVAILABLE_STATUS)
      return () => {
        mountedRef.current = false
      }
    }

    const restartDesired = (delayMs: number) => {
      const mode = desiredModeRef.current
      const generation = desiredGenerationRef.current
      if (!mode || processingRef.current || restartTimerRef.current) return
      scheduleListeningRef.current(mode, generation, delayMs)
    }

    const onStart = () => {
      recognitionActiveRef.current = true
      recognitionStartedAtRef.current = Date.now()
    }

    const onResult = (event: Record<string, unknown>) => {
      const snapshot = readTranscriptEvent(event)
      if (!snapshot || processingRef.current) return
      recognitionAttemptRef.current = 0
      const generation = generationRef.current
      const finalText = transcriptTailRef.current.observe(snapshot, Date.now())
      clearInterimTimer()
      if (finalText) {
        void handleTranscriptRef.current(finalText, generation)
        return
      }

      interimTimerRef.current = setTimeout(() => {
        interimTimerRef.current = null
        if (!isCurrentGeneration(generation) || processingRef.current) return
        const tail = transcriptTailRef.current.flush(Date.now(), INTERIM_TAIL_SILENCE_MS)
        if (tail) void handleTranscriptRef.current(tail, generation)
      }, INTERIM_TAIL_SILENCE_MS + 20)
    }

    const onError = (event: Record<string, unknown>) => {
      recognitionActiveRef.current = false
      clearInterimTimer()
      transcriptTailRef.current.clear()
      const code = typeof event.error === 'string' ? event.error : 'unknown'
      if (code === 'aborted') return

      if (code === 'not-allowed') {
        permissionGrantedRef.current = false
        desiredModeRef.current = null
        setSupported(false)
        publishStatus('Microphone / speech permission denied — enable it in Settings')
        return
      }

      if (code === 'service-not-allowed' || code === 'language-not-supported') {
        desiredModeRef.current = null
        setSupported(false)
        publishStatus(
          code === 'language-not-supported'
            ? 'English speech recognition is unavailable on this device'
            : 'Speech recognition service is unavailable'
        )
        return
      }

      if (code === 'interrupted') {
        publishStatus('Voice paused by a system audio interruption')
        if (appActiveRef.current) restartDesired(1_200)
        return
      }

      const retryMs = speechRetryDelayMs(code, recognitionAttemptRef.current)
      recognitionAttemptRef.current += 1
      if (retryMs != null) {
        if (code !== 'no-speech' && code !== 'speech-timeout') {
          publishStatus(
            code === 'network'
              ? 'Speech network unavailable — retrying'
              : 'Mic interrupted — retrying'
          )
        }
        restartDesired(retryMs)
      }
    }

    const onEnd = () => {
      recognitionActiveRef.current = false
      clearInterimTimer()
      transcriptTailRef.current.clear()
      if (processingRef.current || restartTimerRef.current) return
      const ranForMs = Date.now() - recognitionStartedAtRef.current
      if (ranForMs < 750) recognitionAttemptRef.current += 1
      else recognitionAttemptRef.current = 0
      const delay = ranForMs < 750
        ? Math.min(6_000, 350 * 2 ** Math.min(recognitionAttemptRef.current, 4))
        : 180
      restartDesired(delay)
    }

    const onAppState = (next: AppStateStatus) => {
      const active = next === 'active'
      if (active === appActiveRef.current) return
      appActiveRef.current = active
      const generation = generationRef.current + 1
      generationRef.current = generation
      processingRef.current = false
      void cancelSpeech()
      cancelRecognition()

      if (!active) {
        setPhaseBoth('standby', 'Voice paused while A.L.B.E.R.T. is in the background')
        return
      }

      const shouldArm = armedPreferenceRef.current || handlersRef.current.wakeOnLaunch === true
      setPhaseBoth(
        'standby',
        shouldArm ? 'Standing by, sir. Say “Albert, wake up”.' : 'Standby — tap Engage Voice when ready'
      )
      if (permissionGrantedRef.current && shouldArm) {
        scheduleListeningRef.current('standby', generation, 350)
      }
    }

    const subs = [
      mod.addListener('start', onStart),
      mod.addListener('result', onResult),
      mod.addListener('error', onError),
      mod.addListener('end', onEnd)
    ]
    const appStateSub = AppState.addEventListener('change', onAppState)

    let cancelled = false
    void (async () => {
      try {
        const result = await mod.getPermissionsAsync?.()
        if (cancelled || !mountedRef.current) return
        if (!result) {
          setSupported(true)
          publishStatus('Standby — tap Engage Voice to grant microphone access')
          return
        }
        if (!result.granted) {
          permissionGrantedRef.current = false
          setSupported(result.canAskAgain !== false)
          publishStatus(
            result.canAskAgain === false
              ? 'Mic permission denied — enable Microphone and Speech Recognition in Settings'
              : 'Standby — tap Engage Voice to grant microphone access'
          )
          return
        }
        permissionGrantedRef.current = true
        setSupported(true)
        if (appActiveRef.current && handlersRef.current.wakeOnLaunch === true) {
          armedPreferenceRef.current = true
          const generation = generationRef.current
          scheduleListeningRef.current('standby', generation, 120)
        } else {
          publishStatus('Standby — tap Engage Voice when ready')
        }
      } catch {
        if (!cancelled && mountedRef.current) {
          permissionGrantedRef.current = false
          setSupported(false)
          publishStatus(UNAVAILABLE_STATUS)
        }
      }
    })()

    return () => {
      cancelled = true
      mountedRef.current = false
      generationRef.current += 1
      processingRef.current = false
      permissionGrantedRef.current = false
      for (const sub of subs) {
        try {
          sub.remove()
        } catch {
          /* already removed */
        }
      }
      appStateSub.remove()
      void cancelSpeech()
      cancelRecognition()
    }
  }, [
    cancelRecognition,
    cancelSpeech,
    clearInterimTimer,
    isCurrentGeneration,
    publishStatus,
    setPhaseBoth
  ])

  useEffect(() => {
    if (
      handlers.wakeOnLaunch !== true ||
      !permissionGrantedRef.current ||
      !appActiveRef.current ||
      phaseRef.current !== 'standby' ||
      desiredModeRef.current
    ) return
    armedPreferenceRef.current = true
    const generation = generationRef.current
    setPhaseBoth('standby', 'Standing by, sir. Say “Albert, wake up”.')
    scheduleListening('standby', generation, 120)
  }, [handlers.wakeOnLaunch, scheduleListening, setPhaseBoth])

  const toggle = useCallback(async () => {
    if (!getSpeechRecognitionPackage()) {
      setSupported(false)
      publishStatus(UNAVAILABLE_STATUS)
      return
    }
    if (phaseRef.current === 'standby') await engage()
    else goStandby()
  }, [engage, goStandby, publishStatus])

  return {
    phase,
    status,
    supported,
    wakeArmed,
    engage,
    requestPermission,
    standby: goStandby,
    toggle
  }
}
