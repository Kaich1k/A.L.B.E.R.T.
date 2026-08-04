import { useEffect, useState } from 'react'
import { APP_EXPANSION, APP_NAME } from '../../../shared/brand'
import { useAlbertStore } from '../store'

interface Props {
  onTalk: () => void
}

function formatHudClock(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function brainLabel(settings: {
  routingMode?: string
  localProvider?: string
}): string {
  const mode = settings.routingMode || 'auto'
  if (mode === 'local') {
    return settings.localProvider === 'groq' ? 'LOCAL·GROQ' : 'LOCAL·OLLAMA'
  }
  if (mode === 'fast') return 'HAIKU'
  if (mode === 'power') return 'OPUS'
  return 'AUTO'
}

function ttsLabel(provider?: string): string {
  if (provider === 'kokoro') return 'KOKORO'
  if (provider === 'elevenlabs') return 'ELEVEN'
  return 'SYSTEM'
}

export function HomePanel({ onTalk }: Props): React.JSX.Element {
  const setPanel = useAlbertStore((s) => s.setPanel)
  const voiceState = useAlbertStore((s) => s.voiceState)
  const wakeArmed = useAlbertStore((s) => s.wakeArmed)
  const error = useAlbertStore((s) => s.error)
  const setError = useAlbertStore((s) => s.setError)
  const settings = useAlbertStore((s) => s.settings)
  const memories = useAlbertStore((s) => s.memories)
  const setMemories = useAlbertStore((s) => s.setMemories)
  const routeInfo = useAlbertStore((s) => s.routeInfo)
  const hasBrain = Boolean(
    settings.anthropicApiKey?.trim() ||
      settings.ollamaApiKey?.trim() ||
      settings.groqApiKey?.trim()
  )
  const wakeOn = settings.wakeWordEnabled !== false
  const [clock, setClock] = useState(() => formatHudClock(new Date()))

  useEffect(() => {
    const id = window.setInterval(() => setClock(formatHudClock(new Date())), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    void window.albert.listMemories().then(setMemories).catch(() => undefined)
  }, [setMemories])

  const coreClass = [
    'orb',
    'reactor-core',
    voiceState === 'listening' ? 'listening' : '',
    voiceState === 'speaking' ? 'speaking' : '',
    voiceState === 'connecting' || voiceState === 'thinking' ? 'listening' : '',
    voiceState === 'idle' && wakeArmed ? 'listening' : ''
  ]
    .filter(Boolean)
    .join(' ')

  const brain = brainLabel(settings)
  const wakeValue = !wakeOn ? 'OFF' : wakeArmed ? 'ARMED' : 'ARMING'
  const wakePct = !wakeOn ? 8 : wakeArmed ? 100 : 42
  const corePct = hasBrain ? 100 : 12
  const voiceValue = voiceState === 'idle' ? 'IDLE' : voiceState.toUpperCase()
  const voicePct =
    voiceState === 'speaking' || voiceState === 'listening'
      ? 100
      : voiceState === 'thinking' || voiceState === 'connecting'
        ? 70
        : 18
  const memCount = memories.length
  const tts = ttsLabel(settings.ttsProvider)

  return (
    <section className="panel hero jarvis-home">
      <header className="jarvis-topbar">
        <div className="jarvis-brand-line">
          <span className="jarvis-brand-name">{APP_NAME}</span>
          <span className="jarvis-version">v0.1.0</span>
        </div>
        <div className="jarvis-top-status">
          <span className={`jarvis-uplink ${hasBrain ? 'ok' : 'off'}`}>
            {hasBrain ? 'UPLINK_SECURE' : 'UPLINK_OFFLINE'}
          </span>
          <span className="jarvis-clock">{clock}</span>
        </div>
      </header>

      {/* Diags sit beside the reactor only — brand text is below, no overlap */}
      <div className="jarvis-stage">
        <aside className="jarvis-diag left">
          <div className="jarvis-diag-title">SYS_STATUS</div>
          <Meter label="BRAIN" value={brain} pct={hasBrain ? 100 : 20} />
          <Meter label="CORE" value={hasBrain ? 'ONLINE' : 'OFFLINE'} pct={corePct} />
          <Meter label="WAKE" value={wakeValue} pct={wakePct} />
        </aside>

        <div className="jarvis-reactor-slot">
          <div className="reactor-wrap jarvis-reactor">
            <div className="reactor-ring outer" />
            <div className="reactor-ring mid" />
            <div className="reactor-ring inner" />
            <div className="reactor-ring ticks" />
            <div className="reactor-crosshair" aria-hidden />
            <div className="reactor-dot n" />
            <div className="reactor-dot e" />
            <div className="reactor-dot s" />
            <div className="reactor-dot w" />
            <div className={coreClass} aria-hidden />
          </div>
        </div>

        <aside className="jarvis-diag right">
          <div className="jarvis-diag-title">LINK_STATUS</div>
          <Meter label="VOICE" value={voiceValue} pct={voicePct} />
          <Meter label="TTS" value={tts} pct={100} />
          <Meter
            label="MEMORY"
            value={String(memCount)}
            pct={Math.min(100, Math.max(8, memCount * 12))}
          />
        </aside>
      </div>

      <div className="jarvis-brand-block">
        <h1 className="hero-brand">{APP_NAME}</h1>
        <p className="hero-expansion">{APP_EXPANSION}</p>
        {routeInfo ? <p className="jarvis-route-chip">{routeInfo}</p> : null}
      </div>

      {error ? (
        <div className="error-banner">
          <div>{error}</div>
          <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="hero-actions jarvis-actions">
        <button
          className="btn primary jarvis-cta"
          onClick={onTalk}
          disabled={!hasBrain && voiceState === 'idle'}
        >
          <span className="jarvis-cta-glyph" aria-hidden>
            ◉
          </span>
          {voiceState === 'idle' ? 'Engage voice' : 'End voice'}
        </button>
        <button
          className="btn ghost jarvis-cta"
          onClick={() => setPanel('conversation')}
          disabled={!hasBrain}
        >
          <span className="jarvis-cta-glyph" aria-hidden>
            ▣
          </span>
          Open channel
        </button>
      </div>

      <div className="status-pill">
        <span
          className={`status-dot ${
            voiceState === 'listening' ||
            voiceState === 'speaking' ||
            voiceState === 'connecting' ||
            voiceState === 'thinking'
              ? voiceState === 'speaking'
                ? 'speaking'
                : 'listening'
              : wakeArmed
                ? 'ready'
                : hasBrain
                  ? 'ready'
                  : ''
          }`}
        />
        {!hasBrain
          ? 'Add Anthropic, Groq, or Ollama key in Systems'
          : voiceState !== 'idle'
            ? `Voice · ${voiceState}`
            : wakeOn && wakeArmed
              ? 'Wake armed · say “Albert, wake up”'
              : wakeOn
                ? 'Arming wake mic…'
                : error
                  ? 'Fault logged — dismiss to continue'
                  : 'All systems nominal · Engage or enable wake word'}
      </div>
    </section>
  )
}

function Meter({
  label,
  value,
  pct
}: {
  label: string
  value: string
  pct: number
}): React.JSX.Element {
  const width = Math.max(4, Math.min(100, pct))
  return (
    <div className="jarvis-meter">
      <div className="jarvis-meter-row">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="jarvis-meter-track">
        <div className="jarvis-meter-fill" style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}
