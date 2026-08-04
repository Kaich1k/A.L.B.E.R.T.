import { FormEvent, useEffect, useMemo, useState } from 'react'
import { v4 as uuid } from 'uuid'
import { chatWithClaude } from './lib/claude'
import {
  loadChat,
  loadConfig,
  loadMemories,
  saveChat,
  saveConfig,
  saveMemories,
  upsertLocalMemory
} from './lib/storage'
import { checkMacHealth, syncMemoriesWithMac } from './lib/sync'
import type { ChatMessage, CompanionConfig, MemoryFact } from './types'

type Tab = 'chat' | 'memories' | 'settings'

export function App(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('chat')
  const [config, setConfig] = useState<CompanionConfig>(() => loadConfig())
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadChat())
  const [memories, setMemories] = useState<MemoryFact[]>(() => loadMemories())
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [macOnline, setMacOnline] = useState<boolean | null>(null)
  const [syncNote, setSyncNote] = useState<string | null>(null)

  useEffect(() => {
    saveConfig(config)
  }, [config])

  useEffect(() => {
    saveChat(messages)
  }, [messages])

  useEffect(() => {
    saveMemories(memories)
  }, [memories])

  useEffect(() => {
    let cancelled = false
    async function ping(): Promise<void> {
      if (!config.macBaseUrl.trim()) {
        if (!cancelled) setMacOnline(null)
        return
      }
      const ok = await checkMacHealth(config.macBaseUrl)
      if (!cancelled) setMacOnline(ok)
    }
    void ping()
    const id = window.setInterval(() => void ping(), 20_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [config.macBaseUrl])

  const statusLabel = useMemo(() => {
    if (macOnline === null) return 'Mac link not configured'
    return macOnline ? 'Mac online — memories can sync' : 'Mac offline — chatting locally'
  }, [macOnline])

  async function sendMessage(e?: FormEvent): Promise<void> {
    e?.preventDefault()
    const text = draft.trim()
    if (!text || busy) return

    const userMsg: ChatMessage = {
      id: uuid(),
      role: 'user',
      content: text,
      createdAt: Date.now()
    }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setDraft('')
    setBusy(true)
    setError(null)

    try {
      const { reply, newMemories } = await chatWithClaude({
        apiKey: config.anthropicApiKey,
        model: config.model,
        messages: nextMessages,
        memories
      })

      let nextMemories = memories
      for (const m of newMemories) {
        nextMemories = upsertLocalMemory(nextMemories, {
          id: uuid(),
          content: m.content,
          category: m.category
        })
      }
      if (newMemories.length) {
        setMemories(nextMemories)
        if (macOnline) {
          try {
            const merged = await syncMemoriesWithMac({
              baseUrl: config.macBaseUrl,
              token: config.macToken,
              memories: nextMemories
            })
            setMemories(merged)
            setSyncNote(`Synced ${merged.length} memories to Mac`)
          } catch {
            setSyncNote('Saved locally — Mac sync failed (will retry)')
          }
        }
      }

      setMessages((prev) => [
        ...prev,
        {
          id: uuid(),
          role: 'assistant',
          content: reply,
          createdAt: Date.now()
        }
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function syncNow(): Promise<void> {
    setError(null)
    setSyncNote(null)
    setBusy(true)
    try {
      const merged = await syncMemoriesWithMac({
        baseUrl: config.macBaseUrl,
        token: config.macToken,
        memories
      })
      setMemories(merged)
      setMacOnline(true)
      setSyncNote(`Synced — ${merged.length} memories`)
    } catch (err) {
      setMacOnline(false)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function deleteMemory(id: string): void {
    setMemories((prev) => prev.filter((m) => m.id !== id))
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          A.L.B.E.R.T.
          <span>PHONE COMPANION</span>
        </div>
        <nav className="tabs">
          <button
            type="button"
            className={`tab ${tab === 'chat' ? 'active' : ''}`}
            onClick={() => setTab('chat')}
          >
            Chat
          </button>
          <button
            type="button"
            className={`tab ${tab === 'memories' ? 'active' : ''}`}
            onClick={() => setTab('memories')}
          >
            Memory
          </button>
          <button
            type="button"
            className={`tab ${tab === 'settings' ? 'active' : ''}`}
            onClick={() => setTab('settings')}
          >
            Pair
          </button>
        </nav>
      </header>

      <main className="main">
        <div className={`status ${macOnline === true ? 'ok' : macOnline === false ? 'bad' : ''}`}>
          {statusLabel}
          {syncNote ? ` · ${syncNote}` : ''}
        </div>
        {error ? <div className="error">{error}</div> : null}

        {tab === 'chat' ? (
          <div className="messages">
            {messages.length === 0 ? (
              <p className="hint">
                Chat works offline with your Anthropic key. When your Mac is online on the same
                network, memories sync both ways.
              </p>
            ) : null}
            {messages.map((m) => (
              <div key={m.id} className={`bubble ${m.role}`}>
                {m.content}
              </div>
            ))}
          </div>
        ) : null}

        {tab === 'memories' ? (
          <div>
            <div className="actions">
              <button
                type="button"
                className="btn primary"
                disabled={busy || !config.macBaseUrl}
                onClick={() => void syncNow()}
              >
                Sync with Mac
              </button>
            </div>
            <div className="memory-list">
              {memories.length === 0 ? (
                <p className="hint">No memories yet. Mention preferences in chat and I’ll store them.</p>
              ) : (
                memories.map((m) => (
                  <div key={m.id} className="memory-item">
                    <div className="cat">{m.category}</div>
                    <div>{m.content}</div>
                    <div className="actions">
                      <button type="button" className="btn" onClick={() => deleteMemory(m.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}

        {tab === 'settings' ? (
          <div>
            <p className="hint">
              On the Mac: Systems → enable Phone companion → Copy pair info. Paste the LAN URL and
              token here. Use Tailscale if you’re away from home Wi‑Fi.
            </p>
            <div className="field">
              <label htmlFor="apiKey">Anthropic API key</label>
              <input
                id="apiKey"
                type="password"
                value={config.anthropicApiKey}
                onChange={(e) => setConfig({ ...config, anthropicApiKey: e.target.value })}
                placeholder="sk-ant-..."
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor="model">Model</label>
              <select
                id="model"
                value={config.model}
                onChange={(e) => setConfig({ ...config, model: e.target.value })}
              >
                <option value="claude-haiku-4-5">Haiku (fast)</option>
                <option value="claude-sonnet-4-6">Sonnet</option>
                <option value="claude-opus-4-8">Opus</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="macUrl">Mac companion URL</label>
              <input
                id="macUrl"
                value={config.macBaseUrl}
                onChange={(e) => setConfig({ ...config, macBaseUrl: e.target.value })}
                placeholder="http://192.168.x.x:47831"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="field">
              <label htmlFor="macToken">Pairing token</label>
              <input
                id="macToken"
                value={config.macToken}
                onChange={(e) => setConfig({ ...config, macToken: e.target.value })}
                placeholder="from Mac Systems"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="actions">
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() => void syncNow()}
              >
                Test sync
              </button>
            </div>
          </div>
        ) : null}
      </main>

      {tab === 'chat' ? (
        <form className="composer" onSubmit={(e) => void sendMessage(e)}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Message A.L.B.E.R.T."
            rows={2}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void sendMessage()
              }
            }}
          />
          <button className="btn primary" type="submit" disabled={busy || !draft.trim()}>
            {busy ? '…' : 'Send'}
          </button>
        </form>
      ) : null}
    </div>
  )
}
