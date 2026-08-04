import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { HudButton } from '../components/HudButton'
import type { MemoryFact } from '../types'
import { colors, fonts } from '../theme'

export function MemoryScreen({
  memories,
  busy,
  canSync,
  refreshing,
  onSync,
  onRefresh,
  onDelete
}: {
  memories: MemoryFact[]
  busy: boolean
  canSync: boolean
  refreshing: boolean
  onSync: () => void
  onRefresh: () => void
  onDelete: (id: string) => void
}): React.JSX.Element {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>MEMORY BANK</Text>
      <Text style={styles.sub}>
        Shared with Mac. Deletes propagate when uplink is up. Pull to refresh.
      </Text>

      <View style={styles.actions}>
        <HudButton
          label={busy ? 'Syncing…' : 'Sync with Mac'}
          primary
          disabled={busy || !canSync}
          onPress={onSync}
        />
      </View>

      <FlatList
        data={memories}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
          />
        }
        ListEmptyComponent={
          <Text style={styles.hint}>
            No memories yet. Mention preferences in chat — they’ll sync to Mac when online.
          </Text>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cat}>{item.category}</Text>
            <Text style={styles.content}>{item.content}</Text>
            <HudButton label="Delete" onPress={() => onDelete(item.id)} style={styles.delete} />
          </View>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 14, paddingTop: 8 },
  title: {
    fontFamily: fonts.displayMed,
    fontSize: 18,
    letterSpacing: 2,
    color: colors.accentStrong
  },
  sub: {
    marginTop: 6,
    marginBottom: 14,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.inkMuted,
    lineHeight: 18
  },
  actions: { marginBottom: 12 },
  list: { paddingBottom: 24, gap: 10 },
  hint: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.inkMuted,
    lineHeight: 20
  },
  card: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: 'rgba(0,0,0,0.3)',
    padding: 12,
    marginBottom: 10
  },
  cat: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.accent,
    marginBottom: 6
  },
  content: {
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
    lineHeight: 22,
    marginBottom: 10
  },
  delete: { alignSelf: 'flex-start' }
})
