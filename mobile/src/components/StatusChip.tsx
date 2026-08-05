import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import type { HudTone } from './HudCard'
import { colors, fonts, radii, spacing, typeScale } from '../theme'

export function StatusChip({
  label,
  tone = 'neutral',
  pulse = false,
  style
}: {
  label: string
  tone?: HudTone
  pulse?: boolean
  style?: StyleProp<ViewStyle>
}): React.JSX.Element {
  const rootToneStyle =
    tone === 'ok'
      ? styles.ok
      : tone === 'warn'
        ? styles.warn
        : tone === 'danger'
          ? styles.danger
          : tone === 'accent'
            ? styles.accent
            : styles.neutral
  const dotToneStyle =
    tone === 'ok'
      ? styles.dotOk
      : tone === 'warn'
        ? styles.dotWarn
        : tone === 'danger'
          ? styles.dotDanger
          : tone === 'accent'
            ? styles.dotAccent
            : styles.dotNeutral
  const labelToneStyle =
    tone === 'ok'
      ? styles.labelOk
      : tone === 'warn'
        ? styles.labelWarn
        : tone === 'danger'
          ? styles.labelDanger
          : tone === 'accent'
            ? styles.labelAccent
            : styles.labelNeutral
  return (
    <View accessible accessibilityLabel={label} style={[styles.root, rootToneStyle, style]}>
      <View style={[styles.dot, dotToneStyle, pulse && styles.pulse]} />
      <Text style={[styles.label, labelToneStyle]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    minHeight: 28,
    maxWidth: '100%',
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderRadius: radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(0,0,0,0.45)'
  },
  dot: { width: 6, height: 6, borderRadius: 3, borderWidth: 0 },
  pulse: { shadowOpacity: 0.8, shadowRadius: 7, shadowOffset: { width: 0, height: 0 } },
  label: {
    flexShrink: 1,
    fontFamily: fonts.mono,
    fontSize: typeScale.micro,
    letterSpacing: 0.8,
    textTransform: 'uppercase'
  },
  neutral: { borderColor: colors.line },
  accent: { borderColor: colors.lineStrong },
  ok: { borderColor: 'rgba(61,207,122,0.45)' },
  warn: { borderColor: 'rgba(240,184,90,0.48)' },
  danger: { borderColor: 'rgba(255,107,99,0.5)' },
  dotNeutral: { backgroundColor: colors.inkMuted, shadowColor: colors.inkMuted },
  dotAccent: { backgroundColor: colors.accent, shadowColor: colors.accent },
  dotOk: { backgroundColor: colors.ok, shadowColor: colors.ok },
  dotWarn: { backgroundColor: colors.warn, shadowColor: colors.warn },
  dotDanger: { backgroundColor: colors.danger, shadowColor: colors.danger },
  labelNeutral: { color: colors.inkMuted },
  labelAccent: { color: colors.accent },
  labelOk: { color: colors.ok },
  labelWarn: { color: colors.warn },
  labelDanger: { color: colors.danger }
})
