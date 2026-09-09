import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CLAUDE_DASHBOARD_URL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GROQ_MODEL,
  DEFAULT_PERSONALITY,
  PERSONALITY_META,
  type AlbertSettings,
  type LocalProvider,
  type OllamaEndpointMode,
  type PersonalityKey,
  type RoutingMode,
  type TtsProvider
} from '../../../shared/types'
import type { ChatGptImportScan } from '../../../shared/api'
import type { CodexStatus } from '../../../shared/types'
import { normalizePersonality } from '../../../shared/personality'
import { APP_NAME } from '../../../shared/brand'
import { groqTransitionWindowOpen } from '../../../shared/groqModels'
import { useAlbertStore } from '../store'
import { listTtsVoices, speakText, stopSpeaking } from '../voice/tts'

const KOKORO_VOICES = [
  { id: 'am_michael', label: 'Michael (US male) — recommended' },
  { id: 'am_fenrir', label: 'Fenrir (US male)' },
  { id: 'am_puck', label: 'Puck (US male)' },
  { id: 'am_echo', label: 'Echo (US male)' },
  { id: 'af_bella', label: 'Bella (US female)' },
  { id: 'af_nicole', label: 'Nicole (US female)' },
  { id: 'af_heart', label: 'Heart (US female)' },
  { id: 'af_sarah', label: 'Sarah (US female)' },
  { id: 'bm_george', label: 'George (UK male)' },
  { id: 'bm_daniel', label: 'Daniel (UK male)' },
  { id: 'bf_emma', label: 'Emma (UK female)' },
  { id: 'bf_isabella', label: 'Isabella (UK female)' }
] as const

function settingsPayload(form: AlbertSettings): Partial<AlbertSettings> {
  return {
    ...form,
    model: form.powerModel,
    powerModel: form.powerModel,
    personality: normalizePersonality(form.personality)
  }
}

const MODEL_OPTIONS = [
  'claude-haiku-4-5',
  'claude-sonnet-4-6',
  'claude-sonnet-5',
  'claude-opus-4-8',
  'claude-opus-5'
]

const OLLAMA_MODEL_OPTIONS: Array<{ id: string; label: string; disabled?: boolean }> = [
  { id: 'qwen3.5:4b', label: 'qwen3.5:4b — recommended · ~3.4GB' },
  { id: 'qwen3.5:9b', label: 'qwen3.5:9b — stronger, slower · ~6.6GB' },
  { id: 'llama3.1:8b', label: 'llama3.1:8b — solid 8B baseline' },
  { id: 'llama3.2:3b', label: 'llama3.2:3b' },
  { id: 'llama3.2:1b', label: 'llama3.2:1b — smallest/fastest' },
  { id: 'qwen2.5:7b', label: 'qwen2.5:7b' },
  { id: 'mistral', label: 'mistral' },
  { id: 'gpt-oss:20b', label: 'gpt-oss:20b — ~14GB; not recommended on 16GB' },
  { id: 'gpt-oss:120b', label: 'gpt-oss:120b — unsuitable on this 16GB Mac', disabled: true }
]

const GROQ_MODEL_OPTIONS = [
  { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B — recommended · ~1,000 tok/s' },
  { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B — stronger reasoning' },
  { id: 'qwen/qwen3.6-27b', label: 'Qwen 3.6 27B — preview; availability may change' },
  ...(groqTransitionWindowOpen()
    ? [
        { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B — temporary bridge · retires Aug 16' },
        { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B — temporary bridge · retires Aug 16' }
      ]
    : [])
]

const GEMINI_MODEL_OPTIONS = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash — recommended free tier' },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite — fastest / lightest' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite — newer lite route' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro — stronger (tighter free quotas)' }
]

const PERSONALITY_KEYS = Object.keys(PERSONALITY_META) as PersonalityKey[]

type CompanionStatus = {
  running: boolean
  port: number | null
  token: string
  urls: string[]
  protocolVersion: number
  devices: Array<{
    id: string
    name: string
    scopes: string[]
    createdAt: number
    lastSeenAt: number
    revokedAt?: number
  }>
}

export function SettingsPanel(): React.JSX.Element {
  const settings = useAlbertStore((s) => s.settings)
  const setSettings = useAlbertStore((s) => s.setSettings)
  const setError = useAlbertStore((s) => s.setError)
  const [form, setForm] = useState(settings)
  const [saveState, setSaveState] = useState<'idle' | 'pending' | 'saving' | 'saved' | 'error'>(
    'idle'
  )
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [companion, setCompanion] = useState<CompanionStatus | null>(null)
  const [copied, setCopied] = useState(false)
  const [ollamaStatus, setOllamaStatus] = useState<string>('')
  const [groqStatus, setGroqStatus] = useState<string>('')
  const [geminiStatus, setGeminiStatus] = useState<string>('')
  const [kokoroStatus, setKokoroStatus] = useState<string>('')
  const [codex, setCodex] = useState<CodexStatus | null>(null)
  const [codexBusy, setCodexBusy] = useState(false)
  const [codexNote, setCodexNote] = useState('')
  const [importPath, setImportPath] = useState('')
  const [importScan, setImportScan] = useState<ChatGptImportScan | null>(null)
  const [importNote, setImportNote] = useState('')
  const [importBusy, setImportBusy] = useState(false)
  const lastSavedJson = useRef(JSON.stringify(settingsPayload(settings)))
  const saveTimer = useRef(0)
  const savedFlashTimer = useRef(0)

  const refreshCompanion = useCallback(async (): Promise<void> => {
    try {
      const status = await window.albert.getCompanionStatus()
      setCompanion(status)
    } catch {
      /* ignore */
    }
  }, [])

  // External settings changes (sidebar brain lock, voice personality, etc.)
  useEffect(() => {
    const incoming = JSON.stringify(settingsPayload(settings))
    if (incoming === lastSavedJson.current) return
    lastSavedJson.current = incoming
    setForm(settings)
  }, [settings])

  useEffect(() => {
    void refreshCompanion()
  }, [refreshCompanion])

  // Codex: connect once when the panel opens, then follow pushed status events
  // (sign-in completing in the browser arrives asynchronously).
  useEffect(() => {
    void window.albert
      .connectCodex()
      .then(setCodex)
      .catch((err) => setCodexNote(err instanceof Error ? err.message : String(err)))
    return window.albert.onChatEvent((event) => {
      if (event.type === 'codex_status' && event.codex) setCodex(event.codex)
    })
  }, [])

  async function signInCodex(): Promise<void> {
    setCodexBusy(true)
    setCodexNote('Opening ChatGPT sign-in in your browser…')
    try {
      const result = await window.albert.loginCodex()
      setCodexNote(
        result.error
          ? result.error
          : result.authUrl
            ? 'Finish sign-in in the browser — this panel updates itself.'
            : 'Codex did not return a sign-in URL.'
      )
    } catch (err) {
      setCodexNote(err instanceof Error ? err.message : String(err))
    } finally {
      setCodexBusy(false)
    }
  }

  async function signOutCodex(): Promise<void> {
    setCodexBusy(true)
    try {
      setCodex(await window.albert.logoutCodex())
      setCodexNote('Signed out of Codex.')
    } catch (err) {
      setCodexNote(err instanceof Error ? err.message : String(err))
    } finally {
      setCodexBusy(false)
    }
  }

  async function resetCodexThread(): Promise<void> {
    try {
      setCodex(await window.albert.newCodexThread())
      setCodexNote('Fresh Codex thread — previous project context dropped.')
    } catch (err) {
      setCodexNote(err instanceof Error ? err.message : String(err))
    }
  }

  async function pickExport(): Promise<void> {
    setImportNote('')
    setImportScan(null)
    try {
      const path = await window.albert.pickChatGptExport()
      if (!path) return
      setImportPath(path)
      setImportBusy(true)
      const scan = await window.albert.scanChatGptExport(path)
      setImportScan(scan)
      setImportNote(
        `${scan.newMemories} saved memories and ${scan.newHistory} distilled facts are new.`
      )
    } catch (err) {
      setImportNote(err instanceof Error ? err.message : String(err))
    } finally {
      setImportBusy(false)
    }
  }

  async function runImport(includeHistory: boolean): Promise<void> {
    if (!importPath) return
    setImportBusy(true)
    setImportNote('Importing — each fact is embedded, so this takes a moment…')
    try {
      const result = await window.albert.runChatGptImport(importPath, includeHistory)
      setImportNote(
        `Imported ${result.importedMemories} saved memories and ${result.importedHistory} distilled facts. ` +
          `${result.skippedDuplicates} were already known${result.failed ? `, ${result.failed} failed` : ''}.`
      )
      setImportScan(null)
    } catch (err) {
      setImportNote(err instanceof Error ? err.message : String(err))
    } finally {
      setImportBusy(false)
    }
  }

  useEffect(() => {
    const refresh = (): void => setVoices(listTtsVoices())
    refresh()
    window.speechSynthesis.onvoiceschanged = refresh
    return () => {
      window.speechSynthesis.onvoiceschanged = null
    }
  }, [])

  // Autosave on every form change (debounced)
  useEffect(() => {
    const payload = settingsPayload(form)
    const json = JSON.stringify(payload)
    if (json === lastSavedJson.current) return

    setSaveState('pending')
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      void (async () => {
        try {
          setSaveState('saving')
          const next = await window.albert.setSettings(payload)
          lastSavedJson.current = JSON.stringify(settingsPayload(next))
          setSettings(next)
          setError(null)

          // Companion server reacts to enable/port/token changes
          try {
            const status = await window.albert.applyCompanion()
            setCompanion(status)
          } catch {
            /* companion optional */
          }

          setSaveState('saved')
          window.clearTimeout(savedFlashTimer.current)
          savedFlashTimer.current = window.setTimeout(() => setSaveState('idle'), 1600)
        } catch (err) {
          setSaveState('error')
          setError(err instanceof Error ? err.message : String(err))
        }
      })()
    }, 350)

    return () => window.clearTimeout(saveTimer.current)
  }, [form, setSettings, setError])

  async function rotateToken(): Promise<void> {
    try {
      const status = await window.albert.rotateCompanionToken()
      setCompanion(status)
      setForm((f) => ({ ...f, companionToken: status.token }))
      const next = await window.albert.getSettings()
      setSettings(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function copyPairInfo(): Promise<void> {
    const urls = companion?.urls?.length
      ? companion.urls
      : [`http://127.0.0.1:${form.companionPort || 47831}`]
    const token = companion?.token || form.companionToken || '(no token yet)'
    // Prefer IPv4 LAN for phones — .local mDNS often fails on iOS.
    const primary =
      urls.find((u) => /https?:\/\/(\d{1,3}\.){3}\d{1,3}(?::\d+)?\/?$/i.test(u)) ||
      urls.find((u) => !/127\.0\.0\.1|localhost|\.local(?::|\/|$)/i.test(u)) ||
      urls.find((u) => !/127\.0\.0\.1|localhost/i.test(u)) ||
      urls[0] ||
      '(no url)'
    const text = [
      `${APP_NAME} phone companion`,
      `URL=${primary}`,
      `TOKEN=${token}`,
      ``,
      `Mac URLs:`,
      ...urls.map((u) => `  ${u}`),
      `Token: ${token}`,
      ``,
      `On phone: SYSTEMS → Mac Link → Paste pair info → Enroll & sync.`,
      `iOS Simulator: use http://127.0.0.1:${form.companionPort || 47831}`
    ].join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch (err) {
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.left = '-9999px'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1600)
      } catch {
        setError(err instanceof Error ? err.message : 'Clipboard copy failed')
      }
    }
  }

  async function revokePhone(deviceId: string): Promise<void> {
    try {
      await window.albert.revokeCompanionDevice(deviceId)
      await refreshCompanion()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    return window.albert.onKokoroProgress((p) => {
      if (p.message) setKokoroStatus(p.message)
      else if (p.status === 'error') setKokoroStatus('Kokoro error')
    })
  }, [])

  async function previewVoice(): Promise<void> {
    stopSpeaking()
    setError(null)
    if (form.ttsProvider === 'kokoro') {
      setKokoroStatus('Starting Kokoro (first run downloads ~80–100MB)…')
    }
    try {
      const result = await speakText(`${APP_NAME} online. Systems nominal. How can I help you?`, {
        provider: form.ttsProvider || 'system',
        apiKey: form.elevenLabsApiKey,
        voiceId:
          form.ttsProvider === 'kokoro'
            ? form.kokoroVoiceId || 'am_michael'
            : form.elevenLabsVoiceId
      })
      if (form.ttsProvider === 'kokoro') {
        setKokoroStatus(
          result.fallbackFrom
            ? `Kokoro failed · system fallback verified · ${result.fallbackReason || 'unknown error'}`
            : 'Kokoro synthesis + playback verified'
        )
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      const nested = raw.match(/Error invoking remote method[^:]+: Error: ([\s\S]+)$/)
      const msg = nested?.[1]?.trim() || raw
      setError(msg)
      if (form.ttsProvider === 'kokoro') setKokoroStatus(msg)
    }
  }

  const saveLabel =
    saveState === 'saving'
      ? 'Saving…'
      : saveState === 'pending'
        ? 'Saving…'
        : saveState === 'saved'
          ? 'Saved'
          : saveState === 'error'
            ? 'Save failed'
            : 'Autosave on'

  return (
    <section className="panel">
      <div className="hud-frame">
        <div className="computer-header" style={{ marginBottom: 8 }}>
          <div>
            <h2 className="section-title">Systems</h2>
            <p className="section-sub">
              Changes save automatically. Sections below: Personality → AI → Voice → Phone link.
            </p>
          </div>
          <span className="hud-label" style={{ whiteSpace: 'nowrap' }}>
            {saveLabel}
          </span>
        </div>

        <nav className="settings-section-nav" aria-label="Systems sections">
          <a href="#systems-personality">Personality</a>
          <a href="#systems-ai">AI</a>
          <a href="#systems-voice">Voice</a>
          <a href="#systems-phone">Phone link</a>
        </nav>

        <a className="dashboard-link" href={CLAUDE_DASHBOARD_URL} target="_blank" rel="noreferrer">
          <span className="hud-label">External</span>
          Claude Platform Dashboard ↗
        </a>

        <div className="settings-form">
          <div className="settings-section" id="systems-personality">
            <h3 className="settings-section-title">1 · Personality dials</h3>
            <p className="section-sub">
              High sarcasm = dry TARS/JARVIS (also called humor/wit). High warmth = buddy on
              the line — still honest, never a yes-man. Low verbosity = short; high = full plans
              when you ask. Voice: “set sarcasm to 60”, “tune humor up to 70”, “more terse”,
              “set verbosity to 80”, “more warmth”. Reset restores defaults.
            </p>
            <div className="personality-grid">
              {PERSONALITY_KEYS.map((key) => {
                const meta = PERSONALITY_META[key]
                const value = normalizePersonality(form.personality)[key]
                return (
                  <div key={key} className="personality-row">
                    <div className="personality-row-head">
                      <span>
                        {meta.label}{' '}
                        <span style={{ opacity: 0.55 }}>
                          ({meta.low} → {meta.high})
                        </span>
                      </span>
                      <span>{value}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={value}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          personality: {
                            ...normalizePersonality(form.personality),
                            [key]: Number(e.target.value)
                          }
                        })
                      }
                    />
                  </div>
                )
              })}
            </div>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                const personality = {
                  sarcasm: DEFAULT_PERSONALITY.sarcasm,
                  warmth: DEFAULT_PERSONALITY.warmth,
                  verbosity: DEFAULT_PERSONALITY.verbosity
                }
                const nextForm = { ...form, personality }
                window.clearTimeout(saveTimer.current)
                setForm(nextForm)
                void (async () => {
                  try {
                    setSaveState('saving')
                    const next = await window.albert.setSettings(settingsPayload(nextForm))
                    lastSavedJson.current = JSON.stringify(settingsPayload(next))
                    setSettings(next)
                    setForm(next)
                    setSaveState('saved')
                    window.clearTimeout(savedFlashTimer.current)
                    savedFlashTimer.current = window.setTimeout(() => setSaveState('idle'), 1600)
                  } catch (err) {
                    setSaveState('error')
                    setError(err instanceof Error ? err.message : String(err))
                  }
                })()
              }}
            >
              Reset personality defaults
            </button>
          </div>

          <div className="settings-section" id="systems-ai">
            <h3 className="settings-section-title">2 · Brain</h3>
            <p className="section-sub">
              ChatGPT is the brain for every turn. Gemini is the free backup. Opus is the paid
              backup. Use the sidebar to lock a fallback; otherwise ChatGPT always answers.
            </p>

            <div className={`settings-brain-card ${codex?.signedIn ? 'ok' : ''}`}>
              <div className="settings-brain-card-head">
                <strong>ChatGPT</strong>
                <span>{codex?.signedIn ? 'Primary · online' : 'Primary · needs sign-in'}</span>
              </div>
              <p className="section-sub" style={{ margin: 0 }}>
                {!codex
                  ? 'Checking ChatGPT…'
                  : !codex.installed
                    ? `ChatGPT CLI not found. ${codex.installHint ?? ''}`
                    : !codex.signedIn
                      ? 'Found on this Mac — sign in with your ChatGPT account. No API key.'
                      : `Signed in as ${codex.email ?? 'your ChatGPT account'}${
                          codex.planType ? ` (${codex.planType})` : ''
                        } · ${codex.allowance?.label ?? 'allowance unknown'}`}
              </p>
            </div>

            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="ghost-button"
                disabled={codexBusy || !codex?.installed || codex?.signedIn}
                onClick={() => void signInCodex()}
              >
                Sign in with ChatGPT
              </button>
              <button
                type="button"
                className="ghost-button"
                disabled={codexBusy || !codex?.signedIn}
                onClick={() => void signOutCodex()}
              >
                Sign out
              </button>
              <button
                type="button"
                className="ghost-button"
                disabled={!codex?.threadId}
                onClick={() => void resetCodexThread()}
              >
                New thread
              </button>
              <button
                type="button"
                className="ghost-button"
                disabled={!codex?.signedIn}
                onClick={() =>
                  void window.albert
                    .refreshCodexAllowance()
                    .then((a) => setCodexNote(a?.label ?? 'Allowance not reported'))
                    .catch(() => setCodexNote('Could not read the allowance'))
                }
              >
                Refresh allowance
              </button>
            </div>
            {(codexNote || codex?.lastError) && (
              <p className="section-sub" style={{ marginTop: 4 }}>
                {codexNote || codex?.lastError}
              </p>
            )}

            {codex?.availableModels?.length ? (
              <>
                <div className="field">
                  <label htmlFor="codexModel">ChatGPT model (everyday)</label>
                  <select
                    id="codexModel"
                    value={form.codexModel || ''}
                    onChange={(e) => setForm({ ...form, codexModel: e.target.value })}
                  >
                    <option value="">
                      auto — currently {codex.model ?? 'unset'}
                    </option>
                    {codex.availableModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.displayName} ({m.id})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="codexEscalationModel">ChatGPT model (hard work)</label>
                  <select
                    id="codexEscalationModel"
                    value={form.codexEscalationModel || ''}
                    onChange={(e) => setForm({ ...form, codexEscalationModel: e.target.value })}
                  >
                    <option value="">
                      auto — currently {codex.escalationModel ?? 'unset'}
                    </option>
                    {codex.availableModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.displayName} ({m.id})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="codexEffort">Reasoning effort</label>
                  <select
                    id="codexEffort"
                    value={form.codexEffort || 'medium'}
                    onChange={(e) => setForm({ ...form, codexEffort: e.target.value })}
                  >
                    {(
                      codex.availableModels.find((m) => m.id === (codex.model ?? ''))?.efforts ?? [
                        'low',
                        'medium',
                        'high'
                      ]
                    ).map((effort) => (
                      <option key={effort} value={effort}>
                        {effort}
                      </option>
                    ))}
                  </select>
                  <p className="section-sub" style={{ marginTop: 4 }}>
                    Higher effort thinks longer and spends more of your weekly allowance.
                  </p>
                </div>
              </>
            ) : null}

            <div className="field">
              <label htmlFor="codexApprovalMode">ChatGPT approvals</label>
              <select
                id="codexApprovalMode"
                value={form.codexApprovalMode || 'project'}
                onChange={(e) =>
                  setForm({
                    ...form,
                    codexApprovalMode: e.target.value as AlbertSettings['codexApprovalMode']
                  })
                }
              >
                <option value="project">
                  project — run freely inside the project folder, ask for anything outside
                </option>
                <option value="always">always ask — Allow/Deny for every command and edit</option>
                <option value="never">never ask — approve everything (dangerous)</option>
              </select>
              <p className="section-sub" style={{ marginTop: 4 }}>
                Network access and write requests beyond the sandbox always ask, whichever mode you
                pick.
              </p>
            </div>

            <h4 className="section-title" style={{ margin: '0.75rem 0 0', fontSize: '0.85rem' }}>
              Fallbacks
            </h4>
            <p className="section-sub">
              Used only when ChatGPT is signed out, hits a limit, or you lock one from the sidebar.
            </p>

            <div className="field">
              <label htmlFor="geminiApiKey">Gemini — free fallback</label>
              <input
                id="geminiApiKey"
                type="password"
                value={form.geminiApiKey || ''}
                onChange={(e) =>
                  setForm({ ...form, geminiApiKey: e.target.value, localProvider: 'gemini' })
                }
                placeholder="from aistudio.google.com/apikey"
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor="geminiModel">Gemini model</label>
              <select
                id="geminiModel"
                value={form.geminiModel || DEFAULT_GEMINI_MODEL}
                onChange={(e) => setForm({ ...form, geminiModel: e.target.value })}
              >
                {GEMINI_MODEL_OPTIONS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                void (async () => {
                  const r = await window.albert.probeGemini()
                  setGeminiStatus(r.ok ? `OK · ${r.detail}` : `Fail · ${r.detail}`)
                })()
              }}
            >
              Test Gemini
            </button>
            {geminiStatus ? <p className="section-sub">{geminiStatus}</p> : null}

            <label className="switch">
              <input
                type="checkbox"
                checked={form.paidFallbackEnabled === true}
                onChange={(e) => setForm({ ...form, paidFallbackEnabled: e.target.checked })}
              />
              <span>Allow paid Opus when ChatGPT and Gemini both fail</span>
            </label>
            <p className="section-sub" style={{ marginTop: 4 }}>
              Off by default. Opus bills your Anthropic key. Leave this off unless you want that.
            </p>

            <div className="field">
              <label htmlFor="anthropicApiKey">Anthropic API key (Opus only)</label>
              <input
                id="anthropicApiKey"
                type="password"
                value={form.anthropicApiKey}
                onChange={(e) => setForm({ ...form, anthropicApiKey: e.target.value })}
                placeholder="sk-ant-..."
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor="powerModel">Opus model</label>
              <select
                id="powerModel"
                value={form.powerModel || form.model}
                onChange={(e) =>
                  setForm({ ...form, powerModel: e.target.value, model: e.target.value })
                }
              >
                {MODEL_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <label className="switch">
              <input
                type="checkbox"
                checked={form.autoRememberEnabled !== false}
                onChange={(e) => setForm({ ...form, autoRememberEnabled: e.target.checked })}
              />
              <span>Auto-remember lasting facts</span>
            </label>
            <p className="section-sub" style={{ marginTop: 4 }}>
              On by default. Saves preferences, identity, and project details Kai mentions. Skips
              one-off tasks and anything that looks like a secret. Review or delete them in Memory.
            </p>

            <h4 className="section-title" style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>
              Import ChatGPT memories
            </h4>
            <p className="section-sub">
              One-time import: OpenAI has no API for ChatGPT&apos;s saved memories, so this reads an
              official data export instead. Request one at ChatGPT → Settings → Data controls →
              Export, then pick the .zip here. Saved memories come across verbatim; conversations
              are scanned for durable facts about you, not copied in full.
            </p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="ghost-button"
                disabled={importBusy}
                onClick={() => void pickExport()}
              >
                Choose export…
              </button>
              {importScan ? (
                <>
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={importBusy}
                    onClick={() => void runImport(true)}
                  >
                    Import memories + facts
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={importBusy}
                    onClick={() => void runImport(false)}
                  >
                    Saved memories only
                  </button>
                </>
              ) : null}
            </div>
            {importScan ? (
              <p className="section-sub" style={{ marginTop: 4 }}>
                Found {importScan.totalMemories} saved memories (
                {importScan.disabledMemories} disabled in ChatGPT, skipped) and{' '}
                {importScan.totalHistory} candidate facts from {importScan.conversationsSeen}{' '}
                conversations. New after dedupe: {importScan.newMemories} memories,{' '}
                {importScan.newHistory} facts.
                {importScan.warnings.length ? ` · ${importScan.warnings[0]}` : ''}
              </p>
            ) : null}
            {importNote ? (
              <p className="section-sub" style={{ marginTop: 4 }}>
                {importNote}
              </p>
            ) : null}

            <div className="field">
              <label htmlFor="openaiApiKey">OpenAI API key (optional embeddings)</label>
              <input
                id="openaiApiKey"
                type="password"
                value={form.openaiApiKey}
                onChange={(e) => setForm({ ...form, openaiApiKey: e.target.value })}
                placeholder="sk-... (optional)"
                autoComplete="off"
              />
            </div>

            <details className="settings-advanced">
              <summary>Advanced · Groq / Ollama / extra routing</summary>
              <p className="section-sub">
                Not needed for normal use. ChatGPT is the brain. These stay available if you lock
                them from a voice command.
              </p>
              <div className="field">
                <label htmlFor="routingMode">Force a brain</label>
                <select
                  id="routingMode"
                  value={form.routingMode === 'auto' ? 'codex' : form.routingMode}
                  onChange={(e) =>
                    setForm({ ...form, routingMode: e.target.value as RoutingMode })
                  }
                >
                  <option value="codex">ChatGPT (default)</option>
                  <option value="local">Gemini / Groq / Ollama lock</option>
                  <option value="power">Opus lock</option>
                </select>
              </div>
              <h4 className="section-title" style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>
                Extra local / cloud providers
              </h4>
            <div className="field">
              <label htmlFor="localProvider">Provider</label>
              <select
                id="localProvider"
                value={form.localProvider || 'ollama'}
                onChange={(e) =>
                  setForm({ ...form, localProvider: e.target.value as LocalProvider })
                }
              >
                <option value="groq">Groq (fast free cloud)</option>
                <option value="gemini">Gemini / Google AI Studio (free tier)</option>
                <option value="ollama">Ollama (cloud or local daemon)</option>
              </select>
            </div>

            {(form.localProvider || 'ollama') === 'groq' ? (
              <>
                <div className="field">
                  <label htmlFor="groqApiKey">Groq API key</label>
                  <input
                    id="groqApiKey"
                    type="password"
                    value={form.groqApiKey || ''}
                    onChange={(e) => setForm({ ...form, groqApiKey: e.target.value })}
                    placeholder="from console.groq.com/keys"
                    autoComplete="off"
                  />
                </div>
                <div className="field">
                  <label htmlFor="groqModel">Groq model</label>
                  <select
                    id="groqModel"
                    value={form.groqModel || DEFAULT_GROQ_MODEL}
                    onChange={(e) => setForm({ ...form, groqModel: e.target.value })}
                  >
                    {GROQ_MODEL_OPTIONS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="section-sub">
                  Groq retires both Llama transition models on August 16, 2026. Enable GPT-OSS 20B,
                  GPT-OSS 120B, or Qwen 3.6 in your{' '}
                  <a href="https://console.groq.com/settings/limits" target="_blank" rel="noreferrer">
                    Groq organization limits
                  </a>{' '}
                  before then. Albert will fail over only to models your organization permits.
                </p>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    void (async () => {
                      const r = await window.albert.probeGroq()
                      setGroqStatus(r.ok ? `OK · ${r.detail}` : `Fail · ${r.detail}`)
                    })()
                  }}
                >
                  Test Groq connection
                </button>
                {groqStatus ? <p className="section-sub">{groqStatus}</p> : null}
              </>
            ) : (form.localProvider || 'ollama') === 'gemini' ? (
              <>
                <div className="field">
                  <label htmlFor="geminiApiKey">Gemini API key</label>
                  <input
                    id="geminiApiKey"
                    type="password"
                    value={form.geminiApiKey || ''}
                    onChange={(e) => setForm({ ...form, geminiApiKey: e.target.value })}
                    placeholder="from aistudio.google.com/apikey"
                    autoComplete="off"
                  />
                </div>
                <div className="field">
                  <label htmlFor="geminiModel">Gemini model</label>
                  <select
                    id="geminiModel"
                    value={form.geminiModel || DEFAULT_GEMINI_MODEL}
                    onChange={(e) => setForm({ ...form, geminiModel: e.target.value })}
                  >
                    {GEMINI_MODEL_OPTIONS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="section-sub">
                  Free tier has RPM/day quotas. Albert still uses its own web_search tools for live
                  lookup; Google Search grounding is not enabled on the free path.
                </p>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    void (async () => {
                      const r = await window.albert.probeGemini()
                      setGeminiStatus(r.ok ? `OK · ${r.detail}` : `Fail · ${r.detail}`)
                    })()
                  }}
                >
                  Test Gemini connection
                </button>
                {geminiStatus ? <p className="section-sub">{geminiStatus}</p> : null}
              </>
            ) : (
              <>
                <p className="section-sub">
                  With an API key + Endpoint Auto, Albert uses Ollama Cloud. Start `ollama serve` and
                  set Endpoint to local for true offline, on-device inference.
                </p>
                <div className="field">
                  <label htmlFor="ollamaApiKey">Ollama API key</label>
                  <input
                    id="ollamaApiKey"
                    type="password"
                    value={form.ollamaApiKey || ''}
                    onChange={(e) => setForm({ ...form, ollamaApiKey: e.target.value })}
                    placeholder="from ollama.com/settings/keys"
                    autoComplete="off"
                  />
                </div>
                <div className="field">
                  <label htmlFor="localModel">Ollama model</label>
                  <select
                    id="localModel"
                    value={form.localModel || 'qwen3.5:4b'}
                    onChange={(e) => setForm({ ...form, localModel: e.target.value })}
                  >
                    {OLLAMA_MODEL_OPTIONS.map((m) => (
                      <option key={m.id} value={m.id} disabled={m.disabled}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="ollamaEndpoint">Endpoint</label>
                  <select
                    id="ollamaEndpoint"
                    value={form.ollamaEndpoint || 'auto'}
                    onChange={(e) =>
                      setForm({ ...form, ollamaEndpoint: e.target.value as OllamaEndpointMode })
                    }
                  >
                    <option value="auto">Auto (cloud if key, else local)</option>
                    <option value="cloud">Cloud (ollama.com)</option>
                    <option value="local">Local (localhost:11434)</option>
                  </select>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => {
                      void (async () => {
                        const r = await window.albert.probeOllama()
                        setOllamaStatus(r.ok ? `OK · ${r.mode} · ${r.detail}` : `Fail · ${r.detail}`)
                      })()
                    }}
                  >
                    Test Ollama connection
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => {
                      void (async () => {
                        const model = form.localModel || 'qwen3.5:4b'
                        if (form.ollamaEndpoint !== 'local') {
                          setForm({ ...form, ollamaEndpoint: 'local' })
                        }
                        setOllamaStatus(`Pulling ${model} into local Ollama… (keep the app open)`)
                        const r = await window.albert.pullOllamaModel(model)
                        setOllamaStatus(r.ok ? `OK · ${r.detail}` : `Fail · ${r.detail}`)
                      })()
                    }}
                  >
                    Pull model (local)
                  </button>
                </div>
                <p className="section-sub">
                  For qwen3.5:4b: set Endpoint to Local, then Pull model. It is the recommended
                  on-device balance for a 16GB Mac; keep context modest for responsive voice turns.
                </p>
                {ollamaStatus ? <p className="section-sub">{ollamaStatus}</p> : null}
              </>
            )}
            </details>

            <h4 className="section-title" style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>
              Workspace &amp; tools
            </h4>
            <div className="field">
              <label htmlFor="projectFolder">Project folder</label>
              <input
                id="projectFolder"
                value={form.projectFolder}
                onChange={(e) => setForm({ ...form, projectFolder: e.target.value })}
                placeholder="/Users/kai/Documents/VS/ALBERT"
              />
              <p className="section-sub" style={{ marginTop: 6 }}>
                Point this at the ALBERT repo. Live src/ writes are blocked while the app is running — he dispatches the Cursor agent instead.
              </p>
            </div>
            <div className="field">
              <label htmlFor="cursorApiKey">Cursor API key</label>
              <input
                id="cursorApiKey"
                type="password"
                value={form.cursorApiKey || ''}
                onChange={(e) => setForm({ ...form, cursorApiKey: e.target.value })}
                placeholder="cursor_… (Dashboard → API Keys). Optional if `agent login` already ran."
                autoComplete="off"
              />
              <p className="section-sub" style={{ marginTop: 6 }}>
                Lets ALBERT run the same Cursor agent as this IDE tab, in a child process, so the live app does not rewrite itself.
              </p>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={form.ambientHudEnabled !== false}
                onChange={(e) => setForm({ ...form, ambientHudEnabled: e.target.checked })}
              />
              Desktop speech orb (floats outside the window)
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.ambientHudRoam !== false}
                onChange={(e) => setForm({ ...form, ambientHudRoam: e.target.checked })}
                disabled={form.ambientHudEnabled === false}
              />
              Fly to Albert’s work, or step aside of the pointer (drag to pin)
            </label>
            <div className="field">
              <label htmlFor="allowedFsRoots">Extra allowed folders (one per line)</label>
              <textarea
                id="allowedFsRoots"
                rows={3}
                value={(form.allowedFsRoots || []).join('\n')}
                onChange={(e) =>
                  setForm({
                    ...form,
                    allowedFsRoots: e.target.value
                      .split('\n')
                      .map((l) => l.trim())
                      .filter(Boolean)
                  })
                }
                placeholder={'Leave empty for defaults:\n~/Documents\n~/Desktop\n~/Downloads'}
                spellCheck={false}
              />
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={form.confirmDangerousTools}
                onChange={(e) => setForm({ ...form, confirmDangerousTools: e.target.checked })}
              />
              Confirm before dangerous tools (writes, shell, desktop clicks, AppleScript) — leave{' '}
              <strong>off</strong> for full hands-free automation (no Allow/Deny popups)
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={Boolean(form.godMode)}
                onChange={(e) => setForm({ ...form, godMode: e.target.checked })}
              />
              God mode — broader home-directory FS + unrestricted shell
            </label>
            {form.godMode ? (
              <p className="section-sub" style={{ color: 'var(--accent)' }}>
                God mode is on. Albert can run freer commands under your home directory.
              </p>
            ) : null}

            <h4 className="section-title" style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>
              macOS permissions (desktop control)
            </h4>
            <p className="section-sub">
              For Spotify, clicking around apps, screenshots, and browser automation, toggle these on
              for <strong>ALBERT</strong> (or Electron if you&apos;re in dev). Restart the app after
              granting.
            </p>
            <ul className="section-sub" style={{ margin: '0.5rem 0 0.75rem', paddingLeft: '1.1rem' }}>
              <li>
                <strong>Accessibility</strong> — click, type, hotkeys, System Events
              </li>
              <li>
                <strong>Screen Recording</strong> — desktop screenshots (so he can aim clicks)
              </li>
              <li>
                <strong>Automation</strong> — control Chrome/Safari/Spotify via AppleScript
              </li>
              <li>
                <strong>Microphone</strong> — voice wake + talk
              </li>
            </ul>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {(
                [
                  ['accessibility', 'Accessibility'],
                  ['screen', 'Screen Recording'],
                  ['automation', 'Automation'],
                  ['microphone', 'Microphone']
                ] as const
              ).map(([pane, label]) => (
                <button
                  key={pane}
                  type="button"
                  className="btn ghost"
                  onClick={() => void window.albert.openPrivacyPane(pane)}
                >
                  Open {label}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-section" id="systems-voice">
            <h3 className="settings-section-title">3 · Voice</h3>
            <p className="section-sub">
              Kokoro (local neural), macOS speech, or ElevenLabs. Wake word and barge-in live here.
            </p>

            <div className="field">
              <label htmlFor="ttsProvider">Voice provider</label>
              <select
                id="ttsProvider"
                value={form.ttsProvider || 'system'}
                onChange={(e) =>
                  setForm({ ...form, ttsProvider: e.target.value as TtsProvider })
                }
              >
                <option value="kokoro">Kokoro (free local neural)</option>
                <option value="system">macOS system speech (free)</option>
                <option value="elevenlabs">ElevenLabs (paid cloud)</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="ttsVoice">{APP_NAME} voice (macOS)</label>
              <select
                id="ttsVoice"
                value={form.ttsVoice}
                onChange={(e) => setForm({ ...form, ttsVoice: e.target.value })}
              >
                <option value="">Auto (best available English)</option>
                {voices.map((v) => (
                  <option key={`${v.name}-${v.lang}`} value={v.name}>
                    {v.name} ({v.lang}){v.localService ? '' : ' · network'}
                  </option>
                ))}
              </select>
            </div>

            {form.ttsProvider === 'kokoro' ? (
              <>
                <div className="field">
                  <label htmlFor="kokoroVoiceId">Kokoro voice</label>
                  <select
                    id="kokoroVoiceId"
                    value={form.kokoroVoiceId || 'am_michael'}
                    onChange={(e) => setForm({ ...form, kokoroVoiceId: e.target.value })}
                  >
                    {KOKORO_VOICES.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="section-sub">
                  First Preview downloads ~80–100MB (needs network), then runs offline. Watch the
                  status line below — it can take a minute the first time.
                </p>
                {kokoroStatus ? <p className="section-sub">{kokoroStatus}</p> : null}
              </>
            ) : null}

            {form.ttsProvider === 'elevenlabs' ? (
              <>
                <div className="field">
                  <label htmlFor="elevenLabsApiKey">ElevenLabs API key</label>
                  <input
                    id="elevenLabsApiKey"
                    type="password"
                    value={form.elevenLabsApiKey || ''}
                    onChange={(e) => setForm({ ...form, elevenLabsApiKey: e.target.value })}
                    placeholder="xi-…"
                    autoComplete="off"
                  />
                </div>

                <div className="field">
                  <label htmlFor="elevenLabsVoiceId">ElevenLabs Voice ID</label>
                  <input
                    id="elevenLabsVoiceId"
                    type="text"
                    value={form.elevenLabsVoiceId || ''}
                    onChange={(e) => setForm({ ...form, elevenLabsVoiceId: e.target.value })}
                    placeholder="Paste voice id from ElevenLabs"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              </>
            ) : null}

            <div className="field">
              <label htmlFor="ttsRate">Speech rate ({form.ttsRate.toFixed(2)}x)</label>
              <input
                id="ttsRate"
                type="range"
                min={0.7}
                max={1.6}
                step={0.02}
                value={form.ttsRate}
                onChange={(e) => setForm({ ...form, ttsRate: Number(e.target.value) })}
              />
            </div>

            <div className="field">
              <label htmlFor="ttsPitch">Pitch ({form.ttsPitch.toFixed(2)})</label>
              <input
                id="ttsPitch"
                type="range"
                min={0.7}
                max={1.3}
                step={0.02}
                value={form.ttsPitch}
                onChange={(e) => setForm({ ...form, ttsPitch: Number(e.target.value) })}
              />
            </div>

            <label className="check">
              <input
                type="checkbox"
                checked={form.ttsStripPunctuation !== false}
                onChange={(e) => setForm({ ...form, ttsStripPunctuation: e.target.checked })}
              />
              Strip punctuation for TTS (skip pauses on . ! ? ,)
            </label>
            <p className="section-sub" style={{ marginTop: '-4px' }}>
              On helps macOS system speech (it pauses hard on periods). Off usually sounds more natural
              with Kokoro / ElevenLabs. Applies to whatever voice provider is selected.
            </p>

            <label className="check">
              <input
                type="checkbox"
                checked={form.allowBargeIn !== false}
                onChange={(e) => setForm({ ...form, allowBargeIn: e.target.checked })}
              />
              Allow interrupting {APP_NAME} while he speaks
            </label>

            <div className="field">
              <label htmlFor="micSensitivity">
                Mic sensitivity — {form.micSensitivity ?? 50}
              </label>
              <input
                id="micSensitivity"
                type="range"
                min={0}
                max={100}
                step={5}
                value={form.micSensitivity ?? 50}
                onChange={(e) =>
                  setForm({ ...form, micSensitivity: Number(e.target.value) })
                }
              />
              <p className="section-sub" style={{ marginTop: 4 }}>
                Thresholds track your room&apos;s measured noise floor; this shifts the margin above
                it. Lower it if a fan, keyboard, or air conditioning makes him hear things you
                didn&apos;t say or cut himself off mid-sentence. Raise it if he misses quiet speech.
              </p>
            </div>

            <label className="check">
              <input
                type="checkbox"
                checked={form.wakeWordEnabled !== false}
                onChange={(e) => setForm({ ...form, wakeWordEnabled: e.target.checked })}
              />
              Always listen for wake word (“Albert, wake up”)
            </label>
            <p className="section-sub" style={{ marginTop: '-4px' }}>
              Keeps the mic armed on Home and listens with local Whisper for “Albert, wake up” /
              “hey albert”. Full voice engages after the phrase. First arm may warm the speech
              model briefly. Applies as soon as you toggle it.
            </p>

            <div>
              <button className="btn ghost" type="button" onClick={() => void previewVoice()}>
                Preview voice
              </button>
            </div>

            <h4 className="section-title" style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>
              Interface
            </h4>
            <label className="check">
              <input
                type="checkbox"
                checked={form.performanceMode !== false}
                onChange={(e) => setForm({ ...form, performanceMode: e.target.checked })}
              />
              Performance mode (cut HUD GPU animations — recommended)
            </label>

            <label className="check">
              <input
                type="checkbox"
                checked={form.startupAnimationEnabled !== false}
                onChange={(e) => setForm({ ...form, startupAnimationEnabled: e.target.checked })}
              />
              Cinematic startup sequence (plays once when Albert launches)
            </label>
            <div>
              <button
                className="btn ghost"
                type="button"
                disabled={form.startupAnimationEnabled === false}
                onClick={() => window.dispatchEvent(new CustomEvent('albert:replay-startup'))}
              >
                Replay startup sequence
              </button>
            </div>

            <div className="field">
              <label htmlFor="hudDensity">HUD density</label>
              <select
                id="hudDensity"
                value={form.hudDensity || 'cinematic'}
                onChange={(e) =>
                  setForm({
                    ...form,
                    hudDensity: e.target.value as AlbertSettings['hudDensity']
                  })
                }
              >
                <option value="minimal">Minimal — essential status only</option>
                <option value="balanced">Balanced — status and context</option>
                <option value="cinematic">Cinematic — full Jarvis instrumentation</option>
              </select>
            </div>
          </div>

          <div className="settings-section" id="systems-phone">
            <h3 className="settings-section-title">4 · Phone link</h3>
            <p className="section-sub">
              Hybrid mode for the native iOS companion (TestFlight / Expo): chat on your phone anytime;
              when this Mac is on the same network (or Tailscale), memories sync both ways. Mac tools
              stay on the desktop for now.
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={Boolean(form.companionEnabled)}
                onChange={(e) => setForm({ ...form, companionEnabled: e.target.checked })}
              />
              Enable LAN companion server
            </label>
            <div className="field">
              <label htmlFor="companionPort">Port</label>
              <input
                id="companionPort"
                type="number"
                min={1024}
                max={65535}
                value={form.companionPort ?? 47831}
                onChange={(e) =>
                  setForm({ ...form, companionPort: Number(e.target.value) || 47831 })
                }
              />
            </div>
            <div className="field">
              <label htmlFor="companionToken">Pairing token</label>
              <input
                id="companionToken"
                type="password"
                value={form.companionToken || companion?.token || ''}
                onChange={(e) => setForm({ ...form, companionToken: e.target.value })}
                placeholder="Generated on first enable"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="companion-status">
              <span className="hud-label">
                Server {companion?.running ? 'online' : 'offline'}
                {companion?.port ? ` · :${companion.port}` : ''}
              </span>
              {companion?.urls?.length ? (
                <ul className="companion-urls">
                  {companion.urls.map((url) => (
                    <li key={url}>
                      <code>{url}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="section-sub">Enable companion — LAN URLs appear once it starts.</p>
              )}
            </div>
            <div className="companion-actions">
              <button className="btn ghost" type="button" onClick={() => void rotateToken()}>
                Rotate token
              </button>
              <button className="btn ghost" type="button" onClick={() => void copyPairInfo()}>
                {copied ? 'Copied' : 'Copy pair info'}
              </button>
              <button className="btn ghost" type="button" onClick={() => void refreshCompanion()}>
                Refresh status
              </button>
            </div>
            {companion?.devices?.some((device) => !device.revokedAt) ? (
              <div className="companion-status" aria-label="Enrolled mobile devices">
                <span className="hud-label">Enrolled phones · protocol v{companion.protocolVersion}</span>
                <ul className="companion-urls">
                  {companion.devices.filter((device) => !device.revokedAt).map((device) => (
                    <li key={device.id}>
                      <span>{device.name} · seen {new Date(device.lastSeenAt).toLocaleString()}</span>{' '}
                      <button className="btn ghost" type="button" onClick={() => void revokePhone(device.id)}>
                        Revoke
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}
