import { StyleSheet, Text, View } from 'react-native'
import { APP_EXPANSION, APP_NAME } from '../brand'
import { HudButton } from '../components/HudButton'
import type { VoicePhase } from '../types'
import { colors, fonts } from '../theme'

export function HomeScreen({
  macOnline,
  statusLabel,
  voicePhase,
  voiceStatus,
  voiceSupported,
  onToggleVoice,
  onOpenComm
}: {
  macOnline: boolean | null
  statusLabel: string
  voicePhase: VoicePhase
  voiceStatus: string
  voiceSupported: boolean
  onToggleVoice: () => void
  onOpenComm: () => void
}): React.JSX.Element {
  const engaged = voicePhase !== 'standby'
  const coreClass =
    voicePhase === 'speaking'
      ? styles.coreSpeaking
      : voicePhase === 'listening' || voicePhase === 'thinking'
        ? styles.coreLive
        : styles.coreIdle

  return (
    <View style={styles.root}>
      <View style={styles.top}>
        <Text style={styles.brand}>{APP_NAME}</Text>
        <Text
          style={[
            styles.uplink,
            macOnline === true && styles.uplinkOk,
            macOnline === false && styles.uplinkBad
          ]}
        >
          {macOnline === true ? 'UPLINK OK' : macOnline === false ? 'UPLINK DOWN' : 'UPLINK —'}
        </Text>
      </View>

      <Text style={styles.expansion}>{APP_EXPANSION}</Text>
      <Text style={styles.status}>{statusLabel}</Text>

      <View style={styles.stage}>
        <View style={[styles.core, coreClass]}>
          <View style={styles.ringOuter} />
          <View style={styles.ringMid} />
          <View style={styles.ringInner} />
          <View style={styles.dot} />
        </View>
        <Text style={styles.phase}>{voicePhase.toUpperCase()}</Text>
        <Text style={styles.voiceStatus}>{voiceStatus}</Text>
      </View>

      <View style={styles.actions}>
        <HudButton
          label={
            !voiceSupported
              ? 'Voice unavailable'
              : engaged
                ? 'TAKE 5 / STANDBY'
                : 'ENGAGE VOICE'
          }
          primary
          disabled={!voiceSupported}
          onPress={onToggleVoice}
        />
        <HudButton label="Open Comm" onPress={onOpenComm} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8
  },
  top: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 4
  },
  brand: {
    fontFamily: fonts.display,
    fontSize: 24,
    letterSpacing: 2,
    color: colors.accentStrong,
    textShadowColor: colors.accentGlow,
    textShadowRadius: 12
  },
  uplink: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.inkMuted
  },
  uplinkOk: { color: colors.ok },
  uplinkBad: { color: colors.danger },
  expansion: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 0.6,
    color: colors.inkFaint,
    marginBottom: 4
  },
  status: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.inkMuted,
    marginBottom: 10
  },
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 0,
    marginBottom: 8
  },
  core: {
    width: 150,
    height: 150,
    borderRadius: 75,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(137, 207, 240, 0.35)',
    backgroundColor: 'rgba(137, 207, 240, 0.06)',
    marginBottom: 12
  },
  coreIdle: {
    shadowColor: colors.accent,
    shadowOpacity: 0.25,
    shadowRadius: 16
  },
  coreLive: {
    borderColor: 'rgba(137, 207, 240, 0.7)',
    shadowColor: colors.accent,
    shadowOpacity: 0.55,
    shadowRadius: 22
  },
  coreSpeaking: {
    borderColor: colors.accentStrong,
    backgroundColor: 'rgba(137, 207, 240, 0.12)',
    shadowColor: colors.accentStrong,
    shadowOpacity: 0.7,
    shadowRadius: 28
  },
  ringOuter: {
    position: 'absolute',
    width: 124,
    height: 124,
    borderRadius: 62,
    borderWidth: 1,
    borderColor: 'rgba(137, 207, 240, 0.35)'
  },
  ringMid: {
    position: 'absolute',
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 1,
    borderColor: 'rgba(137, 207, 240, 0.45)'
  },
  ringInner: {
    position: 'absolute',
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 1,
    borderColor: 'rgba(137, 207, 240, 0.55)'
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.accentStrong,
    shadowColor: colors.accent,
    shadowOpacity: 0.8,
    shadowRadius: 10
  },
  phase: {
    fontFamily: fonts.mono,
    fontSize: 12,
    letterSpacing: 2,
    color: colors.accent,
    marginBottom: 6
  },
  voiceStatus: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.inkMuted,
    textAlign: 'center',
    paddingHorizontal: 20
  },
  actions: {
    gap: 10,
    paddingTop: 4,
    flexShrink: 0
  }
})
