import { Pressable, StyleSheet, Text, ViewStyle } from 'react-native'
import { colors, fonts } from '../theme'

export function HudButton({
  label,
  onPress,
  primary,
  disabled,
  style
}: {
  label: string
  onPress: () => void
  primary?: boolean
  disabled?: boolean
  style?: ViewStyle
}): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={({ pressed }) => [
        styles.btn,
        primary && styles.primary,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style
      ]}
    >
      <Text style={[styles.label, primary && styles.labelPrimary]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  btn: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center'
  },
  primary: {
    borderColor: 'rgba(137, 207, 240, 0.75)',
    backgroundColor: colors.accentSoft
  },
  disabled: {
    opacity: 0.45
  },
  pressed: {
    opacity: 0.75,
    backgroundColor: 'rgba(137, 207, 240, 0.22)'
  },
  label: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    letterSpacing: 0.5,
    color: colors.ink
  },
  labelPrimary: {
    color: colors.accentStrong
  }
})
