import { useEffect, useMemo, useRef, useState } from 'react'
import type { PanelId } from '../../../shared/types'
import { useAlbertStore } from '../store'

const commands: Array<{ label: string; hint: string; panel?: PanelId; action?: 'capture' | 'mission' | 'computer' | 'approvals' | 'focus' | 'routines' | 'voice' }> = [
  { label: 'Go home', hint: 'System overview', panel: 'home' },
  { label: 'Open communications', hint: 'Chat and voice', panel: 'conversation' },
  { label: 'Toggle voice interface', hint: 'Engage or end the live channel', action: 'voice' },
  { label: 'Open missions', hint: 'Objectives and operations', panel: 'missions' },
  { label: 'Create new mission', hint: 'Define a durable outcome', action: 'mission' },
  { label: 'Quick capture', hint: 'Save a thought or loose end', action: 'capture' },
  { label: 'Open approvals', hint: 'Human checkpoints', action: 'approvals' },
  { label: 'Start focus mode', hint: 'Attention protocol', action: 'focus' },
  { label: 'Configure routines', hint: 'Recurring preparations', action: 'routines' },
  { label: 'Review memory', hint: 'Long-term context', panel: 'memory' },
  { label: 'Inspect activity', hint: 'Tool flight recorder', panel: 'activity' },
  { label: 'Configure systems', hint: 'Models, voice, and access', panel: 'settings' },
  { label: 'Open Albert Computer', hint: 'Sandbox browser', action: 'computer' }
]

export function CommandPalette(): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const palette = useRef<HTMLDivElement>(null)
  const priorFocus = useRef<HTMLElement | null>(null)
  const setPanel = useAlbertStore((s) => s.setPanel)
  const matches = useMemo(() => commands.filter((command) => `${command.label} ${command.hint}`.toLowerCase().includes(query.toLowerCase())), [query])

  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      const panelShortcuts: Record<string, PanelId> = { '1':'home','2':'conversation','3':'missions','4':'memory','5':'activity','6':'settings' }
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && panelShortcuts[event.key]) {
        event.preventDefault()
        setPanel(panelShortcuts[event.key])
        setOpen(false)
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setOpen((value) => !value) }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === 'Space') {
        event.preventDefault()
        setPanel('missions')
        window.setTimeout(() => window.dispatchEvent(new CustomEvent('albert:open-operation-modal', { detail: 'capture' })), 0)
      }
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [setPanel])
  useEffect(() => {
    if (!open) return
    priorFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setQuery(''); setIndex(0)
    const timer = window.setTimeout(() => input.current?.focus(), 30)
    return () => { window.clearTimeout(timer); priorFocus.current?.focus() }
  }, [open])

  function run(command: (typeof commands)[number] | undefined): void {
    if (!command) return
    if (command.panel) setPanel(command.panel)
    if (command.action === 'computer') void window.albert.showComputer()
    if (command.action === 'voice') window.dispatchEvent(new CustomEvent('albert:voice-toggle'))
    if (command.action && command.action !== 'computer' && command.action !== 'voice') {
      setPanel('missions')
      window.setTimeout(() => {
        if (command.action === 'capture' || command.action === 'mission') {
          window.dispatchEvent(new CustomEvent('albert:open-operation-modal', { detail: command.action }))
        } else {
          window.dispatchEvent(new CustomEvent('albert:operations-view', { detail: command.action }))
        }
      }, 0)
    }
    setOpen(false)
  }
  if (!open) return null
  return <div className="command-shade" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}><div ref={palette} className="command-palette" role="dialog" aria-modal="true" aria-label="Albert command deck" onKeyDown={(e) => { if (e.key !== 'Tab') return; const nodes = palette.current?.querySelectorAll<HTMLElement>('input,button'); if (!nodes?.length) return; const first=nodes[0]; const last=nodes[nodes.length-1]; if (e.shiftKey && document.activeElement===first) { e.preventDefault(); last.focus() } else if (!e.shiftKey && document.activeElement===last) { e.preventDefault(); first.focus() } }}><div className="command-input"><span>⌘</span><input ref={input} aria-label="Search commands" value={query} onChange={(e) => { setQuery(e.target.value); setIndex(0) }} onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(matches.length - 1, i + 1)) } if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)) } if (e.key === 'Enter') run(matches[index]) }} placeholder="Type a command…" /></div><div className="command-results">{matches.map((command, i) => <button type="button" key={command.label} className={i === index ? 'active' : ''} aria-selected={i === index} onMouseEnter={() => setIndex(i)} onClick={() => run(command)}><span>{command.label}<small>{command.hint}</small></span><kbd>↵</kbd></button>)}{!matches.length ? <p>No matching protocol.</p> : null}</div><footer><span>↑↓ NAVIGATE</span><span>↵ OPEN</span><span>ESC CLOSE</span></footer></div></div>
}
