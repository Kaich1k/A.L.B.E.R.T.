import { APP_NAME } from '../../../shared/brand'
import type { PanelId, RoutingMode } from '../../../shared/types'
import { useAlbertStore } from '../store'

const items: { id: PanelId; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'conversation', label: 'Comm' },
  { id: 'missions', label: 'Operations' },
  { id: 'memory', label: 'Memory' },
  { id: 'activity', label: 'Activity' },
  { id: 'settings', label: 'Systems' }
]

export function Sidebar(): React.JSX.Element {
  const panel = useAlbertStore((s) => s.panel)
  const setPanel = useAlbertStore((s) => s.setPanel)
  const voiceState = useAlbertStore((s) => s.voiceState)
  const wakeArmed = useAlbertStore((s) => s.wakeArmed)
  const settings = useAlbertStore((s) => s.settings)
  const setSettings = useAlbertStore((s) => s.setSettings)
  const routeInfo = useAlbertStore((s) => s.routeInfo)
  const hasBrain = Boolean(
    settings.anthropicApiKey?.trim() ||
      settings.ollamaApiKey?.trim() ||
      settings.groqApiKey?.trim() ||
      settings.localProvider === 'ollama'
  )

  const mode = settings.routingMode || 'auto'
  const isAuto = mode === 'auto'

  async function setMode(next: RoutingMode): Promise<void> {
    try {
      const updated = await window.albert.setSettings({ routingMode: next })
      setSettings(updated)
    } catch {
      /* ignore */
    }
  }

  return (
    <aside className="sidebar">
      <div className="brand-mark">
        <h1>{APP_NAME}</h1>
        <span>Interface protocol · v0.1.0</span>
      </div>
      <nav className="nav">
        {items.map((item, index) => (
          <button
            key={item.id}
            className={panel === item.id ? 'active' : ''}
            aria-current={panel === item.id ? 'page' : undefined}
            onClick={() => setPanel(item.id)}
          >
            <span className="nav-index">0{index + 1}</span>
            {item.label}
            <kbd className="nav-shortcut">⌘{index + 1}</kbd>
          </button>
        ))}
        <button type="button" onClick={() => void window.albert.showComputer()}>
          <span className="nav-index">0{items.length + 1}</span>
          Computer
        </button>
      </nav>
      <div className="sidebar-command-hint"><span>Command deck</span><kbd>⌘ K</kbd></div>

      <div
        className="mode-toggle"
        title={isAuto ? 'Auto: QUICK (Ollama/Groq Cloud) → Haiku → Opus' : routeInfo || undefined}
      >
        <span className="hud-label">Routing mode</span>
        <div className="mode-toggle-row triple">
          <button
            type="button"
            className={mode === 'local' ? 'active' : ''}
            onClick={() => void setMode(mode === 'local' ? 'auto' : 'local')}
          >
            QUICK
          </button>
          <button
            type="button"
            className={mode === 'fast' ? 'active' : ''}
            onClick={() => void setMode(mode === 'fast' ? 'auto' : 'fast')}
          >
            HAIKU
          </button>
          <button
            type="button"
            className={mode === 'power' ? 'active' : ''}
            onClick={() => void setMode(mode === 'power' ? 'auto' : 'power')}
          >
            OPUS
          </button>
        </div>
        {isAuto ? <span className="mode-auto-hint">auto · click to lock</span> : (
          <span className="mode-auto-hint">locked · click again for auto</span>
        )}
      </div>

      <div className="sidebar-footer">
        <div className="status-pill">
          <span
            className={`status-dot ${
              voiceState === 'listening' || voiceState === 'speaking'
                ? voiceState
                : hasBrain
                  ? 'ready'
                  : ''
            }`}
          />
          {voiceState !== 'idle'
            ? `Voice · ${voiceState}`
            : wakeArmed
              ? 'Wake · “Albert, wake up”'
              : hasBrain
                ? 'Ready · ⌘⇧A'
                : 'Awaiting key'}
        </div>
      </div>
    </aside>
  )
}
