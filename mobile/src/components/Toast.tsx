import { useEffect, useRef } from 'react'
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, fonts, radii, sizes, spacing, typeScale } from '../theme'
import type { HudTone } from './HudCard'
import { useReducedMotion } from './useReducedMotion'

export interface ToastProps {
  visible: boolean
  message: string
  tone?: HudTone
  actionLabel?: string
  onAction?: () => void
  onDismiss?: () => void
  reducedMotion?: boolean
}

export function Toast({
  visible,
  message,
  tone = 'neutral',
  actionLabel,
  onAction,
  onDismiss,
  reducedMotion
}: ToastProps): React.JSX.Element | null {
  const reduceMotion = useReducedMotion(reducedMotion)
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current
  const translate = useRef(new Animated.Value(visible ? 0 : 12)).current

  useEffect(() => {
    const duration = reduceMotion ? 0 : 180
    Animated.parallel([
      Animated.timing(opacity, { toValue: visible ? 1 : 0, duration, useNativeDriver: true }),
      Animated.timing(translate, {
        toValue: visible ? 0 : 12,
        duration,
        useNativeDriver: true
      })
    ]).start()
  }, [opacity, reduceMotion, translate, visible])

  if (!visible) return null
  const toneStyle =
    tone === 'danger'
      ? styles.danger
      : tone === 'warn'
        ? styles.warn
        : tone === 'ok'
          ? styles.ok
          : styles.accent

  return (
    <Animated.View
      accessibilityLiveRegion={tone === 'danger' ? 'assertive' : 'polite'}
      style={[styles.root, toneStyle, { opacity, transform: [{ translateY: translate }] }]}
    >
      <View style={styles.copy}>
        <Text accessibilityRole={tone === 'danger' ? 'alert' : undefined} style={styles.message}>{message}</Text>
      </View>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
      {onDismiss ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss notification"
          onPress={onDismiss}
          style={({ pressed }) => [styles.dismiss, pressed && styles.pressed]}
        >
          <Text allowFontScaling={false} style={styles.dismissText}>×</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  root: {
    minHeight: sizes.minTarget,
    marginHorizontal: spacing.md,
    marginVertical: spacing.xs,
    borderWidth: 1,
    borderRadius: radii.sm,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(4,12,18,0.98)',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8
  },
  accent: { borderColor: colors.lineStrong },
  ok: { borderColor: 'rgba(61,207,122,0.55)' },
  warn: { borderColor: 'rgba(240,184,90,0.6)' },
  danger: { borderColor: 'rgba(255,107,99,0.64)' },
  copy: { flex: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  message: { color: colors.ink, fontFamily: fonts.body, fontSize: typeScale.body, lineHeight: 20 },
  action: { minHeight: sizes.minTarget, justifyContent: 'center', paddingHorizontal: spacing.md },
  actionText: { color: colors.accentStrong, fontFamily: fonts.bodyBold, fontSize: typeScale.body },
  dismiss: { width: sizes.minTarget, height: sizes.minTarget, alignItems: 'center', justifyContent: 'center' },
  dismissText: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: 22 },
  pressed: { opacity: 0.6 }
})
