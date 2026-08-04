import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { TabId } from '../types'
import { colors, fonts } from '../theme'

const TABS: { id: TabId; label: string }[] = [
  { id: 'home', label: 'HOME' },
  { id: 'chat', label: 'COMM' },
  { id: 'memory', label: 'MEMORY' },
  { id: 'pair', label: 'PAIR' }
]

export function TabBar({
  active,
  onChange
}: {
  active: TabId
  onChange: (tab: TabId) => void
}): React.JSX.Element {
  return (
    <View style={styles.row}>
      {TABS.map((tab) => {
        const on = tab.id === active
        return (
          <Pressable
            key={tab.id}
            onPress={() => onChange(tab.id)}
            style={[styles.tab, on && styles.tabOn]}
          >
            <Text style={[styles.label, on && styles.labelOn]}>{tab.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingBottom: 10
  },
  tab: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingVertical: 10,
    alignItems: 'center'
  },
  tabOn: {
    borderColor: 'rgba(137, 207, 240, 0.75)',
    backgroundColor: colors.accentSoft
  },
  label: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.inkMuted
  },
  labelOn: {
    color: colors.accentStrong
  }
})
