import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { APP_NAME, APP_PRIVACY_LINE, APP_PROTOCOL } from '../brand'
import { colors, fonts, radii, sizes, spacing, typeScale } from '../theme'
import { AlbertCore } from './AlbertCore'
import { HudButton } from './HudButton'
import { useReducedMotion } from './useReducedMotion'

const STAGES = [
  ['SYS.01', 'INTERFACE SHELL', 'Native display matrix initialized'],
  ['CORE.02', 'COGNITIVE CORE', 'Routing and provider matrix inspected'],
  ['MEM.03', 'MEMORY MATRIX', 'Local context index mounted'],
  ['LINK.04', 'VOICE & UPLINK', 'Secure interfaces standing by'],
  ['READY', 'INTERFACE READY', 'All available systems responding']
] as const

export interface StartupSequenceProps {
  visible?: boolean
  ready?: boolean
  brainConfigured?: boolean
  operatorName?: string
  fault?: string | null
  reducedMotion?: boolean
  onComplete?: () => void
  onRetry?: () => void
  onContinueOffline?: () => void
}

export function StartupSequence({
  visible = true,
  ready = true,
  brainConfigured = true,
  operatorName = 'sir',
  fault,
  reducedMotion,
  onComplete,
  onRetry,
  onContinueOffline
}: StartupSequenceProps): React.JSX.Element | null {
  const reduceMotion = useReducedMotion(reducedMotion)
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const [rendered, setRendered] = useState(visible)
  const [stageIndex, setStageIndex] = useState(0)
  const leavingRef = useRef(false)
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current
  const coreScale = useRef(new Animated.Value(reduceMotion ? 1 : 0.78)).current
  const stage = STAGES[stageIndex]
  const shortPhone = height < 740
  const coreSize = Math.max(
    shortPhone ? 140 : 168,
    Math.min(shortPhone ? 190 : 230, width - 112, height * (shortPhone ? 0.28 : 0.34))
  )

  const greeting = useMemo(() => {
    const hour = new Date().getHours()
    const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
    return `${hello}, ${operatorName.trim() || 'sir'}.`
  }, [operatorName])

  const finish = useCallback(() => {
    if (leavingRef.current) return
    leavingRef.current = true
    Animated.timing(opacity, {
      toValue: 0,
      duration: reduceMotion ? 0 : 260,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true
    }).start(() => {
      setRendered(false)
      onComplete?.()
    })
  }, [onComplete, opacity, reduceMotion])

  useEffect(() => {
    if (!visible) {
      if (rendered) finish()
      return
    }
    leavingRef.current = false
    setRendered(true)
    setStageIndex(0)
    opacity.setValue(1)
    coreScale.setValue(reduceMotion ? 1 : 0.78)
    Animated.spring(coreScale, {
      toValue: 1,
      damping: 13,
      stiffness: 85,
      mass: 0.8,
      useNativeDriver: true
    }).start()
    // This effect intentionally follows the externally controlled visibility only.
    // Internal fade completion must not re-open the sequence while `visible` remains true.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  useEffect(() => {
    if (!visible || !rendered || fault) return
    if (reduceMotion) {
      setStageIndex(STAGES.length - 1)
      return
    }
    const marks = [0, 360, 760, 1_170, 1_620]
    const timers = marks.map((delay, index) => setTimeout(() => setStageIndex(index), delay))
    return () => timers.forEach(clearTimeout)
  }, [fault, reduceMotion, rendered, visible])

  useEffect(() => {
    if (!visible || !rendered || fault || !ready || stageIndex !== STAGES.length - 1) return
    const timer = setTimeout(finish, reduceMotion ? 450 : 980)
    return () => clearTimeout(timer)
  }, [fault, finish, ready, reduceMotion, rendered, stageIndex, visible])

  if (!rendered) return null

  const title = fault
    ? 'STARTUP INTERRUPTED'
    : stageIndex === STAGES.length - 1 && !brainConfigured
      ? 'CORE AWAITING PROVIDER'
      : stage[1]
  const detail = fault
    ? fault
    : stageIndex === STAGES.length - 1
      ? `${greeting} ${brainConfigured ? 'Standing by.' : 'Systems is ready for configuration.'}`
      : stage[2]

  return (
    <Animated.View
      accessibilityViewIsModal
      style={[
        styles.root,
        {
          opacity,
          paddingTop: Math.max(insets.top, spacing.md) + spacing.sm,
          paddingBottom: Math.max(insets.bottom, spacing.md),
          paddingLeft: Math.max(insets.left, spacing.md),
          paddingRight: Math.max(insets.right, spacing.md)
        }
      ]}
    >
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={styles.beamOne} />
        <View style={styles.beamTwo} />
        <View style={styles.horizon} />
      </View>

      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>ADVANCED INTELLIGENCE INTERFACE</Text>
          <Text style={styles.brand}>{APP_NAME}</Text>
        </View>
        <View style={styles.sequenceId}>
          <Text style={styles.sequenceLabel}>BOOT SEQUENCE</Text>
          <Text style={styles.sequenceCount}>
            {String(stageIndex + 1).padStart(2, '0')} / {String(STAGES.length).padStart(2, '0')}
          </Text>
        </View>
      </View>

      <View style={[styles.stage, shortPhone && styles.stageCompact]}>
        <Animated.View style={{ transform: [{ scale: coreScale }] }}>
          <AlbertCore
            phase={fault ? 'fault' : ready && stageIndex === STAGES.length - 1 ? 'standby' : 'arming'}
            size={coreSize}
            reducedMotion={reduceMotion}
            label="Albert startup core"
          />
        </Animated.View>
      </View>

      <View
        accessibilityLiveRegion="polite"
        style={[styles.readout, fault && styles.readoutFault]}
      >
        <Text style={[styles.stageCode, fault && styles.faultText]}>
          {fault ? 'FAULT' : stage[0]}
        </Text>
        <Text accessibilityRole="header" style={styles.title}>{title}</Text>
        <Text
          accessibilityRole={fault ? 'alert' : undefined}
          numberOfLines={fault ? 5 : 3}
          style={styles.detail}
        >
          {detail}
        </Text>
        {!fault ? (
          <>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${ready ? ((stageIndex + 1) / STAGES.length) * 100 : Math.min(92, ((stageIndex + 1) / STAGES.length) * 100)}%` }
                ]}
              />
            </View>
            <View style={styles.dots}>
              {STAGES.map((item, index) => (
                <View key={item[0]} style={[styles.dot, index <= stageIndex && styles.dotOn]} />
              ))}
            </View>
          </>
        ) : (
          <View style={styles.faultActions}>
            {onRetry ? <HudButton label="Retry startup" primary onPress={onRetry} /> : null}
            {onContinueOffline ? (
              <HudButton label="Continue offline" onPress={onContinueOffline} />
            ) : null}
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.privacy}>{APP_PRIVACY_LINE}</Text>
        <Text style={styles.protocol}>{APP_PROTOCOL}</Text>
        {!fault ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Skip startup sequence"
            onPress={finish}
            style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
          >
            <Text style={styles.skipText}>SKIP</Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 100,
    backgroundColor: '#00070b',
    overflow: 'hidden'
  },
  beamOne: {
    position: 'absolute',
    top: -100,
    left: '8%',
    width: 2,
    height: '72%',
    backgroundColor: 'rgba(137,207,240,0.13)',
    transform: [{ rotate: '16deg' }]
  },
  beamTwo: {
    position: 'absolute',
    top: -90,
    right: '12%',
    width: 1,
    height: '74%',
    backgroundColor: 'rgba(137,207,240,0.1)',
    transform: [{ rotate: '-13deg' }]
  },
  horizon: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '57%',
    height: 1,
    backgroundColor: colors.line
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  headerCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.accent, fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.15 },
  brand: {
    marginTop: spacing.xs,
    color: colors.accentStrong,
    fontFamily: fonts.display,
    fontSize: typeScale.title,
    letterSpacing: 2.2,
    textShadowColor: colors.accentGlow,
    textShadowRadius: 10
  },
  sequenceId: { alignItems: 'flex-end', flexShrink: 0 },
  sequenceLabel: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.8 },
  sequenceCount: { marginTop: spacing.xs, color: colors.accent, fontFamily: fonts.mono, fontSize: 14 },
  stage: { flex: 1, minHeight: 120, alignItems: 'center', justifyContent: 'center' },
  stageCompact: { minHeight: 100 },
  readout: {
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radii.lg,
    backgroundColor: 'rgba(3,12,18,0.9)',
    padding: spacing.lg,
    alignItems: 'center',
    overflow: 'hidden'
  },
  readoutFault: { borderColor: 'rgba(255,107,99,0.6)', backgroundColor: colors.dangerSoft },
  stageCode: { color: colors.accent, fontFamily: fonts.mono, fontSize: 12, letterSpacing: 1.5 },
  faultText: { color: colors.danger },
  title: {
    marginTop: spacing.sm,
    color: colors.ink,
    fontFamily: fonts.displayMed,
    fontSize: typeScale.bodyLarge,
    letterSpacing: 1.2,
    textAlign: 'center'
  },
  detail: {
    marginTop: spacing.xs,
    color: colors.inkMuted,
    fontFamily: fonts.body,
    fontSize: typeScale.body,
    lineHeight: 21,
    textAlign: 'center'
  },
  progressTrack: { marginTop: spacing.lg, width: '100%', height: 2, backgroundColor: colors.lineDim },
  progressFill: { height: 2, backgroundColor: colors.accent, shadowColor: colors.accent, shadowOpacity: 0.7, shadowRadius: 5 },
  dots: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.line },
  dotOn: { backgroundColor: colors.accent },
  faultActions: { width: '100%', gap: spacing.sm, marginTop: spacing.lg },
  footer: {
    minHeight: sizes.minTarget,
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  privacy: { flex: 1, color: colors.inkFaint, fontFamily: fonts.mono, fontSize: 9, letterSpacing: 0.45 },
  protocol: { color: colors.inkFaint, fontFamily: fonts.mono, fontSize: 9, letterSpacing: 0.45 },
  skip: { minWidth: sizes.minTarget, minHeight: sizes.minTarget, alignItems: 'center', justifyContent: 'center' },
  skipText: { color: colors.accent, fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1 },
  pressed: { opacity: 0.55 }
})
