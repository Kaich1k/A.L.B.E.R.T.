/**
 * Safe loader for expo-speech-recognition.
 * Expo Go does not ship this native module — never require() it there.
 * Dev clients / EAS builds with the config plugin include it.
 */
import Constants, { ExecutionEnvironment } from 'expo-constants'

export type SpeechRecognitionModule = {
  start: (options: {
    lang?: string
    interimResults?: boolean
    maxAlternatives?: number
    contextualStrings?: string[]
    continuous?: boolean
    addsPunctuation?: boolean
    requiresOnDeviceRecognition?: boolean
    iosTaskHint?: string
  }) => void
  stop: () => void
  abort: () => void
  getPermissionsAsync?: () => Promise<SpeechPermissionResponse>
  requestPermissionsAsync: () => Promise<SpeechPermissionResponse>
  addListener: (
    eventName: string,
    listener: (event: Record<string, unknown>) => void
  ) => { remove: () => void }
}

export type SpeechPermissionResponse = {
  granted: boolean
  canAskAgain?: boolean
  status?: 'undetermined' | 'granted' | 'denied' | 'restricted'
}

type SpeechPackage = {
  ExpoSpeechRecognitionModule: SpeechRecognitionModule
}

let cached: SpeechPackage | null | undefined

function isExpoGo(): boolean {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient
}

export function getSpeechRecognitionPackage(): SpeechPackage | null {
  if (cached !== undefined) return cached
  if (isExpoGo()) {
    cached = null
    return null
  }
  try {
    // Dynamic require — only in native builds that include the module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('expo-speech-recognition') as SpeechPackage
    if (!cached?.ExpoSpeechRecognitionModule) {
      cached = null
    }
  } catch {
    cached = null
  }
  return cached
}

export function isSpeechRecognitionAvailable(): boolean {
  return getSpeechRecognitionPackage() != null
}
