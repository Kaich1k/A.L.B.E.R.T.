import { useCallback, useEffect, useState } from 'react'
import type { OperationsSnapshot } from '../../../shared/types'
import { useAlbertStore } from '../store'

export function SystemStatusRail(): React.JSX.Element {
  const voiceState = useAlbertStore((s) => s.voiceState)
  const wakeArmed = useAlbertStore((s) => s.wakeArmed)
  const routeInfo = useAlbertStore((s) => s.routeInfo)
  const busy = useAlbertStore((s) => s.busy)
  const setPanel = useAlbertStore((s) => s.setPanel)
  const codexStatus = useAlbertStore((s) => s.codexStatus)
  const codexProgress = useAlbertStore((s) => s.codexProgress)
  const [clock, setClock] = useState(() => new Date())
  const [operations, setOperations] = useState<OperationsSnapshot | null>(null)
  const refresh = useCallback(() => void window.albert.getOperations().then(setOperations).catch(() => undefined), [])

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000)
    refresh()
    const off = window.albert.onOperationsChanged(refresh)
    return () => { window.clearInterval(timer); off() }
  }, [refresh])

  const active = operations?.missions.find((mission) => ['active','approval','queued'].includes(mission.state))
  const approvals = operations?.approvals.filter((approval) => approval.state === 'pending').length || 0
  const state = voiceState !== 'idle' ? voiceState : busy ? 'processing' : wakeArmed ? 'wake armed' : 'standby'

  // Mid-turn Codex progress is more useful here than a static allowance figure.
  const codexLabel = codexProgress.trim()
    ? codexProgress.replace(/\s+/g, ' ').slice(0, 60)
    : codexStatus?.installed === false
      ? 'NOT INSTALLED'
      : codexStatus && !codexStatus.signedIn
        ? 'SIGN IN NEEDED'
        : codexStatus?.allowance?.label || null

  return <footer className={`system-status-rail rail-${voiceState}`} aria-label="Live system status">
    <span className="rail-state"><i />CORE / {state.toUpperCase()}</span>
    <span className="rail-route">BRAIN / {(routeInfo || 'CHATGPT').toUpperCase()}</span>
    {codexLabel ? (
      <button type="button" onClick={() => setPanel('settings')} title="ChatGPT — open Systems">
        CHATGPT / {codexLabel.toUpperCase()}
      </button>
    ) : null}
    <button type="button" onClick={() => { setPanel('missions'); window.setTimeout(() => window.dispatchEvent(new CustomEvent('albert:operations-view',{detail:'missions'})),0) }}>OBJECTIVE / {active?.title?.toUpperCase() || 'NONE ACTIVE'}</button>
    <button type="button" className={approvals ? 'attention' : ''} onClick={() => { setPanel('missions'); window.setTimeout(() => window.dispatchEvent(new CustomEvent('albert:operations-view',{detail:'approvals'})),0) }}>AUTH / {approvals ? `${approvals} PENDING` : 'CLEAR'}</button>
    <time dateTime={clock.toISOString()}>{clock.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' })}</time>
  </footer>
}
