import { APP_NAME } from '../../../shared/brand'
import {
  brainChoice,
  brainLockHint,
  chatgptStatusLine,
  hasTalkableBrain,
  settingsForBrain,
  type BrainChoice
} from '../../../shared/brainRouting'
import type { PanelId } from '../../../shared/types'
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
  const codexStatus = useAlbertStore((s) => s.codexStatus)
  const hasBrain = hasTalkableBrain(settings)
  const active = brainChoice(settings)

  async function setBrain(next: BrainChoice): Promise<void> {
    try {
      const updated = await window.albert.setSettings(settingsForBrain(next))
      setSettings(updated)
    } catch {
      /* ignore */
    }
  }

  return (
    <aside className="sidebar">
      <div className="brand-mark">
        <h1>{APP_NAME}</h1>
        <span>ChatGPT · on comms</span>
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
      <div className="sidebar-command-hint">
        <span>Command deck</span>
        <kbd>⌘ K</kbd>
      </div>

      <div className="brain-picker">
        <span className="hud-label">Brain</span>
        <button
          type="button"
          className={`brain-primary ${active === 'chatgpt' ? 'active' : ''}`}
          onClick={() => void setBrain('chatgpt')}
        >
          <span className="brain-primary-name">ChatGPT</span>
          <span className="brain-primary-meta">
            {codexStatus?.signedIn
              ? codexStatus.allowance?.label || 'Signed in'
              : 'Sign in · Systems'}
          </span>
        </button>
        <span className="hud-label faint">Fallback — only if you lock it, or ChatGPT fails</span>
        <div className="mode-toggle-row">
          <button
            type="button"
            className={active === 'gemini' ? 'active' : ''}
            onClick={() => void setBrain(active === 'gemini' ? 'chatgpt' : 'gemini')}
          >
            Gemini
          </button>
          <button
            type="button"
            className={active === 'opus' ? 'active' : ''}
            onClick={() => void setBrain(active === 'opus' ? 'chatgpt' : 'opus')}
          >
            Opus
          </button>
        </div>
        <span className="mode-auto-hint">{brainLockHint(active)}</span>
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
                ? chatgptStatusLine(codexStatus).split('·')[0]
                : 'Sign in to ChatGPT'}
        </div>
      </div>
    </aside>
  )
}
