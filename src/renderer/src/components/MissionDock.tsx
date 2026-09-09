import { useEffect, useMemo, useState } from 'react'
import type { OperationsSnapshot } from '../../../shared/types'
import { useAlbertStore } from '../store'

const empty: OperationsSnapshot = { missions: [], routines: [], approvals: [], captures: [], generatedAt: 0 }

export function MissionDock(): React.JSX.Element {
  const setPanel = useAlbertStore((s) => s.setPanel)
  const panel = useAlbertStore((s) => s.panel)
  const voiceState = useAlbertStore((s) => s.voiceState)
  const busy = useAlbertStore((s) => s.busy)
  const routeInfo = useAlbertStore((s) => s.routeInfo)
  const [data, setData] = useState(empty)
  const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem('albert.dock.collapsed') !== '0')

  useEffect(() => {
    let cancelled = false
    const refresh = (): void => {
      void window.albert.getOperations()
        .then((next) => {
          if (!cancelled) setData(next)
        })
        .catch(() => undefined)
    }
    refresh()
    const off = window.albert.onOperationsChanged(refresh)
    return () => {
      cancelled = true
      off()
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem('albert.dock.collapsed', collapsed ? '1' : '0')
  }, [collapsed])

  const activeMission = useMemo(
    () =>
      data.missions.find((m) => m.state === 'active') ??
      data.missions.find((m) => ['queued', 'approval', 'blocked', 'waiting'].includes(m.state)) ??
      null,
    [data.missions]
  )
  const pendingApprovals = data.approvals.filter((a) => a.state === 'pending').length
  const openLoops = data.missions.filter((m) => !['complete', 'cancelled'].includes(m.state)).length
  const captures = data.captures.filter((c) => c.state === 'inbox').length
  const nextStep = activeMission?.steps.find((s) => s.state !== 'complete')?.title
  const blocked = data.missions.filter((m) => m.state === 'blocked').length
  const status = busy ? 'Executing' : voiceState !== 'idle' ? voiceState : 'Standing by'
  const doingNow = busy ? (routeInfo || 'Working the current turn') : nextStep || 'Waiting for the next order'

  function openOps(view: string): void {
    setPanel('missions')
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('albert:operations-view', { detail: view }))
    }, panel === 'missions' ? 0 : 80)
  }

  return (
    <aside className={`mission-dock ${collapsed ? 'collapsed' : ''}`} aria-label="Mission dock">
      <button
        className="mission-dock-toggle"
        type="button"
        aria-label={collapsed ? 'Expand mission dock' : 'Collapse mission dock'}
        onClick={() => setCollapsed((v) => !v)}
      >
        {collapsed ? '▸' : '×'}
      </button>
      <button className="mission-dock-core" type="button" onClick={() => openOps('missions')}>
        <span>{status}{blocked ? ` · ${blocked} blocked` : ''}</span>
        <strong>{activeMission?.title || 'No active mission'}</strong>
        <small>{doingNow}</small>
      </button>
      <div className="mission-dock-actions">
        <button type="button" onClick={() => openOps('approvals')}>
          <b>{pendingApprovals}</b>
          <span>Approvals</span>
        </button>
        <button type="button" onClick={() => openOps('capture')}>
          <b>{captures}</b>
          <span>Capture</span>
        </button>
        <button type="button" onClick={() => openOps('pulse')}>
          <b>{openLoops}</b>
          <span>Loops</span>
        </button>
      </div>
    </aside>
  )
}
