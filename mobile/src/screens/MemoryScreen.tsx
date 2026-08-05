import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import { HudButton } from '../components/HudButton'
import type { MemoryFact } from '../types'
import { colors, fonts } from '../theme'

type MaybePromise<T> = T | Promise<T>

export interface MemoryScreenProps {
  memories: MemoryFact[]
  busy: boolean
  canSync: boolean
  refreshing: boolean
  loading?: boolean
  offline?: boolean
  error?: string | null
  syncNote?: string | null
  onSync: () => void
  onRefresh: () => void
  onDelete: (id: string) => MaybePromise<void>
  onAddMemory?: (input: Pick<MemoryFact, 'content' | 'category'>) => MaybePromise<void>
  onEditMemory?: (
    id: string,
    patch: Pick<MemoryFact, 'content' | 'category'>
  ) => MaybePromise<void>
  onUndoDelete?: (memory: MemoryFact) => MaybePromise<void>
}

type EditorState = { mode: 'add'; memory?: undefined } | { mode: 'edit'; memory: MemoryFact }

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return 'UNKNOWN'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()
}

function EmptyState({ filtered }: { filtered: boolean }): React.JSX.Element {
  return (
    <View style={styles.empty} accessible accessibilityRole="summary">
      <Text style={styles.emptyGlyph}>{filtered ? '⌕' : '◇'}</Text>
      <Text style={styles.emptyTitle}>{filtered ? 'NO MATCHING MEMORY' : 'MEMORY BANK EMPTY'}</Text>
      <Text style={styles.emptyDetail}>
        {filtered
          ? 'Adjust the search or category filter to widen the scan.'
          : 'Preferences and durable facts learned in Comm will be catalogued here.'}
      </Text>
    </View>
  )
}

function MemoryEditor({
  state,
  saving,
  error,
  onDismiss,
  onSave
}: {
  state: EditorState
  saving: boolean
  error: string | null
  onDismiss: () => void
  onSave: (content: string, category: string) => void
}): React.JSX.Element {
  const [content, setContent] = useState(state.memory?.content ?? '')
  const [category, setCategory] = useState(state.memory?.category ?? 'general')
  const contentRef = useRef<TextInput>(null)

  useEffect(() => {
    const timer = setTimeout(() => contentRef.current?.focus(), 180)
    return () => clearTimeout(timer)
  }, [])

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDismiss} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} accessibilityLabel="Close memory editor" />
        <View style={styles.modalPanel} accessibilityViewIsModal>
          <Text style={styles.editorEyebrow}>{state.mode === 'add' ? 'NEW MEMORY RECORD' : 'EDIT MEMORY RECORD'}</Text>
          <Text style={styles.editorTitle}>{state.mode === 'add' ? 'CATALOG MEMORY' : 'MODIFY RECORD'}</Text>
          <Text style={styles.fieldLabel}>CATEGORY</Text>
          <TextInput
            value={category}
            onChangeText={setCategory}
            maxLength={50}
            editable={!saving}
            autoCapitalize="none"
            returnKeyType="next"
            onSubmitEditing={() => contentRef.current?.focus()}
            accessibilityLabel="Memory category"
            style={styles.editorInput}
          />
          <Text style={styles.fieldLabel}>MEMORY</Text>
          <TextInput
            ref={contentRef}
            value={content}
            onChangeText={setContent}
            multiline
            maxLength={4000}
            editable={!saving}
            placeholder="The durable fact Albert should remember…"
            placeholderTextColor={colors.inkFaint}
            accessibilityLabel="Memory content"
            style={[styles.editorInput, styles.editorTextArea]}
          />
          {error ? <Text style={styles.editorError} accessibilityRole="alert">{error}</Text> : null}
          <View style={styles.modalActions}>
            <HudButton label="Cancel" onPress={onDismiss} disabled={saving} style={styles.flexButton} />
            <HudButton
              label={saving ? 'Saving…' : state.mode === 'add' ? 'Add memory' : 'Save changes'}
              onPress={() => onSave(content.trim(), category.trim())}
              primary
              disabled={saving || !content.trim() || !category.trim()}
              style={styles.flexButton}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

export function MemoryScreen({
  memories,
  busy,
  canSync,
  refreshing,
  loading = false,
  offline = false,
  error,
  syncNote,
  onSync,
  onRefresh,
  onDelete,
  onAddMemory,
  onEditMemory,
  onUndoDelete
}: MemoryScreenProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [editorBusy, setEditorBusy] = useState(false)
  const [editorError, setEditorError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<MemoryFact | null>(null)
  const [undoMemory, setUndoMemory] = useState<MemoryFact | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
  }, [])

  const categories = useMemo(
    () => Array.from(new Set(memories.map((memory) => memory.category.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [memories]
  )
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return memories
      .filter((memory) => category === 'all' || memory.category === category)
      .filter((memory) => !normalizedQuery || `${memory.content} ${memory.category} ${memory.source ?? ''}`.toLocaleLowerCase().includes(normalizedQuery))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [category, memories, query])

  useEffect(() => {
    if (category !== 'all' && !categories.includes(category)) setCategory('all')
  }, [categories, category])

  const saveEditor = async (content: string, nextCategory: string): Promise<void> => {
    if (!editor) return
    setEditorBusy(true)
    setEditorError(null)
    try {
      if (editor.mode === 'add') {
        if (!onAddMemory) throw new Error('Adding memories is not available on this link.')
        await onAddMemory({ content, category: nextCategory })
      } else {
        if (!onEditMemory) throw new Error('Editing memories is not available on this link.')
        await onEditMemory(editor.memory.id, { content, category: nextCategory })
      }
      setEditor(null)
    } catch (cause) {
      setEditorError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setEditorBusy(false)
    }
  }

  const confirmDelete = async (): Promise<void> => {
    const memory = pendingDelete
    if (!memory) return
    setPendingDelete(null)
    setActionError(null)
    try {
      await onDelete(memory.id)
      if (onUndoDelete) {
        setUndoMemory(memory)
        if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
        undoTimerRef.current = setTimeout(() => setUndoMemory(null), 7000)
      }
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const undoDelete = async (): Promise<void> => {
    if (!undoMemory || !onUndoDelete) return
    const memory = undoMemory
    setUndoMemory(null)
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    try {
      await onUndoDelete(memory)
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const isFiltered = Boolean(query.trim()) || category !== 'all'
  const initiallyLoading = loading && memories.length === 0

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.kicker}>COGNITIVE ARCHIVE / {memories.length.toString().padStart(3, '0')} RECORDS</Text>
          <Text style={styles.title}>MEMORY BANK</Text>
          <Text style={styles.sub}>Review the durable context Albert carries across conversations.</Text>
        </View>
        {onAddMemory ? (
          <Pressable
            onPress={() => { setEditorError(null); setEditor({ mode: 'add' }) }}
            accessibilityRole="button"
            accessibilityLabel="Add memory"
            hitSlop={6}
            style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
          >
            <Text style={styles.addIcon}>＋</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.statusRow}>
        <View style={[styles.statusDot, offline ? styles.statusDotOffline : styles.statusDotOnline]} />
        <Text style={styles.statusText}>{offline ? 'LOCAL ARCHIVE · SYNC QUEUED' : canSync ? 'MAC LINK · MEMORY SHARED' : 'LOCAL ARCHIVE · LINK NOT CONFIGURED'}</Text>
        {loading && !initiallyLoading ? <ActivityIndicator color={colors.accent} size="small" accessibilityLabel="Updating memory" /> : null}
      </View>

      {error || actionError ? (
        <View style={styles.errorBanner} accessibilityRole="alert">
          <Text style={styles.errorTitle}>⚠ MEMORY LINK FAULT</Text>
          <Text style={styles.errorBody}>{actionError ?? error}</Text>
        </View>
      ) : syncNote ? (
        <View style={styles.syncBanner} accessible accessibilityLiveRegion="polite">
          <Text style={styles.syncText}>{syncNote}</Text>
        </View>
      ) : null}

      <View style={styles.toolbar}>
        <View style={styles.searchBox}>
          <Text style={styles.searchGlyph}>⌕</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search memory…"
            placeholderTextColor={colors.inkFaint}
            returnKeyType="search"
            autoCorrect={false}
            accessibilityLabel="Search memories"
            clearButtonMode="while-editing"
            style={styles.searchInput}
          />
          {query && Platform.OS !== 'ios' ? (
            <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={10} style={styles.clearButton}>
              <Text style={styles.clearText}>×</Text>
            </Pressable>
          ) : null}
        </View>
        <HudButton
          label={busy ? 'Syncing…' : 'Sync'}
          primary
          disabled={busy || !canSync}
          onPress={onSync}
          style={styles.syncButton}
        />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersScroller} contentContainerStyle={styles.filters}>
        {['all', ...categories].map((item) => {
          const selected = category === item
          return (
            <Pressable
              key={item}
              onPress={() => setCategory(item)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${item === 'all' ? 'All categories' : item}, ${item === 'all' ? memories.length : memories.filter((memory) => memory.category === item).length} memories`}
              style={({ pressed }) => [styles.filter, selected && styles.filterActive, pressed && styles.pressed]}
            >
              <Text style={[styles.filterText, selected && styles.filterTextActive]}>{item.toUpperCase()}</Text>
            </Pressable>
          )
        })}
      </ScrollView>

      {initiallyLoading ? (
        <View style={styles.loadingState} accessibilityRole="progressbar" accessibilityLabel="Loading memories">
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.loadingText}>INDEXING MEMORY BANK…</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(memory) => memory.id}
          contentContainerStyle={[styles.list, filtered.length === 0 && styles.emptyList]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<EmptyState filtered={isFiltered} />}
          renderItem={({ item }) => {
            const confidence = item.confidence == null ? null : Math.round(Math.max(0, Math.min(1, item.confidence)) * 100)
            return (
              <View style={styles.card}>
                <View pointerEvents="none" style={styles.cardCorner} />
                <View style={styles.cardHeader}>
                  <View style={styles.categoryPill}>
                    <View style={styles.categoryDot} />
                    <Text style={styles.categoryText}>{item.category.toUpperCase()}</Text>
                  </View>
                  <Text style={styles.dateText}>UPDATED {formatDate(item.updatedAt)}</Text>
                </View>
                <Text style={styles.content}>{item.content}</Text>
                <View style={styles.cardFooter}>
                  <View style={styles.metadata}>
                    {item.source ? <Text style={styles.metaText}>SOURCE / {item.source.toUpperCase()}</Text> : null}
                    {confidence != null ? <Text style={styles.metaText}>CONFIDENCE / {confidence}%</Text> : null}
                    {!item.source && confidence == null ? <Text style={styles.metaText}>CATALOGUED / {formatDate(item.createdAt)}</Text> : null}
                  </View>
                  <View style={styles.cardActions}>
                    {onEditMemory ? (
                      <Pressable
                        onPress={() => { setEditorError(null); setEditor({ mode: 'edit', memory: item }) }}
                        accessibilityRole="button"
                        accessibilityLabel={`Edit memory: ${item.content}`}
                        style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                      >
                        <Text style={styles.iconButtonText}>EDIT</Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      onPress={() => setPendingDelete(item)}
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete memory: ${item.content}`}
                      accessibilityState={{ disabled: busy }}
                      style={({ pressed }) => [styles.iconButton, styles.deleteButton, pressed && styles.pressed]}
                    >
                      <Text style={[styles.iconButtonText, styles.deleteText]}>DELETE</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            )
          }}
        />
      )}

      {editor ? (
        <MemoryEditor
          key={`${editor.mode}-${editor.memory?.id ?? 'new'}`}
          state={editor}
          saving={editorBusy}
          error={editorError}
          onDismiss={() => { if (!editorBusy) setEditor(null) }}
          onSave={(content, nextCategory) => void saveEditor(content, nextCategory)}
        />
      ) : null}

      <Modal visible={Boolean(pendingDelete)} transparent animationType="fade" onRequestClose={() => setPendingDelete(null)} statusBarTranslucent>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPendingDelete(null)} accessibilityLabel="Cancel deletion" />
          <View style={styles.confirmPanel} accessibilityViewIsModal>
            <Text style={[styles.editorEyebrow, styles.dangerLabel]}>DESTRUCTIVE COMMAND</Text>
            <Text style={styles.editorTitle}>DELETE MEMORY?</Text>
            <Text style={styles.confirmCopy} numberOfLines={4}>{pendingDelete?.content}</Text>
            <Text style={styles.confirmHint}>{canSync ? 'Deletion will propagate to the linked Mac.' : 'Deletion will be queued until a Mac link is available.'}</Text>
            <View style={styles.modalActions}>
              <HudButton label="Cancel" onPress={() => setPendingDelete(null)} style={styles.flexButton} />
              <HudButton label="Delete memory" onPress={() => void confirmDelete()} primary style={[styles.flexButton, styles.destructiveButton]} />
            </View>
          </View>
        </View>
      </Modal>

      {undoMemory && onUndoDelete ? (
        <View style={styles.undoBar}>
          <Text accessibilityLiveRegion="assertive" style={styles.undoText} numberOfLines={1}>Memory deleted</Text>
          <Pressable onPress={() => void undoDelete()} accessibilityRole="button" accessibilityLabel="Undo memory deletion" style={styles.undoButton}>
            <Text style={styles.undoButtonText}>UNDO</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 6 },
  header: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, gap: 12 },
  headerCopy: { flex: 1 },
  kicker: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.5, color: colors.accent },
  title: { marginTop: 4, fontFamily: fonts.displayMed, fontSize: 23, letterSpacing: 2.5, color: colors.accentStrong },
  sub: { marginTop: 5, fontFamily: fonts.body, fontSize: 15, lineHeight: 20, color: colors.inkMuted },
  addButton: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.accentSoft },
  addIcon: { fontFamily: fonts.body, fontSize: 27, lineHeight: 30, color: colors.accentStrong },
  statusRow: { minHeight: 42, marginHorizontal: 16, marginTop: 12, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.lineDim },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusDotOnline: { backgroundColor: colors.ok },
  statusDotOffline: { backgroundColor: '#ffd166' },
  statusText: { flex: 1, fontFamily: fonts.mono, fontSize: 9, letterSpacing: 1, color: colors.inkMuted },
  errorBanner: { marginHorizontal: 16, marginTop: 9, padding: 10, borderLeftWidth: 2, borderColor: colors.danger, backgroundColor: 'rgba(255,107,99,0.08)' },
  errorTitle: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1, color: colors.danger },
  errorBody: { marginTop: 3, fontFamily: fonts.body, fontSize: 14, lineHeight: 18, color: colors.ink },
  syncBanner: { marginHorizontal: 16, marginTop: 9, padding: 9, borderLeftWidth: 2, borderColor: colors.ok, backgroundColor: 'rgba(61,207,122,0.07)' },
  syncText: { fontFamily: fonts.body, fontSize: 14, color: colors.ink },
  toolbar: { flexDirection: 'row', alignItems: 'stretch', gap: 8, paddingHorizontal: 14, marginTop: 10 },
  searchBox: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.line, backgroundColor: 'rgba(0,0,0,0.48)' },
  searchGlyph: { marginLeft: 11, fontFamily: fonts.mono, fontSize: 20, color: colors.accent },
  searchInput: { flex: 1, minHeight: 46, paddingHorizontal: 9, fontFamily: fonts.body, fontSize: 16, color: colors.ink },
  clearButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  clearText: { fontFamily: fonts.body, fontSize: 24, color: colors.inkMuted },
  syncButton: { minWidth: 84, minHeight: 48, justifyContent: 'center' },
  filtersScroller: { flexGrow: 0, marginTop: 8 },
  filters: { paddingHorizontal: 14, gap: 7 },
  filter: { minHeight: 44, minWidth: 62, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.lineDim, backgroundColor: 'rgba(0,0,0,0.3)' },
  filterActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  filterText: { fontFamily: fonts.mono, fontSize: 9, letterSpacing: 0.9, color: colors.inkMuted },
  filterTextActive: { color: colors.accentStrong },
  list: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 14, paddingTop: 10, paddingBottom: 32, gap: 10 },
  emptyList: { flexGrow: 1 },
  card: { position: 'relative', overflow: 'hidden', borderWidth: 1, borderColor: colors.line, backgroundColor: 'rgba(3,10,15,0.87)', padding: 13 },
  cardCorner: { position: 'absolute', top: -1, left: -1, width: 15, height: 15, borderTopWidth: 2, borderLeftWidth: 2, borderColor: colors.accent },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  categoryPill: { minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 8 },
  categoryDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.accent },
  categoryText: { fontFamily: fonts.mono, fontSize: 9, letterSpacing: 1, color: colors.accentStrong },
  dateText: { flexShrink: 1, textAlign: 'right', fontFamily: fonts.mono, fontSize: 9, letterSpacing: 0.6, color: colors.inkFaint },
  content: { marginTop: 11, fontFamily: fonts.body, fontSize: 17, lineHeight: 23, color: colors.ink },
  cardFooter: { marginTop: 12, paddingTop: 9, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.lineDim, flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  metadata: { flex: 1, gap: 3 },
  metaText: { fontFamily: fonts.mono, fontSize: 9, lineHeight: 13, letterSpacing: 0.6, color: colors.inkFaint },
  cardActions: { flexDirection: 'row', gap: 6 },
  iconButton: { minWidth: 54, minHeight: 44, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line },
  iconButtonText: { fontFamily: fonts.mono, fontSize: 9, letterSpacing: 0.8, color: colors.accentStrong },
  deleteButton: { borderColor: 'rgba(255,107,99,0.32)' },
  deleteText: { color: colors.danger },
  loadingState: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  loadingText: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.5, color: colors.inkMuted },
  empty: { flex: 1, minHeight: 230, alignItems: 'center', justifyContent: 'center', padding: 24, borderWidth: 1, borderColor: colors.line, borderStyle: 'dashed' },
  emptyGlyph: { fontFamily: fonts.displayMed, fontSize: 32, color: colors.accent },
  emptyTitle: { marginTop: 10, fontFamily: fonts.displayMed, fontSize: 14, letterSpacing: 1.7, color: colors.accentStrong, textAlign: 'center' },
  emptyDetail: { marginTop: 8, maxWidth: 360, fontFamily: fonts.body, fontSize: 15, lineHeight: 20, color: colors.inkMuted, textAlign: 'center' },
  modalBackdrop: { flex: 1, justifyContent: 'center', padding: 18, backgroundColor: 'rgba(0,0,0,0.84)' },
  modalPanel: { width: '100%', maxWidth: 620, alignSelf: 'center', borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.bg2, padding: 16 },
  confirmPanel: { width: '100%', maxWidth: 520, alignSelf: 'center', borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.bg2, padding: 16 },
  editorEyebrow: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.4, color: colors.accent },
  dangerLabel: { color: colors.danger },
  editorTitle: { marginTop: 5, marginBottom: 14, fontFamily: fonts.displayMed, fontSize: 18, letterSpacing: 1.8, color: colors.ink },
  fieldLabel: { marginTop: 9, marginBottom: 5, fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.1, color: colors.inkMuted },
  editorInput: { minHeight: 48, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 11, fontFamily: fonts.body, fontSize: 16, color: colors.ink, backgroundColor: 'rgba(0,0,0,0.36)' },
  editorTextArea: { minHeight: 130, paddingTop: 11, textAlignVertical: 'top' },
  editorError: { marginTop: 9, fontFamily: fonts.body, fontSize: 14, color: colors.danger },
  modalActions: { flexDirection: 'row', gap: 9, marginTop: 16 },
  flexButton: { flex: 1, minHeight: 48, justifyContent: 'center' },
  destructiveButton: { borderColor: colors.danger, backgroundColor: 'rgba(255,107,99,0.12)' },
  confirmCopy: { fontFamily: fonts.body, fontSize: 16, lineHeight: 22, color: colors.ink },
  confirmHint: { marginTop: 10, fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.inkMuted },
  undoBar: { position: 'absolute', left: 14, right: 14, bottom: 12, minHeight: 54, flexDirection: 'row', alignItems: 'center', paddingLeft: 14, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.bg2 },
  undoText: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  undoButton: { minWidth: 72, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  undoButtonText: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.2, color: colors.accentStrong },
  pressed: { opacity: 0.7 }
})
