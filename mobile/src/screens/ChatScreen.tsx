import { useEffect, useRef } from 'react'
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions
} from 'react-native'
import { APP_NAME } from '../brand'
import { HudButton } from '../components/HudButton'
import { HudCard } from '../components/HudCard'
import { StatusChip } from '../components/StatusChip'
import type { ChatMessage, MacLinkState, VoicePhase } from '../types'
import { colors, fonts, sizes, spacing, typeScale } from '../theme'

export interface ChatScreenProps {
  messages: ChatMessage[]
  draft: string
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
  keyboardVerticalOffset?: number
  onChangeDraft: (value: string) => void
  onSend: () => void
  onPurge: () => void
  onToggleVoice: () => void
  onCancel?: () => void
  onAttach?: () => void
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
  keyboardVerticalOffset = 0,
  onChangeDraft,
  onSend,
  onPurge,
  onToggleVoice,
  onCancel,
  onAttach,
  onRetryMessage,
  onCopyMessage,
  onRegenerate,
  onDismissError,
  onOpenSystems
}: ChatScreenProps): React.JSX.Element {
  const listRef = useRef<FlatList<ChatMessage>>(null)
  const autoFollowRef = useRef(true)
  const { width } = useWindowDimensions()
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

  useEffect(() => {
    if (!autoFollowRef.current) return
    listRef.current?.scrollToEnd({ animated: messages.length > 1 })
  }, [messages.length, streamingText])

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

  const data = streamingText
    ? [
        ...messages,
        {
          id: '__streaming__',
          role: 'assistant' as const,
          content: streamingText,
          createdAt: Date.now(),
          delivery: 'pending' as const
        }
      ]
    : messages

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={keyboardVerticalOffset}
    >
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
              glyph="×"
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
                  {!voiceSupported ? 'Voice setup required — open Systems for microphone access.' : voiceStatus}
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
          onScroll={({ nativeEvent }) => {
            const distance =
              nativeEvent.contentSize.height -
              (nativeEvent.contentOffset.y + nativeEvent.layoutMeasurement.height)
            autoFollowRef.current = distance < 96
          }}
          scrollEventThrottle={48}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text allowFontScaling={false} style={styles.emptyGlyph}>◇</Text>
              <Text style={styles.emptyTitle}>CHANNEL STANDING BY</Text>
              <Text style={styles.emptyText}>
                Send a message, engage voice, or say “Albert, wake up”. Paired messages reconcile with the Mac when the secure uplink is available.
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

        <View style={styles.composer}>
          {onAttach ? (
            <HudButton
              label="Attach"
              glyph="＋"
              variant="quiet"
              accessibilityLabel="Attach image or file"
              onPress={onAttach}
              disabled={busy}
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
            accessibilityHint="Enter a message for Albert"
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
              disabled={busy || !draft.trim()}
              onPress={onSend}
              style={styles.sendButton}
            />
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
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
  return (
    <View
      style={[styles.bubble, user ? styles.bubbleUser : styles.bubbleAssistant, message.delivery === 'failed' && styles.bubbleFailed]}
    >
      <View
        accessible
        accessibilityLabel={`${user ? 'You' : 'Albert'}, ${formatTime(message.createdAt)}. ${message.content}${delivery ? `. ${delivery}` : ''}`}
      >
        <View style={styles.bubbleHeader}>
          <Text style={styles.role}>{user ? 'YOU' : APP_NAME}</Text>
          <Text style={styles.messageMeta}>
            {formatTime(message.createdAt)}{delivery ? ` · ${delivery}` : ''}
          </Text>
        </View>
        <Text style={styles.bubbleText}>{message.content || (streaming ? 'Establishing response…' : '')}</Text>
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
  composer: { flexShrink: 0, flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line, alignItems: 'flex-end', backgroundColor: 'rgba(0,5,9,0.96)' },
  input: { flex: 1, minHeight: 48, maxHeight: 132, borderWidth: 1, borderColor: colors.line, borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.55)', color: colors.ink, paddingHorizontal: spacing.md, paddingVertical: 11, fontFamily: fonts.body, fontSize: typeScale.body },
  attachButton: { width: sizes.minTarget, paddingHorizontal: 0 },
  sendButton: { minWidth: 84 }
})
