import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { ActivityEntry, AlbertSettings, OperationsSnapshot, VoiceState } from '../../../shared/types'
import { useAlbertStore } from '../store'
import './JarvisTelemetry.css'

const RENDERER_SESSION_STARTED_AT = Date.now()
const DEFAULT_REFRESH_INTERVAL = 15_000

export interface JarvisTelemetryProps {
  /** Removes the recent-activity rail and tightens the grid for small placements. */
  compact?: boolean
  className?: string
  /** Set to 0 to rely entirely on store updates after the initial refresh. */
  refreshIntervalMs?: number
}

type CoreTone = 'nominal' | 'engaged' | 'processing' | 'attention' | 'offline'

interface CoreStatus {
  label: string
  detail: string
  tone: CoreTone
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function formatClock(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: '2-digit'
  })
    .format(date)
    .toUpperCase()
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

function timeAgo(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000))
  if (seconds < 10) return 'NOW'
  if (seconds < 60) return `${seconds}S AGO`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}M AGO`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}H AGO`
  return `${Math.floor(hours / 24)}D AGO`
}

function hasConfiguredBrain(settings: AlbertSettings): boolean {
  return Boolean(
    settings.anthropicApiKey?.trim() ||
      settings.ollamaApiKey?.trim() ||
      settings.groqApiKey?.trim() ||
      settings.geminiApiKey?.trim() ||
      settings.localProvider === 'ollama'
  )
}

function shortenModel(model: string): string {
  return model.replace(/^claude-/i, '').replace(/-latest$/i, '').toUpperCase()
}

function routeLabel(settings: AlbertSettings): string {
  switch (settings.routingMode) {
    case 'local':
      return settings.localProvider === 'gemini' ? 'GEMINI FALLBACK' : 'LOCKED FALLBACK'
    case 'fast':
      return `OPUS FAMILY · ${shortenModel(settings.fastModel)}`
    case 'power':
      return `OPUS · ${shortenModel(settings.powerModel)}`
    default:
      return 'CHATGPT'
  }
}

function voiceProvider(settings: AlbertSettings): string {
  if (settings.ttsProvider === 'kokoro') return `KOKORO · ${settings.kokoroVoiceId}`
  if (settings.ttsProvider === 'elevenlabs') return 'ELEVENLABS'
  return settings.ttsVoice ? `SYSTEM · ${settings.ttsVoice}` : 'SYSTEM VOICE'
}

function voiceDetail(
  voiceState: VoiceState,
  voiceStatus: string,
  settings: AlbertSettings,
  wakeArmed: boolean
): string {
  if (voiceStatus.trim()) return voiceStatus.trim()
  if (voiceState !== 'idle') return `Voice channel ${voiceState}`
  if (settings.wakeWordEnabled === false) return 'Wake phrase disabled'
  return wakeArmed ? 'Wake phrase armed' : 'Wake phrase arming'
}

function coreStatus(options: {
  error: string | null
  configured: boolean
  busy: boolean
  streamingText: string
  voiceState: VoiceState
  wakeArmed: boolean
}): CoreStatus {
  if (options.error) {
    return { label: 'ATTENTION', detail: options.error, tone: 'attention' }
  }
  if (!options.configured) {
    return {
      label: 'STANDBY',
      detail: 'Configure a brain provider to establish uplink',
      tone: 'offline'
    }
  }
  if (options.voiceState !== 'idle') {
    return {
      label: options.voiceState.toUpperCase(),
      detail: `Voice interface ${options.voiceState}`,
      tone: options.voiceState === 'thinking' ? 'processing' : 'engaged'
    }
  }
  if (options.busy || options.streamingText.length > 0) {
    return { label: 'PROCESSING', detail: 'Inference stream active', tone: 'processing' }
  }
  return {
    label: 'READY',
    detail: options.wakeArmed ? 'Wake phrase armed' : 'Cognitive route configured',
    tone: 'nominal'
  }
}

function activitySuccessRate(activity: ActivityEntry[]): number {
  const sample = activity.slice(0, 20)
  if (sample.length === 0) return 100
  return Math.round((sample.filter((entry) => entry.ok).length / sample.length) * 100)
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

export function JarvisTelemetry({
  compact = false,
  className,
  refreshIntervalMs = DEFAULT_REFRESH_INTERVAL
}: JarvisTelemetryProps): React.JSX.Element {
  const settings = useAlbertStore((state) => state.settings)
  const messages = useAlbertStore((state) => state.messages)
  const streamingText = useAlbertStore((state) => state.streamingText)
  const busy = useAlbertStore((state) => state.busy)
  const error = useAlbertStore((state) => state.error)
  const memories = useAlbertStore((state) => state.memories)
  const activity = useAlbertStore((state) => state.activity)
  const voiceState = useAlbertStore((state) => state.voiceState)
  const voiceStatus = useAlbertStore((state) => state.voiceStatus)
  const routeInfo = useAlbertStore((state) => state.routeInfo)
  const wakeArmed = useAlbertStore((state) => state.wakeArmed)
  const setMemories = useAlbertStore((state) => state.setMemories)
  const setActivity = useAlbertStore((state) => state.setActivity)
  const [now, setNow] = useState(() => new Date())
  const [operations, setOperations] = useState<OperationsSnapshot | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let active = true

    async function refresh(): Promise<void> {
      if (document.hidden) return
      const [memoryResult, activityResult, operationsResult] = await Promise.allSettled([
        window.albert.listMemories(),
        window.albert.listActivity(),
        window.albert.getOperations()
      ])
      if (!active) return
      if (memoryResult.status === 'fulfilled') setMemories(memoryResult.value)
      if (activityResult.status === 'fulfilled') setActivity(activityResult.value)
      if (operationsResult.status === 'fulfilled') setOperations(operationsResult.value)
    }

    const onVisible = (): void => {
      if (!document.hidden) void refresh()
    }

    void refresh()
    const removeOperationsListener = window.albert.onOperationsChanged(() => void refresh())
    const interval =
      refreshIntervalMs > 0
        ? window.setInterval(() => void refresh(), Math.max(5_000, refreshIntervalMs))
        : undefined
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      active = false
      if (interval !== undefined) window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      removeOperationsListener()
    }
  }, [refreshIntervalMs, setActivity, setMemories])

  const configured = hasConfiguredBrain(settings)
  const status = coreStatus({ error, configured, busy, streamingText, voiceState, wakeArmed })
  const recentActivity = activity.slice(0, compact ? 3 : 5)
  const successRate = activitySuccessRate(activity)
  const meanConfidence = memories.length
    ? Math.round(
        (memories.reduce((total, memory) => total + (memory.confidence ?? 1), 0) /
          memories.length) *
          100
      )
    : 0
  const memoryCategories = new Set(memories.map((memory) => memory.category)).size
  const activeMissions =
    operations?.missions.filter((mission) =>
      ['queued', 'active', 'waiting', 'approval', 'blocked'].includes(mission.state)
    ).length ?? 0
  const pendingApprovals =
    operations?.approvals.filter((approval) => approval.state === 'pending').length ?? 0
  const sessionTurns = messages.filter(
    (message) => message.role === 'user' || message.role === 'assistant'
  ).length
  const coreLoad =
    voiceState === 'speaking' || voiceState === 'listening'
      ? 92
      : voiceState === 'thinking' || busy || streamingText
        ? 76
        : configured
          ? 24
          : 8
  const route = routeInfo.trim() || routeLabel(settings)
  const activityLabel = activity.length
    ? `${successRate}% success across ${Math.min(activity.length, 20)} recent tool calls`
    : 'No tool calls logged this session'
  const timestamp = now.getTime()
  const displayStyle = {
    '--jvt-core-load': `${coreLoad}`,
    '--jvt-memory-confidence': `${meanConfidence}%`,
    '--jvt-activity-health': `${successRate}%`
  } as CSSProperties

  const waveform = useMemo(
    () => Array.from({ length: 17 }, (_, index) => <i key={index} />),
    []
  )

  return (
    <section
      className={cx(
        'jvt',
        `jvt--${status.tone}`,
        `jvt--voice-${voiceState}`,
        compact && 'jvt--compact',
        settings.performanceMode !== false && 'jvt--efficient',
        className
      )}
      style={displayStyle}
      aria-label="Albert live system telemetry"
    >
      <header className="jvt__header">
        <div className="jvt__identity">
          <span className="jvt__live-dot" aria-hidden="true" />
          <div>
            <strong>NEURAL TELEMETRY</strong>
            <small>ALBERT // LIVE SYSTEM BUS</small>
          </div>
        </div>
        <div className="jvt__clock-block">
          <time dateTime={now.toISOString()} className="jvt__clock">
            {formatClock(now)}
          </time>
          <span>{formatDate(now)}</span>
        </div>
      </header>

      <div className="jvt__body">
        <div className="jvt__core-column">
          <div className="jvt__core" aria-hidden="true">
            <svg viewBox="0 0 160 160" focusable="false">
              <circle className="jvt__core-grid" cx="80" cy="80" r="68" />
              <circle className="jvt__core-track" cx="80" cy="80" r="57" />
              <circle
                className="jvt__core-value"
                cx="80"
                cy="80"
                r="57"
                pathLength="100"
                strokeDasharray={`${coreLoad} ${100 - coreLoad}`}
              />
              <circle className="jvt__core-inner" cx="80" cy="80" r="37" />
            </svg>
            <div className="jvt__reticle jvt__reticle--outer" />
            <div className="jvt__reticle jvt__reticle--inner" />
            <span className="jvt__core-number">{pad(coreLoad)}</span>
            <small>ACTIVITY</small>
          </div>
          <div className="jvt__state" role="status" aria-live="polite" aria-atomic="true">
            <span>{status.label}</span>
            <p title={status.detail}>{status.detail}</p>
          </div>
          <div className="jvt__wave" aria-hidden="true">
            {waveform}
          </div>
        </div>

        <div className="jvt__readouts">
          <TelemetryReadout
            code="VOC"
            label="Voice interface"
            value={voiceState.toUpperCase()}
            detail={voiceDetail(voiceState, voiceStatus, settings, wakeArmed)}
            meta={voiceProvider(settings)}
            active={voiceState !== 'idle'}
          />
          <TelemetryReadout
            code="RTE"
            label="Cognitive routing"
            value={settings.routingMode === 'codex' || settings.routingMode === 'auto' ? 'CHATGPT' : settings.routingMode.toUpperCase()}
            detail={route}
            meta={configured ? 'ROUTE CONFIGURED' : 'PROVIDER REQUIRED'}
            active={busy || streamingText.length > 0}
          />
          <TelemetryReadout
            code="MEM"
            label="Memory lattice"
            value={String(memories.length).padStart(2, '0')}
            detail={`${memoryCategories} ${memoryCategories === 1 ? 'category' : 'categories'} · ${meanConfidence}% mean confidence`}
            meta={memories.length ? 'INDEX AVAILABLE' : 'AWAITING INPUT'}
            meter={meanConfidence}
          />
          <TelemetryReadout
            code="SES"
            label="Session uptime"
            value={formatDuration(timestamp - RENDERER_SESSION_STARTED_AT)}
            detail={`${sessionTurns} turns · ${activeMissions} active ops`}
            meta={pendingApprovals ? `${pendingApprovals} APPROVAL${pendingApprovals === 1 ? '' : 'S'} PENDING` : 'NO APPROVAL HOLDS'}
            active={sessionTurns > 0}
          />
        </div>
      </div>

      {!compact ? (
        <footer className="jvt__activity">
          <div className="jvt__activity-heading">
            <span>ACTIVITY BUS</span>
            <small>{activityLabel}</small>
          </div>
          <div className="jvt__activity-stream" aria-label="Recent tool activity">
            {recentActivity.length ? (
              recentActivity.map((entry, index) => (
                <div
                  key={entry.id}
                  className={cx('jvt__activity-packet', !entry.ok && 'jvt__activity-packet--failed')}
                  title={`${entry.toolName} · ${entry.ok ? 'successful' : 'failed'} · ${new Date(entry.createdAt).toLocaleString()}`}
                >
                  <span>{pad(index + 1)}</span>
                  <strong>{entry.toolName.replaceAll('_', ' ')}</strong>
                  <small>{timeAgo(entry.createdAt, timestamp)}</small>
                </div>
              ))
            ) : (
              <div className="jvt__activity-empty">Bus clear · awaiting first tool event</div>
            )}
          </div>
        </footer>
      ) : null}
    </section>
  )
}

function TelemetryReadout({
  code,
  label,
  value,
  detail,
  meta,
  active = false,
  meter
}: {
  code: string
  label: string
  value: string
  detail: string
  meta: string
  active?: boolean
  meter?: number
}): React.JSX.Element {
  return (
    <article className={cx('jvt__readout', active && 'jvt__readout--active')}>
      <span className="jvt__readout-code" aria-hidden="true">
        {code}
      </span>
      <div className="jvt__readout-copy">
        <small>{label}</small>
        <strong title={value}>{value}</strong>
        <p title={detail}>{detail}</p>
        {meter !== undefined ? (
          <div
            className="jvt__meter"
            role="meter"
            aria-label={`${label} confidence`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={meter}
          >
            <i style={{ width: `${Math.max(2, Math.min(100, meter))}%` }} />
          </div>
        ) : null}
        <em>{meta}</em>
      </div>
    </article>
  )
}
