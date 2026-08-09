import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle
} from 'react-native'
import { colors, fonts, radii, sizes, spacing, typeScale } from '../theme'

export type HudButtonVariant = 'ghost' | 'primary' | 'quiet' | 'danger'

export function HudButton({
  label,
  onPress,
  primary,
  variant,
  disabled,
  loading = false,
  selected = false,
  compact = false,
  glyph,
  accessibilityLabel,
  accessibilityHint,
  style
}: {
  label: string
  onPress: () => void
  /** Backwards-compatible alias for variant="primary". */
  primary?: boolean
  variant?: HudButtonVariant
  disabled?: boolean
  loading?: boolean
  selected?: boolean
  compact?: boolean
  glyph?: string
  accessibilityLabel?: string
  accessibilityHint?: string
  style?: StyleProp<ViewStyle>
}): React.JSX.Element {
  const resolvedVariant = variant ?? (primary ? 'primary' : 'ghost')
  const unavailable = Boolean(disabled || loading)
  return (
    <Pressable
      onPress={onPress}
      disabled={unavailable}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: unavailable, busy: loading, selected }}
      style={({ pressed }) => [
        styles.btn,
        compact && styles.compact,
        resolvedVariant === 'primary' && styles.primary,
        resolvedVariant === 'quiet' && styles.quiet,
        resolvedVariant === 'danger' && styles.danger,
        selected && styles.selected,
        unavailable && styles.disabled,
        pressed && !unavailable && styles.pressed,
        style
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={resolvedVariant === 'danger' ? colors.danger : colors.accentStrong}
        />
      ) : glyph ? (
        <Text
          allowFontScaling={false}
          style={[styles.glyph, resolvedVariant === 'danger' && styles.labelDanger]}
        >
          {glyph}
        </Text>
      ) : null}
      <Text
        style={[
          styles.label,
          resolvedVariant === 'primary' && styles.labelPrimary,
          resolvedVariant === 'quiet' && styles.labelQuiet,
          resolvedVariant === 'danger' && styles.labelDanger
        ]}
        numberOfLines={2}
      >
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  btn: {
    position: 'relative',
    minHeight: sizes.minTarget,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.sm,
    backgroundColor: 'rgba(0, 5, 9, 0.72)',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    overflow: 'hidden'
  },
  compact: { minHeight: sizes.minTarget, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  primary: {
    borderColor: 'rgba(137, 207, 240, 0.78)',
    backgroundColor: 'rgba(45, 125, 163, 0.25)',
    shadowColor: colors.accent,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2
  },
  quiet: { borderColor: 'transparent', backgroundColor: 'transparent' },
  danger: { borderColor: 'rgba(255,107,99,0.55)', backgroundColor: colors.dangerSoft },
  selected: { borderColor: colors.accentStrong, backgroundColor: colors.accentSoft },
  disabled: { opacity: 0.42 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.985 }] },
  glyph: {
    minWidth: 18,
    color: colors.accent,
    fontFamily: fonts.mono,
    fontSize: 18,
    textAlign: 'center'
  },
  label: {
    flexShrink: 1,
    fontFamily: fonts.bodyBold,
    fontSize: typeScale.body,
    lineHeight: 19,
    letterSpacing: 0.55,
    color: colors.ink,
    textAlign: 'center'
  },
  labelPrimary: { color: colors.accentStrong },
  labelQuiet: { color: colors.inkMuted },
  labelDanger: { color: colors.danger }
})
