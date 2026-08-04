import * as Speech from 'expo-speech'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { VoicePhase } from '../types'
import { getSpeechRecognitionPackage, isSpeechRecognitionAvailable } from './speechRecognition'
import { isEndVoiceCommand, isMuteCommand } from './voiceCommands'
import { isWakePhrase } from './wakePhrase'

export type VoiceHandlers = {
  onUserUtterance: (text: string) => Promise<string>
  onPhase?: (phase: VoicePhase) => void
  onStatus?: (msg: string) => void
}

const UNAVAILABLE_STATUS =
  'Voice needs a dev build (Expo Go has no speech recognition). Comm still works.'

/**
 * Phone voice: standby listens for wake; engaged listens for chat / take-5 / mute.
 * Uses on-device speech recognition + expo-speech TTS when native module is present.
 */
export function useAlbertVoice(handlers: VoiceHandlers): {
  phase: VoicePhase
  status: string
  supported: boolean
  engage: () => Promise<void>
  standby: () => void
  toggle: () => Promise<void>
} {
  const nativeAvailable = isSpeechRecognitionAvailable()
  const [phase, setPhase] = useState<VoicePhase>('standby')
  const [status, setStatus] = useState(
    nativeAvailable ? 'Standby — say “Albert, wake up”' : UNAVAILABLE_STATUS
  )
  const [supported, setSupported] = useState(nativeAvailable)
  const phaseRef = useRef<VoicePhase>('standby')
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const processingRef = useRef(false)

  const setPhaseBoth = useCallback((next: VoicePhase, note?: string) => {
    phaseRef.current = next
    setPhase(next)
    handlersRef.current.onPhase?.(next)
    if (note) {
      setStatus(note)
      handlersRef.current.onStatus?.(note)
    }
  }, [])

  const stopListening = useCallback(() => {
    const mod = getSpeechRecognitionPackage()?.ExpoSpeechRecognitionModule
    if (!mod) return
    try {
      mod.stop()
    } catch {
      /* ignore */
    }
  }, [])

  const startListening = useCallback((mode: 'standby' | 'listening') => {
    const mod = getSpeechRecognitionPackage()?.ExpoSpeechRecognitionModule
    if (!mod) return
    try {
      mod.start({
        lang: 'en-US',
        interimResults: true,
        continuous: true,
        addsPunctuation: true,
        iosTaskHint: mode === 'standby' ? 'confirmation' : 'dictation'
      })
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Mic failed')
    }
  }, [])

  const goStandby = useCallback(() => {
    Speech.stop()
    stopListening()
    processingRef.current = false
    setPhaseBoth('standby', 'Standing by, sir. Say “Albert, wake up”.')
    setTimeout(() => {
      if (phaseRef.current === 'standby') startListening('standby')
    }, 350)
  }, [setPhaseBoth, startListening, stopListening])

  const engage = useCallback(async () => {
    if (!getSpeechRecognitionPackage()) {
      setSupported(false)
      setStatus(UNAVAILABLE_STATUS)
      return
    }
    Speech.stop()
    stopListening()
    setPhaseBoth('listening', 'Listening — say “take 5” for standby')
    startListening('listening')
  }, [setPhaseBoth, startListening, stopListening])

  const speak = useCallback(
    async (text: string): Promise<void> => {
      const clean = text.replace(/\s+/g, ' ').trim()
      if (!clean) return
      setPhaseBoth('speaking', 'Speaking… (say “mute” to cut)')
      await new Promise<void>((resolve) => {
        Speech.speak(clean, {
          language: 'en-US',
          rate: 1.05,
          onDone: () => resolve(),
          onStopped: () => resolve(),
          onError: () => resolve()
        })
      })
    },
    [setPhaseBoth]
  )

  const handleFinal = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text || processingRef.current) return
      const phaseNow = phaseRef.current

      if (phaseNow === 'speaking' && (isMuteCommand(text) || /\bmute\b/i.test(text))) {
        Speech.stop()
        setPhaseBoth('listening', 'Muted — listening')
        startListening('listening')
        return
      }

      if (phaseNow === 'standby') {
        if (isWakePhrase(text)) {
          await engage()
          await speak('Online, sir.')
          if (phaseRef.current !== 'standby') {
            setPhaseBoth('listening', 'Listening')
            startListening('listening')
          }
        }
        return
      }

      if (phaseNow === 'listening' || phaseNow === 'speaking' || phaseNow === 'thinking') {
        if (isEndVoiceCommand(text)) {
          await speak('Standing by, sir.')
          goStandby()
          return
        }
        if (isMuteCommand(text)) {
          Speech.stop()
          setPhaseBoth('listening', 'Muted — listening')
          startListening('listening')
          return
        }

        if (phaseNow === 'thinking') return

        processingRef.current = true
        stopListening()
        setPhaseBoth('thinking', `Heard: “${text}”`)
        const stillEngaged = (): boolean => phaseRef.current !== 'standby'
        try {
          const reply = await handlersRef.current.onUserUtterance(text)
          if (!stillEngaged()) return
          await speak(reply || 'Done, sir.')
          if (stillEngaged()) {
            setPhaseBoth('listening', 'Listening')
            startListening('listening')
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          setStatus(msg)
          await speak(`I hit an error, sir. ${msg}`)
          if (stillEngaged()) {
            setPhaseBoth('listening', 'Listening')
            startListening('listening')
          }
        } finally {
          processingRef.current = false
        }
      }
    },
    [engage, goStandby, setPhaseBoth, speak, startListening, stopListening]
  )

  const handleFinalRef = useRef(handleFinal)
  handleFinalRef.current = handleFinal

  useEffect(() => {
    const mod = getSpeechRecognitionPackage()?.ExpoSpeechRecognitionModule
    if (!mod) {
      setSupported(false)
      setStatus(UNAVAILABLE_STATUS)
      return
    }

    const onResult = (event: Record<string, unknown>) => {
      if (!event.isFinal) return
      const results = event.results as Array<{ transcript?: string }> | undefined
      const text = results?.[0]?.transcript?.trim()
      if (text) void handleFinalRef.current(text)
    }

    const onError = (event: Record<string, unknown>) => {
      if (event.error === 'not-allowed') {
        setSupported(false)
        setStatus('Microphone permission denied')
        return
      }
      if (phaseRef.current === 'standby' || phaseRef.current === 'listening') {
        setTimeout(() => {
          if (phaseRef.current === 'standby') startListening('standby')
          else if (phaseRef.current === 'listening') startListening('listening')
        }, 400)
      }
    }

    const onEnd = () => {
      if (processingRef.current) return
      if (phaseRef.current === 'standby') startListening('standby')
      else if (phaseRef.current === 'listening') startListening('listening')
    }

    const subs = [
      mod.addListener('result', onResult),
      mod.addListener('error', onError),
      mod.addListener('end', onEnd)
    ]

    let cancelled = false
    void (async () => {
      try {
        const result = await mod.requestPermissionsAsync()
        if (cancelled) return
        if (!result.granted) {
          setSupported(false)
          setStatus('Mic permission needed for voice')
          return
        }
        setSupported(true)
        startListening('standby')
      } catch {
        if (!cancelled) {
          setSupported(false)
          setStatus(UNAVAILABLE_STATUS)
        }
      }
    })()

    return () => {
      cancelled = true
      Speech.stop()
      stopListening()
      for (const sub of subs) {
        try {
          sub.remove()
        } catch {
          /* ignore */
        }
      }
    }
  }, [startListening, stopListening])

  const toggle = useCallback(async () => {
    if (!getSpeechRecognitionPackage()) {
      setSupported(false)
      setStatus(UNAVAILABLE_STATUS)
      return
    }
    if (phaseRef.current === 'standby') await engage()
    else goStandby()
  }, [engage, goStandby])

  return {
    phase,
    status,
    supported,
    engage,
    standby: goStandby,
    toggle
  }
}
