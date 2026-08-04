import { useEffect } from 'react'
import { APP_NAME } from '../../../shared/brand'
import { useAlbertStore } from '../store'

export function ActivityPanel(): React.JSX.Element {
  const activity = useAlbertStore((s) => s.activity)
  const setActivity = useAlbertStore((s) => s.setActivity)

  async function refresh(): Promise<void> {
    setActivity(await window.albert.listActivity())
  }

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), 2500)
    return () => window.clearInterval(id)
  }, [])

  return (
    <section className="panel">
      <h2 className="section-title">Activity</h2>
      <p className="section-sub">Tool calls {APP_NAME} made on your behalf.</p>
      <div className="toolbar">
        <button className="btn ghost" onClick={() => void refresh()}>
          Refresh
        </button>
        <button
          className="btn ghost"
          onClick={() => void window.albert.clearActivity().then(refresh)}
        >
          Clear
        </button>
      </div>
      <div className="list">
        {activity.length === 0 ? (
          <div className="empty">No activity yet.</div>
        ) : (
          activity.map((a) => (
            <article key={a.id} className={`list-item ${a.ok ? 'ok' : 'fail'}`}>
              <header>
                <strong>{a.toolName}</strong>
                <span className="meta">
                  <span className="meta-status">{a.ok ? 'ok' : 'failed'}</span>
                  {' · '}
                  {new Date(a.createdAt).toLocaleString()}
                </span>
              </header>
              <p>
                <span className="meta">args</span>
                {'\n'}
                {JSON.stringify(a.args, null, 2)}
                {'\n\n'}
                <span className="meta">result</span>
                {'\n'}
                {a.result}
              </p>
            </article>
          ))
        )}
      </div>
    </section>
  )
}
