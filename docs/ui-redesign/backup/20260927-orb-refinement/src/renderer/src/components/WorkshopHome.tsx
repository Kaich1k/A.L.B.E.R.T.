import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { sourceNoteCache } from '../chat/sourceNotes'
import { configuredProvider, workshopLink } from '../../../shared/brainRouting'
import { buildMemoryGraph } from '../../../shared/memoryGraph'
import type { ChatImagePayload, ComputerState, OperationsSnapshot, PanelId } from '../../../shared/types'
import {
  clipboardLooksLikeImage,
  fileToDraft,
  filesFromClipboard,
  getDraftCache,
  MAX_ATTACH,
  mergeDraftImages,
  payloadToDraft,
  setDraftText,
  writeDraftCache,
  type DraftImage
} from '../chat/draftImages'
import { useAlbertStore } from '../store'
import { stopSpeaking } from '../voice/tts'
import { FilamentOrb, orbMood } from './FilamentOrb'

const CX = 350
const CY = 250
const ORB_RIM = 149

const RING: Array<{
  id: PanelId | 'computer'
  label: string
  icon: 'talk' | 'missions' | 'memory' | 'activity' | 'computer' | 'settings'
  d: string
  iconX: number
  iconY: number
  textX: number
  labelY: number
  hints: readonly string[]
  hintXs: readonly number[]
  hintY: number
}> = [
  {
    id: 'conversation',
    label: 'Talk',
    icon: 'talk',
    d: 'M184 10 Q188 6 192 11 L232 94 Q170 130 141 219 Q140 224 135 223 L34 204 Q28 203 30 198 Q70 77 184 10 Z',
    iconX: 130,
    iconY: 109,
    textX: 110,
    labelY: 158,
    hints: ['Voice & text', 'conversation'],
    hintXs: [100, 95],
    hintY: 176
  },
  {
    id: 'missions',
    label: 'Missions',
    icon: 'missions',
    d: 'M516 10 Q512 6 508 11 L468 94 Q530 130 559 219 Q560 224 565 223 L666 204 Q672 203 670 198 Q630 77 516 10 Z',
    iconX: 570,
    iconY: 109,
    textX: 591,
    labelY: 158,
    hints: ['Plan, research', 'and take action'],
    hintXs: [600, 606],
    hintY: 176
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: 'settings',
    d: 'M23 298 L120 273 Q125 271 126 277 Q138 353 178 399 Q181 403 177 407 L101 475 Q98 479 94 474 Q29 405 19 305 Q18 300 23 298 Z',
    iconX: 82,
    iconY: 338,
    textX: 100,
    labelY: 389,
    hints: ['Personality,', 'voice, provider'],
    hintXs: [108, 107],
    hintY: 407
  },
  {
    id: 'memory',
    label: 'Memory',
    icon: 'memory',
    d: 'M677 298 L580 273 Q575 271 574 277 Q562 353 522 399 Q519 403 523 407 L599 475 Q602 479 606 474 Q671 405 681 305 Q682 300 677 298 Z',
    iconX: 618,
    iconY: 338,
    textX: 600,
    labelY: 389,
    hints: ['What Albert', 'remembers'],
    hintXs: [592, 595],
    hintY: 407
  },
  {
    id: 'computer',
    label: 'Computer',
    icon: 'computer',
    d: 'M155 445 L216 488 Q221 491 223 498 L266 616 Q268 623 260 623 L202 623 Q136 583 87 514 Q83 509 88 505 Z',
    iconX: 175,
    iconY: 518,
    textX: 190,
    labelY: 566,
    hints: ['Browse & act', 'Use tools'],
    hintXs: [202, 213],
    hintY: 585
  },
  {
    id: 'activity',
    label: 'Activity',
    icon: 'activity',
    d: 'M542 445 L480 488 Q475 491 473 498 L432 616 Q430 623 438 623 L497 623 Q561 581 611 514 Q615 509 610 505 Z',
    iconX: 525,
    iconY: 518,
    textX: 505,
    labelY: 566,
    hints: ['Your history', 'Progress'],
    hintXs: [493, 484],
    hintY: 585
  }
]

function polar(cx: number, cy: number, radius: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180
  return [cx + Math.cos(rad) * radius, cy + Math.sin(rad) * radius]
}

function sectorPath(a0: number, a1: number, inner: number, outer: number, chamfer = 14): string {
  const outerPad = (chamfer / outer) * (180 / Math.PI)
  const innerPad = (chamfer / inner) * (180 / Math.PI)
  const oa0 = a0 + outerPad
  const oa1 = a1 - outerPad
  const ia0 = a0 + innerPad
  const ia1 = a1 - innerPad
  const large = oa1 - oa0 > 180 ? 1 : 0
  const [x0, y0] = polar(CX, CY, outer, oa0)
  const [x1, y1] = polar(CX, CY, outer, oa1)
  const [x2, y2] = polar(CX, CY, inner, ia1)
  const [x3, y3] = polar(CX, CY, inner, ia0)
  return `M ${x0} ${y0} A ${outer} ${outer} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${inner} ${inner} 0 ${large} 0 ${x3} ${y3} Z`
}

function clip(text: string, max = 140): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const sliced = clean.slice(0, max)
  const space = sliced.lastIndexOf(' ')
  const base = (space > 4 ? sliced.slice(0, space) : sliced).replace(/[\s,;:]+$/, '')
  return `${base}…`
}

function memoryLabel(text: string): string {
  const head = text.split(/[/:]/)[0]?.trim() || text
  return clip(head, 18)
}

function activityBlurb(result: string): string {
  const raw = result.replace(/\s+/g, ' ').trim()
  if (!raw || raw.length > 48 || /\b(npm|pid|detached|error:)\b/i.test(raw)) return 'Saved in Activity'
  return raw
}

function pageHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || 'page'
  } catch {
    return 'page'
  }
}

function ago(ts: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000))
  if (mins < 1) return 'Now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 21) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

function openCommandPalette(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))
}

function RingGlyph({ name }: { name: (typeof RING)[number]['icon'] }): React.JSX.Element {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const
  }
  return (
    <g className="ring-glyph" aria-hidden="true">
      {name === 'talk' ? <path {...common} d="M3 9h2l1.4-3.6 1.5 7.2 1.5-5.2 1.2 2.4H13" /> : null}
      {name === 'missions' ? (
        <>
          <circle {...common} cx="8" cy="8" r="5.1" />
          <circle {...common} cx="8" cy="8" r="1.8" />
        </>
      ) : null}
      {name === 'memory' ? <path {...common} d="M4.2 11.2C2.8 10 2.2 8.6 2.2 7.2a3.8 3.8 0 0 1 6.6-2.5 3.8 3.8 0 0 1 6.8 2.2c0 1.6-.7 3-2 4.2H4.2z" /> : null}
      {name === 'activity' ? (
        <>
          <circle {...common} cx="8" cy="8" r="5.2" />
          <path {...common} d="M8 5.2V8.2l2 1.3" />
        </>
      ) : null}
      {name === 'computer' ? <path {...common} d="M2.4 4.2h11.2v7H2.4zM5.2 13.2h5.6" /> : null}
      {name === 'settings' ? (
        <>
          <circle {...common} cx="8" cy="8" r="2.1" />
          <path {...common} d="M8 2.6v1.6M8 11.8v1.6M2.6 8h1.6M11.8 8h1.6M4.1 4.1l1.1 1.1M10.8 10.8l1.1 1.1M11.9 4.1 10.8 5.2M5.2 10.8 4.1 11.9" />
        </>
      ) : null}
    </g>
  )
}

function ChamferFrame(): React.JSX.Element {
  return (
    <svg className="workshop-frame" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <path className="workshop-frame-outer" d="M8 0.8 H99.2 V92 L92 99.2 H0.8 V8 Z" />
      <path className="workshop-frame-inner" d="M10.2 3 H97 V90.2 L89.8 97 H3 V10.2 Z" />
    </svg>
  )
}

function IconImage(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="3" y="4" width="14" height="12" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="7.2" cy="8.2" r="1.4" fill="currentColor" />
      <path d="M4.4 14.2 8.2 10l3 2.6 4.4-4.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

function IconMic(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="7.4" y="3.2" width="5.2" height="8.4" rx="2.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5.2 9.4a4.8 4.8 0 0 0 9.6 0M10 14.2v2.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

function IconChat(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 5.2h12v8H8.2L4 16.2z" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

function IconSearch(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="9" cy="9" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12.2 12.2 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

function IconPencil(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M12.2 4.2 15.8 7.8 7.2 16.4H3.6v-3.6z" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

function IconBookmark(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M6 3.6h8v12.8L10 13.2 6 16.4z" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

function IconOpen(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M8 4.2H4.4v11.4h11.2V12" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10.2 4.2H16v5.8M16 4.2 9.2 11" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

function IconSend(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3.2 10.1 16.8 3.6 12.2 16.4l-1.7-5.2z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

export function WorkshopHome({ onTalk }: { onTalk: () => void }): React.JSX.Element {
  const setPanel = useAlbertStore((s) => s.setPanel)
  const panel = useAlbertStore((s) => s.panel)
  const setSelectedMemoryId = useAlbertStore((s) => s.setSelectedMemoryId)
  const setMemoryEditRequested = useAlbertStore((s) => s.setMemoryEditRequested)
  const voiceState = useAlbertStore((s) => s.voiceState)
  const busy = useAlbertStore((s) => s.busy)
  const setBusy = useAlbertStore((s) => s.setBusy)
  const error = useAlbertStore((s) => s.error)
  const setError = useAlbertStore((s) => s.setError)
  const messages = useAlbertStore((s) => s.messages)
  const memories = useAlbertStore((s) => s.memories)
  const setMemories = useAlbertStore((s) => s.setMemories)
  const activity = useAlbertStore((s) => s.activity)
  const settings = useAlbertStore((s) => s.settings)
  const codexStatus = useAlbertStore((s) => s.codexStatus)
  const streamingText = useAlbertStore((s) => s.streamingText)
  const [operations, setOperations] = useState<OperationsSnapshot | null>(null)
  const [computer, setComputer] = useState<ComputerState | null>(null)
  const [stepId, setStepId] = useState<string | null>(null)
  const [draft, setDraft] = useState(() => getDraftCache().text)
  const [draftImages, setDraftImages] = useState<DraftImage[]>(() => getDraftCache().images)
  const [attachError, setAttachError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const dockRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const sendingRef = useRef(false)
  const [orbParked, setOrbParked] = useState(true)
  const [pickedMemory, setPickedMemory] = useState<string | null>(null)
  const [memorySource, setMemorySource] = useState('all')
  const [sourceView, setSourceView] = useState<'page' | 'note'>('page')
  const sourceNotes = useSyncExternalStore(sourceNoteCache.subscribe, sourceNoteCache.getSnapshot)

  useEffect(() => {
    void window.albert.listMemories().then(setMemories).catch(() => undefined)
    void window.albert.getOperations().then(setOperations).catch(() => undefined)
    let computerGen = 0
    const offComputer = window.albert.onComputerChanged((state) => {
      computerGen += 1
      setComputer(state)
    })
    const snapGen = computerGen
    void window.albert
      .getComputerState()
      .then((state) => {
        if (computerGen === snapGen) setComputer(state)
      })
      .catch(() => undefined)
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
      offComputer()
      observer.disconnect()
      window.removeEventListener('resize', onResize)
      window.clearTimeout(timer)
    }
  }, [setMemories])

  const mission =
    operations?.missions.find((item) => item.state === 'active') ||
    operations?.missions.find((item) => item.state !== 'complete' && item.state !== 'cancelled') ||
    null
  const steps = (mission?.steps || []).slice().sort((a, b) => a.position - b.position)
  const shownSteps = steps.slice(0, 4)
  const extraSteps = Math.max(0, steps.length - shownSteps.length)
  const selectedStep =
    steps.find((step) => step.id === stepId) || steps.find((step) => step.state === 'active') || steps[0] || null
  const userLine = [...messages].reverse().find((message) => message.role === 'user')
  const albertLine = streamingText
    ? { content: streamingText }
    : [...messages].reverse().find((message) => message.role === 'assistant')
  const latestActivity = activity[0]
  const mood = orbMood(voiceState, busy, Boolean(error))
  const voiceReady = voiceState === 'idle' && !busy
  const workRunning = busy
  const recordOpen = Boolean(mission && mission.state !== 'complete' && mission.state !== 'cancelled')
  const activeTab = computer?.tabs.find((tab) => tab.id === computer.activeTabId) || computer?.tabs[0] || null
  const memorySources = Array.from(new Set(memories.map((item) => item.source || 'conversation')))
  const memoryPool =
    memorySource === 'all' ? memories : memories.filter((item) => (item.source || 'conversation') === memorySource)
  const graph = buildMemoryGraph(memoryPool, 12)
  const sketchNodes = graph.nodes.slice(0, 4)
  const sketchEdges = graph.edges.filter(
    (edge) => sketchNodes.some((node) => node.id === edge.from) && sketchNodes.some((node) => node.id === edge.to)
  )
  const sketchKey = sketchNodes.map((node) => node.id).join('|')
  useEffect(() => {
    if (pickedMemory && !sketchKey.split('|').filter(Boolean).includes(pickedMemory)) {
      setPickedMemory(null)
    }
  }, [pickedMemory, sketchKey])
  const selectedMemory = sketchNodes.some((node) => node.id === pickedMemory)
    ? memories.find((item) => item.id === pickedMemory) || null
    : null
  const link = workshopLink(settings, Boolean(codexStatus?.signedIn))
  const provider = configuredProvider(settings)
  const providerModel =
    provider === 'chatgpt'
      ? codexStatus?.model || null
      : provider === 'gemini'
        ? settings.geminiModel || null
        : provider === 'groq'
          ? settings.groqModel || null
          : provider === 'ollama'
            ? settings.localModel || null
            : settings.powerModel || null
  const sourceKey = activeTab ? `${activeTab.title || ''}\n${activeTab.url}` : ''
  const note = sourceNotes.get(sourceKey)
  const noteState = note?.state || 'idle'

  function go(id: PanelId | 'computer'): void {
    if (id === 'computer') {
      void window.albert.showComputer()
      return
    }
    setPanel(id)
  }

  async function interruptWork(): Promise<void> {
    stopSpeaking()
    await window.albert.stopCurrentWork()
  }

  async function holdMission(): Promise<void> {
    if (!mission || mission.state !== 'active') return
    await window.albert.updateMission(mission.id, { state: 'waiting' })
    setOperations(await window.albert.getOperations())
  }

  async function reactivateMission(): Promise<void> {
    if (!mission || mission.state !== 'waiting') return
    await window.albert.updateMission(mission.id, { state: 'active' })
    setOperations(await window.albert.getOperations())
  }

  async function cancelMissionRecord(): Promise<void> {
    if (!mission || !recordOpen) return
    await window.albert.updateMission(mission.id, { state: 'cancelled' })
    setOperations(await window.albert.getOperations())
  }

  function applyDraft(next: { text: string; images: DraftImage[] }): void {
    setDraft(next.text)
    setDraftImages(next.images)
  }

  function commitDraft(text: string, images?: DraftImage[]): void {
    if (images) {
      writeDraftCache(text, images)
      applyDraft({ text, images })
      return
    }
    applyDraft(setDraftText(text))
  }

  async function addFiles(list: FileList | File[]): Promise<number> {
    const incoming = Array.from(list)
    if (!incoming.length) return 0
    const room = Math.max(0, MAX_ATTACH - getDraftCache().images.length)
    const accepted: DraftImage[] = []
    let failed = 0
    for (const file of incoming) {
      if (accepted.length >= room) break
      const drafted = await fileToDraft(file)
      if (drafted) accepted.push(drafted)
      else failed += 1
    }
    if (accepted.length) {
      const next = mergeDraftImages(accepted)
      setDraft(next.text)
      setDraftImages(next.images)
    }
    setAttachError(failed ? 'Only PNG, JPEG, GIF, or WebP images under 4.5 MB can be attached.' : null)
    return accepted.length
  }

  async function addClipboardFallback(): Promise<boolean> {
    const clip = await window.albert.readClipboardImage()
    if (!clip) return false
    if (getDraftCache().images.length >= MAX_ATTACH) return false
    const next = mergeDraftImages([payloadToDraft(clip)])
    setDraft(next.text)
    setDraftImages(next.images)
    return true
  }

  async function ingestPaste(event: React.ClipboardEvent): Promise<void> {
    const data = event.clipboardData
    const files = filesFromClipboard(data)
    if (files.length) {
      event.preventDefault()
      if (await addFiles(files)) return
    if (await addClipboardFallback()) {
      setAttachError(null)
      return
    }
    setAttachError('Couldn’t attach that image (use PNG/JPEG/GIF/WebP under 4.5 MB).')
    return
  }
  if (!clipboardLooksLikeImage(data)) return
  event.preventDefault()
  if (await addClipboardFallback()) {
    setAttachError(null)
    return
  }
    setAttachError('Couldn’t read that clipboard image. Try PNG/JPEG/GIF/WebP under 4.5 MB.')
  }

  async function sendDraft(): Promise<void> {
    if (busy) {
      await interruptWork()
      return
    }
    if (sendingRef.current) return
    const text = draft.trim()
    if (!text && !draftImages.length) return
    const images: ChatImagePayload[] = draftImages.map((image) => ({ mediaType: image.mediaType, data: image.data }))
    const keptText = draft
    const keptImages = draftImages
    sendingRef.current = true
    const clearedRev = writeDraftCache('', [])
    setDraft('')
    setDraftImages([])
    setAttachError(null)
    setError(null)
    stopSpeaking()
    setBusy(true)
    try {
      await window.albert.sendChat(images.length ? { text, images } : text)
    } catch (err) {
      if (getDraftCache().rev === clearedRev) {
        writeDraftCache(keptText, keptImages)
        setDraft(keptText)
        setDraftImages(keptImages)
      }
      setBusy(false)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      sendingRef.current = false
    }
  }

  function openMemory(edit: boolean): void {
    if (selectedMemory) {
      setSelectedMemoryId(selectedMemory.id)
      setMemoryEditRequested(edit)
    }
    setPanel('memory')
  }

  async function saveSourceNote(): Promise<void> {
    if (!activeTab) return
    const source = { title: activeTab.title || activeTab.url, body: `${activeTab.title}\n${activeTab.url}`, kind: 'source' as const }
    await sourceNoteCache.save(sourceKey, () => window.albert.saveArtifact(source))
  }

  return (
    <section
      className={`workshop-home${dragOver ? ' is-drop-target' : ''}`}
      aria-label="Workshop"
      onDragOver={(event) => {
        event.preventDefault()
        if (Array.from(event.dataTransfer.types).includes('Files')) setDragOver(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOver(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setDragOver(false)
        if ((event.target as HTMLElement).closest('.workshop-composer')) return
        if (event.dataTransfer.files?.length) void addFiles(event.dataTransfer.files)
      }}
    >
      <div className="workshop-column">
        <article className="workshop-panel">
          <ChamferFrame />
          <header>
            <h2>Conversation</h2>
            <span>Talk with Albert</span>
          </header>
          <div className="workshop-thread">
            {userLine ? (
              <p className="bubble you">
                <i className="bubble-avatar" aria-hidden="true" />
                <span>
                  <strong>You</strong>
                  {clip(userLine.content, 220)}
                </span>
              </p>
            ) : (
              <p className="workshop-empty">No messages yet.</p>
            )}
            {albertLine ? (
              <p className="bubble albert">
                <i className="bubble-avatar" aria-hidden="true" />
                <span>
                  <strong>Albert</strong>
                  {clip(albertLine.content, 220)}
                </span>
              </p>
            ) : null}
          </div>
          <button type="button" className="workshop-link" onClick={() => setPanel('conversation')}>
            <IconChat />
            Open conversation
            <span aria-hidden="true">→</span>
          </button>
        </article>
        <article className="workshop-panel">
          <ChamferFrame />
          <header>
            <h2>Memory context</h2>
            <span>Relevant to your current work</span>
            <button type="button" className="panel-icon" aria-label="Open memory" onClick={() => setPanel('memory')}>
              ···
            </button>
          </header>
          <div className="memory-body">
          <MemorySketch
            nodes={sketchNodes}
            edges={sketchEdges}
            selectedId={selectedMemory?.id || null}
            onSelect={setPickedMemory}
          />
          <label className="memory-source">
            <IconBookmark />
            <span>Source</span>
            <select value={memorySource} onChange={(event) => setMemorySource(event.target.value)} aria-label="Memory source">
              <option value="all">All</option>
              {memorySources.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
          </label>
          </div>
          <div className="workshop-actions">
            <button type="button" disabled={!selectedMemory} onClick={() => openMemory(false)}>
              <IconSearch />
              Inspect
            </button>
            <button type="button" disabled={!selectedMemory} onClick={() => openMemory(true)}>
              <IconPencil />
              Edit
            </button>
          </div>
        </article>
      </div>

      <div className="workshop-hub">
        <div className="workshop-ring">
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
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
              <path d="M8 1.4v2.2M8 12.4v2.2M1.4 8h2.2M12.4 8h2.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            Detach orb
          </button>
          <svg viewBox="0 0 700 640" className="ring-svg" role="group" aria-label="Workshop destinations">
            <defs>
              <linearGradient id="sector-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#082536" />
                <stop offset="55%" stopColor="#051824" />
                <stop offset="100%" stopColor="#020e18" />
              </linearGradient>
              <filter id="sector-bloom" x="-18%" y="-18%" width="136%" height="136%">
                <feGaussianBlur stdDeviation="1.4" result="glow" />
                <feMerge>
                  <feMergeNode in="glow" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <circle cx={CX} cy={CY} r="225" className="ring-guide" />
            <circle cx={CX} cy={CY} r="199" className="orb-track" />
            <circle cx={CX} cy={CY} r="184" className="orb-ticks" />
            <circle cx={CX} cy={CY} r={ORB_RIM} className="orb-rim" />
            {RING.map((item) => {
              const selected = item.id !== 'computer' && panel === item.id
              return (
                <g
                  key={item.id}
                  className={`ring-hit${selected ? ' is-selected' : ''}`}
                  onClick={() => go(item.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      go(item.id)
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`${item.label}. ${item.hints.join(' ')}`}
                  aria-current={selected ? 'page' : undefined}
                >
                  <path d={item.d} className="ring-segment" />
                  <path
                    d={item.d}
                    transform={`translate(${item.iconX} ${item.iconY}) scale(.968) translate(${-item.iconX} ${-item.iconY})`}
                    className="ring-segment-inner"
                  />
                  <g transform={`translate(${item.iconX} ${item.iconY})`} aria-hidden="true">
                    <circle className="ring-well" r="31" />
                    <g transform="translate(-15 -15) scale(1.875)">
                      <RingGlyph name={item.icon} />
                    </g>
                  </g>
                  <text className="ring-label" x={item.textX} y={item.labelY} textAnchor="middle">
                    {item.label}
                  </text>
                  <text className="ring-hint" x={item.hintXs[0]} y={item.hintY} textAnchor="middle" aria-hidden="true">
                    {item.hints.map((line, index) => (
                      <tspan key={line} x={item.hintXs[index]} dy={index ? 14 : 0}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                </g>
              )
            })}
            {shownSteps.length ? (
              shownSteps.map((step, index) => {
                const span = 112 / shownSteps.length
                const a1 = 236 - index * span - 1.5
                const a0 = 236 - (index + 1) * span + 1.5
                const mid = (a0 + a1) / 2
                const [nodeX, nodeY] = polar(CX, CY, 176, mid)
                const [textX, textY] = polar(CX, CY, 197, mid)
                const selected = selectedStep?.id === step.id
                return (
                  <g
                    key={step.id}
                    className={`ring-hit${selected ? ' is-selected' : ''}`}
                    onClick={() => setStepId(step.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setStepId(step.id)
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={step.title}
                    aria-pressed={selected}
                  >
                    <path
                      d={sectorPath(a0, a1, 169, 208, 4)}
                      className={`mission-segment state-${step.state}${selected ? ' is-selected' : ''}`}
                    />
                    <circle className="mission-node" cx={nodeX} cy={nodeY} r="10" />
                    <text className="mission-arc-label" x={textX} y={textY + 4} textAnchor="middle">
                      <title>{step.title}</title>
                      {clip(step.title, 12)}
                    </text>
                  </g>
                )
              })
            ) : (
              <path d={sectorPath(124, 236, 169, 208, 4)} className="mission-segment is-empty" />
            )}
          </svg>
          <div className={`workshop-orb-dock${orbParked ? '' : ' is-empty'}`} ref={dockRef}>
            {orbParked ? <FilamentOrb variant="hub" mood={mood} label={`Albert, ${mood}`} /> : null}
            {orbParked ? null : (
              <button type="button" className="orb-dock-snap" onClick={() => void window.albert.returnHudToDock()}>
                Snap back
              </button>
            )}
          </div>
          <div className="workshop-status">
            <em>{mission ? clip(mission.title, 28) : 'No mission'}</em>
            <strong>{selectedStep ? clip(selectedStep.title, 22) : workRunning ? 'Working' : 'Standing by'}</strong>
            <span>{voiceReady ? 'Voice ready' : workRunning ? 'Work in progress' : voiceState}</span>
          </div>
        </div>
        <div className="voice-row">
          <span>Voice input</span>
          <i className={voiceState === 'listening' || voiceState === 'speaking' ? 'live' : ''} />
          <button type="button" aria-label={voiceState === 'idle' ? 'Talk' : 'Voice is live'} onClick={onTalk}>
            <IconMic />
          </button>
        </div>
        <div className="activity-chips">
          <button type="button" onClick={() => setPanel('activity')}>
            <strong>{latestActivity ? clip(latestActivity.toolName.replaceAll('_', ' '), 28) : 'No recent action'}</strong>
            <time>{latestActivity ? ago(latestActivity.createdAt) : ''}</time>
            <small>{latestActivity ? activityBlurb(latestActivity.result || '') : 'History stays here'}</small>
          </button>
          <button type="button" className="is-mission" onClick={() => setPanel('missions')}>
            <strong>{mission ? clip(mission.title, 28) : 'No mission'}</strong>
            <time>{mission ? ago(mission.updatedAt) : ''}</time>
            <small>{selectedStep ? `${selectedStep.state}${extraSteps ? ` · +${extraSteps} more` : ''}` : 'Open Missions to plan'}</small>
          </button>
        </div>
      </div>

      <div className="workshop-column">
        <article className="workshop-panel">
          <ChamferFrame />
          <header>
            <h2>{mission?.title || 'Mission'}</h2>
            <span>{mission ? `Record · ${mission.state}` : 'No mission selected'}</span>
          </header>
          <ol className={`workshop-steps${shownSteps.length ? '' : ' is-empty'}`}>
            {shownSteps.length ? (
              shownSteps.map((step) => (
                <li
                  key={step.id}
                  className={`state-${step.state}${selectedStep?.id === step.id ? ' is-selected' : ''}`}
                >
                  <button type="button" onClick={() => setStepId(step.id)}>
                    <em />
                    <span>
                      {step.title}
                      {step.result ? <small className="step-detail">{clip(step.result, 90)}</small> : null}
                    </span>
                    <small>{step.state}</small>
                  </button>
                </li>
              ))
            ) : (
              <li className="workshop-empty">Create a mission in Missions.</li>
            )}
            {extraSteps ? <li className="workshop-empty">+{extraSteps} more steps in Missions.</li> : null}
          </ol>
          <div className="workshop-actions mission-actions">
            <button type="button" onClick={() => setPanel('missions')}>
              {mission ? 'Open record' : 'Open Missions'}
            </button>
            {mission?.state === 'waiting' ? (
              <button type="button" disabled={!mission} onClick={() => void reactivateMission()}>
                <i className="icon-pause" />
                Reactivate
              </button>
            ) : (
              <button type="button" disabled={mission?.state !== 'active'} onClick={() => void holdMission()}>
                <i className="icon-pause" />
                Hold
              </button>
            )}
            <button
              type="button"
              className="danger"
              disabled={!workRunning}
              aria-label="Stop current work"
              onClick={() => void interruptWork()}
            >
              <i className="icon-stop" />
              Stop
            </button>
            <button
              type="button"
              className="quiet-danger"
              disabled={!recordOpen}
              onClick={() => void cancelMissionRecord()}
            >
              Cancel mission
            </button>
          </div>
        </article>
        <article className="workshop-panel">
          <ChamferFrame />
          <header>
            <h2>Active source</h2>
            <span>From your browser session</span>
            <button type="button" className="panel-icon" aria-label="Open browser" onClick={() => void window.albert.showComputer()}>
              <IconOpen />
            </button>
          </header>
          <div className="source-body">
          <div className="source-tabs" role="tablist" aria-label="Source view">
            <button type="button" role="tab" aria-selected={sourceView === 'page'} onClick={() => setSourceView('page')}>
              Page
            </button>
            <button type="button" role="tab" aria-selected={sourceView === 'note'} onClick={() => setSourceView('note')}>
              Note
            </button>
          </div>
          <div className={`source-card${activeTab ? '' : ' is-empty'}`}>
            {activeTab ? <div className="source-thumb" aria-hidden="true"><IconOpen /></div> : null}
            <div>
              {sourceView === 'note' ? (
                <>
                  <strong>{activeTab ? activeTab.title || 'Untitled tab' : 'No page to note'}</strong>
                  <p>{activeTab ? 'Save note keeps this page on the record.' : 'Open a page in the browser, then save a note from it.'}</p>
                </>
              ) : activeTab ? (
                <>
                  <strong>{activeTab.title || 'Untitled tab'}</strong>
                  <p>{activeTab.url}</p>
                  {activeTab.lastError ? <p className="workshop-empty">{activeTab.lastError}</p> : null}
                </>
              ) : (
                <>
                  <strong>No source open</strong>
                  <p>Open the browser to work from a page. Tool results stay in Activity.</p>
                </>
              )}
              <div className="source-tags">
                {activeTab ? <span>{pageHost(activeTab.url)}</span> : null}
                <span>
                  {link.name}
                  {providerModel ? ` · ${providerModel}` : ''}
                </span>
              </div>
            </div>
          </div>
          </div>
          <div className="source-actions">
          <div className="workshop-actions">
            <button type="button" onClick={() => void window.albert.showComputer()}>
              <IconOpen />
              Open browser
            </button>
            <button type="button" disabled={!activeTab || noteState === 'pending' || noteState === 'saved'} onClick={() => void saveSourceNote()}>
              <IconBookmark />
              {noteState === 'pending' ? 'Saving…' : noteState === 'saved' ? 'Saved' : 'Save note'}
            </button>
          </div>
          {noteState === 'pending' ? <p className="workshop-empty" role="status">Saving note…</p> : null}
          {noteState === 'saved' ? (
            <p className="workshop-empty" role="status">Saved</p>
          ) : null}
          {noteState === 'error' ? <p className="workshop-empty" role="alert">{note?.error || 'Couldn’t save that note.'}</p> : null}
          </div>
        </article>
      </div>

      <form
        className="workshop-composer"
        onSubmit={(event) => {
          event.preventDefault()
          void sendDraft()
        }}
        onDragOver={(event) => {
          event.preventDefault()
          if (Array.from(event.dataTransfer.types).includes('Files')) setDragOver(true)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOver(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setDragOver(false)
          if (event.dataTransfer.files?.length) void addFiles(event.dataTransfer.files)
        }}
      >
        <ChamferFrame />
        {draftImages.length ? (
          <div className="workshop-attach-row">
            {draftImages.map((image) => (
              <button
                key={image.id}
                type="button"
                className="workshop-attach-thumb"
                onClick={() =>
                  commitDraft(
                    getDraftCache().text,
                    getDraftCache().images.filter((item) => item.id !== image.id)
                  )
                }
                aria-label="Remove attachment"
              >
                <img src={image.previewUrl} alt="" />
              </button>
            ))}
          </div>
        ) : null}
        {attachError ? <p className="workshop-empty">{attachError}</p> : null}
        {error ? (
          <p className="workshop-empty" role="alert">
            {error}
          </p>
        ) : null}
        <div className="workshop-composer-row">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            hidden
            onChange={(event) => {
              if (event.target.files?.length) void addFiles(event.target.files)
              event.target.value = ''
            }}
          />
          <span className="composer-spark" aria-hidden="true">
            ✦
          </span>
          <input
            value={draft}
            onChange={(event) => commitDraft(event.target.value)}
            placeholder="Ask Albert or drop an image..."
            aria-label="Message Albert"
            onPaste={(event) => void ingestPaste(event)}
          />
          <button type="button" className="workshop-icon-btn" onClick={() => fileRef.current?.click()} aria-label="Attach image">
            <IconImage />
          </button>
          <button type="button" className="workshop-icon-btn" onClick={onTalk} aria-label="Talk">
            <IconMic />
          </button>
          <button
            type="submit"
            className="send"
            disabled={!busy && !draft.trim() && !draftImages.length}
            aria-label={busy ? 'Stop current work' : 'Send'}
            title={busy ? 'Stop current work' : 'Send'}
          >
            {busy ? (
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <rect x="5" y="5" width="10" height="10" rx="1.4" fill="currentColor" />
              </svg>
            ) : (
              <IconSend />
            )}
          </button>
        </div>
      </form>
    </section>
  )
}

function MemorySketch({
  nodes,
  edges,
  selectedId,
  onSelect
}: {
  nodes: Array<{ id: string; x: number; y: number; label: string; kind: string }>
  edges: Array<{ from: string; to: string }>
  selectedId: string | null
  onSelect: (id: string) => void
}): React.JSX.Element {
  if (!nodes.length) return <p className="workshop-empty">No memories stored.</p>
  const colors: Record<string, string> = {
    project: '#6cb6ff',
    person: '#5ee0a0',
    preference: '#c79bff',
    decision: '#f0b14a',
    place: '#7ec8ff',
    general: '#8ecbff'
  }
  const slots = [
    { x: 80, y: 40 },
    { x: 240, y: 40 },
    { x: 80, y: 122 },
    { x: 240, y: 122 }
  ]
  const point = (_node: { x: number; y: number }, index: number): { x: number; y: number } =>
    slots[index] || slots[0]!
  return (
    <svg className="memory-sketch" viewBox="0 0 320 180" role="group" aria-label="Memory map">
      {edges.map((edge) => {
        const from = nodes.find((node) => node.id === edge.from)
        const to = nodes.find((node) => node.id === edge.to)
        if (!from || !to) return null
        const a = point(from, nodes.indexOf(from))
        const b = point(to, nodes.indexOf(to))
        return <line key={`${edge.from}-${edge.to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      })}
      {nodes.map((node) => {
        const p = point(node, nodes.indexOf(node))
        const label = { x: p.x, y: p.y + 24, anchor: 'middle' as const }
        return (
          <g
            key={node.id}
            className={selectedId === node.id ? 'is-selected' : ''}
            onClick={() => onSelect(node.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelect(node.id)
              }
            }}
            role="button"
            tabIndex={0}
            aria-pressed={selectedId === node.id}
            aria-label={node.label}
          >
            <title>{node.label}</title>
            <rect className="memory-hit" x={p.x - 72} y={p.y - 20} width="144" height="64" rx="6" />
            <circle cx={p.x} cy={p.y} r={selectedId === node.id ? 8 : 6} fill={colors[node.kind] || '#8ecbff'} />
            <text x={label.x} y={label.y} textAnchor={label.anchor}>
              {memoryLabel(node.label)}
            </text>
          </g>
        )
      })}
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
  const settings = useAlbertStore((s) => s.settings)
  const codexStatus = useAlbertStore((s) => s.codexStatus)
  const setPanel = useAlbertStore((s) => s.setPanel)
  const link = workshopLink(settings, Boolean(codexStatus?.signedIn))
  return (
    <header className="workshop-bar">
      <button type="button" className="workshop-brand" onClick={onHome}>
        A.L.B.E.R.T. <span>WORKSHOP</span>
      </button>
      <button type="button" className="workshop-search" onClick={openCommandPalette}>
        <i />
        Search commands…
      </button>
      <button
        type="button"
        className={`workshop-link-state ${link.ok ? 'ok' : link.text === 'Configured' ? 'configured' : ''}`}
        onClick={() => setPanel('settings')}
      >
        {link.text}
      </button>
      {panel !== 'home' ? (
        <button type="button" className="workshop-hub-back" onClick={onHome}>
          Hub
        </button>
      ) : null}
    </header>
  )
}
