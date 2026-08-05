import type { ReactNode } from 'react'
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { colors, fonts, radii, spacing, typeScale } from '../theme'

export type HudTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'

export function HudCard({
  children,
  eyebrow,
  title,
  trailing,
  tone = 'neutral',
  compact = false,
  accessible = false,
  style
}: {
  children?: ReactNode
  eyebrow?: string
  title?: string
  trailing?: ReactNode
  tone?: HudTone
  compact?: boolean
  accessible?: boolean
  style?: StyleProp<ViewStyle>
}): React.JSX.Element {
  return (
    <View
      accessible={accessible}
      style={[
        styles.card,
        compact && styles.compact,
        tone === 'accent' && styles.accent,
        tone === 'ok' && styles.ok,
        tone === 'warn' && styles.warn,
        tone === 'danger' && styles.danger,
        style
      ]}
    >
      <View pointerEvents="none" style={styles.cornerTop} />
      <View pointerEvents="none" style={styles.cornerBottom} />
      {eyebrow || title || trailing ? (
        <View style={styles.header}>
          <View style={styles.headingCopy}>
            {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
            {title ? <Text style={styles.title}>{title}</Text> : null}
          </View>
          {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
        </View>
      ) : null}
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    position: 'relative',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.sm,
    backgroundColor: 'rgba(3, 10, 15, 0.84)',
    padding: spacing.lg,
    overflow: 'hidden'
  },
  compact: { padding: spacing.md },
  accent: { borderColor: colors.lineStrong, backgroundColor: 'rgba(7, 23, 33, 0.9)' },
  ok: { borderColor: 'rgba(61,207,122,0.44)', backgroundColor: colors.okSoft },
  warn: { borderColor: 'rgba(240,184,90,0.48)', backgroundColor: colors.warnSoft },
  danger: { borderColor: 'rgba(255,107,99,0.5)', backgroundColor: colors.dangerSoft },
  cornerTop: {
    position: 'absolute',
    width: 18,
    height: 18,
    top: -1,
    left: -1,
    borderTopWidth: 2,
    borderLeftWidth: 2,
    borderColor: colors.accent
  },
  cornerBottom: {
    position: 'absolute',
    width: 18,
    height: 18,
    right: -1,
    bottom: -1,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderColor: colors.accentDeep
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.md
  },
  headingCopy: { flex: 1, gap: spacing.xxs },
  trailing: { flexShrink: 0 },
  eyebrow: {
    color: colors.accent,
    fontFamily: fonts.mono,
    fontSize: typeScale.micro,
    letterSpacing: 1.4,
    textTransform: 'uppercase'
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.displayMed,
    fontSize: 17,
    letterSpacing: 0.8
  }
})
