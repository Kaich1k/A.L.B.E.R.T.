import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  FlatList,
  Image,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { APP_NAME } from '../brand'
import { HudButton } from '../components/HudButton'
import { HudCard } from '../components/HudCard'
import { StatusChip } from '../components/StatusChip'
import type { ChatImagePayload, ChatMessage, MacLinkState, VoicePhase } from '../types'
import { colors, fonts, sizes, spacing, typeScale } from '../theme'

export interface ChatScreenProps {
  messages: ChatMessage[]
  draft: string
  draftImages?: ChatImagePayload[]
  busy: boolean
  statusLabel: string
  statusTone: 'ok' | 'bad' | 'neutral'
  syncNote: string | null
  error: string | null
  voicePhase: VoicePhase
  voiceStatus: string
  voiceSupported: boolean
  linkState?: MacLinkState
  routeLabel?: string
  streamingText?: string
  interimTranscript?: string
  /** Height of StatusRail + TabBar sitting below this screen (covered when the keyboard opens). */
  bottomChromeHeight?: number
  onChangeDraft: (value: string) => void
  onSend: () => void
  onPurge: () => void
  onToggleVoice: () => void
  onCancel?: () => void
  onAttach?: () => void
  onRemoveDraftImage?: (index: number) => void
  onRetryMessage?: (message: ChatMessage) => void
  onCopyMessage?: (message: ChatMessage) => void
  onRegenerate?: (message: ChatMessage) => void
  onDismissError?: () => void
  onOpenSystems?: () => void
}

function deliveryLabel(message: ChatMessage): string | null {
  if (message.delivery === 'pending') return 'PENDING'
  if (message.delivery === 'synced') return 'SYNCED'
  if (message.delivery === 'failed') return 'FAILED'
  if (message.delivery === 'local') return 'LOCAL'
  return null
}

function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function ChatScreen({
  messages,
  draft,
  draftImages = [],
  busy,
  statusLabel,
  statusTone,
  syncNote,
  error,
  voicePhase,
  voiceStatus,
  voiceSupported,
  linkState,
  routeLabel,
  streamingText,
  interimTranscript,
  bottomChromeHeight = sizes.bottomNav + sizes.minTarget,
  onChangeDraft,
  onSend,
  onPurge,
  onToggleVoice,
  onCancel,
  onAttach,
  onRemoveDraftImage,
  onRetryMessage,
  onCopyMessage,
  onRegenerate,
  onDismissError,
  onOpenSystems
}: ChatScreenProps): React.JSX.Element {
  const listRef = useRef<FlatList<ChatMessage>>(null)
  const pendingInitialScrollRef = useRef(true)
  const pendingReplyScrollRef = useRef(false)
  const lastHandledAssistantIdRef = useRef<string | null>(null)
  const initialStableTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const replyStableTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initialScrollIndexRef = useRef<number | undefined>(undefined)
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const [keyboardLift, setKeyboardLift] = useState(0)
  const wide = width >= sizes.tabletBreakpoint
  const voiceEngaged = voicePhase !== 'standby' && voicePhase !== 'permission' && voicePhase !== 'fault'
  const linkTone =
    linkState === 'authenticated'
      ? 'ok'
      : linkState === 'syncing' || linkState === 'checking'
        ? 'accent'
        : linkState === 'auth-failed' || linkState === 'fault'
          ? 'danger'
          : linkState === 'offline'
            ? 'warn'
            : statusTone === 'ok'
              ? 'ok'
              : statusTone === 'bad'
                ? 'warn'
                : 'neutral'

  const data = streamingText
    ? [
        ...messages,
        {
          id: '__streaming__',
          role: 'assistant' as const,
          content: streamingText,
          createdAt: messages[messages.length - 1]?.createdAt ?? 0,
          delivery: 'pending' as const
        }
      ]
    : messages

  if (initialScrollIndexRef.current === undefined && data.length > 0) {
    initialScrollIndexRef.current = data.length - 1
  }

  const seedHandledAssistant = (): void => {
    const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant')
    lastHandledAssistantIdRef.current = lastAssistant?.id ?? null
  }

  const scrollToAbsoluteBottom = (animated: boolean): void => {
    const lastIndex = data.length - 1
    if (lastIndex < 0) return
    listRef.current?.scrollToEnd({ animated })
    // FlatList often hasn't measured the tail yet — also pin the last row.
    try {
      listRef.current?.scrollToIndex({ index: lastIndex, animated, viewPosition: 1 })
    } catch {
      // onScrollToIndexFailed retries below
    }
  }

  // Case 2: mark a one-shot scroll when Albert's finished reply lands.
  useEffect(() => {
    if (pendingInitialScrollRef.current) return
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant') return
    if (lastHandledAssistantIdRef.current === last.id) return
    lastHandledAssistantIdRef.current = last.id
    pendingReplyScrollRef.current = true
  }, [messages])

  useEffect(() => {
    return () => {
      if (initialStableTimerRef.current) clearTimeout(initialStableTimerRef.current)
      if (replyStableTimerRef.current) clearTimeout(replyStableTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const showSub = Keyboard.addListener(showEvent, (event) => {
      // Chrome below Comm is covered by the keyboard; lift only the overlapping portion.
      const covered = bottomChromeHeight + insets.bottom
      setKeyboardLift(Math.max(0, event.endCoordinates.height - covered))
    })
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardLift(0))
    return () => {
      showSub.remove()
      hideSub.remove()
    }
  }, [bottomChromeHeight, insets.bottom])

  const confirmPurge = (): void => {
    Alert.alert(
      'Clear Comm history?',
      'This clears the phone thread and requests the paired Mac copy be cleared. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear history', style: 'destructive', onPress: onPurge }
      ]
    )
  }

  return (
    <View style={[styles.flex, keyboardLift > 0 && { paddingBottom: keyboardLift }]}>
      <View style={[styles.shell, wide && styles.shellWide]}>
        <View style={styles.hero}>
          <View style={styles.heroRow}>
            <View style={styles.heroCopy}>
              <Text style={styles.eyebrow}>SECURE COMMUNICATION CHANNEL</Text>
              <Text style={styles.title}>COMM LINK</Text>
            </View>
            <HudButton
              label="Clear"
              variant="quiet"
              onPress={confirmPurge}
              disabled={busy}
              accessibilityLabel="Clear communication history"
              style={styles.clearButton}
            />
          </View>
          <View style={styles.statusRow}>
            <StatusChip label={statusLabel} tone={linkTone} pulse={linkState === 'syncing'} style={styles.statusChip} />
            {routeLabel ? <StatusChip label={`ROUTE ${routeLabel}`} tone="accent" /> : null}
          </View>
          {syncNote ? (
            <Text style={styles.syncNote} accessibilityLiveRegion="polite">
              {syncNote}
            </Text>
          ) : null}
        </View>

        <HudCard
          compact
          tone={voicePhase === 'fault' ? 'danger' : voiceEngaged ? 'accent' : 'neutral'}
          style={styles.voiceBar}
          accessible={false}
        >
          <View style={styles.voiceRow}>
            <View style={styles.voiceIndicator}>
              <View style={[styles.voiceDot, voiceEngaged && styles.voiceDotLive, voicePhase === 'fault' && styles.voiceDotFault]} />
              <View style={styles.voiceMeta}>
                <Text style={styles.voicePhase}>{voicePhase.toUpperCase()}</Text>
                <Text style={styles.voiceStatus} accessibilityLiveRegion="polite" numberOfLines={2}>
                  {voiceSupported ? voiceStatus : ''}
                </Text>
              </View>
            </View>
            <HudButton
              label={!voiceSupported ? 'Setup' : voiceEngaged ? 'Take 5' : 'Voice'}
              glyph={voiceEngaged ? '■' : '◉'}
              primary={voiceSupported && !voiceEngaged}
              onPress={voiceSupported ? onToggleVoice : onOpenSystems ?? onToggleVoice}
              style={styles.voiceButton}
            />
          </View>
          {interimTranscript ? (
            <View style={styles.transcript} accessibilityLiveRegion="polite">
              <Text style={styles.transcriptLabel}>LIVE TRANSCRIPT</Text>
              <Text style={styles.transcriptText}>“{interimTranscript}”</Text>
            </View>
          ) : null}
        </HudCard>

        {error ? (
          <HudCard tone="danger" compact style={styles.errorCard} eyebrow="CHANNEL FAULT">
            <Text style={styles.errorText} accessibilityRole="alert">
              {error}
            </Text>
            <View style={styles.errorActions}>
              {onOpenSystems ? <HudButton label="Open Systems" variant="quiet" onPress={onOpenSystems} /> : null}
              {onDismissError ? <HudButton label="Dismiss" variant="quiet" onPress={onDismissError} /> : null}
            </View>
          </HudCard>
        ) : null}

        <FlatList
          ref={listRef}
          style={styles.flex}
          data={data}
          keyExtractor={(message) => message.id}
          contentContainerStyle={[styles.list, data.length === 0 && styles.listEmpty]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          // Start near the latest bubble so open-Comm can actually reach the bottom
          // (virtualization otherwise only measures the top of a long thread).
          initialScrollIndex={initialScrollIndexRef.current}
          initialNumToRender={16}
          maxToRenderPerBatch={16}
          windowSize={11}
          onContentSizeChange={() => {
            // Case 1: opening Comm — keep pinning to bottom until layout settles.
            if (pendingInitialScrollRef.current) {
              if (data.length === 0) {
                pendingInitialScrollRef.current = false
                lastHandledAssistantIdRef.current = null
                return
              }
              scrollToAbsoluteBottom(false)
              if (initialStableTimerRef.current) clearTimeout(initialStableTimerRef.current)
              initialStableTimerRef.current = setTimeout(() => {
                pendingInitialScrollRef.current = false
                seedHandledAssistant()
                scrollToAbsoluteBottom(false)
              }, 160)
              return
            }
            // Case 2: Albert's reply — pin to bottom of his bubble until layout settles.
            if (!pendingReplyScrollRef.current) return
            scrollToAbsoluteBottom(true)
            if (replyStableTimerRef.current) clearTimeout(replyStableTimerRef.current)
            replyStableTimerRef.current = setTimeout(() => {
              pendingReplyScrollRef.current = false
              scrollToAbsoluteBottom(true)
            }, 160)
          }}
          onScrollToIndexFailed={({ index, averageItemLength }) => {
            listRef.current?.scrollToOffset({
              offset: Math.max(0, averageItemLength * index),
              animated: false
            })
            requestAnimationFrame(() => {
              try {
                listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 1 })
              } catch {
                listRef.current?.scrollToEnd({ animated: false })
              }
            })
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text allowFontScaling={false} style={styles.emptyGlyph}>◇</Text>
              <Text style={styles.emptyTitle}>CHANNEL STANDING BY</Text>
              <Text style={styles.emptyText}>
                Send a message, attach a photo, engage voice, or say “Albert, wake up”. Paired messages reconcile with the Mac when the secure uplink is available.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              streaming={item.id === '__streaming__'}
              onRetry={onRetryMessage}
              onCopy={onCopyMessage}
              onRegenerate={onRegenerate}
            />
          )}
        />

        <View style={styles.composerBlock}>
          {draftImages.length > 0 ? (
            <ScrollView
              horizontal
              style={styles.draftStrip}
              contentContainerStyle={styles.draftStripInner}
              showsHorizontalScrollIndicator={false}
            >
              {draftImages.map((img, index) => (
                <View key={`${img.mediaType}_${index}`} style={styles.draftThumbWrap}>
                  <Image
                    source={{ uri: `data:${img.mediaType};base64,${img.data}` }}
                    style={styles.draftThumb}
                    accessibilityLabel={`Attached image ${index + 1}`}
                  />
                  {onRemoveDraftImage ? (
                    <Pressable
                      onPress={() => onRemoveDraftImage(index)}
                      style={styles.draftRemove}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove image ${index + 1}`}
                      hitSlop={8}
                    >
                      <Text style={styles.draftRemoveText}>×</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </ScrollView>
          ) : null}
          <View style={styles.composer}>
            {onAttach ? (
              <HudButton
                label=""
                glyph="＋"
                variant="quiet"
                accessibilityLabel="Attach image"
                onPress={onAttach}
                disabled={busy || draftImages.length >= 4}
                style={styles.attachButton}
              />
            ) : null}
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={onChangeDraft}
              placeholder={`Message ${APP_NAME}…`}
              placeholderTextColor={colors.inkFaint}
              multiline
              editable={!busy}
              accessibilityLabel={`Message ${APP_NAME}`}
              accessibilityHint="Enter a message for Albert, or attach a photo"
              maxLength={12_000}
            />
            {busy && onCancel ? (
              <HudButton label="Stop" glyph="■" variant="danger" onPress={onCancel} style={styles.sendButton} />
            ) : (
              <HudButton
                label={busy ? 'Sending' : 'Send'}
                glyph="›"
                primary
                loading={busy}
                disabled={busy || (!draft.trim() && draftImages.length === 0)}
                onPress={onSend}
                style={styles.sendButton}
              />
            )}
          </View>
        </View>
      </View>
    </View>
  )
}

function MessageBubble({
  message,
  streaming,
  onRetry,
  onCopy,
  onRegenerate
}: {
  message: ChatMessage
  streaming: boolean
  onRetry?: (message: ChatMessage) => void
  onCopy?: (message: ChatMessage) => void
  onRegenerate?: (message: ChatMessage) => void
}): React.JSX.Element {
  const user = message.role === 'user'
  const delivery = deliveryLabel(message)
  const route = [message.provider?.toUpperCase(), message.model].filter(Boolean).join(' · ')
  const images = message.images?.filter((img) => Boolean(img.dataUrl)) || []
  const showPlaceholderContent =
    Boolean(message.content) &&
    !(images.length > 0 && (message.content === '(image)' || /^\(\d+ images\)$/.test(message.content)))
  return (
    <View
      style={[styles.bubble, user ? styles.bubbleUser : styles.bubbleAssistant, message.delivery === 'failed' && styles.bubbleFailed]}
    >
      <View
        accessible
        accessibilityLabel={`${user ? 'You' : 'Albert'}, ${formatTime(message.createdAt)}. ${message.content}${images.length ? `, ${images.length} image${images.length === 1 ? '' : 's'}` : ''}${delivery ? `. ${delivery}` : ''}`}
      >
        <View style={styles.bubbleHeader}>
          <Text style={styles.role}>{user ? 'YOU' : APP_NAME}</Text>
          <Text style={styles.messageMeta}>
            {formatTime(message.createdAt)}{delivery ? ` · ${delivery}` : ''}
          </Text>
        </View>
        {images.length > 0 ? (
          <View style={styles.messageImages}>
            {images.map((img) => (
              <Image
                key={img.id}
                source={{ uri: img.dataUrl }}
                style={styles.messageImage}
                accessibilityLabel="Attached photo"
              />
            ))}
          </View>
        ) : message.images?.length ? (
          <Text style={styles.imageStub}>📷 {message.images.length === 1 ? 'Photo attached' : `${message.images.length} photos attached`}</Text>
        ) : null}
        {showPlaceholderContent || streaming ? (
          <Text style={styles.bubbleText}>{message.content || (streaming ? 'Establishing response…' : '')}</Text>
        ) : null}
        {route ? <Text style={styles.route}>{route}</Text> : null}
        {message.error ? <Text style={styles.messageError}>{message.error}</Text> : null}
      </View>
      <View style={styles.messageActions}>
        {message.delivery === 'failed' && onRetry ? (
          <HudButton label="Retry" variant="quiet" compact onPress={() => onRetry(message)} />
        ) : null}
        {message.content && onCopy ? (
          <HudButton label="Copy" variant="quiet" compact onPress={() => onCopy(message)} />
        ) : null}
        {!user && !streaming && onRegenerate ? (
          <HudButton label="Regenerate" variant="quiet" compact onPress={() => onRegenerate(message)} />
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shell: { flex: 1, width: '100%', maxWidth: sizes.contentMax, alignSelf: 'center' },
  shellWide: { borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, borderColor: colors.lineDim },
  hero: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  heroRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  heroCopy: { flex: 1 },
  eyebrow: { color: colors.inkFaint, fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1 },
  title: { marginTop: 2, color: colors.accentStrong, fontFamily: fonts.display, fontSize: typeScale.title, letterSpacing: 2 },
  clearButton: { minWidth: 80 },
  statusRow: { marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  statusChip: { flexShrink: 1 },
  syncNote: { marginTop: spacing.xs, color: colors.inkMuted, fontFamily: fonts.mono, fontSize: typeScale.micro, lineHeight: 15 },
  voiceBar: { marginHorizontal: spacing.md, marginTop: spacing.sm },
  voiceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  voiceIndicator: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  voiceDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.inkMuted },
  voiceDotLive: { backgroundColor: colors.accent, shadowColor: colors.accent, shadowOpacity: 0.8, shadowRadius: 7 },
  voiceDotFault: { backgroundColor: colors.danger, shadowColor: colors.danger },
  voiceMeta: { flex: 1, minWidth: 0, gap: 2 },
  voicePhase: { color: colors.accent, fontFamily: fonts.mono, fontSize: typeScale.micro, letterSpacing: 1.2 },
  voiceStatus: { color: colors.inkMuted, fontFamily: fonts.body, fontSize: 14, lineHeight: 17 },
  voiceButton: { minWidth: 92 },
  transcript: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  transcriptLabel: { color: colors.accent, fontFamily: fonts.mono, fontSize: 9, letterSpacing: 1 },
  transcriptText: { marginTop: 2, color: colors.ink, fontFamily: fonts.body, fontSize: typeScale.body, fontStyle: 'italic' },
  errorCard: { marginHorizontal: spacing.md, marginTop: spacing.sm },
  errorText: { color: colors.ink, fontFamily: fonts.body, fontSize: typeScale.body, lineHeight: 21 },
  errorActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  list: { paddingHorizontal: spacing.md, paddingVertical: spacing.md, gap: spacing.md },
  listEmpty: { flexGrow: 1, justifyContent: 'center' },
  empty: { alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.xxxl },
  emptyGlyph: { color: colors.accent, fontFamily: fonts.mono, fontSize: 36 },
  emptyTitle: { marginTop: spacing.md, color: colors.accentStrong, fontFamily: fonts.displayMed, fontSize: 16, letterSpacing: 1.5, textAlign: 'center' },
  emptyText: { marginTop: spacing.sm, color: colors.inkMuted, fontFamily: fonts.body, fontSize: typeScale.body, lineHeight: 21, textAlign: 'center' },
  bubble: { maxWidth: '91%', borderWidth: 1, borderColor: colors.line, borderRadius: 4, backgroundColor: 'rgba(1,8,12,0.86)', paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  bubbleUser: { alignSelf: 'flex-end', marginLeft: '12%', borderColor: 'rgba(137,207,240,0.5)', backgroundColor: 'rgba(21,65,85,0.28)' },
  bubbleAssistant: { alignSelf: 'flex-start', marginRight: '7%' },
  bubbleFailed: { borderColor: 'rgba(255,107,99,0.55)', backgroundColor: colors.dangerSoft },
  bubbleHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  role: { color: colors.accent, fontFamily: fonts.mono, fontSize: typeScale.micro, letterSpacing: 1 },
  messageMeta: { color: colors.inkFaint, fontFamily: fonts.mono, fontSize: 10 },
  bubbleText: { marginTop: spacing.xs, color: colors.ink, fontFamily: fonts.body, fontSize: 17, lineHeight: 23 },
  route: { marginTop: spacing.sm, color: colors.inkFaint, fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.35 },
  messageError: { marginTop: spacing.sm, color: colors.danger, fontFamily: fonts.body, fontSize: 14, lineHeight: 18 },
  messageActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  messageImages: { marginTop: spacing.sm, gap: spacing.xs },
  messageImage: { width: '100%', maxWidth: 280, height: 180, borderRadius: 3, backgroundColor: 'rgba(0,0,0,0.45)' },
  imageStub: { marginTop: spacing.xs, color: colors.inkMuted, fontFamily: fonts.mono, fontSize: typeScale.micro },
  composerBlock: { flexShrink: 0, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: 'rgba(0,5,9,0.96)' },
  draftStrip: { maxHeight: 88, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  draftStripInner: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm, alignItems: 'center' },
  draftThumbWrap: { position: 'relative' },
  draftThumb: { width: 64, height: 64, borderRadius: 3, borderWidth: 1, borderColor: colors.line, backgroundColor: 'rgba(0,0,0,0.5)' },
  draftRemove: { position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  draftRemoveText: { color: colors.ink, fontFamily: fonts.mono, fontSize: 14, lineHeight: 16 },
  composer: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, alignItems: 'flex-end' },
  input: { flex: 1, minHeight: 48, maxHeight: 132, borderWidth: 1, borderColor: colors.line, borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.55)', color: colors.ink, paddingHorizontal: spacing.md, paddingVertical: 11, fontFamily: fonts.body, fontSize: typeScale.body },
  attachButton: { width: sizes.minTarget, paddingHorizontal: 0 },
  sendButton: { minWidth: 84 }
})
