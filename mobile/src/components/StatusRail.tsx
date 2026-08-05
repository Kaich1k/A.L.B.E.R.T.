import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { MacLinkState, VoicePhase } from '../types'
import { colors, fonts, sizes, spacing, typeScale } from '../theme'

function linkLabel(state: MacLinkState): string {
  if (state === 'authenticated') return 'LINK SECURE'
  if (state === 'syncing') return 'SYNC ACTIVE'
  if (state === 'checking') return 'LINK CHECK'
  if (state === 'enrolling') return 'ENROLLING'
  if (state === 'auth-failed') return 'AUTH FAULT'
  if (state === 'offline') return 'LINK OFFLINE'
  if (state === 'fault') return 'LINK FAULT'
  return 'LINK UNPAIRED'
}

function voiceLabel(phase: VoicePhase): string {
  if (phase === 'permission') return 'MIC PERMISSION'
  if (phase === 'arming') return 'WAKE ARMING'
  return `CORE ${phase.toUpperCase()}`
}

export function StatusRail({
  voicePhase,
  linkState,
  routeLabel = 'AUTO',
  pendingCount = 0,
  lastSyncLabel,
  onPressLink,
  onPressPending
}: {
  voicePhase: VoicePhase
  linkState: MacLinkState
  routeLabel?: string
  pendingCount?: number
  lastSyncLabel?: string
  onPressLink?: () => void
  onPressPending?: () => void
}): React.JSX.Element {
  const hasFault = linkState === 'fault' || linkState === 'auth-failed'
  return (
    <View
      style={styles.root}
      accessibilityLabel={`${voiceLabel(voicePhase)}. ${linkLabel(linkState)}. Route ${routeLabel}. ${pendingCount} pending changes.`}
    >
      <View style={styles.segment}>
        <View
          style={[
            styles.dot,
            voicePhase === 'fault' ? styles.dotBad : voicePhase === 'standby' ? styles.dotIdle : styles.dotLive
          ]}
        />
        <Text style={styles.primary} numberOfLines={1}>
          {voiceLabel(voicePhase)}
        </Text>
      </View>
      <Pressable
        onPress={onPressLink}
        disabled={!onPressLink}
        accessibilityRole={onPressLink ? 'button' : undefined}
        accessibilityLabel={`${linkLabel(linkState)}${lastSyncLabel ? `. ${lastSyncLabel}` : ''}`}
        style={({ pressed }) => [styles.segment, styles.linkSegment, pressed && styles.pressed]}
      >
        <Text style={[styles.secondary, hasFault && styles.bad]} numberOfLines={1}>
          {linkLabel(linkState)}
        </Text>
      </Pressable>
      <View style={[styles.segment, styles.routeSegment]}>
        <Text style={styles.secondary} numberOfLines={1}>
          ROUTE {routeLabel.toUpperCase()}
        </Text>
      </View>
      <Pressable
        onPress={onPressPending}
        disabled={!onPressPending}
        accessibilityRole={onPressPending ? 'button' : undefined}
        accessibilityLabel={`${pendingCount} pending sync changes`}
        style={({ pressed }) => [styles.segment, styles.pendingSegment, pressed && styles.pressed]}
      >
        <Text style={[styles.secondary, pendingCount > 0 && styles.warn]} numberOfLines={1}>
          QUEUE {pendingCount || 'CLEAR'}
        </Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flexShrink: 0,
    minHeight: sizes.minTarget,
    flexDirection: 'row',
    alignItems: 'stretch',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    backgroundColor: 'rgba(1,7,11,0.94)'
  },
  segment: {
    minHeight: sizes.minTarget,
    minWidth: sizes.minTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.lineDim
  },
  linkSegment: { flex: 1.1 },
  routeSegment: { flex: 0.9 },
  pendingSegment: { flex: 0.75 },
  pressed: { backgroundColor: colors.accentSoft },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotIdle: { backgroundColor: colors.inkMuted },
  dotLive: { backgroundColor: colors.accent, shadowColor: colors.accent, shadowOpacity: 0.8, shadowRadius: 6 },
  dotBad: { backgroundColor: colors.danger },
  primary: {
    color: colors.accent,
    fontFamily: fonts.mono,
    fontSize: typeScale.micro - 1,
    letterSpacing: 0.55
  },
  secondary: {
    color: colors.inkMuted,
    fontFamily: fonts.mono,
    fontSize: typeScale.micro - 2,
    letterSpacing: 0.45
  },
  bad: { color: colors.danger },
  warn: { color: colors.warn }
})
