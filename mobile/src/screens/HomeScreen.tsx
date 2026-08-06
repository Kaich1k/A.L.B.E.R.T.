import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { APP_EXPANSION, APP_NAME, APP_PROTOCOL } from '../brand'
import { AlbertCore } from '../components/AlbertCore'
import { HudButton } from '../components/HudButton'
import { HudCard } from '../components/HudCard'
import { StatusChip } from '../components/StatusChip'
import type { ActivityEntry, MacLinkState, Mission, SyncState, VoicePhase } from '../types'
import { colors, fonts, sizes, spacing, typeScale } from '../theme'

export interface HomeScreenProps {
  macOnline?: boolean | null
  linkState?: MacLinkState
  statusLabel: string
  voicePhase: VoicePhase
  voiceStatus: string
  voiceSupported: boolean
  wakeArmed?: boolean
  brainLabel?: string
  modelLabel?: string
  memoryCount?: number
  priorityMission?: Mission | null
  pendingApprovals?: number
  lastActivity?: ActivityEntry | null
  syncState?: SyncState
  reducedMotion?: boolean
  error?: string | null
  onToggleVoice: () => void
  onOpenComm: () => void
  onOpenOperations?: () => void
  onOpenMemory?: () => void
  onOpenSystems?: () => void
  onQuickCapture?: () => void
}

function resolveLinkState(explicit: MacLinkState | undefined, online: boolean | null | undefined): MacLinkState {
  if (explicit) return explicit
  if (online === true) return 'authenticated'
  if (online === false) return 'offline'
  return 'unconfigured'
}

function linkTone(state: MacLinkState): 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' {
  if (state === 'authenticated') return 'ok'
  if (state === 'syncing' || state === 'checking' || state === 'enrolling') return 'accent'
  if (state === 'offline' || state === 'unconfigured') return 'warn'
  return 'danger'
}

function linkCopy(state: MacLinkState): string {
  if (state === 'authenticated') return 'UPLINK SECURE'
  if (state === 'syncing') return 'UPLINK SYNCING'
  if (state === 'checking') return 'CHECKING UPLINK'
  if (state === 'enrolling') return 'ENROLLING DEVICE'
  if (state === 'offline') return 'UPLINK OFFLINE'
  if (state === 'auth-failed') return 'AUTHENTICATION FAULT'
  if (state === 'fault') return 'UPLINK FAULT'
  return 'UPLINK UNPAIRED'
}

export function HomeScreen(props: HomeScreenProps): React.JSX.Element {
  const {
    macOnline,
    statusLabel,
    voicePhase,
    voiceStatus,
    voiceSupported,
    wakeArmed = voicePhase === 'standby',
    brainLabel = 'PHONE · AUTO',
    modelLabel,
    memoryCount = 0,
    priorityMission,
    pendingApprovals = 0,
    lastActivity,
    syncState,
    reducedMotion,
    error,
    onToggleVoice,
    onOpenComm,
    onOpenOperations,
    onOpenMemory,
    onOpenSystems,
    onQuickCapture
  } = props
  const { width, height } = useWindowDimensions()
  const linkState = resolveLinkState(props.linkState, macOnline)
  const wide = width >= sizes.tabletBreakpoint
  const coreSize = Math.max(196, Math.min(wide ? 310 : 270, width - (wide ? 360 : 80), height * 0.38))
  const engaged = voicePhase !== 'standby' && voicePhase !== 'permission' && voicePhase !== 'fault'
  const voiceTone = voicePhase === 'fault' ? 'danger' : engaged ? 'accent' : voiceSupported ? 'ok' : 'warn'
  const openMissionCount = priorityMission ? 1 : 0

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, wide && styles.contentWide]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.topbar}>
        <View style={styles.identity}>
          <Text style={styles.protocol}>{APP_PROTOCOL}</Text>
          <Text style={styles.brand}>{APP_NAME}</Text>
        </View>
        <StatusChip label={linkCopy(linkState)} tone={linkTone(linkState)} pulse={linkState === 'syncing'} />
      </View>
      <Text style={styles.expansion}>{APP_EXPANSION}</Text>

      <View style={[styles.commandStage, wide && styles.commandStageWide]}>
        <View style={[styles.telemetryColumn, !wide && styles.telemetryRow]}>
          <Telemetry label="BRAIN" value={brainLabel} tone="accent" />
          <Telemetry label="VOICE" value={voicePhase.toUpperCase()} tone={voiceTone} />
          <Telemetry label="WAKE" value={wakeArmed ? 'ARMED' : 'STANDBY'} tone={wakeArmed ? 'ok' : 'neutral'} />
        </View>

        <View style={styles.coreStage}>
          <View style={[styles.coreFrame, { width: coreSize, height: coreSize }]}>
            <AlbertCore
              phase={voicePhase}
              wakeArmed={wakeArmed}
              size={coreSize}
              reducedMotion={reducedMotion}
            />
          </View>
          <Text style={styles.phase} accessibilityLiveRegion="polite">
            {voicePhase.toUpperCase()}
          </Text>
          <Text style={[styles.voiceStatus, voicePhase === 'fault' && styles.faultText]} accessibilityLiveRegion="polite">
            {voiceStatus}
          </Text>
        </View>

        <View style={[styles.telemetryColumn, !wide && styles.telemetryRow]}>
          <Telemetry label="MODEL" value={modelLabel || 'ADAPTIVE'} tone="accent" />
          <Telemetry label="MEMORY" value={String(memoryCount)} tone="neutral" />
          <Telemetry
            label="SYNC"
            value={syncState?.outbox.length ? `${syncState.outbox.length} QUEUED` : 'CLEAR'}
            tone={syncState?.outbox.length ? 'warn' : 'ok'}
          />
        </View>
      </View>

      <Text style={styles.status}>{statusLabel}</Text>
      {error ? (
        <HudCard tone="danger" eyebrow="SYSTEM FAULT">
          <Text style={styles.errorText} accessibilityRole="alert">
            {error}
          </Text>
          {onOpenSystems ? (
            <HudButton label="Open Systems" variant="quiet" onPress={onOpenSystems} style={styles.inlineButton} />
          ) : null}
        </HudCard>
      ) : null}

      <View style={[styles.intelDeck, wide && styles.intelDeckWide]}>
        <IntelCard
          eyebrow="PRIORITY OBJECTIVE"
          title={priorityMission?.title || 'NO ACTIVE MISSION'}
          note={priorityMission ? `${priorityMission.progress}% COMPLETE · ${priorityMission.state.toUpperCase()}` : 'OPERATIONS DECK CLEAR'}
          tone={priorityMission?.state === 'blocked' ? 'danger' : 'accent'}
          onPress={onOpenOperations}
          accessibilityLabel={priorityMission ? `Open mission ${priorityMission.title}` : 'Open operations'}
        />
        <IntelCard
          eyebrow="DECISION QUEUE"
          title={`${pendingApprovals} AWAITING YOU`}
          note={pendingApprovals ? 'HUMAN AUTHORITY REQUIRED' : 'AUTHORIZATION CLEAR'}
          tone={pendingApprovals ? 'warn' : 'ok'}
          onPress={onOpenOperations}
          accessibilityLabel={`Open ${pendingApprovals} pending approvals`}
        />
        <IntelCard
          eyebrow="LAST OPERATION"
          title={lastActivity?.toolName.replaceAll('_', ' ').toUpperCase() || 'SYSTEM IDLE'}
          note={lastActivity ? `${lastActivity.ok ? 'VERIFIED' : 'FAILED'} · AUDIT LOG` : `${openMissionCount} ACTIVE OBJECTIVE`}
          tone={lastActivity?.ok === false ? 'danger' : 'neutral'}
          onPress={onOpenOperations}
          accessibilityLabel="Open operations activity"
        />
      </View>

      <View style={[styles.actions, wide && styles.actionsWide]}>
        <HudButton
          label={
            !voiceSupported
              ? 'Voice setup required'
              : engaged
                ? 'TAKE 5 / STANDBY'
                : 'ENGAGE VOICE'
          }
          glyph={engaged ? '■' : '◉'}
          primary
          disabled={!voiceSupported && voicePhase !== 'permission'}
          onPress={onToggleVoice}
          accessibilityHint={engaged ? 'Ends the active voice session' : 'Starts a voice session'}
          style={styles.primaryAction}
        />
        <HudButton label="OPEN COMM" glyph="▤" onPress={onOpenComm} style={styles.secondaryAction} />
        {onQuickCapture ? (
          <HudButton label="CAPTURE" glyph="＋" onPress={onQuickCapture} style={styles.tertiaryAction} />
        ) : null}
        {onOpenMemory ? (
          <HudButton label="MEMORY" glyph="⌁" onPress={onOpenMemory} style={styles.tertiaryAction} />
        ) : null}
      </View>
    </ScrollView>
  )
}

function Telemetry({
  label,
  value,
  tone
}: {
  label: string
  value: string
  tone: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'
}): React.JSX.Element {
  const toneColor =
    tone === 'ok'
      ? colors.ok
      : tone === 'warn'
        ? colors.warn
        : tone === 'danger'
          ? colors.danger
          : tone === 'accent'
            ? colors.accent
            : colors.inkMuted
  return (
    <View style={styles.telemetry} accessible accessibilityLabel={`${label}: ${value}`}>
      <View style={styles.telemetryHeading}>
        <Text style={styles.telemetryLabel}>{label}</Text>
        <Text style={[styles.telemetryValue, { color: toneColor }]} numberOfLines={1}>
          {value}
        </Text>
      </View>
      <View style={styles.meterTrack}>
        <View style={[styles.meterFill, { backgroundColor: toneColor, width: tone === 'warn' || tone === 'danger' ? '54%' : '88%' }]} />
      </View>
    </View>
  )
}

function IntelCard({
  eyebrow,
  title,
  note,
  tone,
  onPress,
  accessibilityLabel
}: {
  eyebrow: string
  title: string
  note: string
  tone: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'
  onPress?: () => void
  accessibilityLabel: string
}): React.JSX.Element {
  return (
    <View style={styles.intelCard}>
      <HudCard tone={tone} compact accessible={false} style={styles.intelCardInner}>
        <Text style={styles.intelEyebrow}>{eyebrow}</Text>
        <Text style={styles.intelTitle} numberOfLines={2}>
          {title}
        </Text>
        <Text style={styles.intelNote}>{note}</Text>
        {onPress ? (
          <HudButton
            label="Inspect"
            variant="quiet"
            compact
            accessibilityLabel={accessibilityLabel}
            onPress={onPress}
            style={styles.inspectButton}
          />
        ) : null}
      </HudCard>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { width: '100%', maxWidth: sizes.contentMax, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xl, gap: spacing.md },
  contentWide: { paddingHorizontal: spacing.xl },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  identity: { flex: 1 },
  protocol: { color: colors.inkFaint, fontFamily: fonts.mono, fontSize: typeScale.micro, letterSpacing: 1.15 },
  brand: { marginTop: 2, color: colors.accentStrong, fontFamily: fonts.display, fontSize: typeScale.title, letterSpacing: 2.4, textShadowColor: colors.accentGlow, textShadowRadius: 10 },
  expansion: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: typeScale.micro, lineHeight: 15, letterSpacing: 0.4 },
  commandStage: { width: '100%', alignItems: 'center', gap: spacing.sm },
  commandStageWide: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  telemetryColumn: { width: 150, gap: spacing.lg },
  telemetryRow: { width: '100%', flexDirection: 'row', gap: spacing.sm },
  telemetry: { flex: 1, minWidth: 0, gap: spacing.xs },
  telemetryHeading: { gap: 2 },
  telemetryLabel: { color: colors.inkFaint, fontFamily: fonts.mono, fontSize: 9, letterSpacing: 0.8 },
  telemetryValue: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.35 },
  meterTrack: { height: 2, backgroundColor: colors.lineDim },
  meterFill: { height: 2 },
  coreStage: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center'
  },
  coreFrame: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center'
  },
  phase: {
    marginTop: spacing.sm,
    color: colors.accentStrong,
    fontFamily: fonts.displayMed,
    fontSize: 15,
    letterSpacing: 2,
    textAlign: 'center',
    alignSelf: 'center'
  },
  voiceStatus: {
    marginTop: spacing.xs,
    color: colors.inkMuted,
    fontFamily: fonts.body,
    fontSize: typeScale.body,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 420,
    alignSelf: 'center'
  },
  faultText: { color: colors.danger },
  status: { color: colors.inkMuted, fontFamily: fonts.body, fontSize: typeScale.body, textAlign: 'center' },
  errorText: { color: colors.ink, fontFamily: fonts.body, fontSize: typeScale.body, lineHeight: 21 },
  inlineButton: { alignSelf: 'flex-start', marginTop: spacing.sm },
  intelDeck: { gap: spacing.sm },
  intelDeckWide: { flexDirection: 'row' },
  intelCard: { flex: 1, minWidth: 0 },
  intelCardInner: { minHeight: 128 },
  intelEyebrow: { color: colors.accent, fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1 },
  intelTitle: { marginTop: spacing.xs, color: colors.ink, fontFamily: fonts.bodyBold, fontSize: 17, lineHeight: 20 },
  intelNote: { marginTop: spacing.xs, color: colors.inkMuted, fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.35 },
  inspectButton: { alignSelf: 'flex-start', marginTop: 'auto' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  actionsWide: { justifyContent: 'center' },
  primaryAction: { flexGrow: 2, flexBasis: 210 },
  secondaryAction: { flexGrow: 1, flexBasis: 145 },
  tertiaryAction: { flexGrow: 1, flexBasis: 110 }
})
