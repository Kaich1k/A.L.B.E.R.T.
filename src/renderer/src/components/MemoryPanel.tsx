import { useEffect, useMemo, useState } from 'react'
import { APP_NAME } from '../../../shared/brand'
import { buildMemoryGraph } from '../../../shared/memoryGraph'
import type { MemoryFact, MemoryGraphNode, MemoryKind } from '../../../shared/types'
import { useAlbertStore } from '../store'

type MemoryView = 'graph' | 'list'

export function MemoryPanel(): React.JSX.Element {
  const memories = useAlbertStore((s) => s.memories)
  const setMemories = useAlbertStore((s) => s.setMemories)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [view, setView] = useState<MemoryView>('graph')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    setMemories(await window.albert.listMemories())
  }

  useEffect(() => {
    void refresh()
    return window.albert.onMemoryChanged(() => void refresh())
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

  const categories = Array.from(new Set(memories.map((m) => m.category || 'general'))).sort()
  const normalizedQuery = query.trim().toLowerCase()
  const visible = memories.filter((m) =>
    normalizedQuery
      ? `${m.content} ${m.category} ${m.source ?? ''}`.toLowerCase().includes(normalizedQuery)
      : true
  )
  const selected = visible.find((m) => m.id === selectedId) ?? visible[0] ?? null
  const stale = memories.filter((m) => Date.now() - m.updatedAt > 1000 * 60 * 60 * 24 * 120).length
  const unsourced = memories.filter((m) => !m.source || m.source === 'conversation').length
  const lowConfidence = memories.filter((m) => (m.confidence ?? 1) < 0.72).length

  return (
    <section className="panel memory-panel">
      <header className="memory-header">
        <div>
          <h2 className="section-title">Memory</h2>
          <p className="section-sub">
            Long-term facts {APP_NAME} keeps across sessions — people, projects, preferences, and decisions, with source and confidence.
          </p>
        </div>
        <div className="memory-actions">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search memory..."
            aria-label="Search memory"
          />
          <button className="btn ghost" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
      </header>

      <div className="memory-health">
        <article><span>Total</span><strong>{memories.length}</strong><small>{categories.length} categories</small></article>
        <article><span>Stale</span><strong>{stale}</strong><small>120+ days</small></article>
        <article><span>Source review</span><strong>{unsourced}</strong><small>conversation/default</small></article>
        <article><span>Low confidence</span><strong>{lowConfidence}</strong><small>under 72%</small></article>
      </div>

      <div className="memory-view-toggle" role="tablist" aria-label="Memory views">
        <button type="button" className={view === 'graph' ? 'active' : ''} onClick={() => setView('graph')}>
          Constellation
        </button>
        <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
          List
        </button>
      </div>

      {view === 'graph' ? (
        <MemoryConstellation
          memories={visible}
          selected={selected}
          select={(memory) => setSelectedId(memory.id)}
        />
      ) : (
        <div className="list">
          {visible.length === 0 ? (
            <div className="empty">
              Nothing matching that filter. Memory remains annoyingly literal, sir.
            </div>
          ) : (
            visible.map((m) => (
              <article key={m.id} className={`list-item ${selected?.id === m.id ? 'selected' : ''}`}>
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
                        setSelectedId(m.id)
                      }}
                    >
                      Edit
                    </button>
                    <button className="btn ghost" onClick={() => void onDelete(m.id)}>
                      Delete
                    </button>
                  </div>
                </header>
                <div className="memory-provenance">
                  <span>SOURCE {m.source || 'conversation'}</span>
                  <span>CONFIDENCE {Math.round((m.confidence ?? 1) * 100)}%</span>
                  <span>{m.lastUsedAt ? `USED ${new Date(m.lastUsedAt).toLocaleDateString()}` : 'NOT YET RECALLED'}</span>
                </div>
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
      )}
    </section>
  )
}

const KIND_COLOR: Record<MemoryKind, string> = {
  person: '#89cff0',
  project: '#3dcf7a',
  preference: '#e3c36a',
  decision: '#f08a5d',
  place: '#b48ef0',
  general: '#8aa0ad'
}

function MemoryConstellation({
  memories,
  selected,
  select
}: {
  memories: MemoryFact[]
  selected: MemoryFact | null
  select: (memory: MemoryFact) => void
}): React.JSX.Element {
  const graph = useMemo(() => buildMemoryGraph(memories), [memories])
  const selectedNode = graph.nodes.find((node) => node.id === selected?.id) ?? graph.nodes[0] ?? null
  const linked = new Set(
    graph.edges
      .filter((edge) => selectedNode && (edge.from === selectedNode.id || edge.to === selectedNode.id))
      .flatMap((edge) => [edge.from, edge.to])
  )

  return (
    <div className="memory-constellation">
      <div className="memory-map memory-graph-wrap" aria-label="Memory graph">
        {graph.nodes.length ? (
          <svg className="memory-graph" viewBox="0 0 640 500" role="img">
            {graph.edges.map((edge) => {
              const from = graph.nodes.find((node) => node.id === edge.from)
              const to = graph.nodes.find((node) => node.id === edge.to)
              if (!from || !to) return null
              const hot = selectedNode && (edge.from === selectedNode.id || edge.to === selectedNode.id)
              return (
                <line
                  key={`${edge.from}-${edge.to}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  className={hot ? 'hot' : ''}
                />
              )
            })}
            {graph.nodes.map((node) => (
              <MemoryGraphMark
                key={node.id}
                node={node}
                selected={selectedNode?.id === node.id}
                linked={linked.has(node.id)}
                onSelect={() => {
                  const memory = memories.find((item) => item.id === node.id)
                  if (memory) select(memory)
                }}
              />
            ))}
          </svg>
        ) : (
          <div className="empty">No matching memories.</div>
        )}
        <div className="memory-legend">
          {(Object.keys(KIND_COLOR) as MemoryKind[]).map((kind) => (
            <span key={kind}>
              <i style={{ background: KIND_COLOR[kind] }} />
              {kind}
            </span>
          ))}
        </div>
      </div>
      <aside className="memory-inspector">
        {selected ? (
          <>
            <div className="eyebrow">
              MEMORY INSPECTOR / {(selectedNode?.kind || selected.category || 'general').toUpperCase()}
            </div>
            <h3>{(selected.content || 'Memory').split(/[.:\n]/)[0]}</h3>
            <p>{selected.content}</p>
            <dl>
              <div>
                <dt>Source</dt>
                <dd>{selected.source || 'conversation'}</dd>
              </div>
              <div>
                <dt>Confidence</dt>
                <dd>{Math.round((selected.confidence ?? 1) * 100)}%</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{new Date(selected.updatedAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt>Last used</dt>
                <dd>{selected.lastUsedAt ? new Date(selected.lastUsedAt).toLocaleString() : 'Not yet recalled'}</dd>
              </div>
              <div>
                <dt>Links</dt>
                <dd>
                  {graph.edges.filter((edge) => edge.from === selected.id || edge.to === selected.id).length ||
                    'none yet'}
                </dd>
              </div>
            </dl>
          </>
        ) : (
          <div className="empty">Select a memory to inspect provenance.</div>
        )}
      </aside>
    </div>
  )
}

function MemoryGraphMark({
  node,
  selected,
  linked,
  onSelect
}: {
  node: MemoryGraphNode
  selected: boolean
  linked: boolean
  onSelect: () => void
}): React.JSX.Element {
  const radius = selected ? 9 : linked ? 7 : 5
  return (
    <g className={`memory-node ${selected ? 'selected' : ''} ${linked ? 'linked' : ''}`} onClick={onSelect}>
      <circle cx={node.x} cy={node.y} r={radius + 6} fill="transparent" />
      <circle cx={node.x} cy={node.y} r={radius} fill={KIND_COLOR[node.kind]} />
      <text x={node.x + 12} y={node.y + 4}>
        {node.label}
      </text>
    </g>
  )
}
