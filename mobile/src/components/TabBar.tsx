import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { TabId } from '../types'
import { colors, fonts, sizes, spacing, typeScale } from '../theme'

const TABS: ReadonlyArray<{ id: TabId; label: string; glyph: string; hint: string }> = [
  { id: 'home', label: 'CORE', glyph: '◉', hint: 'System overview and voice core' },
  { id: 'chat', label: 'COMM', glyph: '▤', hint: 'Open communications' },
  { id: 'operations', label: 'OPS', glyph: '◇', hint: 'Missions and approvals' },
  { id: 'memory', label: 'MEMORY', glyph: '⌁', hint: 'Long-term memory bank' },
  { id: 'systems', label: 'SYSTEMS', glyph: '⌬', hint: 'Models, Mac link, and privacy' }
]

export function TabBar({
  active,
  onChange,
  pendingApprovals = 0,
  systemsAttention = false
}: {
  active: TabId
  onChange: (tab: TabId) => void
  pendingApprovals?: number
  systemsAttention?: boolean
}): React.JSX.Element {
  return (
    <View style={styles.shell} accessibilityLabel="Primary navigation">
      <View pointerEvents="none" style={styles.topLine} />
      <View style={styles.row}>
        {TABS.map((tab) => {
          const on = tab.id === active
          const badge =
            tab.id === 'operations' && pendingApprovals > 0
              ? pendingApprovals > 99
                ? '99+'
                : String(pendingApprovals)
              : tab.id === 'systems' && systemsAttention
                ? '!'
                : null
          return (
            <Pressable
              key={tab.id}
              onPress={() => onChange(tab.id)}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityHint={tab.hint}
              accessibilityState={{ selected: on }}
              hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
              style={({ pressed }) => [styles.tab, on && styles.tabOn, pressed && styles.pressed]}
            >
              <View style={styles.glyphWrap}>
                <Text allowFontScaling={false} style={[styles.glyph, on && styles.glyphOn]}>
                  {tab.glyph}
                </Text>
                {badge ? (
                  <View style={styles.badge}>
                    <Text allowFontScaling={false} style={styles.badgeText}>
                      {badge}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text maxFontSizeMultiplier={1.3} style={[styles.label, on && styles.labelOn]}>
                {tab.label}
              </Text>
              {on ? <View pointerEvents="none" style={styles.activeRail} /> : null}
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  shell: {
    flexShrink: 0,
    minHeight: sizes.bottomNav,
    paddingHorizontal: spacing.xs,
    backgroundColor: 'rgba(0, 5, 9, 0.96)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.lineStrong
  },
  topLine: {
    position: 'absolute',
    top: -1,
    alignSelf: 'center',
    width: '36%',
    height: 2,
    backgroundColor: colors.accent,
    shadowColor: colors.accent,
    shadowOpacity: 0.6,
    shadowRadius: 8
  },
  row: { flex: 1, flexDirection: 'row', alignItems: 'stretch' },
  tab: {
    flex: 1,
    minWidth: sizes.minTarget,
    minHeight: sizes.bottomNav,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 2,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.lineDim
  },
  tabOn: { backgroundColor: colors.accentFaint },
  pressed: { opacity: 0.68 },
  glyphWrap: { minWidth: 26, height: 25, alignItems: 'center', justifyContent: 'center' },
  glyph: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: 19 },
  glyphOn: {
    color: colors.accentStrong,
    textShadowColor: colors.accentGlow,
    textShadowRadius: 8
  },
  label: {
    color: colors.inkMuted,
    fontFamily: fonts.mono,
    fontSize: typeScale.micro - 1,
    letterSpacing: 0.55
  },
  labelOn: { color: colors.accentStrong },
  activeRail: {
    position: 'absolute',
    bottom: 0,
    left: '19%',
    right: '19%',
    height: 2,
    backgroundColor: colors.accent
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: -8,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger
  },
  badgeText: { color: '#050608', fontFamily: fonts.bodyBold, fontSize: 10 }
})
