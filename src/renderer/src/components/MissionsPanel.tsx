import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CaptureItem, Mission, MissionState, OperationsSnapshot, Routine } from '../../../shared/types'

type View = 'missions' | 'approvals' | 'routines' | 'capture' | 'focus' | 'pulse'
const empty: OperationsSnapshot = { missions: [], routines: [], approvals: [], captures: [], generatedAt: 0 }

export function MissionsPanel(): React.JSX.Element {
  const [data, setData] = useState(empty)
  const [view, setView] = useState<View>('missions')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | MissionState>('all')
  const [modal, setModal] = useState<'mission' | 'routine' | 'capture' | null>(null)
  const [focusMinutes, setFocusMinutes] = useState(25)
  const [focusEndAt, setFocusEndAt] = useState(() => Number(window.sessionStorage.getItem('albert.focus.endAt') || 0))
  const [focusRemaining, setFocusRemaining] = useState(() => Math.max(0, Math.ceil((Number(window.sessionStorage.getItem('albert.focus.endAt') || 0) - Date.now()) / 1000)))

  const refresh = useCallback(async (): Promise<void> => {
    const next = await window.albert.getOperations()
    setData(next)
    setSelectedId((current) => current && next.missions.some((m) => m.id === current) ? current : next.missions[0]?.id ?? null)
  }, [])

  useEffect(() => {
    void refresh()
    return window.albert.onOperationsChanged(() => void refresh())
  }, [refresh])

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
        {(['missions', 'approvals', 'routines', 'capture', 'focus', 'pulse'] as View[]).map((item) => (
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
      {view === 'approvals' ? <ApprovalView approvals={data.approvals} refresh={refresh} /> : null}
      {view === 'routines' ? <RoutineView routines={data.routines} create={() => setModal('routine')} refresh={refresh} /> : null}
      {view === 'capture' ? <CaptureView captures={data.captures} create={() => setModal('capture')} refresh={refresh} /> : null}
      {view === 'focus' ? <FocusView mission={selected} missions={data.missions} select={setSelectedId} minutes={focusMinutes} setMinutes={setFocusMinutes} remaining={focusRemaining} start={startFocus} stop={stopFocus} /> : null}
      {view === 'pulse' ? <PulseView data={data} /> : null}

      {modal === 'mission' ? <MissionDialog close={() => setModal(null)} done={refresh} /> : null}
      {modal === 'routine' ? <RoutineDialog close={() => setModal(null)} done={refresh} /> : null}
      {modal === 'capture' ? <CaptureDialog close={() => setModal(null)} done={refresh} /> : null}
    </section>
  )
}

function SituationBrief({ data }: { data: OperationsSnapshot }): React.JSX.Element {
  const urgent = data.missions.find((m) => m.priority === 'critical' || m.priority === 'high') ?? data.missions.find((m) => !['complete','cancelled'].includes(m.state))
  const blocked = data.missions.filter((m) => m.state === 'blocked').length
  const inbox = data.captures.filter((c) => c.state === 'inbox').length
  return <article className="daily-brief"><div className="brief-mark"><span>{String(new Date().getDate()).padStart(2,'0')}</span><small>{new Date().toLocaleString(undefined,{month:'short'}).toUpperCase()}</small></div><div className="brief-copy"><div className="eyebrow">SITUATION REPORT / {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div><h3>{urgent ? `Recommended first move: ${urgent.title}` : 'The operations deck is clear.'}</h3><p>{urgent?.outcome || 'Create a mission when an outcome needs to survive beyond a conversation.'} {blocked ? `${blocked} blocked objective${blocked === 1 ? '' : 's'} need recovery.` : 'No blocked objectives.'} {inbox ? `${inbox} capture${inbox === 1 ? '' : 's'} await filing.` : ''}</p></div><div className="brief-actions"><span className="text-action">{data.approvals.filter((a)=>a.state==='pending').length} APPROVALS</span><span className="text-action">{data.routines.filter((r)=>r.enabled).length} ROUTINES ARMED</span></div></article>
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

function ApprovalView({ approvals, refresh }: { approvals: OperationsSnapshot['approvals']; refresh: () => Promise<void> }): React.JSX.Element {
  return <div className="approval-grid">{approvals.length ? approvals.map((approval) => <article key={approval.id} className={`approval-card ${approval.state}`}><div className="eyebrow">{approval.risk} / {approval.state}</div><h3>{approval.title}</h3><p>{approval.description}</p>{approval.preview ? <pre>{approval.preview}</pre> : null}<small>{new Date(approval.createdAt).toLocaleString()}</small>{approval.state === 'pending' ? <div><button className="btn ghost" type="button" onClick={async () => { await window.albert.resolveApproval(approval.id, 'declined'); await refresh() }}>Decline</button><button className="btn primary" type="button" onClick={async () => { await window.albert.resolveApproval(approval.id, 'approved'); await refresh() }}>{approval.actionLabel}</button></div> : null}</article>) : <Empty title="Approval queue clear" detail="Consequential actions will wait here with an impact preview." />}</div>
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

function PulseView({ data }: { data: OperationsSnapshot }): React.JSX.Element {
  const totalSteps = data.missions.flatMap((m) => m.steps); const done = totalSteps.filter((s) => s.state === 'complete').length
  return <div className="pulse-dashboard"><article><div className="eyebrow">PROJECT PULSE</div><h3>Operational health</h3><div className="health-score"><strong>{data.missions.some((m) => m.state === 'blocked') ? '72' : '94'}</strong><span>/100</span></div><p>{data.missions.filter((m) => m.state === 'blocked').length} blocked · {data.missions.filter((m) => m.state === 'waiting').length} waiting · {done}/{totalSteps.length} steps verified</p></article><article><div className="eyebrow">PRIVACY FLIGHT RECORDER</div><h3>Local operations</h3><ul><li><span>Mission data</span><b>LOCAL SQLITE</b></li><li><span>Scheduler</span><b>ON DEVICE</b></li><li><span>External actions</span><b>APPROVAL GATED</b></li><li><span>Cloud routing</span><b>SEE ACTIVITY</b></li></ul></article><article><div className="eyebrow">OPEN LOOPS</div><h3>{data.missions.filter((m) => !['complete','cancelled'].includes(m.state)).length} objectives remain</h3><p>{data.captures.filter((c) => c.state === 'inbox').length} unfiled captures and {data.approvals.filter((a) => a.state === 'pending').length} decisions need attention.</p></article></div>
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
