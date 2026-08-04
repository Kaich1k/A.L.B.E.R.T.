import { useEffect, useState } from 'react'
import { APP_NAME } from '../../../shared/brand'
import { useAlbertStore } from '../store'

export function MemoryPanel(): React.JSX.Element {
  const memories = useAlbertStore((s) => s.memories)
  const setMemories = useAlbertStore((s) => s.setMemories)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  async function refresh(): Promise<void> {
    setMemories(await window.albert.listMemories())
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function onDelete(id: string): Promise<void> {
    await window.albert.deleteMemory(id)
    await refresh()
  }

  async function onSave(id: string): Promise<void> {
    await window.albert.updateMemory(id, draft)
    setEditingId(null)
    await refresh()
  }

  return (
    <section className="panel">
      <h2 className="section-title">Memory</h2>
      <p className="section-sub">Long-term facts {APP_NAME} keeps across sessions.</p>
      <div className="toolbar">
        <button className="btn ghost" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      <div className="list">
        {memories.length === 0 ? (
          <div className="empty">No memories yet. Ask {APP_NAME} to remember something.</div>
        ) : (
          memories.map((m) => (
            <article key={m.id} className="list-item">
              <header>
                <span className="meta">
                  {m.category} · {new Date(m.updatedAt).toLocaleString()}
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn ghost"
                    onClick={() => {
                      setEditingId(m.id)
                      setDraft(m.content)
                    }}
                  >
                    Edit
                  </button>
                  <button className="btn ghost" onClick={() => void onDelete(m.id)}>
                    Delete
                  </button>
                </div>
              </header>
              {editingId === m.id ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={3}
                    style={{
                      width: '100%',
                      borderRadius: 2,
                      border: '1px solid var(--line)',
                      background: 'rgba(255,255,255,0.03)',
                      padding: 12,
                      fontFamily: 'var(--font-body)',
                      color: 'var(--ink)'
                    }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn primary" onClick={() => void onSave(m.id)}>
                      Save
                    </button>
                    <button className="btn ghost" onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <p>{m.content}</p>
              )}
            </article>
          ))
        )}
      </div>
    </section>
  )
}
