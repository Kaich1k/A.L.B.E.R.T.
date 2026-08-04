import { useRef } from 'react'
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { APP_NAME } from '../brand'
import { HudButton } from '../components/HudButton'
import type { ChatMessage, VoicePhase } from '../types'
import { colors, fonts } from '../theme'

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
  onChangeDraft,
  onSend,
  onPurge,
  onToggleVoice
}: {
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
  onChangeDraft: (v: string) => void
  onSend: () => void
  onPurge: () => void
  onToggleVoice: () => void
}): React.JSX.Element {
  const listRef = useRef<FlatList<ChatMessage>>(null)
  const insets = useSafeAreaInsets()
  const voiceEngaged = voicePhase !== 'standby'

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
    >
      <View style={styles.hero}>
        <View style={styles.heroRow}>
          <Text style={styles.brand}>COMM LINK</Text>
          <HudButton label="Purge" onPress={onPurge} disabled={busy} style={styles.purge} />
        </View>
        <Text style={styles.tag}>Shared with Mac {APP_NAME} when uplink is up.</Text>
      </View>

      <Text
        style={[
          styles.status,
          statusTone === 'ok' && styles.statusOk,
          statusTone === 'bad' && styles.statusBad
        ]}
      >
        {statusLabel}
        {syncNote ? ` · ${syncNote}` : ''}
      </Text>

      <View style={styles.voiceBar}>
        <View style={styles.voiceMeta}>
          <Text style={styles.voicePhase}>{voicePhase.toUpperCase()}</Text>
          <Text style={styles.voiceStatus} numberOfLines={2}>
            {!voiceSupported
              ? 'Voice needs a native/dev build (not Expo Go)'
              : voiceStatus}
          </Text>
        </View>
        <HudButton
          label={
            !voiceSupported
              ? 'No mic'
              : voiceEngaged
                ? 'Take 5'
                : 'Voice'
          }
          primary={voiceSupported && !voiceEngaged}
          disabled={!voiceSupported}
          onPress={onToggleVoice}
          style={styles.voiceBtn}
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        ref={listRef}
        style={styles.flex}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={
          <Text style={styles.hint}>
            Same Comm thread as your Mac. Pair under PAIR, then chat — or tap Voice / say
            “Albert, wake up”.
          </Text>
        }
        renderItem={({ item }) => (
          <View
            style={[
              styles.bubble,
              item.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant
            ]}
          >
            <Text style={styles.role}>{item.role === 'user' ? 'YOU' : APP_NAME}</Text>
            <Text style={styles.bubbleText}>{item.content}</Text>
          </View>
        )}
      />

      <View
        style={[
          styles.composer,
          { paddingBottom: Math.max(insets.bottom, 10) + 8 }
        ]}
      >
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={onChangeDraft}
          placeholder={`Message ${APP_NAME}…`}
          placeholderTextColor={colors.inkFaint}
          multiline
          editable={!busy}
        />
        <HudButton
          label={busy ? '…' : 'Send'}
          primary
          disabled={busy || !draft.trim()}
          onPress={onSend}
          style={styles.send}
        />
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10
  },
  brand: {
    fontFamily: fonts.display,
    fontSize: 22,
    letterSpacing: 2,
    color: colors.accentStrong
  },
  purge: { paddingVertical: 8, paddingHorizontal: 10 },
  tag: {
    marginTop: 6,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.inkMuted,
    lineHeight: 18
  },
  status: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 0.8,
    color: colors.inkMuted,
    paddingHorizontal: 16,
    paddingVertical: 8
  },
  statusOk: { color: colors.ok },
  statusBad: { color: colors.danger },
  voiceBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 14,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: 'rgba(0,0,0,0.35)'
  },
  voiceMeta: { flex: 1, gap: 2 },
  voicePhase: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.accent
  },
  voiceStatus: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.inkMuted,
    lineHeight: 17
  },
  voiceBtn: {
    minWidth: 84,
    paddingVertical: 10,
    paddingHorizontal: 12
  },
  error: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(137, 207, 240, 0.45)',
    backgroundColor: colors.accentSoft,
    color: colors.ink,
    fontFamily: fonts.body,
    fontSize: 14
  },
  list: {
    paddingHorizontal: 14,
    paddingBottom: 12,
    gap: 10
  },
  hint: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.inkMuted,
    lineHeight: 20,
    paddingTop: 8
  },
  bubble: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    maxWidth: '92%'
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    borderColor: 'rgba(137, 207, 240, 0.45)',
    marginLeft: '18%'
  },
  bubbleAssistant: {
    alignSelf: 'flex-start',
    marginRight: '8%'
  },
  role: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.accent,
    marginBottom: 4
  },
  bubbleText: {
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
    lineHeight: 22
  },
  composer: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    alignItems: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)'
  },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: 'rgba(0,0,0,0.45)',
    color: colors.ink,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.body,
    fontSize: 16
  },
  send: {
    minWidth: 72
  }
})
