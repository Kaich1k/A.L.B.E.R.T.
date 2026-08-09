import { useEffect, useState } from 'react'
import { APP_EXPANSION, APP_NAME } from '../../../shared/brand'
import type { OperationsSnapshot } from '../../../shared/types'
import { useAlbertStore } from '../store'
import { AlbertCore } from './AlbertCore'

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
    if (settings.localProvider === 'groq') return 'QUICK·GROQ CLOUD'
    if (settings.localProvider === 'gemini') return 'QUICK·GEMINI'
    return 'QUICK·OLLAMA'
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
  const activity = useAlbertStore((s) => s.activity)
  const hasBrain = Boolean(
    settings.anthropicApiKey?.trim() ||
      settings.ollamaApiKey?.trim() ||
      settings.groqApiKey?.trim() ||
      settings.geminiApiKey?.trim() ||
      settings.localProvider === 'ollama'
  )
  const wakeOn = settings.wakeWordEnabled !== false
  const [clock, setClock] = useState(() => formatHudClock(new Date()))
  const [operations, setOperations] = useState<OperationsSnapshot | null>(null)

  useEffect(() => {
    const id = window.setInterval(() => setClock(formatHudClock(new Date())), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    void window.albert.listMemories().then(setMemories).catch(() => undefined)
    void window.albert.getOperations().then(setOperations).catch(() => undefined)
    return window.albert.onOperationsChanged(() => {
      void window.albert.getOperations().then(setOperations).catch(() => undefined)
    })
  }, [setMemories])

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
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning, sir.' : hour < 18 ? 'Good afternoon, sir.' : 'Good evening, sir.'

  return (
    <section className="panel hero jarvis-home">
      <header className="jarvis-topbar">
        <div className="jarvis-brand-line">
          <span className="jarvis-brand-name">{APP_NAME}</span>
          <span className="jarvis-version">v0.1.0</span>
        </div>
        <div className="jarvis-top-status">
          <span className={`jarvis-uplink ${hasBrain ? 'ok' : 'off'}`}>
            {hasBrain ? 'ROUTER_CONFIGURED' : 'ROUTER_OFFLINE'}
          </span>
          <span className="jarvis-clock">{clock}</span>
        </div>
      </header>

      {/* Diags sit beside the reactor only — brand text is below, no overlap */}
      <div className="jarvis-stage">
        <aside className="jarvis-diag left">
          <div className="jarvis-diag-title">SYS_STATUS</div>
          <Meter label="BRAIN" value={brain} pct={hasBrain ? 100 : 20} />
          <Meter label="CORE" value={hasBrain ? 'CONFIGURED' : 'OFFLINE'} pct={corePct} />
          <Meter label="WAKE" value={wakeValue} pct={wakePct} />
        </aside>

        <div className="jarvis-reactor-slot">
          <AlbertCore state={voiceState} wakeArmed={wakeArmed} fault={Boolean(error)} />
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
        <p className="jarvis-greeting">{greeting} {hasBrain ? 'Cognitive routing is configured and standing by.' : 'The core is awaiting a brain connection.'}</p>
        {routeInfo ? <p className="jarvis-route-chip">{routeInfo}</p> : null}
      </div>

      <div className="home-intel-deck">
        <button type="button" onClick={() => setPanel('missions')}>
          <span>PRIORITY OBJECTIVE</span>
          <strong>{operations?.missions.find((m) => ['active', 'queued', 'approval'].includes(m.state))?.title || 'NO ACTIVE MISSION'}</strong>
          <small>{operations?.missions.filter((m) => !['complete', 'cancelled'].includes(m.state)).length || 0} OPEN LOOPS</small>
        </button>
        <button type="button" onClick={() => setPanel('missions')}>
          <span>DECISION QUEUE</span>
          <strong>{operations?.approvals.filter((a) => a.state === 'pending').length || 0} AWAITING YOU</strong>
          <small>HUMAN AUTHORITY RETAINED</small>
        </button>
        <button type="button" onClick={() => setPanel('activity')}>
          <span>LAST OPERATION</span>
          <strong>{activity[0]?.toolName?.replaceAll('_', ' ') || 'SYSTEM IDLE'}</strong>
          <small>AUDIT TRAIL AVAILABLE</small>
        </button>
      </div>

      {error ? (
        <div className="error-banner" role="alert">
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
                  : 'Interface ready · Engage or enable wake word'}
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
