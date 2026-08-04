import type { ExpoConfig } from 'expo/config'

const config: ExpoConfig = {
  name: 'A.L.B.E.R.T.',
  slug: 'albert-companion',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'dark',
  scheme: 'albert',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.kai.albert.companion',
    buildNumber: '1',
    infoPlist: {
      NSMicrophoneUsageDescription:
        'A.L.B.E.R.T. needs the microphone for wake, voice chat, and mute.',
      NSSpeechRecognitionUsageDescription:
        'A.L.B.E.R.T. uses on-device speech recognition for wake phrases and voice commands.',
      NSLocalNetworkUsageDescription:
        'A.L.B.E.R.T. connects to your Mac on the local network to sync Comm and memories.',
      NSAppTransportSecurity: {
        NSAllowsLocalNetworking: true,
        NSAllowsArbitraryLoads: true
      }
    }
  },
  android: {
    package: 'com.kai.albert.companion',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#000000'
    },
    permissions: ['RECORD_AUDIO']
  },
  web: {
    favicon: './assets/favicon.png'
  },
  extra: {
    eas: {
      projectId: process.env.EAS_PROJECT_ID || undefined
    }
  },
  plugins: [
    'expo-secure-store',
    'expo-font',
    'expo-asset',
    [
      'expo-speech-recognition',
      {
        microphonePermission:
          'A.L.B.E.R.T. needs the microphone for wake, voice chat, and mute.',
        speechRecognitionPermission:
          'A.L.B.E.R.T. uses speech recognition for wake phrases and voice commands.'
      }
    ]
  ]
}

export default config
