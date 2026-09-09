import { useEffect, useRef, useState } from 'react'
import type { VoiceState } from '../../../shared/types'
import { useAlbertStore } from '../store'
import { AlbertCore } from './AlbertCore'

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
      return 'Standby'
  }
}

function isHudTarget(node: HTMLElement, clientX: number, clientY: number, target: EventTarget | null): boolean {
  if ((target as HTMLElement | null)?.closest?.('button')) return true
  const box = node.getBoundingClientRect()
  const cx = box.left + box.width / 2
  const cy = box.top + box.height / 2
  const dx = clientX - cx
  const dy = clientY - cy
  const r = Math.min(box.width, box.height) / 2 - 10
  return dx * dx + dy * dy <= r * r
}

export function AmbientHud(): React.JSX.Element {
  const voiceState = useAlbertStore((s) => s.voiceState)
  const busy = useAlbertStore((s) => s.busy)
  const setVoiceState = useAlbertStore((s) => s.setVoiceState)
  const setBusy = useAlbertStore((s) => s.setBusy)
  const [roam, setRoam] = useState(true)
  const orbRef = useRef<HTMLElement>(null)
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; moved: boolean } | null>(
    null
  )
  const ignoreRef = useRef<boolean | null>(null)

  function setClickThrough(ignore: boolean): void {
    if (ignoreRef.current === ignore) return
    ignoreRef.current = ignore
    void window.albert.setHudClickThrough(ignore)
  }

  useEffect(() => {
    document.body.classList.add('hud-window')
    document.documentElement.classList.add('hud-window')
    setClickThrough(true)
    return () => {
      document.body.classList.remove('hud-window')
      document.documentElement.classList.remove('hud-window')
    }
  }, [])

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
    if ((event.target as HTMLElement).closest('button')) {
      setClickThrough(false)
      return
    }
    if (!isHudTarget(event.currentTarget, event.clientX, event.clientY, event.target)) {
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
      setClickThrough(!isHudTarget(event.currentTarget, event.clientX, event.clientY, event.target))
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
    if (!drag.moved) void window.albert.showWindow()
    const node = orbRef.current
    if (node) setClickThrough(!isHudTarget(node, event.clientX, event.clientY, event.target))
  }

  return (
    <div className="hud-root">
      <article
        ref={orbRef}
        className={`speech-orb state-${voiceState}${working ? ' is-busy' : ''}${live ? ' is-live' : ''}${
          roam ? ' is-free' : ' is-pinned'
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          if (!dragRef.current) setClickThrough(true)
        }}
        onPointerEnter={(event) => {
          if (isHudTarget(event.currentTarget, event.clientX, event.clientY, event.target)) {
            setClickThrough(false)
          }
        }}
      >
        <div className="speech-orb__disc" aria-hidden="true" />
        <AlbertCore
          state={voiceState}
          variant="orb"
          label={`Speech orb, ${status.toLowerCase()}`}
        />
        <div className="speech-orb__chrome">
          <button
            type="button"
            className={`speech-orb__talk ${live ? 'live' : ''}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => void window.albert.toggleVoice()}
            aria-pressed={live}
            aria-label={live ? 'End voice session' : 'Engage voice session'}
          >
            {live ? 'End' : 'Talk'}
          </button>
          <button
            type="button"
            className={`speech-orb__pin ${roam ? '' : 'pinned'}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              const next = !roam
              setRoam(next)
              void window.albert.setHudRoam(next)
            }}
            aria-pressed={!roam}
            title={roam ? 'Pin orb in place' : 'Let the orb step aside of work'}
          >
            {roam ? 'Pin' : 'Unpin'}
          </button>
        </div>
      </article>
    </div>
  )
}
