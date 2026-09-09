import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ActivityEntry,
  CaptureItem,
  ContextCapsule,
  Mission,
  MissionState,
  OperationsSnapshot,
  ProjectPulse,
  Routine
} from '../../../shared/types'
import { useAlbertStore } from '../store'
import { ApprovalInbox } from './ApprovalInbox'
import { CommandTheater } from './CommandTheater'

type View = 'missions' | 'approvals' | 'routines' | 'capture' | 'focus' | 'pulse' | 'capsules' | 'artifacts' | 'theater'
const empty: OperationsSnapshot = { missions: [], routines: [], approvals: [], captures: [], generatedAt: 0 }
const capsuleKey = 'albert.contextCapsules'

export function MissionsPanel(): React.JSX.Element {
  const activity = useAlbertStore((s) => s.activity)
  const codexDiff = useAlbertStore((s) => s.codexDiff)
  const panel = useAlbertStore((s) => s.panel)
  const [data, setData] = useState(empty)
  const [view, setView] = useState<View>('missions')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | MissionState>('all')
  const [modal, setModal] = useState<'mission' | 'routine' | 'capture' | null>(null)
  const [capsules, setCapsules] = useState<ContextCapsule[]>([])
  const [pulse, setPulse] = useState<ProjectPulse | null>(null)
  const [pulseBusy, setPulseBusy] = useState(false)
  const [focusMinutes, setFocusMinutes] = useState(25)
  const [focusEndAt, setFocusEndAt] = useState(() => Number(window.sessionStorage.getItem('albert.focus.endAt') || 0))
  const [focusRemaining, setFocusRemaining] = useState(() => Math.max(0, Math.ceil((Number(window.sessionStorage.getItem('albert.focus.endAt') || 0) - Date.now()) / 1000)))

  const refresh = useCallback(async (): Promise<void> => {
    const next = await window.albert.getOperations()
    setData(next)
    setSelectedId((current) => current && next.missions.some((m) => m.id === current) ? current : next.missions[0]?.id ?? null)
  }, [])

  const refreshCapsules = useCallback(async (): Promise<void> => {
    const existing = await window.albert.listCapsules().catch(() => [])
    if (!existing.length) {
      const legacy = readLegacyCapsules()
      if (legacy.length) {
        const imported = await window.albert.importCapsules(legacy).catch(() => [])
        window.localStorage.removeItem(capsuleKey)
        setCapsules(imported)
        return
      }
    }
    setCapsules(existing)
  }, [])

  const refreshPulse = useCallback(async (force = false): Promise<void> => {
    setPulseBusy(true)
    try {
      setPulse(await window.albert.getProjectPulse(force))
    } catch (err) {
      setPulse({
        projectFolder: null,
        isGit: false,
        branch: null,
        dirty: [],
        recentCommits: [],
        staleBranches: [],
        todos: [],
        testFailures: [],
        nextTask: err instanceof Error ? err.message : String(err),
        score: null,
        generatedAt: Date.now(),
        error: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setPulseBusy(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    void refreshCapsules()
    return window.albert.onOperationsChanged(() => void refresh())
  }, [refresh, refreshCapsules])

  useEffect(() => window.albert.onCapsulesChanged(() => void refreshCapsules()), [refreshCapsules])

  useEffect(() => {
    if (view === 'pulse') void refreshPulse()
  }, [view, refreshPulse])

  useEffect(() => {
    const openModal = (event: Event): void => setModal((event as CustomEvent<'mission' | 'capture'>).detail)
    const openView = (event: Event): void => setView((event as CustomEvent<View>).detail)
    window.addEventListener('albert:open-operation-modal', openModal)
    window.addEventListener('albert:operations-view', openView)
    return () => {
      window.removeEventListener('albert:open-operation-modal', openModal)
      window.removeEventListener('albert:operations-view', openView)
    }
  }, [])

  useEffect(() => {
    if (focusEndAt <= Date.now()) { setFocusRemaining(0); return }
    const update = (): void => {
      const remaining = Math.max(0, Math.ceil((focusEndAt - Date.now()) / 1000))
      setFocusRemaining(remaining)
      if (!remaining) window.sessionStorage.removeItem('albert.focus.endAt')
    }
    update()
    const timer = window.setInterval(update, 500)
    return () => window.clearInterval(timer)
  }, [focusEndAt])

  function startFocus(): void {
    const endAt = Date.now() + focusMinutes * 60_000
    window.sessionStorage.setItem('albert.focus.endAt', String(endAt))
    setFocusEndAt(endAt)
  }

  function stopFocus(): void {
    window.sessionStorage.removeItem('albert.focus.endAt')
    setFocusEndAt(0)
    setFocusRemaining(0)
  }

  async function createCapsule(notes: string, title?: string): Promise<void> {
    const mission = selected ?? data.missions.find((m) => m.state === 'active') ?? null
    await window.albert.saveCapsule({
      title: title?.trim() || mission?.title,
      notes,
      panel,
      missionId: mission?.id
    })
    await refreshCapsules()
  }

  async function restoreCapsule(capsule: ContextCapsule): Promise<void> {
    const result = await window.albert.restoreCapsule(capsule.id)
    if (result.capsule?.missionId) setSelectedId(result.capsule.missionId)
    setView('missions')
  }

  const selected = data.missions.find((mission) => mission.id === selectedId) ?? null
  const visible = useMemo(() => data.missions.filter((mission) => filter === 'all' || mission.state === filter), [data.missions, filter])
  const pendingApprovals = data.approvals.filter((approval) => approval.state === 'pending')
  const active = data.missions.filter((mission) => mission.state === 'active').length
  const completed = data.missions.filter((mission) => mission.state === 'complete').length

  return (
    <section className="panel missions-panel">
      <header className="missions-header">
        <div><div className="eyebrow">PERSONAL OPERATIONS SYSTEM / LIVE</div><h2 className="section-title">Operations</h2><p className="section-sub">Plan outcomes, stage actions, preserve attention.</p></div>
        <div className="operations-actions">
          <button className="btn ghost" type="button" onClick={() => setModal('capture')}>Quick capture</button>
          <button className="btn primary" type="button" onClick={() => setModal('mission')}>New mission</button>
        </div>
      </header>

      <nav className="operations-nav" aria-label="Operations views">
        {(['missions', 'approvals', 'routines', 'capture', 'focus', 'pulse', 'capsules', 'artifacts', 'theater'] as View[]).map((item) => (
          <button type="button" key={item} className={view === item ? 'active' : ''} aria-current={view === item ? 'page' : undefined} onClick={() => setView(item)}>
            {item}{item === 'approvals' && pendingApprovals.length ? <b>{pendingApprovals.length}</b> : null}
          </button>
        ))}
      </nav>

      <div className="mission-kpis">
        <Kpi label="Active" value={String(active).padStart(2, '0')} note="in progress" tone="live" />
        <Kpi label="Needs your" value={String(pendingApprovals.length).padStart(2, '0')} note="approval gates" tone="warn" />
        <Kpi label="Routines" value={String(data.routines.filter((r) => r.enabled).length).padStart(2, '0')} note="armed" />
        <Kpi label="Completed" value={String(completed).padStart(2, '0')} note="all time" />
      </div>

      {view === 'missions' ? <SituationBrief data={data} /> : null}

      {view === 'missions' ? <MissionView missions={visible} selected={selected} filter={filter} setFilter={setFilter} select={setSelectedId} refresh={refresh} /> : null}
      {view === 'approvals' ? <ApprovalInbox approvals={data.approvals} refresh={refresh} /> : null}
      {view === 'routines' ? <RoutineView routines={data.routines} create={() => setModal('routine')} refresh={refresh} /> : null}
      {view === 'capture' ? <CaptureView captures={data.captures} create={() => setModal('capture')} refresh={refresh} /> : null}
      {view === 'focus' ? <FocusView mission={selected} missions={data.missions} select={setSelectedId} minutes={focusMinutes} setMinutes={setFocusMinutes} remaining={focusRemaining} start={startFocus} stop={stopFocus} /> : null}
      {view === 'pulse' ? <PulseView pulse={pulse} busy={pulseBusy} refresh={() => void refreshPulse(true)} data={data} /> : null}
      {view === 'capsules' ? <CapsuleView capsules={capsules} save={createCapsule} restore={restoreCapsule} remove={async (id) => { await window.albert.deleteCapsule(id); await refreshCapsules() }} /> : null}
      {view === 'artifacts' ? <ArtifactView data={data} activity={activity} codexDiff={codexDiff} /> : null}
      {view === 'theater' ? <CommandTheater /> : null}

      {modal === 'mission' ? <MissionDialog close={() => setModal(null)} done={refresh} /> : null}
      {modal === 'routine' ? <RoutineDialog close={() => setModal(null)} done={refresh} /> : null}
      {modal === 'capture' ? <CaptureDialog close={() => setModal(null)} done={refresh} /> : null}
    </section>
  )
}

function SituationBrief({ data }: { data: OperationsSnapshot }): React.JSX.Element {
  const [brief, setBrief] = useState<{ weather: string; calendar: string[]; overnight: string[]; firstMove: string } | null>(null)
  useEffect(() => {
    void window.albert.getDailyBrief(false).then((next) => {
      setBrief({
        weather: next.weather,
        calendar: next.calendar,
        overnight: next.overnight,
        firstMove: next.firstMove
      })
    }).catch(() => undefined)
  }, [data.generatedAt])
  const urgent = data.missions.find((m) => m.priority === 'critical' || m.priority === 'high') ?? data.missions.find((m) => !['complete','cancelled'].includes(m.state))
  const blocked = data.missions.filter((m) => m.state === 'blocked').length
  return <article className="daily-brief"><div className="brief-mark"><span>{String(new Date().getDate()).padStart(2,'0')}</span><small>{new Date().toLocaleString(undefined,{month:'short'}).toUpperCase()}</small></div><div className="brief-copy"><div className="eyebrow">DAILY BRIEF / {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div><h3>{brief?.firstMove || (urgent ? `Recommended first move: ${urgent.title}` : 'The operations deck is clear.')}</h3><p>{brief?.weather || urgent?.outcome || 'Create a mission when an outcome needs to survive beyond a conversation.'} {blocked ? `${blocked} blocked objective${blocked === 1 ? '' : 's'} need recovery.` : ''} {brief?.calendar.length ? ` Calendar: ${brief.calendar.slice(0,3).join(', ')}.` : ''} {brief?.overnight[0] ? ` Overnight: ${brief.overnight[0]}.` : ''}</p></div><div className="brief-actions"><span className="text-action">{data.approvals.filter((a)=>a.state==='pending').length} APPROVALS</span><span className="text-action">{data.routines.filter((r)=>r.enabled).length} ROUTINES ARMED</span></div></article>
}

function MissionView({ missions, selected, filter, setFilter, select, refresh }: { missions: Mission[]; selected: Mission | null; filter: 'all' | MissionState; setFilter: (v: 'all' | MissionState) => void; select: (id: string) => void; refresh: () => Promise<void> }): React.JSX.Element {
  const [stepDraft, setStepDraft] = useState('')
  async function changeState(state: MissionState): Promise<void> { if (selected) { await window.albert.updateMission(selected.id, { state }); await refresh() } }
  async function addStep(): Promise<void> { if (selected && stepDraft.trim()) { await window.albert.addMissionStep(selected.id, stepDraft); setStepDraft(''); await refresh() } }
  return <div className="mission-workspace">
    <div className="mission-board">
      <div className="mission-toolbar"><div className="filter-row">{(['all','active','approval','queued','waiting','blocked','complete'] as const).map((item) => <button key={item} type="button" className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item}</button>)}</div><span>{missions.length} OBJECTIVES</span></div>
      <div className="mission-list">{missions.length ? missions.map((mission) => <button type="button" key={mission.id} className={`mission-card ${selected?.id === mission.id ? 'selected' : ''}`} onClick={() => select(mission.id)}>
        <div className={`mission-state ${mission.state}`}>{mission.state}</div><div className="mission-card-copy"><div className="mission-card-heading"><h3>{mission.title}</h3><span>{mission.priority} · {mission.risk}</span></div><p>{mission.outcome}</p><div className="mission-progress"><i style={{ width: `${mission.progress}%` }} /></div><div className="mission-meta"><span>{mission.progress}% COMPLETE</span><span>{new Date(mission.updatedAt).toLocaleString()}</span></div></div>
      </button>) : <Empty title="No missions in this view" detail="Create an outcome and give Albert a concrete finish line." />}</div>
    </div>
    <aside className="mission-inspector">{selected ? <><div className="eyebrow">OBJECTIVE / {selected.id.slice(0,8).toUpperCase()}</div><div className={`inspector-sigil ${selected.state}`}><span>{selected.progress}</span><small>%</small></div><h3>{selected.title}</h3><p>{selected.outcome}</p>
      <div className="state-controls"><button type="button" disabled={selected.state === 'active' || selected.state === 'complete' || selected.state === 'cancelled'} onClick={() => void changeState('active')}>Start</button><button type="button" disabled={selected.state === 'waiting' || selected.state === 'complete' || selected.state === 'cancelled'} onClick={() => void changeState('waiting')}>Pause</button><button type="button" disabled={selected.state === 'complete' || selected.state === 'cancelled'} onClick={() => void changeState('complete')}>Complete</button></div>
      <div className="step-stack">{selected.steps.map((step, index) => <button type="button" key={step.id} className={step.state === 'complete' ? 'done' : ''} aria-pressed={step.state === 'complete'} aria-label={`${step.state === 'complete' ? 'Reopen' : 'Complete'} step: ${step.title}`} onClick={async () => { await window.albert.updateMissionStep(step.id, { state: step.state === 'complete' ? 'pending' : 'complete' }); await refresh() }}><span>{String(index + 1).padStart(2,'0')}</span>{step.title}</button>)}</div>
      <div className="inline-add"><input value={stepDraft} onChange={(e) => setStepDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addStep() }} placeholder="Add next step…"/><button type="button" onClick={() => void addStep()}>+</button></div>
      <button className="btn ghost inspector-button danger-text" type="button" onClick={async () => { if (!window.confirm(`Delete “${selected.title}” and its steps?`)) return; await window.albert.deleteMission(selected.id); await refresh() }}>Delete mission</button>
    </> : <Empty title="Select a mission" detail="Details and verification appear here." />}</aside>
  </div>
}

function RoutineView({ routines, create, refresh }: { routines: Routine[]; create: () => void; refresh: () => Promise<void> }): React.JSX.Element {
  return <div className="operations-section"><div className="section-row"><div><h3>Automation grid</h3><p>Due routines create reviewable missions. They never silently publish, spend, or delete.</p></div><button className="btn primary" type="button" onClick={create}>New routine</button></div><div className="routine-table">{routines.length ? routines.map((routine) => <article key={routine.id}><button className={`toggle ${routine.enabled ? 'on' : ''}`} type="button" aria-pressed={routine.enabled} aria-label={`${routine.enabled ? 'Disable' : 'Enable'} routine ${routine.name}`} onClick={async () => { await window.albert.updateRoutine(routine.id, { enabled: !routine.enabled }); await refresh() }}><i /></button><div><strong>{routine.name}</strong><p>{routine.prompt}</p></div><div><span>{routine.schedule}</span><small>{routine.nextRunAt ? `NEXT ${new Date(routine.nextRunAt).toLocaleString()}` : 'MANUAL / UNSCHEDULED'}</small></div><button className="icon-delete" type="button" aria-label={`Delete routine ${routine.name}`} onClick={async () => { if (!window.confirm(`Delete routine “${routine.name}”?`)) return; await window.albert.deleteRoutine(routine.id); await refresh() }}>×</button></article>) : <Empty title="No routines armed" detail="Schedule a briefing, project review, watch, or recurring preparation." />}</div></div>
}

function CaptureView({ captures, create, refresh }: { captures: CaptureItem[]; create: () => void; refresh: () => Promise<void> }): React.JSX.Element {
  return <div className="operations-section"><div className="section-row"><div><h3>Universal capture</h3><p>Ideas, tasks, links, and loose ends land here before they disappear.</p></div><button className="btn primary" onClick={create} type="button">Capture</button></div><div className="capture-grid">{captures.filter((c) => c.state !== 'archived').length ? captures.filter((c) => c.state !== 'archived').map((capture) => <article key={capture.id}><span>{capture.kind}</span><p>{capture.content}</p><small>{new Date(capture.createdAt).toLocaleString()}</small><div><button type="button" onClick={async () => { await window.albert.updateCapture(capture.id, 'filed'); await refresh() }}>File</button><button type="button" onClick={async () => { await window.albert.updateCapture(capture.id, 'archived'); await refresh() }}>Archive</button></div></article>) : <Empty title="Capture inbox zero" detail="A surprisingly rare and suspiciously peaceful condition." />}</div></div>
}

function FocusView({ mission, missions, select, minutes, setMinutes, remaining, start, stop }: { mission: Mission | null; missions: Mission[]; select: (id: string) => void; minutes: number; setMinutes: (v: number) => void; remaining: number; start: () => void; stop: () => void }): React.JSX.Element {
  const mm = String(Math.floor(remaining / 60)).padStart(2,'0'); const ss = String(remaining % 60).padStart(2,'0')
  const progress = remaining ? Math.max(0, Math.min(100, (remaining / (minutes * 60)) * 100)) : 100
  return <div className={`focus-cockpit ${remaining ? 'engaged' : ''}`}><div className="focus-ring" style={{ '--focus-progress': `${progress * 3.6}deg` } as React.CSSProperties}><span>{remaining ? `${mm}:${ss}` : `${minutes}:00`}</span><small>{remaining ? 'FOCUS ENGAGED' : 'READY'}</small></div><div className="focus-config"><div className="eyebrow">ATTENTION PROTOCOL</div><h3>{mission?.title || 'Choose a mission'}</h3><p>{mission?.outcome || 'Focus Mode keeps one outcome visible and everything else quiet.'}</p><label>Objective<select value={mission?.id || ''} onChange={(e) => select(e.target.value)}><option value="">Select…</option>{missions.filter((m) => m.state !== 'complete').map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select></label><label>Duration<input type="range" min="10" max="90" step="5" value={minutes} disabled={remaining > 0} onChange={(e) => setMinutes(Number(e.target.value))}/><span>{minutes} minutes</span></label><button className={remaining ? 'btn ghost' : 'btn primary'} type="button" disabled={!mission} onClick={remaining ? stop : start}>{remaining ? 'End focus session' : 'Engage focus mode'}</button></div></div>
}

function PulseView({
  pulse,
  busy,
  refresh,
  data
}: {
  pulse: ProjectPulse | null
  busy: boolean
  refresh: () => void
  data: OperationsSnapshot
}): React.JSX.Element {
  const blocked = data.missions.filter((m) => m.state === 'blocked').length
  return (
    <div className="pulse-dashboard">
      <article>
        <div className="eyebrow">PROJECT PULSE</div>
        <h3>{pulse?.projectFolder ? pulse.projectFolder.split('/').slice(-2).join('/') : 'No project folder'}</h3>
        <div className="health-score">
          <strong>{pulse?.score ?? '—'}</strong>
          <span>/100</span>
        </div>
        <p>
          {pulse?.branch ? `On ${pulse.branch}` : 'Not a git repo'}
          {pulse?.isGit ? ` · ${pulse.dirty.length} dirty` : ''}
          {blocked ? ` · ${blocked} blocked missions` : ''}
          {busy ? ' · scanning…' : ''}
        </p>
        <button className="btn ghost" type="button" onClick={refresh} disabled={busy}>
          Rescan
        </button>
        {pulse?.error ? <small>{pulse.error}</small> : null}
      </article>
      <article>
        <div className="eyebrow">NEXT LIKELY TASK</div>
        <h3>{pulse?.nextTask || 'Nothing obvious yet'}</h3>
        <p>{data.missions.find((m) => m.state === 'active')?.outcome || 'Pulse uses the active mission, first TODO, or first dirty file.'}</p>
      </article>
      <article>
        <div className="eyebrow">DIRTY TREE</div>
        <h3>{pulse?.dirty.length ?? 0} changed files</h3>
        <ul>
          {(pulse?.dirty.length ? pulse.dirty.slice(0, 8) : [{ path: 'Working tree clean', status: 'ok' }]).map((row) => (
            <li key={`${row.status}-${row.path}`}><span>{row.path}</span><b>{row.status}</b></li>
          ))}
        </ul>
      </article>
      <article>
        <div className="eyebrow">TODOS / FIXME</div>
        <h3>{pulse?.todos.length ?? 0} open notes</h3>
        <ul>
          {(pulse?.todos.length ? pulse.todos.slice(0, 6) : [{ path: '—', line: 0, text: 'No TODO/FIXME hits in the scanned files.' }]).map((todo) => (
            <li key={`${todo.path}:${todo.line}`}><span>{todo.text}</span><b>{todo.line ? `${todo.path}:${todo.line}` : ''}</b></li>
          ))}
        </ul>
      </article>
      <article>
        <div className="eyebrow">STALE BRANCHES</div>
        <h3>{pulse?.staleBranches.length ?? 0} older than 21 days</h3>
        <ul>
          {(pulse?.staleBranches.length
            ? pulse.staleBranches
            : [{ name: pulse?.isGit ? 'None stale' : 'No git history', lastCommitAt: 0 }]).map((branch) => (
            <li key={branch.name}>
              <span>{branch.name}</span>
              <b>{branch.lastCommitAt ? new Date(branch.lastCommitAt).toLocaleDateString() : ''}</b>
            </li>
          ))}
        </ul>
      </article>
      <article>
        <div className="eyebrow">RECENT COMMITS</div>
        <h3>{pulse?.recentCommits[0]?.subject || 'No recent commits'}</h3>
        <ul>
          {(pulse?.recentCommits || []).slice(0, 5).map((commit) => (
            <li key={commit.hash}><span>{commit.subject}</span><b>{commit.hash}</b></li>
          ))}
        </ul>
      </article>
      <article>
        <div className="eyebrow">TEST / BUILD FAULTS</div>
        <h3>{pulse?.testFailures.length ?? 0} recent failures</h3>
        <p>{pulse?.testFailures[0]?.result || 'No failed test/lint/build activity in the flight recorder.'}</p>
      </article>
    </div>
  )
}

function readLegacyCapsules(): ContextCapsule[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(capsuleKey) || '[]') as ContextCapsule[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function CapsuleView({
  capsules,
  save,
  restore,
  remove
}: {
  capsules: ContextCapsule[]
  save: (notes: string, title?: string) => Promise<void>
  restore: (capsule: ContextCapsule) => Promise<void>
  remove: (id: string) => void | Promise<void>
}): React.JSX.Element {
  const [notes, setNotes] = useState('')
  const [title, setTitle] = useState('')
  return (
    <div className="capsule-workspace">
      <article className="capsule-capture">
        <div className="eyebrow">CONTEXT CAPSULE</div>
        <h3>Save the current operating position</h3>
        <p>Seals the selected mission, Computer tabs, front apps, project folder, and a resume note. Later: “resume {title || 'GPACE outreach'}”.</p>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Capsule name — e.g. GPACE outreach" />
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What should future-you know before resuming?" />
        <button
          className="btn primary"
          type="button"
          onClick={async () => {
            await save(notes, title)
            setNotes('')
            setTitle('')
          }}
        >
          Seal capsule
        </button>
      </article>
      <div className="capsule-list">
        {capsules.length ? capsules.map((capsule) => (
          <article key={capsule.id}>
            <div>
              <span>{new Date(capsule.createdAt).toLocaleString()}</span>
              <h3>{capsule.title}</h3>
              <p>{capsule.notes || 'No operator note.'}</p>
              <small>
                {capsule.tabs.length} tabs
                {capsule.apps.length ? ` · ${capsule.apps.slice(0, 3).join(', ')}` : ''}
                {capsule.missionTitle ? ` · ${capsule.missionTitle}` : ''}
              </small>
            </div>
            <div>{capsule.tabs.slice(0, 3).map((tab) => <code key={tab.url}>{tab.title}</code>)}</div>
            <footer>
              <button type="button" onClick={() => void restore(capsule)}>Restore</button>
              <button type="button" onClick={() => void remove(capsule.id)}>Delete</button>
            </footer>
          </article>
        )) : <Empty title="No capsules saved" detail="Seal a working state before context evaporates in the usual heroic fashion." />}
      </div>
    </div>
  )
}

function ArtifactView({
  data,
  activity,
  codexDiff
}: {
  data: OperationsSnapshot
  activity: ActivityEntry[]
  codexDiff: string
}): React.JSX.Element {
  const [stored, setStored] = useState<Array<{ kind: string; title: string; body: string; source: string; time: number; version?: number }>>([])
  useEffect(() => {
    void window.albert.listArtifacts().then((rows) => {
      setStored(rows.map((row) => ({
        kind: row.kind,
        title: `${row.title} v${row.version}`,
        body: row.body,
        source: row.source,
        time: row.createdAt,
        version: row.version
      })))
    }).catch(() => undefined)
  }, [data.generatedAt, activity.length, codexDiff])
  const stepArtifacts = data.missions.flatMap((mission) =>
    mission.steps
      .filter((step) => step.result || step.verification)
      .map((step) => ({ kind: 'step', title: step.title, body: step.verification || step.result || '', source: mission.title, time: step.updatedAt, version: undefined as number | undefined }))
  )
  const captureArtifacts = data.captures
    .filter((capture) => capture.state !== 'archived')
    .map((capture) => ({ kind: capture.kind, title: capture.kind, body: capture.content, source: capture.state, time: capture.updatedAt || capture.createdAt, version: undefined as number | undefined }))
  const approvalArtifacts = data.approvals
    .filter((approval) => approval.preview)
    .map((approval) => ({ kind: 'approval', title: approval.title, body: approval.preview || approval.description, source: approval.state, time: approval.updatedAt || approval.createdAt, version: undefined as number | undefined }))
  const activityArtifacts = activity.slice(0, 6).map((entry) => ({ kind: entry.ok ? 'operation' : 'fault', title: (entry.toolName || 'tool').replaceAll('_',' '), body: entry.result || '', source: entry.ok ? 'verified' : 'failed', time: entry.createdAt, version: undefined as number | undefined }))
  const diffArtifact = codexDiff ? [{ kind: 'diff', title: 'Current Codex diff', body: codexDiff, source: 'live turn', time: Date.now(), version: undefined as number | undefined }] : []
  const artifacts = [...stored, ...diffArtifact, ...stepArtifacts, ...approvalArtifacts, ...captureArtifacts, ...activityArtifacts].sort((a,b)=>b.time-a.time)
  return <div className="artifact-workspace"><header><div><div className="eyebrow">ARTIFACT WORKSPACE</div><h3>{artifacts.length} versioned outputs and evidence items</h3></div><span>Drafts · diffs · captures · approvals · tool results</span></header><div className="artifact-grid">{artifacts.length ? artifacts.map((artifact,index)=><article key={`${artifact.kind}-${artifact.time}-${index}`}><div className="artifact-kind">{artifact.kind}{artifact.version ? ` v${artifact.version}` : ''}</div><h3>{artifact.title}</h3><p>{String(artifact.body || '').slice(0,520)}</p><footer><span>{artifact.source}</span><time>{new Date(artifact.time).toLocaleString()}</time></footer></article>) : <Empty title="No artifacts yet" detail="Mission outputs, previews, captures, and diffs will collect here." />}</div></div>
}

function MissionDialog({ close, done }: { close: () => void; done: () => Promise<void> }): React.JSX.Element {
  const [title,setTitle]=useState(''); const [outcome,setOutcome]=useState(''); const [steps,setSteps]=useState('')
  return <Modal title="New mission" close={close}><label>Mission title<input autoFocus value={title} onChange={(e)=>setTitle(e.target.value)} placeholder="Prepare the release"/></label><label>Definition of done<textarea value={outcome} onChange={(e)=>setOutcome(e.target.value)} placeholder="A verified build and a ship/hold recommendation."/></label><label>Initial steps <small>one per line</small><textarea value={steps} onChange={(e)=>setSteps(e.target.value)} placeholder={'Run checks\nReview packaging\nPrepare recommendation'}/></label><button className="btn primary" disabled={!title.trim()} type="button" onClick={async()=>{await window.albert.createMission({title,outcome,steps:steps.split('\n')});await done();close()}}>Create mission</button></Modal>
}
function RoutineDialog({ close, done }: { close: () => void; done: () => Promise<void> }): React.JSX.Element {
  const [name,setName]=useState(''); const [prompt,setPrompt]=useState(''); const [schedule,setSchedule]=useState('08:00')
  return <Modal title="New routine" close={close}><label>Name<input autoFocus value={name} onChange={(e)=>setName(e.target.value)} placeholder="Daily briefing"/></label><label>Action<textarea value={prompt} onChange={(e)=>setPrompt(e.target.value)} placeholder="Prepare my calendar, priorities, and recommended first move."/></label><label>Schedule<input value={schedule} onChange={(e)=>setSchedule(e.target.value)} placeholder="08:00 or every 30 minutes"/><small>Supports HH:MM and “every N minutes/hours”.</small></label><button className="btn primary" disabled={!name.trim()||!prompt.trim()||!schedule.trim()} type="button" onClick={async()=>{await window.albert.createRoutine({name,prompt,schedule});await done();close()}}>Arm routine</button></Modal>
}
function CaptureDialog({ close, done }: { close: () => void; done: () => Promise<void> }): React.JSX.Element {
  const [content,setContent]=useState(''); const [kind,setKind]=useState<CaptureItem['kind']>('note')
  return <Modal title="Quick capture" close={close}><label>Type<select value={kind} onChange={(e)=>setKind(e.target.value as CaptureItem['kind'])}>{['note','task','idea','url','receipt','reference'].map((v)=><option key={v}>{v}</option>)}</select></label><label>Capture<textarea autoFocus value={content} onChange={(e)=>setContent(e.target.value)} placeholder="Drop the thought here. Sorting can wait."/></label><button className="btn primary" disabled={!content.trim()} type="button" onClick={async()=>{await window.albert.createCapture(content,kind);await done();close()}}>Save to inbox</button></Modal>
}
function Modal({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }): React.JSX.Element {
  const modalRef = useRef<HTMLDivElement>(null)
  const priorFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    priorFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const timer = window.setTimeout(() => modalRef.current?.querySelector<HTMLElement>('input,textarea,select,button')?.focus(), 20)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return }
      if (event.key !== 'Tab') return
      const nodes = modalRef.current?.querySelectorAll<HTMLElement>('input:not(:disabled),textarea:not(:disabled),select:not(:disabled),button:not(:disabled)')
      if (!nodes?.length) return
      const first=nodes[0], last=nodes[nodes.length-1]
      if (event.shiftKey && document.activeElement===first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement===last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown',onKey)
    return () => { window.clearTimeout(timer); document.removeEventListener('keydown',onKey); priorFocus.current?.focus() }
  }, [close])
  return <div className="modal-shade" onMouseDown={(e)=>{if(e.target===e.currentTarget)close()}}><div ref={modalRef} className="operations-modal" role="dialog" aria-modal="true" aria-labelledby="operations-modal-title"><header><div><div className="eyebrow">ALBERT OPERATIONS</div><h3 id="operations-modal-title">{title}</h3></div><button type="button" onClick={close} aria-label={`Close ${title}`}>×</button></header>{children}</div></div>
}
function Empty({ title, detail }: { title: string; detail: string }): React.JSX.Element { return <div className="operations-empty"><span>◇</span><h3>{title}</h3><p>{detail}</p></div> }
function Kpi({label,value,note,tone=''}:{label:string;value:string;note:string;tone?:string}):React.JSX.Element{return <article className={`mission-kpi ${tone}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>}
