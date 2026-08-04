import { useEffect, useRef, useState } from 'react'
import { APP_NAME } from '../../../shared/brand'
import type { ActivityEntry, ComputerState, ComputerTab } from '../../../shared/types'
import { useAlbertStore } from '../store'

type WebviewEl = HTMLElement & {
  src: string
  partition: string
  getURL: () => string
  getTitle: () => string
  loadURL: (url: string) => void
  executeJavaScript: <T>(code: string) => Promise<T>
  addEventListener: (
    type: string,
    listener: (event: Event & { isMainFrame?: boolean; url?: string }) => void
  ) => void
  removeEventListener: (
    type: string,
    listener: (event: Event & { isMainFrame?: boolean; url?: string }) => void
  ) => void
}

function sameDocument(a: string, b: string): boolean {
  try {
    const ua = new URL(a)
    const ub = new URL(b)
    return ua.origin === ub.origin && ua.pathname === ub.pathname && ua.search === ub.search
  } catch {
    return a === b
  }
}

export function ComputerPanel({
  standalone = false
}: {
  standalone?: boolean
}): React.JSX.Element {
  const [state, setState] = useState<ComputerState>({ tabs: [], activeTabId: null })
  const [urlDraft, setUrlDraft] = useState('')
  const activity = useAlbertStore((s) => s.activity)
  const webviewRefs = useRef<Map<string, WebviewEl>>(new Map())
  /** Last URL we intentionally asked the webview to load. */
  const committedSrc = useRef<Map<string, string>>(new Map())
  const boundIds = useRef<Set<string>>(new Set())
  /** Stable initial src per tab so React never rewrites src after mount. */
  const initialSrc = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    void window.albert.getComputerState().then(setState)
    const off = window.albert.onComputerChanged(setState)
    return off
  }, [])

  useEffect(() => {
    const off = window.albert.onComputerGetPage(({ requestId, tabId }) => {
      void (async () => {
        const el = webviewRefs.current.get(tabId)
        if (!el) {
          window.albert.replyComputerGetPage({
            requestId,
            ok: false,
            error: 'Tab webview not mounted — Computer window still loading'
          })
          return
        }
        try {
          const text = await el.executeJavaScript<string>(
            `(() => {
              const body = document.body ? document.body.innerText : '';
              return body.replace(/\\s+/g, ' ').trim().slice(0, 5000);
            })()`
          )
          window.albert.replyComputerGetPage({
            requestId,
            ok: true,
            title: el.getTitle() || 'Untitled',
            url: el.getURL() || '',
            text: text || ''
          })
        } catch (err) {
          window.albert.replyComputerGetPage({
            requestId,
            ok: false,
            error: err instanceof Error ? err.message : String(err)
          })
        }
      })()
    })
    return off
  }, [])

  useEffect(() => {
    const active = state.tabs.find((t) => t.id === state.activeTabId)
    if (!active) {
      setUrlDraft('')
      return
    }
    const el = webviewRefs.current.get(active.id)
    if (el) {
      try {
        const live = el.getURL()
        if (live && live !== 'about:blank') {
          setUrlDraft(live)
          return
        }
      } catch {
        /* webview not ready */
      }
    }
    setUrlDraft(active.url)
  }, [state.activeTabId])

  // Intentional navigations from toolbar / agent tools
  useEffect(() => {
    for (const tab of state.tabs) {
      if (!initialSrc.current.has(tab.id)) {
        initialSrc.current.set(tab.id, tab.url)
      }

      const el = webviewRefs.current.get(tab.id)
      if (!el) continue

      const wanted = tab.url
      const lastTold = committedSrc.current.get(tab.id)
      if (!wanted || wanted === lastTold) continue

      let live = ''
      try {
        live = el.getURL()
      } catch {
        live = ''
      }

      if (live && sameDocument(live, wanted)) {
        committedSrc.current.set(tab.id, wanted)
        continue
      }

      committedSrc.current.set(tab.id, wanted)
      try {
        el.loadURL(wanted)
      } catch {
        el.src = wanted
      }
    }
  }, [state.tabs])

  function bindWebview(tab: ComputerTab, el: WebviewEl | null): void {
    if (!el) {
      webviewRefs.current.delete(tab.id)
      boundIds.current.delete(tab.id)
      return
    }
    webviewRefs.current.set(tab.id, el)

    if (!committedSrc.current.has(tab.id) && tab.url) {
      committedSrc.current.set(tab.id, tab.url)
    }

    if (boundIds.current.has(tab.id)) return
    boundIds.current.add(tab.id)

    const onStart = (): void => {
      void window.albert.updateComputerTab(tab.id, { loading: true })
    }
    const onStop = (): void => {
      void window.albert.updateComputerTab(tab.id, {
        loading: false,
        title: el.getTitle() || tab.title
        // Do not write live URL (e.g. Google ?zx=) back into tab.url — that reloads the webview.
      })
      try {
        const current = el.getURL()
        if (current && current !== 'about:blank') {
          void window.albert.getComputerState().then((s) => {
            if (s.activeTabId === tab.id) setUrlDraft(current)
          })
        }
      } catch {
        /* ignore */
      }
    }
    const onFail = (): void => {
      void window.albert.updateComputerTab(tab.id, {
        loading: false,
        lastError: 'Failed to load page'
      })
    }
    const onTitle = (): void => {
      void window.albert.updateComputerTab(tab.id, { title: el.getTitle() || 'Untitled' })
    }

    el.addEventListener('did-start-loading', onStart)
    el.addEventListener('did-stop-loading', onStop)
    el.addEventListener('did-fail-load', onFail)
    el.addEventListener('page-title-updated', onTitle)
  }

  async function openTab(): Promise<void> {
    const url = urlDraft.trim() || 'https://www.google.com'
    await window.albert.openComputerTab(url)
  }

  async function go(): Promise<void> {
    if (!state.activeTabId) {
      await openTab()
      return
    }
    const url = urlDraft.trim()
    if (!url) return
    committedSrc.current.delete(state.activeTabId)
    await window.albert.navigateComputerTab(url, state.activeTabId)
  }

  const recentOps = activity.slice(0, 12)
  const activeId = state.activeTabId

  return (
    <section className={`panel panel-computer ${standalone ? 'standalone' : ''}`}>
      <div className="computer-header">
        <div>
          <h2 className="section-title">{standalone ? `${APP_NAME} Computer` : 'Computer'}</h2>
          <p className="section-sub">
            Sandbox browser {APP_NAME} owns — tabs stay in this window, not Safari / Chrome.
          </p>
        </div>
      </div>

      <div className="computer-layout">
        <div className="computer-main">
          <div className="computer-tabs">
            {state.tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`computer-tab ${tab.id === activeId ? 'active' : ''}`}
                onClick={() => void window.albert.focusComputerTab(tab.id)}
              >
                <span className="computer-tab-title">
                  {tab.loading ? '… ' : ''}
                  {tab.title || 'Tab'}
                </span>
                <span
                  className="computer-tab-close"
                  onClick={(e) => {
                    e.stopPropagation()
                    void window.albert.closeComputerTab(tab.id)
                  }}
                >
                  ×
                </span>
              </button>
            ))}
            <button
              type="button"
              className="computer-tab add"
              onClick={() => void window.albert.openComputerTab('https://www.google.com')}
            >
              +
            </button>
          </div>

          <div className="computer-toolbar">
            <input
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void go()
              }}
              placeholder="https://…"
              spellCheck={false}
            />
            <button className="btn primary" type="button" onClick={() => void go()}>
              Go
            </button>
          </div>

          <div className="computer-stage">
            {state.tabs.length === 0 ? (
              <div className="computer-empty">
                <p>Standing by — ask A.L.B.E.R.T. to open something, or launch a tab here.</p>
                <button className="btn primary" type="button" onClick={() => void openTab()}>
                  Open Google
                </button>
              </div>
            ) : (
              state.tabs.map((tab) => {
                if (!initialSrc.current.has(tab.id)) {
                  initialSrc.current.set(tab.id, tab.url)
                }
                return (
                  <webview
                    key={tab.id}
                    ref={(node) => bindWebview(tab, node as WebviewEl | null)}
                    src={initialSrc.current.get(tab.id)}
                    partition="persist:albert-computer"
                    style={{
                      display: tab.id === activeId ? 'flex' : 'none',
                      flex: 1,
                      width: '100%',
                      height: '100%',
                      border: 'none',
                      background: '#0a0a0c'
                    }}
                  />
                )
              })
            )}
          </div>
        </div>

        <aside className="computer-ops">
          <div className="hud-label">Live ops</div>
          <div className="computer-ops-list">
            {recentOps.length === 0 ? (
              <p className="section-sub">Tool activity appears here while he works.</p>
            ) : (
              recentOps.map((op: ActivityEntry) => (
                <div key={op.id} className={`computer-op ${op.ok ? 'ok' : 'bad'}`}>
                  <div className="computer-op-name">{op.toolName}</div>
                  <div className="computer-op-result">{op.result.slice(0, 160)}</div>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
    </section>
  )
}
