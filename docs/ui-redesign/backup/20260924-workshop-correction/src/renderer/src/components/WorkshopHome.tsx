import { useEffect, useRef, useState } from 'react'
import { brainChoice, brainDisplayName } from '../../../shared/brainRouting'
import type { MemoryFact, OperationsSnapshot, PanelId } from '../../../shared/types'
import { useAlbertStore } from '../store'
import { stopSpeaking } from '../voice/tts'
import { FilamentOrb, orbMood } from './FilamentOrb'

function polar(cx: number, cy: number, radius: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180
  return [cx + Math.cos(rad) * radius, cy + Math.sin(rad) * radius]
}

function ringPath(a0: number, a1: number, inner = 168, outer = 236): string {
  const large = a1 - a0 > 180 ? 1 : 0
  const [x0, y0] = polar(260, 250, outer, a0)
  const [x1, y1] = polar(260, 250, outer, a1)
  const [x2, y2] = polar(260, 250, inner, a1)
  const [x3, y3] = polar(260, 250, inner, a0)
  return `M ${x0} ${y0} A ${outer} ${outer} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${inner} ${inner} 0 ${large} 0 ${x3} ${y3} Z`
}

const RING: Array<{
  id: PanelId | 'computer'
  label: string
  hint: string
  a0: number
  a1: number
  icon: 'talk' | 'missions' | 'memory' | 'activity' | 'computer' | 'settings'
}> = [
  { id: 'conversation', label: 'Talk', hint: 'Voice & text', a0: 305, a1: 355, icon: 'talk' },
  { id: 'missions', label: 'Missions', hint: 'Plan and act', a0: 5, a1: 55, icon: 'missions' },
  { id: 'memory', label: 'Memory', hint: 'What he remembers', a0: 65, a1: 115, icon: 'memory' },
  { id: 'activity', label: 'Activity', hint: 'History', a0: 125, a1: 175, icon: 'activity' },
  { id: 'computer', label: 'Computer', hint: 'Browse and tools', a0: 185, a1: 235, icon: 'computer' },
  { id: 'settings', label: 'Settings', hint: 'Voice, provider', a0: 245, a1: 295, icon: 'settings' }
]

function clip(text: string, max = 140): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

function openCommandPalette(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))
}

function RingGlyph({ name, x, y }: { name: (typeof RING)[number]['icon']; x: number; y: number }): React.JSX.Element {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const }
  return (
    <g className="ring-glyph" transform={`translate(${x - 8} ${y - 8})`} aria-hidden="true">
      {name === 'talk' ? (
        <path {...common} d="M2 10h2l1.2-4 1.6 8 1.6-6 1.2 3H12" />
      ) : null}
      {name === 'missions' ? (
        <>
          <circle {...common} cx="8" cy="8" r="5.2" />
          <circle {...common} cx="8" cy="8" r="2" />
        </>
      ) : null}
      {name === 'memory' ? (
        <path {...common} d="M4 11c-1.4-1-2-2.4-2-4a4 4 0 0 1 7-2.4A4 4 0 0 1 14 8c0 1.8-.8 3.2-2.2 4H4z" />
      ) : null}
      {name === 'activity' ? (
        <>
          <circle {...common} cx="8" cy="8" r="5.4" />
          <path {...common} d="M8 5v3.2l2.2 1.4" />
        </>
      ) : null}
      {name === 'computer' ? (
        <path {...common} d="M2.5 4h11v7H2.5zM5 13h6" />
      ) : null}
      {name === 'settings' ? (
        <path
          {...common}
          d="M8 3.2 9.2 5l2.2.2.8 2 1.8 1.2L13.2 10l.8 2-1.8 1.2-.8 2-2.2.2L8 12.8 6.8 15l-2.2-.2-.8-2L2 11.6 2.8 10 2 8l1.8-1.2.8-2 2.2-.2z"
        />
      ) : null}
    </g>
  )
}

export function WorkshopHome({ onTalk }: { onTalk: () => void }): React.JSX.Element {
  const setPanel = useAlbertStore((s) => s.setPanel)
  const voiceState = useAlbertStore((s) => s.voiceState)
  const busy = useAlbertStore((s) => s.busy)
  const error = useAlbertStore((s) => s.error)
  const messages = useAlbertStore((s) => s.messages)
  const memories = useAlbertStore((s) => s.memories)
  const setMemories = useAlbertStore((s) => s.setMemories)
  const activity = useAlbertStore((s) => s.activity)
  const settings = useAlbertStore((s) => s.settings)
  const codexStatus = useAlbertStore((s) => s.codexStatus)
  const streamingText = useAlbertStore((s) => s.streamingText)
  const [operations, setOperations] = useState<OperationsSnapshot | null>(null)
  const [stepId, setStepId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const dockRef = useRef<HTMLDivElement>(null)
  const [orbParked, setOrbParked] = useState(true)

  useEffect(() => {
    void window.albert.listMemories().then(setMemories).catch(() => undefined)
    void window.albert.getOperations().then(setOperations).catch(() => undefined)
    void window.albert
      .getHudSnapshot()
      .then((snap) => setOrbParked(snap.docked !== false))
      .catch(() => undefined)
    const offOps = window.albert.onOperationsChanged(() => {
      void window.albert.getOperations().then(setOperations).catch(() => undefined)
    })
    const remember = (): void => {
      const node = dockRef.current
      if (!node) return
      const rect = node.getBoundingClientRect()
      if (rect.width < 80) return
      void window.albert.dockHud({ x: rect.x, y: rect.y, width: rect.width, height: rect.height, park: false })
    }
    const observer = new ResizeObserver(() => remember())
    if (dockRef.current) observer.observe(dockRef.current)
    const onResize = (): void => remember()
    window.addEventListener('resize', onResize)
    const offDock = window.albert.onChatEvent((event) => {
      if (event.type === 'hud_docked') setOrbParked(event.docked !== false)
    })
    const timer = window.setTimeout(remember, 120)
    return () => {
      offOps()
      offDock()
      observer.disconnect()
      window.removeEventListener('resize', onResize)
      window.clearTimeout(timer)
    }
  }, [setMemories])

  const mission =
    operations?.missions.find((item) => item.state === 'active') ||
    operations?.missions.find((item) => item.state !== 'complete' && item.state !== 'cancelled') ||
    null
  const steps = (mission?.steps || []).slice().sort((a, b) => a.position - b.position).slice(0, 6)
  const selectedStep = steps.find((step) => step.id === stepId) || steps.find((step) => step.state === 'active') || steps[0] || null
  const userLine = [...messages].reverse().find((message) => message.role === 'user')
  const albertLine = streamingText
    ? { content: streamingText }
    : [...messages].reverse().find((message) => message.role === 'assistant')
  const latestActivity = activity[0]
  const mood = orbMood(voiceState, busy, Boolean(error))
  const brain = brainDisplayName(brainChoice(settings))
  const connected = Boolean(codexStatus?.signedIn)
  const voiceReady = voiceState === 'idle' && !busy

  function go(id: PanelId | 'computer'): void {
    if (id === 'computer') {
      void window.albert.showComputer()
      return
    }
    setPanel(id)
  }

  async function setMissionState(next: 'waiting' | 'cancelled' | 'active'): Promise<void> {
    if (!mission) return
    await window.albert.updateMission(mission.id, { state: next })
    setOperations(await window.albert.getOperations())
  }

  async function sendDraft(): Promise<void> {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    stopSpeaking()
    await window.albert.sendChat(text)
  }

  return (
    <section className="workshop-home" aria-label="Workshop">
      <div className="workshop-column">
        <article className="workshop-panel">
          <header>
            <h2>Conversation</h2>
            <span>Talk with Albert</span>
          </header>
          <div className="workshop-thread">
            {userLine ? (
              <p className="bubble you">
                <strong>You</strong>
                {clip(userLine.content)}
              </p>
            ) : (
              <p className="workshop-empty">No messages yet.</p>
            )}
            {albertLine ? (
              <p className="bubble albert">
                <strong>Albert</strong>
                {clip(albertLine.content)}
              </p>
            ) : null}
          </div>
          <button type="button" className="workshop-link" onClick={() => setPanel('conversation')}>
            Open conversation
          </button>
        </article>
        <article className="workshop-panel">
          <header>
            <h2>Memory context</h2>
            <span>Relevant to your current work</span>
          </header>
          <MemorySketch memories={memories.slice(0, 4)} />
          <div className="workshop-actions">
            <button type="button" onClick={() => setPanel('memory')}>
              Inspect
            </button>
            <button type="button" onClick={() => setPanel('memory')}>
              Edit
            </button>
          </div>
        </article>
      </div>

      <div className="workshop-hub">
        <button
          type="button"
          className="workshop-detach"
          onClick={() => {
            const node = dockRef.current
            if (node) {
              const rect = node.getBoundingClientRect()
              if (rect.width >= 80) {
                void window.albert.dockHud({
                  x: rect.x,
                  y: rect.y,
                  width: rect.width,
                  height: rect.height,
                  park: false
                })
              }
            }
            void window.albert.undockHud()
          }}
        >
          Detach orb
        </button>
        <div className="workshop-ring">
          <svg viewBox="0 0 520 520" className="ring-svg" role="group" aria-label="Workshop destinations">
            <circle cx="260" cy="250" r="244" className="ring-guide" />
            {RING.map((item) => {
              const mid = (item.a0 + item.a1) / 2
              const [ix, iy] = polar(260, 250, 214, mid)
              const [lx, ly] = polar(260, 250, 196, mid)
              return (
                <g
                  key={item.id}
                  className="ring-hit"
                  onClick={() => go(item.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      go(item.id)
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`${item.label}. ${item.hint}`}
                >
                  <path d={ringPath(item.a0, item.a1)} className="ring-segment" />
                  <RingGlyph name={item.icon} x={ix} y={iy - 16} />
                  <text x={lx} y={ly} textAnchor="middle">
                    <tspan x={lx} dy="0">
                      {item.label}
                    </tspan>
                    <tspan x={lx} dy="13">
                      {item.hint}
                    </tspan>
                  </text>
                </g>
              )
            })}
            {steps.slice(0, 4).map((step, index, list) => {
              const span = 92 / Math.max(list.length, 1)
              const start = 142 + index * span
              const [lx, ly] = polar(260, 250, 128, start + span / 2)
              return (
                <g
                  key={step.id}
                  className="ring-hit"
                  onClick={() => setStepId(step.id)}
                  role="button"
                  tabIndex={0}
                  aria-label={step.title}
                >
                  <path
                    d={ringPath(start, start + span - 4, 112, 146)}
                    className={selectedStep?.id === step.id ? 'mission-segment active' : `mission-segment ${step.state}`}
                  />
                  <text className="mission-arc-label" x={lx} y={ly} textAnchor="middle">
                    {clip(step.title, 12)}
                  </text>
                </g>
              )
            })}
          </svg>
          <div className={`workshop-orb-dock${orbParked ? '' : ' is-empty'}`} ref={dockRef}>
            {orbParked ? <FilamentOrb mood={mood} label={`Albert, ${mood}`} /> : null}
            {orbParked ? null : (
              <button type="button" className="orb-dock-snap" onClick={() => void window.albert.returnHudToDock()}>
                Snap back
              </button>
            )}
          </div>
          <div className="compare-card">
            <strong>{selectedStep ? clip(selectedStep.title, 42) : mission?.title || 'Standing by'}</strong>
            <span>{voiceReady ? 'Voice ready' : voiceState === 'idle' ? 'Working' : voiceState}</span>
          </div>
        </div>
        <div className="voice-row">
          <span>Voice input</span>
          <i className={voiceState === 'listening' || voiceState === 'speaking' ? 'live' : ''} />
          <button type="button" aria-label={voiceState === 'idle' ? 'Talk' : 'Voice is live'} onClick={onTalk}>
            {voiceState === 'listening' ? 'Live' : 'Mic'}
          </button>
        </div>
        <div className="activity-chips">
          <button type="button" onClick={() => setPanel('activity')}>
            {latestActivity ? clip(latestActivity.toolName.replaceAll('_', ' '), 28) : 'No recent action'}
            <small>{latestActivity ? new Date(latestActivity.createdAt).toLocaleTimeString() : ''}</small>
          </button>
          <button type="button" onClick={() => setPanel('missions')}>
            {mission ? clip(mission.title, 28) : 'No mission'}
            <small>{selectedStep ? selectedStep.state : 'idle'}</small>
          </button>
        </div>
      </div>

      <div className="workshop-column">
        <article className="workshop-panel">
          <header>
            <h2>{mission?.title || 'Mission'}</h2>
            <span>{mission ? 'Research, analyze and create' : 'No mission selected'}</span>
          </header>
          <ol className="workshop-steps">
            {steps.length ? (
              steps.map((step) => (
                <li key={step.id} className={selectedStep?.id === step.id ? 'active' : step.state}>
                  <button type="button" onClick={() => setStepId(step.id)}>
                    <em />
                    <span>{step.title}</span>
                    <small>{step.state}</small>
                  </button>
                </li>
              ))
            ) : (
              <li className="workshop-empty">Create a mission in Missions.</li>
            )}
          </ol>
          <div className="workshop-actions">
            <button type="button" disabled={!mission || mission.state === 'waiting'} onClick={() => void setMissionState('waiting')}>
              <i className="icon-pause" /> Pause
            </button>
            <button
              type="button"
              className="danger"
              disabled={!mission}
              onClick={() => void setMissionState(mission?.state === 'waiting' ? 'active' : 'cancelled')}
            >
              <i className="icon-stop" /> {mission?.state === 'waiting' ? 'Resume' : 'Stop'}
            </button>
          </div>
        </article>
        <article className="workshop-panel">
          <header>
            <h2>Active source</h2>
            <span>
              {brain}
              {codexStatus?.model ? ` · ${codexStatus.model}` : ''}
            </span>
          </header>
          <div className="source-card">
            <strong>{latestActivity ? latestActivity.toolName.replaceAll('_', ' ') : connected ? 'ChatGPT connected' : 'Not signed in'}</strong>
            <p>{latestActivity ? clip(latestActivity.result, 120) : 'No tool result yet.'}</p>
          </div>
          <div className="workshop-actions">
            <button type="button" onClick={() => void window.albert.showComputer()}>
              Open browser
            </button>
            <button type="button" onClick={() => setPanel('activity')}>
              Open activity
            </button>
          </div>
        </article>
      </div>

      <form
        className="workshop-composer"
        onSubmit={(event) => {
          event.preventDefault()
          void sendDraft()
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask Albert or drop a file..."
          aria-label="Message Albert"
        />
        <button type="button" onClick={() => setPanel('conversation')} aria-label="Attach in conversation">
          Img
        </button>
        <button type="button" onClick={onTalk} aria-label="Talk">
          Mic
        </button>
        <button type="submit" className="send" aria-label="Send">
          Send
        </button>
      </form>
    </section>
  )
}

function MemorySketch({ memories }: { memories: MemoryFact[] }): React.JSX.Element {
  if (!memories.length) return <p className="workshop-empty">No memories stored.</p>
  const spots = [
    { x: 88, y: 62, color: '#f0b14a' },
    { x: 42, y: 28, color: '#5ee0a0' },
    { x: 148, y: 36, color: '#6cb6ff' },
    { x: 38, y: 118, color: '#c79bff' }
  ]
  return (
    <svg className="memory-sketch" viewBox="0 0 180 150" role="img" aria-label="Memory map">
      {spots.slice(1).map((spot, index) => (
        <line key={index} x1={spots[0]!.x} y1={spots[0]!.y} x2={spot.x} y2={spot.y} />
      ))}
      {memories.slice(0, 4).map((memory, index) => (
        <g key={memory.id}>
          <circle cx={spots[index]!.x} cy={spots[index]!.y} r={index === 0 ? 8 : 6} fill={spots[index]!.color} />
          <text x={spots[index]!.x + 10} y={spots[index]!.y + 4}>
            {clip(memory.content, 16)}
          </text>
        </g>
      ))}
    </svg>
  )
}

export function WorkshopBar({
  panel,
  onHome
}: {
  panel: string
  onHome: () => void
}): React.JSX.Element {
  const codexStatus = useAlbertStore((s) => s.codexStatus)
  const connected = Boolean(codexStatus?.signedIn)
  return (
    <header className="workshop-bar">
      <button type="button" className="workshop-brand" onClick={onHome}>
        A.L.B.E.R.T. <span>WORKSHOP</span>
      </button>
      <button type="button" className="workshop-search" onClick={openCommandPalette}>
        <i />
        Search, ask, or run a command...
      </button>
      <span className={`workshop-link-state ${connected ? 'ok' : ''}`}>{connected ? 'Connected' : 'Offline'}</span>
      {panel !== 'home' ? (
        <button type="button" className="workshop-hub-back" onClick={onHome}>
          Hub
        </button>
      ) : null}
    </header>
  )
}
