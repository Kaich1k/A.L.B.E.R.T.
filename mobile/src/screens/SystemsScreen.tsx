import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
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
import { defaultModelFor, isModelForProvider } from '../lib/chat'
import type { CompanionConfig, LlmProvider, MacLinkState, SyncState } from '../types'
import { colors, fonts, sizes, spacing, typeScale } from '../theme'

export interface ModelOption {
  value: string
  label: string
  note?: string
}

export interface SystemsScreenProps {
  config: CompanionConfig
  busy: boolean
  error: string | null
  syncNote: string | null
  linkState?: MacLinkState
  syncState?: SyncState
  remoteName?: string
  modelOptions?: ReadonlyArray<ModelOption>
  onChange: (next: CompanionConfig) => void
  onSave: () => void | Promise<void>
  onSync: () => void | Promise<void>
  onPastePairInfo?: () => void | Promise<void>
  onUnpair?: () => void | Promise<void>
  onRequestVoicePermission?: () => void | Promise<void>
  onOpenPrivacy?: () => void
}

const FALLBACK_MODELS: Record<LlmProvider, ReadonlyArray<ModelOption>> = {
  auto: [
    { value: 'openai/gpt-oss-20b', label: 'Groq · GPT-OSS 20B', note: 'Fastest available configured brain' },
    { value: 'openai/gpt-oss-120b', label: 'Groq · GPT-OSS 120B', note: 'Higher-capability free-cloud route' },
    { value: 'qwen/qwen3.6-27b', label: 'Groq · Qwen 27B', note: 'Preview route' },
    { value: 'claude-haiku-4-5', label: 'Anthropic · Haiku', note: 'Fast, concise voice and chat' },
    { value: 'claude-sonnet-4-6', label: 'Anthropic · Sonnet', note: 'Balanced reasoning' },
    { value: 'claude-opus-4-8', label: 'Anthropic · Opus', note: 'Deep work' }
  ],
  anthropic: [
    { value: 'claude-haiku-4-5', label: 'Haiku', note: 'Fast, concise voice and chat' },
    { value: 'claude-sonnet-4-6', label: 'Sonnet', note: 'Balanced reasoning' },
    { value: 'claude-opus-4-8', label: 'Opus', note: 'Deep work' }
  ],
  groq: [
    { value: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B', note: 'Fast free-cloud route' },
    { value: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', note: 'Higher-capability free-cloud route' },
    { value: 'qwen/qwen3.6-27b', label: 'Qwen 27B', note: 'Preview route' }
  ]
}

function linkLabel(state: MacLinkState): string {
  if (state === 'authenticated') return 'SECURE'
  if (state === 'syncing') return 'SYNCING'
  if (state === 'checking') return 'CHECKING'
  if (state === 'enrolling') return 'ENROLLING'
  if (state === 'offline') return 'OFFLINE'
  if (state === 'auth-failed') return 'AUTH FAULT'
  if (state === 'fault') return 'FAULT'
  return 'UNPAIRED'
}

function linkTone(state: MacLinkState): 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' {
  if (state === 'authenticated') return 'ok'
  if (state === 'syncing' || state === 'checking' || state === 'enrolling') return 'accent'
  if (state === 'offline' || state === 'unconfigured') return 'warn'
  return 'danger'
}

function formatSyncTime(timestamp?: number): string {
  if (!timestamp) return 'NEVER'
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).toUpperCase()
}

export function SystemsScreen({
  config,
  busy,
  error,
  syncNote,
  linkState = config.macCredential ? 'authenticated' : config.macBaseUrl ? 'offline' : 'unconfigured',
  syncState,
  remoteName,
  modelOptions,
  onChange,
  onSave,
  onSync,
  onPastePairInfo,
  onUnpair,
  onRequestVoicePermission,
  onOpenPrivacy
}: SystemsScreenProps): React.JSX.Element {
  const { width } = useWindowDimensions()
  const wide = width >= sizes.tabletBreakpoint
  const [showProviderKey, setShowProviderKey] = useState(false)
  const [showEnrollmentToken, setShowEnrollmentToken] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'fault'>('idle')
  const [localFault, setLocalFault] = useState<string | null>(null)
  const saveResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const options = modelOptions ?? FALLBACK_MODELS[config.provider]
  const providerKey = config.provider === 'groq' ? config.groqApiKey : config.anthropicApiKey

  useEffect(
    () => () => {
      if (saveResetTimer.current) clearTimeout(saveResetTimer.current)
    },
    []
  )

  const paired = Boolean(config.macCredential || (config.macBaseUrl.trim() && config.macToken.trim()))
  const diagnostics = useMemo(
    () => [
      ['REMOTE', remoteName || syncState?.remoteName || 'NOT IDENTIFIED'],
      ['PROTOCOL', syncState?.protocolVersion ? `V${syncState.protocolVersion}` : 'NEGOTIATING'],
      ['LAST SYNC', formatSyncTime(syncState?.lastSyncAt)],
      ['PENDING', String(syncState?.outbox.length || 0)]
    ],
    [remoteName, syncState]
  )

  const setProvider = (provider: LlmProvider): void => {
    const nextModel = isModelForProvider(provider, config.model)
      ? config.model
      : defaultModelFor(provider)
    onChange({ ...config, provider, model: nextModel })
  }

  const save = async (): Promise<void> => {
    setLocalFault(null)
    setSaveState('saving')
    try {
      await onSave()
      setSaveState('saved')
      if (saveResetTimer.current) clearTimeout(saveResetTimer.current)
      saveResetTimer.current = setTimeout(() => setSaveState('idle'), 1_800)
    } catch (caught) {
      setSaveState('fault')
      setLocalFault(caught instanceof Error ? caught.message : 'Settings could not be saved')
    }
  }

  const runAction = async (
    action: () => void | Promise<void>,
    fallback: string
  ): Promise<void> => {
    setLocalFault(null)
    try {
      await action()
    } catch (caught) {
      setLocalFault(caught instanceof Error ? caught.message : fallback)
    }
  }

  const confirmUnpair = (): void => {
    if (!onUnpair) return
    Alert.alert(
      'Unpair this Mac?',
      'This removes the device credential from the phone. Local Comm and memory remain on this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unpair',
          style: 'destructive',
          onPress: () => void runAction(onUnpair, 'Mac link could not be removed')
        }
      ]
    )
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, wide && styles.contentWide]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      >
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>CONFIGURATION & TRUST CONTROL</Text>
            <Text style={styles.title}>SYSTEMS</Text>
            <Text style={styles.sub}>Phone brain, secure Mac uplink, voice behavior, and privacy.</Text>
          </View>
          <StatusChip label={`LINK ${linkLabel(linkState)}`} tone={linkTone(linkState)} pulse={linkState === 'syncing'} />
        </View>

        <View style={[styles.grid, wide && styles.gridWide]}>
          <View style={styles.column}>
            <HudCard eyebrow="COGNITIVE ROUTING" title="Phone brain" tone="accent">
              <Text style={styles.help}>
                This brain answers on the phone. The paired Mac may use a different route; each Comm response records its actual model.
              </Text>
              <FieldLabel text="Provider" />
              <View style={styles.segmentRow}>
                {(['auto', 'anthropic', 'groq'] as const).map((provider) => (
                  <HudButton
                    key={provider}
                    label={provider === 'auto' ? 'Auto' : provider === 'anthropic' ? 'Anthropic' : 'Groq'}
                    selected={config.provider === provider}
                    primary={config.provider === provider}
                    onPress={() => setProvider(provider)}
                    style={styles.segmentButton}
                  />
                ))}
              </View>

              {config.provider === 'auto' ? (
                <>
                  <FieldLabel text="Anthropic API key" />
                  <View style={styles.inputRow}>
                    <TextInput
                      value={config.anthropicApiKey}
                      onChangeText={(anthropicApiKey) => onChange({ ...config, anthropicApiKey })}
                      accessibilityLabel="Anthropic API key"
                      placeholder="sk-ant-…"
                      placeholderTextColor={colors.inkFaint}
                      secureTextEntry={!showProviderKey}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="off"
                      style={styles.input}
                    />
                    <HudButton
                      label={showProviderKey ? 'Hide' : 'Show'}
                      variant="quiet"
                      accessibilityLabel={showProviderKey ? 'Hide provider keys' : 'Show provider keys'}
                      onPress={() => setShowProviderKey((value) => !value)}
                      style={styles.revealButton}
                    />
                  </View>
                  <FieldLabel text="Groq API key" />
                  <View style={styles.inputRow}>
                    <TextInput
                      value={config.groqApiKey}
                      onChangeText={(groqApiKey) => onChange({ ...config, groqApiKey })}
                      accessibilityLabel="Groq API key"
                      placeholder="gsk_…"
                      placeholderTextColor={colors.inkFaint}
                      secureTextEntry={!showProviderKey}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="off"
                      style={styles.input}
                    />
                    <HudButton
                      label={showProviderKey ? 'Hide' : 'Show'}
                      variant="quiet"
                      accessibilityLabel={showProviderKey ? 'Hide provider keys' : 'Show provider keys'}
                      onPress={() => setShowProviderKey((value) => !value)}
                      style={styles.revealButton}
                    />
                  </View>
                </>
              ) : (
                <>
                  <FieldLabel text={`${config.provider === 'groq' ? 'Groq' : 'Anthropic'} API key`} />
                  <View style={styles.inputRow}>
                    <TextInput
                      value={providerKey}
                      onChangeText={(value) =>
                        onChange(
                          config.provider === 'groq'
                            ? { ...config, groqApiKey: value }
                            : { ...config, anthropicApiKey: value }
                        )
                      }
                      accessibilityLabel={`${config.provider} API key`}
                      placeholder={config.provider === 'groq' ? 'gsk_…' : 'sk-ant-…'}
                      placeholderTextColor={colors.inkFaint}
                      secureTextEntry={!showProviderKey}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="off"
                      style={styles.input}
                    />
                    <HudButton
                      label={showProviderKey ? 'Hide' : 'Show'}
                      variant="quiet"
                      accessibilityLabel={showProviderKey ? 'Hide API key' : 'Show API key'}
                      onPress={() => setShowProviderKey((value) => !value)}
                      style={styles.revealButton}
                    />
                  </View>
                </>
              )}

              <FieldLabel text="Model route" />
              <View style={styles.modelStack}>
                {options.map((model) => (
                  <Pressable
                    key={model.value}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: config.model === model.value }}
                    accessibilityLabel={`${model.label}${model.note ? `. ${model.note}` : ''}`}
                    onPress={() => onChange({ ...config, model: model.value })}
                    style={({ pressed }) => [
                      styles.modelOption,
                      config.model === model.value && styles.modelOptionOn,
                      pressed && styles.pressed
                    ]}
                  >
                    <View style={[styles.radio, config.model === model.value && styles.radioOn]} />
                    <View style={styles.modelCopy}>
                      <Text style={styles.modelLabel}>{model.label}</Text>
                      {model.note ? <Text style={styles.modelNote}>{model.note}</Text> : null}
                    </View>
                  </Pressable>
                ))}
              </View>
            </HudCard>

            <HudCard eyebrow="VOICE MATRIX" title="Listening & speech">
              <SettingToggle
                label="Speak replies"
                detail="Read Albert responses aloud while voice is engaged."
                value={config.speakReplies}
                onChange={(speakReplies) => onChange({ ...config, speakReplies })}
              />
              <SettingToggle
                label="Wake on launch"
                detail="Arm the wake phrase after the app becomes active."
                value={config.wakeOnLaunch}
                onChange={(wakeOnLaunch) => onChange({ ...config, wakeOnLaunch })}
              />
              <SettingToggle
                label="Reduce interface motion"
                detail="Use static state changes instead of rotating or pulsing HUD elements."
                value={config.reducedMotion}
                onChange={(reducedMotion) => onChange({ ...config, reducedMotion })}
              />
              <FieldLabel text={`Voice speed · ${config.voiceRate.toFixed(2)}×`} />
              <View style={styles.rateRow}>
                <HudButton
                  label="Slower"
                  glyph="−"
                  onPress={() => onChange({ ...config, voiceRate: Math.max(0.7, Number((config.voiceRate - 0.05).toFixed(2))) })}
                  disabled={config.voiceRate <= 0.7}
                  style={styles.rateButton}
                />
                <HudButton
                  label="Reset"
                  variant="quiet"
                  onPress={() => onChange({ ...config, voiceRate: 1.05 })}
                  style={styles.rateButton}
                />
                <HudButton
                  label="Faster"
                  glyph="＋"
                  onPress={() => onChange({ ...config, voiceRate: Math.min(1.35, Number((config.voiceRate + 0.05).toFixed(2))) })}
                  disabled={config.voiceRate >= 1.35}
                  style={styles.rateButton}
                />
              </View>
              {onRequestVoicePermission ? (
                <HudButton
                  label="Check microphone access"
                  onPress={() => void runAction(onRequestVoicePermission, 'Microphone access could not be checked')}
                />
              ) : null}
            </HudCard>
          </View>

          <View style={styles.column}>
            <HudCard eyebrow="SECURE UPLINK" title="Mac companion" tone={paired ? 'accent' : 'warn'}>
              <Text style={styles.help}>
                Pair on a trusted network. Enrollment creates a revocable device credential; the bootstrap token is not retained on this phone after success.
              </Text>
              {onPastePairInfo ? (
                <HudButton
                  label="Paste enrollment info"
                  glyph="⌁"
                  onPress={() => void runAction(onPastePairInfo, 'Enrollment info could not be pasted')}
                />
              ) : null}
              <FieldLabel text="Device name" />
              <TextInput
                value={config.deviceName}
                onChangeText={(deviceName) => onChange({ ...config, deviceName })}
                accessibilityLabel="This device name"
                placeholder="Kai's iPhone"
                placeholderTextColor={colors.inkFaint}
                autoCapitalize="words"
                style={styles.input}
              />
              <FieldLabel text="Mac companion URL" />
              <TextInput
                value={config.macBaseUrl}
                onChangeText={(macBaseUrl) => onChange({ ...config, macBaseUrl })}
                accessibilityLabel="Mac companion URL"
                accessibilityHint="Local or secure Tailscale address for the Mac companion"
                placeholder="http://192.168.x.x:47831"
                placeholderTextColor={colors.inkFaint}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                keyboardType="url"
                style={styles.input}
              />
              {!config.macCredential ? (
                <>
                  <FieldLabel text="Mac pairing token" />
                  <View style={styles.inputRow}>
                    <TextInput
                      value={config.macToken}
                      onChangeText={(macToken) => onChange({ ...config, macToken })}
                      accessibilityLabel="Mac pairing token"
                      placeholder="Paste from Mac Systems"
                      placeholderTextColor={colors.inkFaint}
                      secureTextEntry={!showEnrollmentToken}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="off"
                      style={styles.input}
                    />
                    <HudButton
                      label={showEnrollmentToken ? 'Hide' : 'Show'}
                      variant="quiet"
                      onPress={() => setShowEnrollmentToken((value) => !value)}
                      style={styles.revealButton}
                    />
                  </View>
                </>
              ) : (
                <StatusChip label="DEVICE CREDENTIAL STORED SECURELY" tone="ok" />
              )}
              <SettingToggle
                label="Automatic sync"
                detail="Reconcile pending local changes when the secure Mac link becomes available."
                value={config.autoSync}
                onChange={(autoSync) => onChange({ ...config, autoSync })}
              />
              <View style={styles.actionStack}>
                <HudButton
                  label={saveState === 'saved' ? 'Settings saved' : saveState === 'fault' ? 'Save failed' : 'Save settings'}
                  primary
                  loading={saveState === 'saving'}
                  disabled={busy}
                  onPress={() => void save()}
                />
                <HudButton
                  label={busy || linkState === 'syncing'
                    ? 'Testing & syncing'
                    : config.macCredential
                      ? 'Test secure link'
                      : 'Enroll & sync'}
                  loading={busy || linkState === 'syncing'}
                  disabled={busy || !config.macBaseUrl.trim() || (!config.macCredential && !config.macToken.trim())}
                  onPress={() => void runAction(onSync, 'Secure link test failed')}
                />
                {paired && onUnpair ? (
                  <HudButton label="Unpair this Mac" variant="danger" onPress={confirmUnpair} />
                ) : null}
              </View>
            </HudCard>

            <HudCard eyebrow="SYNC DIAGNOSTICS" title="Link telemetry">
              <View style={styles.diagnostics}>
                {diagnostics.map(([label, value]) => (
                  <View key={label} style={styles.diagnosticRow} accessible accessibilityLabel={`${label}: ${value}`}>
                    <Text style={styles.diagnosticLabel}>{label}</Text>
                    <Text style={styles.diagnosticValue} numberOfLines={1}>{value}</Text>
                  </View>
                ))}
              </View>
              {syncState?.lastError ? <Text style={styles.faultText} accessibilityRole="alert">{syncState.lastError}</Text> : null}
              {syncNote ? <Text style={styles.okText} accessibilityLiveRegion="polite">{syncNote}</Text> : null}
            </HudCard>

            <HudCard eyebrow="PRIVACY CONTROL" title="Private by design">
              <Text style={styles.help}>
                Provider keys and device credentials remain in secure device storage. Local Comm and memory stay on this phone until you explicitly pair and sync.
              </Text>
              <View style={styles.privacyFacts}>
                <PrivacyFact label="API KEYS" value="SECURE STORE" />
                <PrivacyFact label="MAC ACTIONS" value="APPROVAL GATED" />
                <PrivacyFact label="SYNC" value={config.autoSync ? 'ENABLED' : 'MANUAL'} />
              </View>
              {onOpenPrivacy ? <HudButton label="Privacy details" variant="quiet" onPress={onOpenPrivacy} /> : null}
            </HudCard>
          </View>
        </View>

        {localFault || error ? (
          <HudCard tone="danger" eyebrow="SYSTEM FAULT">
            <Text style={styles.faultText} accessibilityRole="alert">{localFault || error}</Text>
          </HudCard>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function FieldLabel({ text }: { text: string }): React.JSX.Element {
  return <Text style={styles.fieldLabel}>{text}</Text>
}

function SettingToggle({
  label,
  detail,
  value,
  onChange
}: {
  label: string
  detail: string
  value: boolean
  onChange: (value: boolean) => void
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      accessibilityHint={detail}
      onPress={() => onChange(!value)}
      style={({ pressed }) => [styles.toggleRow, pressed && styles.pressed]}
    >
      <View style={styles.toggleCopy}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleDetail}>{detail}</Text>
      </View>
      <View style={[styles.toggleTrack, value && styles.toggleTrackOn]}>
        <View style={[styles.toggleThumb, value && styles.toggleThumbOn]} />
      </View>
    </Pressable>
  )
}

function PrivacyFact({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.privacyFact} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.privacyLabel}>{label}</Text>
      <Text style={styles.privacyValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { width: '100%', maxWidth: sizes.contentMax, alignSelf: 'center', paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xxxl, gap: spacing.md },
  contentWide: { maxWidth: 1_080, paddingHorizontal: spacing.xl },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  headerCopy: { flex: 1 },
  eyebrow: { color: colors.inkFaint, fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.1 },
  title: { marginTop: 2, color: colors.accentStrong, fontFamily: fonts.display, fontSize: typeScale.title, letterSpacing: 2 },
  sub: { marginTop: spacing.xs, color: colors.inkMuted, fontFamily: fonts.body, fontSize: typeScale.body, lineHeight: 20 },
  grid: { gap: spacing.md },
  gridWide: { flexDirection: 'row', alignItems: 'flex-start' },
  column: { flex: 1, minWidth: 0, gap: spacing.md },
  help: { color: colors.inkMuted, fontFamily: fonts.body, fontSize: typeScale.body, lineHeight: 21, marginBottom: spacing.sm },
  fieldLabel: { marginTop: spacing.md, marginBottom: spacing.xs, color: colors.inkMuted, fontFamily: fonts.mono, fontSize: typeScale.micro, letterSpacing: 1, textTransform: 'uppercase' },
  segmentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  segmentButton: { flexGrow: 1, flexBasis: 92 },
  inputRow: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.xs },
  input: { flex: 1, minHeight: sizes.minTarget + 4, borderWidth: 1, borderColor: colors.line, borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.48)', color: colors.ink, paddingHorizontal: spacing.md, paddingVertical: 10, fontFamily: fonts.body, fontSize: typeScale.body },
  revealButton: { minWidth: 68 },
  modelStack: { gap: spacing.xs },
  modelOption: { minHeight: sizes.minTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1, borderColor: colors.lineDim, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  modelOptionOn: { borderColor: colors.lineStrong, backgroundColor: colors.accentFaint },
  radio: { width: 16, height: 16, borderRadius: 8, borderWidth: 1, borderColor: colors.inkMuted },
  radioOn: { borderWidth: 5, borderColor: colors.accent },
  modelCopy: { flex: 1 },
  modelLabel: { color: colors.ink, fontFamily: fonts.bodyBold, fontSize: typeScale.body },
  modelNote: { color: colors.inkMuted, fontFamily: fonts.body, fontSize: 14, lineHeight: 17 },
  toggleRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.lineDim },
  toggleCopy: { flex: 1 },
  toggleLabel: { color: colors.ink, fontFamily: fonts.bodyBold, fontSize: typeScale.body },
  toggleDetail: { marginTop: 2, color: colors.inkMuted, fontFamily: fonts.body, fontSize: 14, lineHeight: 17 },
  toggleTrack: { width: 48, height: 28, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg3, padding: 3 },
  toggleTrackOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.inkMuted },
  toggleThumbOn: { alignSelf: 'flex-end', backgroundColor: colors.accentStrong, shadowColor: colors.accent, shadowOpacity: 0.8, shadowRadius: 6 },
  rateRow: { flexDirection: 'row', gap: spacing.xs },
  rateButton: { flex: 1 },
  actionStack: { marginTop: spacing.md, gap: spacing.sm },
  diagnostics: { gap: spacing.xs },
  diagnosticRow: { minHeight: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.lineDim },
  diagnosticLabel: { color: colors.inkFaint, fontFamily: fonts.mono, fontSize: typeScale.micro, letterSpacing: 0.8 },
  diagnosticValue: { flex: 1, color: colors.accent, fontFamily: fonts.mono, fontSize: typeScale.micro, textAlign: 'right' },
  faultText: { marginTop: spacing.sm, color: colors.danger, fontFamily: fonts.body, fontSize: typeScale.body, lineHeight: 21 },
  okText: { marginTop: spacing.sm, color: colors.ok, fontFamily: fonts.body, fontSize: typeScale.body, lineHeight: 21 },
  privacyFacts: { marginBottom: spacing.sm, gap: spacing.xs },
  privacyFact: { minHeight: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  privacyLabel: { color: colors.inkFaint, fontFamily: fonts.mono, fontSize: typeScale.micro, letterSpacing: 0.8 },
  privacyValue: { color: colors.ok, fontFamily: fonts.mono, fontSize: typeScale.micro, letterSpacing: 0.5 },
  pressed: { opacity: 0.62 }
})
