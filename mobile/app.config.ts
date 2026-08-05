import type { ExpoConfig } from 'expo/config'

const config: ExpoConfig = {
  name: 'A.L.B.E.R.T.',
  slug: 'albert',
  owner: 'kaichik',
  description: 'A private, voice-first AI companion with optional two-way Mac synchronization.',
  version: '1.1.0',
  platforms: ['ios', 'android'],
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'dark',
  scheme: 'albert',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.kaichik.albert',
    buildNumber: '2',
    infoPlist: {
      NSMicrophoneUsageDescription:
        'A.L.B.E.R.T. uses the microphone for wake phrases, voice commands, and conversations while the app is active.',
      NSSpeechRecognitionUsageDescription:
        'A.L.B.E.R.T. converts your speech to text for wake phrases, voice commands, and conversations.',
      NSLocalNetworkUsageDescription:
        'A.L.B.E.R.T. connects to your Mac on the local network to sync Comm, memory, Operations, approvals, captures, and activity.',
      NSAppTransportSecurity: {
        NSAllowsLocalNetworking: true,
        NSAllowsArbitraryLoads: false
      }
    },
    config: { usesNonExemptEncryption: false }
  },
  android: {
    package: 'com.kaichik.albert',
    versionCode: 2,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#000000'
    }
  },
  extra: {
    eas: {
      projectId: process.env.EAS_PROJECT_ID || '3b312788-2ec0-45da-83d7-e88014d9c9ef'
    }
  },
  plugins: [
    './plugins/with-local-network',
    'expo-secure-store',
    'expo-font',
    'expo-asset',
    [
      'expo-speech-recognition',
      {
        microphonePermission:
          'A.L.B.E.R.T. uses the microphone for wake phrases, voice commands, and conversations while the app is active.',
        speechRecognitionPermission:
          'A.L.B.E.R.T. converts your speech to text for wake phrases, voice commands, and conversations.'
      }
    ],
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 180,
        resizeMode: 'contain',
        backgroundColor: '#000000',
        dark: { backgroundColor: '#000000' }
      }
    ]
  ]
}

export default config
