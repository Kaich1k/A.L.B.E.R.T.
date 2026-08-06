import { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, AppState, Easing, StyleSheet, View } from 'react-native'
import type { VoicePhase } from '../types'
import { colors, shadows } from '../theme'
import { useReducedMotion } from './useReducedMotion'

const TICKS = Array.from({ length: 24 }, (_, index) => index)
const WAVE = [0.34, 0.7, 0.48, 1, 0.58, 0.78, 0.38]

const PHASE_COPY: Record<VoicePhase, string> = {
  standby: 'standing by',
  permission: 'microphone permission required',
  arming: 'arming wake listener',
  listening: 'listening',
  thinking: 'processing',
  speaking: 'speaking',
  fault: 'voice fault'
}

export interface AlbertCoreProps {
  phase: VoicePhase
  size?: number
  wakeArmed?: boolean
  reducedMotion?: boolean
  label?: string
  amplitude?: number
}

/** Pixel-perfect center inside a known square shell (avoids % left/top RN quirks). */
function centerInShell(shell: number, diameter: number) {
  const offset = (shell - diameter) / 2
  return {
    position: 'absolute' as const,
    width: diameter,
    height: diameter,
    left: offset,
    top: offset,
    borderRadius: diameter / 2
  }
}

export function AlbertCore({
  phase,
  size = 248,
  wakeArmed = false,
  reducedMotion,
  label,
  amplitude = 0.55
}: AlbertCoreProps): React.JSX.Element {
  const reduceMotion = useReducedMotion(reducedMotion)
  const [appActive, setAppActive] = useState(AppState.currentState === 'active')
  const spin = useRef(new Animated.Value(0)).current
  const reverseSpin = useRef(new Animated.Value(0)).current
  const slowSpin = useRef(new Animated.Value(0)).current
  const breathe = useRef(new Animated.Value(0)).current
  const activity = phase === 'listening' || phase === 'thinking' || phase === 'speaking'
  const fault = phase === 'fault'
  const coreColor = fault ? colors.danger : phase === 'permission' ? colors.warn : colors.accent
  const safeAmplitude = Math.max(0.16, Math.min(1, amplitude))

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setAppActive(state === 'active'))
    return () => subscription.remove()
  }, [])

  useEffect(() => {
    spin.stopAnimation()
    reverseSpin.stopAnimation()
    slowSpin.stopAnimation()
    breathe.stopAnimation()
    if (reduceMotion || !appActive) {
      spin.setValue(0)
      reverseSpin.setValue(0)
      slowSpin.setValue(0)
      breathe.setValue(activity ? 0.8 : 0.35)
      return
    }

    const spinDuration = phase === 'thinking' ? 2_800 : phase === 'listening' ? 5_400 : 8_500
    const forward = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: spinDuration,
        easing: Easing.linear,
        useNativeDriver: true
      })
    )
    const reverse = Animated.loop(
      Animated.timing(reverseSpin, {
        toValue: 1,
        duration: Math.round(spinDuration * 1.35),
        easing: Easing.linear,
        useNativeDriver: true
      })
    )
    const slow = Animated.loop(
      Animated.timing(slowSpin, {
        toValue: 1,
        duration: Math.round(spinDuration * 2.2),
        easing: Easing.linear,
        useNativeDriver: true
      })
    )
    const breath = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: phase === 'speaking' ? 380 : activity ? 650 : 1_650,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: phase === 'speaking' ? 380 : activity ? 650 : 1_650,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true
        })
      ])
    )
    forward.start()
    reverse.start()
    slow.start()
    breath.start()
    return () => {
      forward.stop()
      reverse.stop()
      slow.stop()
      breath.stop()
    }
  }, [activity, appActive, breathe, phase, reduceMotion, reverseSpin, slowSpin, spin])

  const d = useMemo(() => {
    const shell = Math.max(176, Math.min(330, size))
    return {
      shell,
      wash: shell * 0.92,
      sweep: shell * 0.94,
      outer: shell * 0.84,
      ticks: shell * 0.78,
      mid: shell * 0.64,
      dotted: shell * 0.5,
      inner: shell * 0.42,
      core: shell * 0.34,
      glow: shell * 0.48,
      cross: shell * 0.58
    }
  }, [size])

  const forwardRotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })
  const reverseRotate = reverseSpin.interpolate({
    inputRange: [0, 1],
    outputRange: ['360deg', '0deg']
  })
  const slowRotate = slowSpin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg']
  })
  const pulseScale = breathe.interpolate({
    inputRange: [0, 1],
    outputRange: [1, activity ? 1.05 : 1.03]
  })
  const pulseOpacity = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.78, 1] })

  const midX = d.shell / 2

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={
        label ??
        `Albert core, ${PHASE_COPY[phase]}${wakeArmed && phase === 'standby' ? ', wake phrase armed' : ''}`
      }
      style={[styles.shell, { width: d.shell, height: d.shell }]}
    >
      <View pointerEvents="none" accessible={false} style={styles.stage}>
        {/* Soft wash inside the wheel only — not a separate screen-level disc */}
        <View
          style={[
            styles.wash,
            centerInShell(d.shell, d.wash),
            { backgroundColor: fault ? 'rgba(255,107,99,0.1)' : 'rgba(34, 110, 149, 0.22)' }
          ]}
        />

        <Animated.View
          style={[
            styles.sweepRing,
            fault && styles.sweepRingFault,
            centerInShell(d.shell, d.sweep),
            { transform: [{ rotate: slowRotate }] }
          ]}
        />

        <Animated.View
          style={[
            styles.outerRing,
            centerInShell(d.shell, d.outer),
            { transform: [{ rotate: forwardRotate }] }
          ]}
        >
          <View style={[styles.orbitNode, styles.nodeN, fault && styles.nodeFault]} />
          <View style={[styles.orbitNode, styles.nodeS, fault && styles.nodeFault]} />
        </Animated.View>

        <View style={centerInShell(d.shell, d.ticks)}>
          {TICKS.map((tick) => (
            <View key={tick} style={[styles.tickArm, { transform: [{ rotate: `${tick * 15}deg` }] }]}>
              <View style={[styles.tick, tick % 3 === 0 && styles.tickMajor]} />
            </View>
          ))}
        </View>

        <Animated.View
          style={[
            styles.midRing,
            centerInShell(d.shell, d.mid),
            { transform: [{ rotate: reverseRotate }] }
          ]}
        >
          <View style={[styles.cardinalDot, styles.cardinalN, fault && styles.nodeFault]} />
          <View style={[styles.cardinalDot, styles.cardinalE, fault && styles.nodeFault]} />
          <View style={[styles.cardinalDot, styles.cardinalS, fault && styles.nodeFault]} />
          <View style={[styles.cardinalDot, styles.cardinalW, fault && styles.nodeFault]} />
        </Animated.View>

        <View style={[styles.dottedRing, centerInShell(d.shell, d.dotted)]} />
        <View
          style={[
            styles.innerRing,
            centerInShell(d.shell, d.inner),
            { borderColor: fault ? 'rgba(255,107,99,0.6)' : 'rgba(137,207,240,0.58)' }
          ]}
        />

        <View
          style={[
            styles.crosshairH,
            {
              width: d.cross,
              left: midX - d.cross / 2,
              top: midX - StyleSheet.hairlineWidth / 2
            }
          ]}
        />
        <View
          style={[
            styles.crosshairV,
            {
              height: d.cross,
              left: midX - StyleSheet.hairlineWidth / 2,
              top: midX - d.cross / 2
            }
          ]}
        />

        <Animated.View
          style={[
            styles.coreGlow,
            centerInShell(d.shell, d.glow),
            {
              backgroundColor: fault ? 'rgba(255,107,99,0.12)' : 'rgba(137,207,240,0.16)',
              opacity: pulseOpacity,
              transform: [{ scale: pulseScale }]
            }
          ]}
        />
        <Animated.View
          style={[
            styles.core,
            shadows.glowStrong,
            centerInShell(d.shell, d.core),
            {
              borderColor: fault ? 'rgba(255,107,99,0.55)' : 'rgba(184,228,248,0.5)',
              shadowColor: coreColor,
              backgroundColor: fault ? 'rgba(72, 16, 14, 0.9)' : 'rgba(12, 52, 72, 0.88)',
              opacity: pulseOpacity,
              transform: [{ scale: pulseScale }]
            }
          ]}
        />

        <View
          style={[
            styles.wave,
            {
              width: 56,
              left: midX - 28,
              top: midX + d.inner * 0.28
            }
          ]}
        >
          {WAVE.map((height, index) => (
            <View
              key={index}
              style={[
                styles.waveBar,
                {
                  height: 5 + 16 * height * (phase === 'speaking' ? safeAmplitude : activity ? 0.62 : 0.24),
                  backgroundColor: fault ? colors.danger : colors.accent
                }
              ]}
            />
          ))}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  shell: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible'
  },
  stage: {
    width: '100%',
    height: '100%'
  },
  wash: {},
  sweepRing: {
    borderWidth: 2,
    borderColor: 'transparent',
    borderTopColor: 'rgba(137,207,240,0.82)',
    borderRightColor: 'rgba(137,207,240,0.18)',
    borderBottomColor: 'rgba(137,207,240,0.42)',
    shadowColor: colors.accent,
    shadowOpacity: 0.4,
    shadowRadius: 6
  },
  sweepRingFault: {
    borderTopColor: 'rgba(255,107,99,0.82)',
    borderRightColor: 'rgba(255,107,99,0.18)',
    borderBottomColor: 'rgba(255,107,99,0.42)',
    shadowColor: colors.danger
  },
  outerRing: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(137,207,240,0.42)'
  },
  midRing: {
    borderWidth: 1,
    borderColor: 'rgba(137,207,240,0.5)'
  },
  dottedRing: {
    borderWidth: 1,
    borderStyle: 'dotted',
    borderColor: 'rgba(137,207,240,0.4)'
  },
  innerRing: {
    borderWidth: 1
  },
  tickArm: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center'
  },
  tick: {
    width: 1,
    height: 5,
    backgroundColor: 'rgba(137,207,240,0.4)'
  },
  tickMajor: {
    width: 2,
    height: 9,
    backgroundColor: 'rgba(184,228,248,0.82)'
  },
  orbitNode: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accentStrong,
    shadowColor: colors.accent,
    shadowOpacity: 0.9,
    shadowRadius: 7
  },
  nodeN: { top: -3, left: '50%', marginLeft: -3 },
  nodeS: { bottom: -3, left: '50%', marginLeft: -3 },
  nodeFault: { backgroundColor: colors.danger, shadowColor: colors.danger },
  cardinalDot: {
    position: 'absolute',
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.accentStrong,
    shadowColor: colors.accent,
    shadowOpacity: 0.85,
    shadowRadius: 6
  },
  cardinalN: { top: -2.5, left: '50%', marginLeft: -2.5 },
  cardinalE: { right: -2.5, top: '50%', marginTop: -2.5 },
  cardinalS: { bottom: -2.5, left: '50%', marginLeft: -2.5 },
  cardinalW: { left: -2.5, top: '50%', marginTop: -2.5 },
  crosshairH: {
    position: 'absolute',
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(137,207,240,0.3)'
  },
  crosshairV: {
    position: 'absolute',
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(137,207,240,0.3)'
  },
  coreGlow: {},
  core: {
    borderWidth: 1
  },
  wave: {
    position: 'absolute',
    height: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4
  },
  waveBar: {
    width: 2,
    borderRadius: 1,
    opacity: 0.8
  }
})
