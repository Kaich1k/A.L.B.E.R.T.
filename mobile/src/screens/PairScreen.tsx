import { useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { HudButton } from '../components/HudButton'
import { defaultModelFor, isModelForProvider, modelsFor } from '../lib/chat'
import { normalizeMacUrl, parsePairInfo } from '../lib/pairInfo'
import type { CompanionConfig, LlmProvider } from '../types'
import { colors, fonts } from '../theme'

export function PairScreen({
  config,
  busy,
  error,
  syncNote,
  onChange,
  onSync,
  onSave
}: {
  config: CompanionConfig
  busy: boolean
  error: string | null
  syncNote: string | null
  onChange: (next: CompanionConfig) => void
  onSync: () => void
  onSave: () => void
}): React.JSX.Element {
  const [pasteNote, setPasteNote] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  const setProvider = (provider: LlmProvider) => {
    const model = isModelForProvider(provider, config.model)
      ? config.model
      : defaultModelFor(provider)
    onChange({ ...config, provider, model })
  }

  const pastePairInfo = async () => {
    try {
      const raw = await Clipboard.getStringAsync()
      const parsed = parsePairInfo(raw)
      if (!parsed.macBaseUrl && !parsed.macToken) {
        setPasteNote('Clipboard has no Mac URL / token — Copy pair info on the Mac first')
        return
      }
      onChange({
        ...config,
        macBaseUrl: parsed.macBaseUrl
          ? normalizeMacUrl(parsed.macBaseUrl)
          : config.macBaseUrl,
        macToken: parsed.macToken || config.macToken
      })
      setPasteNote(
        `Pasted${parsed.macBaseUrl ? ' URL' : ''}${parsed.macToken ? ' + token' : ''}`
      )
    } catch (err) {
      setPasteNote(err instanceof Error ? err.message : 'Clipboard read failed')
    }
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>PAIR WITH MAC</Text>
      <Text style={styles.sub}>
        Mac → Systems → Phone companion → enable → Copy pair info. Then Paste below (or type URL +
        token). Simulator: use http://127.0.0.1:47831
      </Text>

      <HudButton label="Paste pair info from clipboard" onPress={() => void pastePairInfo()} />
      {pasteNote ? <Text style={styles.note}>{pasteNote}</Text> : null}

      <Field label="LLM provider">
        <View style={styles.modelRow}>
          <HudButton
            label="Anthropic"
            primary={config.provider === 'anthropic'}
            onPress={() => setProvider('anthropic')}
            style={styles.modelBtn}
          />
          <HudButton
            label="Groq"
            primary={config.provider === 'groq'}
            onPress={() => setProvider('groq')}
            style={styles.modelBtn}
          />
        </View>
      </Field>

      {config.provider === 'anthropic' ? (
        <Field label="Anthropic API key">
          <TextInput
            style={styles.input}
            value={config.anthropicApiKey}
            onChangeText={(anthropicApiKey) => onChange({ ...config, anthropicApiKey })}
            placeholder="sk-ant-..."
            placeholderTextColor={colors.inkFaint}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
        </Field>
      ) : (
        <Field label="Groq API key">
          <TextInput
            style={styles.input}
            value={config.groqApiKey}
            onChangeText={(groqApiKey) => onChange({ ...config, groqApiKey })}
            placeholder="gsk_..."
            placeholderTextColor={colors.inkFaint}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
        </Field>
      )}

      <Field label="Model">
        <View style={styles.modelRow}>
          {modelsFor(config.provider).map((m) => {
            const on = config.model === m.value
            return (
              <HudButton
                key={m.value}
                label={m.label}
                primary={on}
                onPress={() => onChange({ ...config, model: m.value })}
                style={styles.modelBtn}
              />
            )
          })}
        </View>
      </Field>

      <Field label="Mac companion URL">
        <TextInput
          style={styles.input}
          value={config.macBaseUrl}
          onChangeText={(macBaseUrl) => onChange({ ...config, macBaseUrl })}
          onBlur={() => {
            const n = normalizeMacUrl(config.macBaseUrl)
            if (n !== config.macBaseUrl) onChange({ ...config, macBaseUrl: n })
          }}
          placeholder="http://192.168.x.x:47831"
          placeholderTextColor={colors.inkFaint}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
        />
      </Field>

      <Field label="Pairing token">
        <TextInput
          style={styles.input}
          value={config.macToken}
          onChangeText={(macToken) => {
            const parsed = parsePairInfo(macToken)
            if (parsed.macBaseUrl || (parsed.macToken && parsed.macToken !== macToken)) {
              onChange({
                ...config,
                macBaseUrl: parsed.macBaseUrl
                  ? normalizeMacUrl(parsed.macBaseUrl)
                  : config.macBaseUrl,
                macToken: parsed.macToken || macToken.trim()
              })
              return
            }
            onChange({ ...config, macToken })
          }}
          placeholder="from Mac Systems"
          placeholderTextColor={colors.inkFaint}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
        />
      </Field>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {syncNote ? <Text style={styles.ok}>{syncNote}</Text> : null}
      {savedFlash ? <Text style={styles.ok}>Pairing saved</Text> : null}

      <View style={styles.actions}>
        <HudButton
          label="Save pairing"
          primary
          disabled={busy}
          onPress={() => {
            onSave()
            setSavedFlash(true)
            setTimeout(() => setSavedFlash(false), 1600)
          }}
        />
        <HudButton
          label={busy ? 'Syncing…' : 'Test sync (chat + memory)'}
          onPress={onSync}
          disabled={busy}
        />
      </View>
    </ScrollView>
  )
}

function Field({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 40, gap: 10 },
  title: {
    fontFamily: fonts.displayMed,
    fontSize: 18,
    letterSpacing: 2,
    color: colors.accentStrong
  },
  sub: {
    marginTop: 2,
    marginBottom: 8,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.inkMuted,
    lineHeight: 18
  },
  field: { marginBottom: 6, gap: 6 },
  label: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.inkMuted
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: 'rgba(0,0,0,0.45)',
    color: colors.ink,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontFamily: fonts.body,
    fontSize: 16
  },
  modelRow: { gap: 8 },
  modelBtn: { marginBottom: 0 },
  actions: { gap: 10, marginTop: 8 },
  note: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.inkMuted
  },
  error: {
    fontFamily: fonts.mono,
    fontSize: 13,
    color: colors.danger,
    lineHeight: 18
  },
  ok: {
    fontFamily: fonts.mono,
    fontSize: 13,
    color: colors.ok,
    lineHeight: 18
  }
})
