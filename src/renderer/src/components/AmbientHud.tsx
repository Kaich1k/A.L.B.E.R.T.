import { useEffect, useRef, useState } from 'react'
import type { VoiceState } from '../../../shared/types'
import { useAlbertStore } from '../store'
import { FilamentOrb, orbMood } from './FilamentOrb'

function caption(state: VoiceState): string {
  switch (state) {
    case 'connecting':
      return 'Linking'
    case 'listening':
      return 'Listening'
    case 'thinking':
      return 'Thinking'
    case 'speaking':
      return 'Speaking'
    default:
      return 'Ready'
  }
}

function isHudTarget(node: HTMLElement, clientX: number, clientY: number, target: EventTarget | null, expanded: boolean): boolean {
  const el = target as HTMLElement | null
  if (el?.closest?.('button, input, .float-task, .speech-orb__panel')) return true
  if (expanded) return Boolean(el?.closest?.('.speech-orb'))
  const box = node.getBoundingClientRect()
  const cx = box.left + box.width / 2
  const cy = box.top + box.height / 2
  const dx = clientX - cx
  const dy = clientY - cy
  const r = Math.min(box.width, box.height) / 2 - 8
  return dx * dx + dy * dy <= r * r
}

export function AmbientHud(): React.JSX.Element {
  const voiceState = useAlbertStore((s) => s.voiceState)
  const busy = useAlbertStore((s) => s.busy)
  const setVoiceState = useAlbertStore((s) => s.setVoiceState)
  const setBusy = useAlbertStore((s) => s.setBusy)
  const [roam, setRoam] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [missionTitle, setMissionTitle] = useState<string | null>(null)
  const [nextStep, setNextStep] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const orbRef = useRef<HTMLElement>(null)
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; moved: boolean } | null>(null)
  const ignoreRef = useRef<boolean | null>(null)

  function setClickThrough(ignore: boolean): void {
    if (ignoreRef.current === ignore) return
    ignoreRef.current = ignore
    void window.albert.setHudClickThrough(ignore)
  }

  useEffect(() => {
    document.body.classList.add('hud-window')
    document.documentElement.classList.add('hud-window')
    setClickThrough(!expanded)
    return () => {
      document.body.classList.remove('hud-window')
      document.documentElement.classList.remove('hud-window')
    }
  }, [expanded])

  useEffect(() => {
    const off = window.albert.onChatEvent((event) => {
      if (event.type === 'done' || event.type === 'error') setBusy(false)
      if (event.type === 'tool_start') setBusy(true)
    })
    return off
  }, [setBusy])

  useEffect(() => {
    const tick = (): void => {
      void window.albert
        .getHudSnapshot()
        .then((snap) => {
          setRoam(snap.roam !== false)
          if (snap.voiceState) setVoiceState(snap.voiceState as VoiceState)
          setBusy(Boolean(snap.busy))
          setMissionTitle(snap.missionTitle)
          setNextStep(snap.nextStep)
        })
        .catch(() => undefined)
    }
    tick()
    const timer = window.setInterval(tick, 700)
    return () => window.clearInterval(timer)
  }, [setBusy, setVoiceState])

  const live = voiceState !== 'idle'
  const working = busy && !live
  const status = working ? 'Working' : caption(voiceState)

  function onPointerDown(event: React.PointerEvent<HTMLElement>): void {
    if ((event.target as HTMLElement).closest('button, input')) {
      setClickThrough(false)
      return
    }
    if (!isHudTarget(event.currentTarget, event.clientX, event.clientY, event.target, expanded)) {
      setClickThrough(true)
      return
    }
    setClickThrough(false)
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      moved: false
    }
    void window.albert.hudDrag({ phase: 'start', screenX: event.screenX, screenY: event.screenY })
  }

  function onPointerMove(event: React.PointerEvent<HTMLElement>): void {
    if (!dragRef.current) {
      const over = isHudTarget(event.currentTarget, event.clientX, event.clientY, event.target, expanded)
      setClickThrough(!over)
      return
    }
    const drag = dragRef.current
    if (drag.pointerId !== event.pointerId) return
    if (!drag.moved && Math.hypot(event.screenX - drag.startX, event.screenY - drag.startY) < 4) return
    drag.moved = true
    void window.albert.hudDrag({ phase: 'move', screenX: event.screenX, screenY: event.screenY })
  }

  function onPointerUp(event: React.PointerEvent<HTMLElement>): void {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    void window.albert.hudDrag({ phase: 'end', screenX: event.screenX, screenY: event.screenY })
    if (!drag.moved) {
      const next = !expanded
      setExpanded(next)
      setClickThrough(!next)
      void window.albert.setHudExpanded(next)
    }
    const node = orbRef.current
    if (node) setClickThrough(!isHudTarget(node, event.clientX, event.clientY, event.target, expanded))
  }

  async function sendDraft(): Promise<void> {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    await window.albert.sendChat(text)
  }

  return (
    <div className="hud-root">
      <article
        ref={orbRef}
        className={`speech-orb workshop-float state-${voiceState}${working ? ' is-busy' : ''}${live ? ' is-live' : ''}${
          roam ? ' is-free' : ' is-pinned'
        }${expanded ? ' is-expanded' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          if (!dragRef.current && !expanded) setClickThrough(true)
        }}
        onPointerEnter={(event) => {
          if (isHudTarget(event.currentTarget, event.clientX, event.clientY, event.target, expanded)) {
            setClickThrough(false)
          }
        }}
      >
        {expanded ? (
          <div className="float-sats">
            <button
              type="button"
              className="sat-talk"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => void window.albert.toggleVoice()}
            >
              {live ? 'End' : 'Talk'}
            </button>
            <button
              type="button"
              className="sat-open"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => void window.albert.showWindow()}
            >
              Open
            </button>
            <button
              type="button"
              className="sat-memory"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => void window.albert.showWindow('memory')}
            >
              Memory
            </button>
            <button
              type="button"
              className="sat-pin"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => {
                const next = !roam
                setRoam(next)
                void window.albert.setHudRoam(next)
              }}
            >
              {roam ? 'Pin' : 'Unpin'}
            </button>
          </div>
        ) : null}
        <FilamentOrb mood={orbMood(voiceState, working, false)} label={`Speech orb, ${status.toLowerCase()}`} />
        {expanded ? <p className="speech-orb__status">{status}</p> : null}
        {expanded ? (
          <div className="speech-orb__panel">
            <div className="float-task">
              <strong>{missionTitle || 'Standing by'}</strong>
              <span>{nextStep || (working ? 'Working' : live ? status : 'Voice ready')}</span>
            </div>
            <div className="float-actions">
              <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => void window.albert.toggleVoice()}>
                {live ? 'End' : 'Talk'}
              </button>
              <button
                type="button"
                className="danger"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => void window.albert.returnHudToDock()}
              >
                Dock
              </button>
              <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => void window.albert.showWindow()}>
                Workspace
              </button>
            </div>
            <form
              className="float-composer"
              onSubmit={(event) => {
                event.preventDefault()
                void sendDraft()
              }}
            >
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Tell Albert..."
                aria-label="Message Albert"
                onPointerDown={(event) => event.stopPropagation()}
              />
              <button type="submit" onPointerDown={(event) => event.stopPropagation()}>
                Send
              </button>
            </form>
          </div>
        ) : null}
      </article>
    </div>
  )
}
