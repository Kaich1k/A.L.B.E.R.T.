import { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, AppState, Easing, StyleSheet, Text, View } from 'react-native'
import type { VoicePhase } from '../types'
import { colors, fonts, shadows } from '../theme'
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
    breathe.stopAnimation()
    if (reduceMotion || !appActive) {
      spin.setValue(0)
      reverseSpin.setValue(0)
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
    breath.start()
    return () => {
      forward.stop()
      reverse.stop()
      breath.stop()
    }
  }, [activity, appActive, breathe, phase, reduceMotion, reverseSpin, spin])

  const dimensions = useMemo(() => {
    const clamped = Math.max(176, Math.min(330, size))
    return {
      shell: clamped,
      outer: clamped * 0.86,
      mid: clamped * 0.66,
      inner: clamped * 0.43,
      core: clamped * 0.24
    }
  }, [size])

  const forwardRotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })
  const reverseRotate = reverseSpin.interpolate({
    inputRange: [0, 1],
    outputRange: ['360deg', '0deg']
  })
  const pulseScale = breathe.interpolate({
    inputRange: [0, 1],
    outputRange: [1, activity ? 1.075 : 1.035]
  })
  const pulseOpacity = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.56, 1] })

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={
        label ??
        `Albert core, ${PHASE_COPY[phase]}${wakeArmed && phase === 'standby' ? ', wake phrase armed' : ''}`
      }
      style={[styles.shell, { width: dimensions.shell, height: dimensions.shell }]}
    >
      <View pointerEvents="none" accessible={false} style={StyleSheet.absoluteFill}>
        <Animated.View
          style={[
            styles.ring,
            styles.outerRing,
            {
              width: dimensions.outer,
              height: dimensions.outer,
              borderRadius: dimensions.outer / 2,
              transform: [{ rotate: forwardRotate }]
            }
          ]}
        >
          <View style={[styles.orbitNode, styles.nodeTop, fault && styles.nodeFault]} />
          <View style={[styles.orbitNode, styles.nodeBottom, fault && styles.nodeFault]} />
        </Animated.View>

        <View
          style={[
            styles.tickField,
            { width: dimensions.outer * 0.92, height: dimensions.outer * 0.92 }
          ]}
        >
          {TICKS.map((tick) => (
            <View
              key={tick}
              style={[styles.tickArm, { transform: [{ rotate: `${tick * 15}deg` }] }]}
            >
              <View style={[styles.tick, tick % 3 === 0 && styles.tickMajor]} />
            </View>
          ))}
        </View>

        <Animated.View
          style={[
            styles.ring,
            styles.midRing,
            {
              width: dimensions.mid,
              height: dimensions.mid,
              borderRadius: dimensions.mid / 2,
              transform: [{ rotate: reverseRotate }]
            }
          ]}
        >
          <View style={[styles.arc, styles.arcOne, fault && styles.arcFault]} />
          <View style={[styles.arc, styles.arcTwo, fault && styles.arcFault]} />
        </Animated.View>

        <View
          style={[
            styles.ring,
            styles.innerRing,
            {
              width: dimensions.inner,
              height: dimensions.inner,
              borderRadius: dimensions.inner / 2,
              borderColor: fault ? 'rgba(255,107,99,0.6)' : 'rgba(137,207,240,0.58)'
            }
          ]}
        />
        <View style={[styles.crosshairHorizontal, { width: dimensions.outer * 0.72 }]} />
        <View style={[styles.crosshairVertical, { height: dimensions.outer * 0.72 }]} />

        <Animated.View
          style={[
            styles.coreGlow,
            {
              width: dimensions.core * 1.7,
              height: dimensions.core * 1.7,
              borderRadius: dimensions.core,
              marginTop: -dimensions.core * 0.85,
              backgroundColor: fault ? 'rgba(255,107,99,0.12)' : 'rgba(137,207,240,0.12)',
              opacity: pulseOpacity,
              transform: [{ scale: pulseScale }]
            }
          ]}
        />
        <Animated.View
          style={[
            styles.core,
            shadows.glowStrong,
            {
              width: dimensions.core,
              height: dimensions.core,
              borderRadius: dimensions.core / 2,
              marginTop: -dimensions.core / 2,
              borderColor: coreColor,
              shadowColor: coreColor,
              opacity: pulseOpacity,
              transform: [{ scale: pulseScale }]
            }
          ]}
        >
          <Text
            allowFontScaling={false}
            style={[
              styles.monogram,
              { color: coreColor, fontSize: dimensions.core * 0.4, textShadowColor: coreColor }
            ]}
          >
            A
          </Text>
        </Animated.View>

        <View style={[styles.wave, { top: dimensions.shell * 0.68 }]}>
          {WAVE.map((height, index) => (
            <View
              key={index}
              style={[
                styles.waveBar,
                {
                  height: 5 + 18 * height * (phase === 'speaking' ? safeAmplitude : activity ? 0.62 : 0.24),
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
  shell: { alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', alignSelf: 'center', top: '50%', marginTop: 0 },
  outerRing: {
    top: '7%',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(137,207,240,0.42)'
  },
  midRing: {
    top: '17%',
    borderWidth: 1,
    borderColor: 'rgba(137,207,240,0.34)'
  },
  innerRing: { top: '28.5%', borderWidth: 1 },
  tickField: { position: 'absolute', top: '10%', alignSelf: 'center' },
  tickArm: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center' },
  tick: { width: 1, height: 5, backgroundColor: 'rgba(137,207,240,0.4)' },
  tickMajor: { width: 2, height: 9, backgroundColor: 'rgba(184,228,248,0.82)' },
  orbitNode: {
    position: 'absolute',
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.accentStrong,
    shadowColor: colors.accent,
    shadowOpacity: 0.9,
    shadowRadius: 7
  },
  nodeTop: { top: -4, left: '50%', marginLeft: -3.5 },
  nodeBottom: { bottom: -4, left: '50%', marginLeft: -3.5 },
  nodeFault: { backgroundColor: colors.danger, shadowColor: colors.danger },
  arc: {
    position: 'absolute',
    width: '54%',
    height: '54%',
    borderColor: colors.accent,
    borderWidth: 2
  },
  arcOne: { top: -2, left: -2, borderRightColor: 'transparent', borderBottomColor: 'transparent' },
  arcTwo: {
    right: -2,
    bottom: -2,
    borderLeftColor: 'transparent',
    borderTopColor: 'transparent'
  },
  arcFault: { borderColor: colors.danger },
  crosshairHorizontal: {
    position: 'absolute',
    alignSelf: 'center',
    top: '49.8%',
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(137,207,240,0.28)'
  },
  crosshairVertical: {
    position: 'absolute',
    alignSelf: 'center',
    top: '14%',
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(137,207,240,0.28)'
  },
  coreGlow: { position: 'absolute', alignSelf: 'center', top: '50%' },
  core: {
    position: 'absolute',
    alignSelf: 'center',
    top: '50%',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    backgroundColor: 'rgba(10,39,55,0.94)'
  },
  monogram: { fontFamily: fonts.displayMed, textShadowRadius: 8 },
  wave: {
    position: 'absolute',
    alignSelf: 'center',
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4
  },
  waveBar: { width: 2, borderRadius: 1, opacity: 0.8 }
})
