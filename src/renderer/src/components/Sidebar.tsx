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
import {
  CHATGPT_ASTRA_MODEL,
  CHATGPT_SOL_61_MODEL,
  codexModelLabel,
  codexModelListed,
  sol61UnavailableReason
} from '../../../shared/codexModels'
import {
  CLAUDE_MODEL_OPTIONS,
  GEMINI_MODEL_OPTIONS,
  withSavedModel
} from '../../../shared/modelCatalog'
import { useAlbertStore } from '../store'

function shownModelLabel(
  id: string,
  codexStatus: { signedIn?: boolean; availableModels?: Array<{ id: string; displayName: string }> } | null
): string {
  if (!id) return codexStatus?.signedIn ? 'Astra' : 'Sign in · Systems'
  const known = codexStatus?.availableModels?.find((model) => model.id === id)
  return codexModelLabel(id, known?.displayName)
}

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
  const sol61Available = codexModelListed(codexStatus?.availableModels, CHATGPT_SOL_61_MODEL)

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
            {shownModelLabel(settings.codexModel || codexStatus?.model || '', codexStatus)}
          </span>
        </button>
        {active === 'chatgpt' ? (
          <label className="brain-model-select">
            <span className="hud-label">Model</span>
            <select
              aria-label="ChatGPT model"
              value={settings.codexModel || CHATGPT_ASTRA_MODEL}
              onChange={(event) => {
                const next = event.target.value
                const previous = settings.codexModel
                setSettings({ ...settings, codexModel: next })
                void window.albert.setSettings({ codexModel: next }).then(async (updated) => {
                  setSettings(updated)
                  const status = await window.albert.getCodexStatus()
                  useAlbertStore.getState().setCodexStatus(status)
                  if (updated.codexModel !== next) {
                    useAlbertStore.getState().setError(
                      status.modelNotice ||
                        'That ChatGPT model is not available. Kept the previous model.'
                    )
                    if (!updated.codexModel) setSettings({ ...updated, codexModel: previous })
                  } else {
                    useAlbertStore.getState().setError(null)
                  }
                }).catch(() => {
                  setSettings({ ...useAlbertStore.getState().settings, codexModel: previous })
                })
              }}
            >
              <option value={CHATGPT_ASTRA_MODEL}>Astra</option>
              <option value={CHATGPT_SOL_61_MODEL} disabled={!sol61Available}>
                {sol61Available ? '6.1 Sol' : `6.1 Sol — ${sol61UnavailableReason(codexStatus?.version)}`}
              </option>
              {(codexStatus?.availableModels || [])
                .filter(
                  (model) =>
                    model.id !== CHATGPT_ASTRA_MODEL &&
                    model.id !== CHATGPT_SOL_61_MODEL &&
                    !model.id.startsWith(`${CHATGPT_SOL_61_MODEL}-`)
                )
                .map((model) => (
                  <option key={model.id} value={model.id}>
                    {codexModelLabel(model.id, model.displayName)}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
        {codexStatus?.modelNotice ? <span className="mode-auto-hint">{codexStatus.modelNotice}</span> : null}
        <div className="mode-toggle-row">
          <button
            type="button"
            className={active === 'gemini' ? 'active' : ''}
            onClick={() => void setBrain('gemini')}
          >
            Gemini
          </button>
          <button
            type="button"
            className={active === 'opus' ? 'active' : ''}
            onClick={() => void setBrain('opus')}
          >
            Claude
          </button>
        </div>
        {active === 'gemini' ? (
          <label className="brain-model-select">
            <span className="hud-label">Model</span>
            <select
              aria-label="Gemini model"
              value={settings.geminiModel}
              onChange={(event) => {
                const geminiModel = event.target.value
                setSettings({ ...settings, geminiModel, routingMode: 'local', localProvider: 'gemini' })
                void window.albert
                  .setSettings({ geminiModel, routingMode: 'local', localProvider: 'gemini' })
                  .then(setSettings)
              }}
            >
              {withSavedModel(GEMINI_MODEL_OPTIONS, settings.geminiModel).map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {active === 'opus' ? (
          <label className="brain-model-select">
            <span className="hud-label">Model</span>
            <select
              aria-label="Claude model"
              value={settings.powerModel || settings.model}
              onChange={(event) => {
                const powerModel = event.target.value
                setSettings({ ...settings, powerModel, model: powerModel, routingMode: 'power' })
                void window.albert
                  .setSettings({ powerModel, model: powerModel, routingMode: 'power' })
                  .then(setSettings)
              }}
            >
              {withSavedModel(CLAUDE_MODEL_OPTIONS, settings.powerModel || settings.model).map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
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
