import { FormEvent, useEffect, useRef, useState } from 'react'
import { APP_NAME } from '../../../shared/brand'
import type { ChatImageMediaType, ChatImagePayload, ChatImageRef } from '../../../shared/types'
import { useAlbertStore } from '../store'
import { isEndVoiceCommand } from '../voice/voiceCommands'
import { AlbertCore } from './AlbertCore'

interface Props {
  onTalk: () => void
  /** End voice session + re-arm wake (standby / take 5) */
  onStandby?: () => void | Promise<void>
}

interface DraftImage {
  id: string
  mediaType: ChatImageMediaType
  data: string
  previewUrl: string
}

const MAX_ATTACH = 4
const MAX_BYTES = 4_500_000
const voiceStackCommands = [
  { label: 'Short version', prompt: 'Give me the short version of your last answer.' },
  { label: 'Hold thought', prompt: 'Hold that thought and save the current thread context for later.' },
  { label: 'Show me', prompt: 'Show me the relevant screen, file, source, or artifact for that.' },
  { label: 'Take over screen', prompt: 'Take over the screen and do the next safe step yourself.' },
  { label: 'Send to phone', prompt: 'Package the useful part of this and send it to my phone or companion context if available.' }
]

function voiceCaption(state: string): string {
  switch (state) {
    case 'connecting':
      return 'Connecting…'
    case 'listening':
      return 'Listening'
    case 'thinking':
      return 'Thinking'
    case 'speaking':
      return 'Speaking'
    default:
      return 'Voice idle'
  }
}

function normalizeMediaType(raw: string): ChatImageMediaType | null {
  const t = raw.toLowerCase().split(';')[0]!.trim()
  if (t === 'image/jpg') return 'image/jpeg'
  if (t === 'image/png' || t === 'image/jpeg' || t === 'image/gif' || t === 'image/webp') {
    return t
  }
  return null
}

function fileToDraft(file: File): Promise<DraftImage | null> {
  return new Promise((resolve) => {
    const named = /\.(png|jpe?g|gif|webp)$/i.exec(file.name || '')
    const mediaType =
      normalizeMediaType(file.type) ||
      (named?.[1] === 'jpg' || named?.[1] === 'jpeg'
        ? 'image/jpeg'
        : named?.[1] === 'gif'
          ? 'image/gif'
          : named?.[1] === 'webp'
            ? 'image/webp'
            : named
              ? 'image/png'
              : null)
    if (!mediaType) {
      resolve(null)
      return
    }
    if (file.size > MAX_BYTES) {
      resolve(null)
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const m = /^data:([^;]+);base64,(.+)$/s.exec(result)
      if (!m) {
        resolve(null)
        return
      }
      resolve({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        mediaType,
        data: m[2]!,
        previewUrl: result
      })
    }
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

function filesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return []
  const files: File[] = []
  const seen = new Set<string>()
  const push = (file: File | null): void => {
    if (!file) return
    const key = `${file.name}:${file.size}:${file.type}`
    if (seen.has(key)) return
    seen.add(key)
    files.push(file)
  }
  for (const file of Array.from(data.files || [])) push(file)
  for (const item of Array.from(data.items || [])) {
    if (item.kind === 'file' && (item.type.startsWith('image/') || item.type === '' || item.type === 'image/tiff')) {
      push(item.getAsFile())
    }
  }
  return files.filter(
    (file) =>
      file.type.startsWith('image/') ||
      file.type === '' ||
      /\.(png|jpe?g|gif|webp|tiff?|heic)$/i.test(file.name)
  )
}

function MessageImages({ images }: { images: ChatImageRef[] }): React.JSX.Element {
  const [urls, setUrls] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const img of images) {
      if (img.dataUrl) init[img.id] = img.dataUrl
    }
    return init
  })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      for (const img of images) {
        if (img.dataUrl || urls[img.id]) continue
        const dataUrl = await window.albert.getChatImageDataUrl(img.fileName)
        if (!cancelled && dataUrl) {
          setUrls((prev) => ({ ...prev, [img.id]: dataUrl }))
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per image set
  }, [images])

  return (
    <div className="msg-images">
      {images.map((img, index) => {
        const src = urls[img.id] || img.dataUrl
        return src ? (
          <a key={img.id} href={src} target="_blank" rel="noreferrer" className="msg-image-link">
            <img
              src={src}
              alt={`Conversation attachment ${index + 1}`}
              className="msg-image"
            />
          </a>
        ) : (
          <div key={img.id} className="msg-image placeholder">
            Image
          </div>
        )
      })}
    </div>
  )
}

export function ConversationPanel({ onTalk, onStandby }: Props): React.JSX.Element {
  const messages = useAlbertStore((s) => s.messages)
  const streamingText = useAlbertStore((s) => s.streamingText)
  const busy = useAlbertStore((s) => s.busy)
  const error = useAlbertStore((s) => s.error)
  const voiceState = useAlbertStore((s) => s.voiceState)
  const voiceStatus = useAlbertStore((s) => s.voiceStatus)
  const routeInfo = useAlbertStore((s) => s.routeInfo)
  const codexPlan = useAlbertStore((s) => s.codexPlan)
  const codexProgress = useAlbertStore((s) => s.codexProgress)
  const codexDiff = useAlbertStore((s) => s.codexDiff)
  const setBusy = useAlbertStore((s) => s.setBusy)
  const setError = useAlbertStore((s) => s.setError)
  const setMessages = useAlbertStore((s) => s.setMessages)
  const appendMessage = useAlbertStore((s) => s.appendMessage)
  const setVoiceStatus = useAlbertStore((s) => s.setVoiceStatus)
  const [draft, setDraft] = useState('')
  const [draftImages, setDraftImages] = useState<DraftImage[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [purgeArmed, setPurgeArmed] = useState(false)
  const [purging, setPurging] = useState(false)
  const [followOutput, setFollowOutput] = useState(true)
  const [composerHeight, setComposerHeight] = useState(80)
  const [orbParked, setOrbParked] = useState(true)
  const [roam, setRoam] = useState(true)
  const messagesRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLFormElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const dockRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const purgeTimerRef = useRef(0)
  const scrollFrameRef = useRef(0)

  const voiceLive = voiceState !== 'idle'
  const voiceLabel = voiceCaption(voiceState)
  const standbyDraft =
    draft.trim().length > 0 && draftImages.length === 0 && isEndVoiceCommand(draft)
  const canSend =
    (draft.trim().length > 0 || draftImages.length > 0) &&
    !busy &&
    (!voiceLive || standbyDraft)

  function dockSlot(park: boolean): { x: number; y: number; width: number; height: number; park: boolean } | undefined {
    const node = dockRef.current
    if (!node) return undefined
    const r = node.getBoundingClientRect()
    if (r.width < 80 || r.height < 80) return undefined
    return { x: r.x, y: r.y, width: r.width, height: r.height, park }
  }

  function parkOrb(): void {
    const slot = dockSlot(true)
    setOrbParked(true)
    void window.albert.dockHud(slot)
  }

  function undockOrb(): void {
    setOrbParked(false)
    void window.albert.undockHud()
  }

  useEffect(() => {
    setOrbParked(false)
    void window.albert.undockHud()
    void window.albert
      .getHudSnapshot()
      .then((snap) => {
        setRoam(snap.roam !== false)
      })
      .catch(() => undefined)
    const node = dockRef.current
    if (!node) return
    const remember = (): void => {
      const slot = dockSlot(false)
      if (slot) void window.albert.dockHud(slot)
    }
    const observer = new ResizeObserver(remember)
    observer.observe(node)
    window.addEventListener('resize', remember)
    const off = window.albert.onChatEvent((event) => {
      if (event.type === 'hud_docked') setOrbParked(event.docked !== false)
    })
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', remember)
      off()
      void window.albert.undockHud()
    }
  }, [])

  useEffect(() => {
    if (!followOutput) return
    window.cancelAnimationFrame(scrollFrameRef.current)
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      const node = messagesRef.current
      if (node) node.scrollTop = node.scrollHeight
    })
    return () => window.cancelAnimationFrame(scrollFrameRef.current)
  }, [messages, streamingText, followOutput])

  useEffect(() => {
    return () => {
      window.clearTimeout(purgeTimerRef.current)
      window.cancelAnimationFrame(scrollFrameRef.current)
    }
  }, [])

  useEffect(() => {
    const node = composerRef.current
    if (!node) return
    const update = (): void => setComposerHeight(Math.ceil(node.getBoundingClientRect().height))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!purgeArmed || (!busy && !voiceLive)) return
    window.clearTimeout(purgeTimerRef.current)
    setPurgeArmed(false)
  }, [busy, purgeArmed, voiceLive])

  useEffect(() => {
    return () => {
      for (const img of draftImages) {
        if (img.previewUrl.startsWith('blob:')) URL.revokeObjectURL(img.previewUrl)
      }
    }
  }, [draftImages])

  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea') && !target.closest('.panel-comm')) return
      void ingestPaste(event)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  async function addFiles(files: FileList | File[]): Promise<number> {
    if (busy || voiceLive) return 0
    const list = Array.from(files)
    const next: DraftImage[] = [...draftImages]
    for (const file of list) {
      if (next.length >= MAX_ATTACH) break
      if (!file.type.startsWith('image/') && !/\.(png|jpe?g|gif|webp)$/i.test(file.name)) continue
      const draftImg = await fileToDraft(file)
      if (draftImg) next.push(draftImg)
    }
    if (next.length === draftImages.length && list.some((f) => f.type.startsWith('image/'))) {
      setError('Couldn’t attach that image (use PNG/JPEG/GIF/WebP under ~4.5MB, max 4).')
    }
    const current = useAlbertStore.getState()
    if (current.busy || current.voiceState !== 'idle') return 0
    setDraftImages(next.slice(0, MAX_ATTACH))
    return Math.max(0, next.length - draftImages.length)
  }

  async function addClipboardFallback(): Promise<boolean> {
    const clip = await window.albert.readClipboardImage()
    if (!clip) return false
    const current = useAlbertStore.getState()
    if (current.busy || current.voiceState !== 'idle') return false
    setDraftImages((prev) => {
      if (prev.length >= MAX_ATTACH) return prev
      return [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          mediaType: clip.mediaType,
          data: clip.data,
          previewUrl: `data:${clip.mediaType};base64,${clip.data}`
        }
      ].slice(0, MAX_ATTACH)
    })
    return true
  }

  async function ingestPaste(event: React.ClipboardEvent | ClipboardEvent): Promise<void> {
    if (event.defaultPrevented || busy || voiceLive) return
    const data = 'clipboardData' in event ? event.clipboardData : null
    const files = filesFromClipboard(data)
    if (files.length) {
      event.preventDefault()
      if (await addFiles(files)) return
      if (await addClipboardFallback()) return
      setError('Couldn’t attach that image (use PNG/JPEG/GIF/WebP under ~4.5MB, max 4).')
      return
    }
    const types = Array.from(data?.types || [])
    const looksLikeImage = types.some(
      (type) =>
        type.startsWith('image/') ||
        /png|jpe?g|gif|webp|tiff/i.test(type) ||
        type === 'Files'
    )
    if (!looksLikeImage) return
    event.preventDefault()
    const attached = await addClipboardFallback()
    if (!attached) setError('Couldn’t read that clipboard image. Try PNG/JPEG/GIF/WebP under ~4.5MB.')
  }

  function removeDraftImage(id: string): void {
    setDraftImages((prev) => prev.filter((img) => img.id !== id))
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    const text = draft.trim()
    if ((!text && !draftImages.length) || busy) return

    const isStandby = Boolean(text && draftImages.length === 0 && isEndVoiceCommand(text))
    // Composer stays locked during voice except for standby / take 5
    if (voiceLive && !isStandby) return

    const images: ChatImagePayload[] = draftImages.map(({ mediaType, data }) => ({
      mediaType,
      data
    }))
    setDraft('')
    setDraftImages([])
    setFollowOutput(true)
    setError(null)

    // Standby / take 5 — app layer, not the brain roleplaying sleep
    if (isStandby && text) {
      const now = Date.now()
      appendMessage({
        id: `user-standby-${now}`,
        role: 'user',
        content: text,
        createdAt: now
      })
      try {
        // Always end voice if live; never let the brain roleplay standby.
        if (onStandby) await onStandby()
        appendMessage({
          id: `asst-standby-${now}`,
          role: 'assistant',
          content: voiceLive
            ? 'Standing by, sir.'
            : 'Standing by, sir. Say “Albert, wake up” when you need me.',
          createdAt: Date.now()
        })
        setVoiceStatus('Standby — wake armed when enabled')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
      return
    }

    setBusy(true)
    try {
      await window.albert.sendChat(images.length ? { text, images } : text)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function clearChat(): Promise<void> {
    if (purging || busy || voiceLive) return
    if (!purgeArmed) {
      setPurgeArmed(true)
      window.clearTimeout(purgeTimerRef.current)
      purgeTimerRef.current = window.setTimeout(() => setPurgeArmed(false), 4_000)
      return
    }
    window.clearTimeout(purgeTimerRef.current)
    setPurging(true)
    try {
      await window.albert.clearChat()
      setMessages([])
      setFollowOutput(true)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPurgeArmed(false)
      setPurging(false)
    }
  }

  async function stageVoiceCommand(prompt: string): Promise<void> {
    setError(null)
    setBusy(true)
    try {
      await window.albert.sendChat(prompt)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className={`panel panel-comm ${dragOver ? 'is-drop-target' : ''} ${busy ? 'is-busy' : ''}`}
      aria-labelledby="comm-link-title"
      onPaste={(e) => void ingestPaste(e)}
      onDragOver={(e) => {
        e.preventDefault()
        if (!busy && !voiceLive && Array.from(e.dataTransfer.types).includes('Files')) setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        if (!busy && !voiceLive && e.dataTransfer.files?.length) {
          void addFiles(e.dataTransfer.files)
        }
      }}
    >
      <header className="comm-header">
        <div>
          <h2 className="section-title" id="comm-link-title">
            Comm Link
          </h2>
          <p className="section-sub">
            Text, images, or voice. {APP_NAME} retains context and can act on your Mac.
          </p>
        </div>
        <div className="comm-header-actions">
          <button
            type="button"
            className={`btn ghost comm-talk ${voiceLive ? 'live' : ''}`}
            onClick={onTalk}
            aria-pressed={voiceLive}
            aria-label={voiceLive ? 'End voice session' : 'Engage voice session'}
          >
            {voiceLive ? 'End voice' : 'Talk'}
          </button>
          <button
            className={`btn ghost comm-purge ${purgeArmed ? 'armed' : ''}`}
            type="button"
            onClick={() => void clearChat()}
            disabled={busy || voiceLive || purging || (messages.length === 0 && !streamingText)}
            aria-busy={purging}
            aria-label={purgeArmed ? 'Confirm clearing conversation history' : 'Clear conversation history'}
            title={purgeArmed ? 'Click again within four seconds to confirm' : 'Clear conversation history'}
          >
            {purging ? 'Purging…' : purgeArmed ? 'Confirm purge' : 'Purge'}
          </button>
        </div>
        <span className="sr-only" role="status" aria-live="assertive" aria-atomic="true">
          {purgeArmed ? 'Purge armed. Activate Confirm purge within four seconds.' : ''}
        </span>
      </header>

      {error ? (
        <div className="error-banner" role="alert">
          <div>{error}</div>
          <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <div ref={stageRef} className="comm-stage">
        <div className="comm-chat">
          {(voiceStatus || routeInfo) && (
            <div className="comm-meta" aria-label="Connection details">
              {routeInfo ? (
                <span>
                  <b>Last route</b>
                  <span>{routeInfo}</span>
                </span>
              ) : null}
              {voiceStatus ? (
                <span>
                  <b>Voice</b>
                  <span>{voiceStatus}</span>
                </span>
              ) : null}
            </div>
          )}

          {codexPlan.length || codexProgress || codexDiff ? (
            <div className="comm-meta" aria-label="Codex progress" aria-live="polite">
              {codexProgress ? (
                <span>
                  <b>Codex</b>
                  <span>{codexProgress.replace(/\s+/g, ' ').slice(0, 220)}</span>
                </span>
              ) : null}
              {codexPlan.length ? (
                <span>
                  <b>Plan</b>
                  <span>
                    {codexPlan
                      .map(
                        (step) =>
                          `${/completed|done/i.test(step.status) ? '✓' : /in_?progress/i.test(step.status) ? '▸' : '·'} ${step.step}`
                      )
                      .join('  ')
                      .slice(0, 300)}
                  </span>
                </span>
              ) : null}
              {codexDiff ? (
                <span>
                  <b>Diff</b>
                  <span>{`${codexDiff.split('\n').filter((l) => /^[+-][^+-]/.test(l)).length} changed lines`}</span>
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="voice-stack" aria-label="Voice interruption stack">
            <div className="voice-stack-status">
              <span>Voice stack</span>
              <strong>{voiceLabel}</strong>
            </div>
            {voiceStackCommands.map((command) => (
              <button
                key={command.label}
                type="button"
                onClick={() => void stageVoiceCommand(command.prompt)}
              >
                {command.label}
              </button>
            ))}
          </div>

          <div
            ref={messagesRef}
            className="messages"
            role="log"
            aria-label="Conversation transcript"
            aria-live="polite"
            aria-relevant="additions"
            aria-busy={busy || voiceState === 'thinking' || voiceState === 'speaking'}
            tabIndex={0}
            onScroll={() => {
              const node = messagesRef.current
              if (!node) return
              const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 72
              setFollowOutput(nearBottom)
            }}
          >
            {messages.length === 0 && !streamingText ? (
              <div className="empty">
                Channel open — type, paste or drop an image, or engage voice. Ask anything; he can search
                the web when facts need a live check.
              </div>
            ) : null}
            {messages
              .filter((m) => m.role !== 'system')
              .map((m) => (
                <article
                  key={m.id}
                  className={`msg ${m.role}`}
                  aria-label={`${m.role === 'assistant' ? APP_NAME : m.role === 'tool' ? 'Tool' : 'You'} message`}
                >
                  <div className="role">
                    {m.role === 'assistant'
                      ? APP_NAME
                      : m.role === 'tool'
                        ? `Tool · ${m.toolName || 'action'}`
                        : 'You'}
                  </div>
                  {m.images?.length ? <MessageImages images={m.images} /> : null}
                  {m.content && m.content !== '(image)' && !/^\(\d+ images\)$/.test(m.content) ? (
                    <div className="body">{m.content}</div>
                  ) : m.images?.length ? null : (
                    <div className="body">{m.content}</div>
                  )}
                </article>
              ))}
            {streamingText ? (
              <article
                className="msg assistant streaming"
                aria-label={`${APP_NAME} response in progress`}
              >
                <div className="role">{APP_NAME}</div>
                <div className="body">{streamingText}</div>
              </article>
            ) : null}
            <div ref={bottomRef} aria-hidden="true" />
          </div>

          {!followOutput && (messages.length > 0 || Boolean(streamingText)) ? (
            <button
              type="button"
              className="comm-jump-latest"
              style={{ bottom: composerHeight + 18 }}
              onClick={() => {
                const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
                const node = messagesRef.current
                if (reducedMotion) setFollowOutput(true)
                node?.scrollTo({
                  top: node.scrollHeight,
                  behavior: reducedMotion ? 'auto' : 'smooth'
                })
              }}
            >
              Jump to latest ↓
            </button>
          ) : null}

          <form
            ref={composerRef}
            className={`composer ${dragOver ? 'drag-over' : ''}`}
            aria-label="Message composer"
            onSubmit={(e) => void onSubmit(e)}
          >
            {draftImages.length > 0 ? (
              <div className="composer-previews">
                {draftImages.map((img, index) => (
                  <div key={img.id} className="composer-preview">
                    <img src={img.previewUrl} alt={`Pending attachment ${index + 1}`} />
                    <button
                      type="button"
                      className="composer-preview-remove"
                      aria-label={`Remove attachment ${index + 1}`}
                      onClick={() => removeDraftImage(img.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="composer-row">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                multiple
                hidden
                onChange={(e) => {
                  if (!busy && !voiceLive && e.target.files?.length) void addFiles(e.target.files)
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                className="btn ghost composer-attach"
                title="Attach or paste an image"
                aria-label="Attach images"
                disabled={busy || voiceLive || draftImages.length >= MAX_ATTACH}
                onClick={() => fileInputRef.current?.click()}
              >
                Image
              </button>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={
                  voiceLive
                    ? 'Voice engaged — end voice to type…'
                    : `Message ${APP_NAME}… (paste or drop images)`
                }
                disabled={voiceLive}
                aria-label={`Message ${APP_NAME}`}
                aria-describedby="comm-composer-hint"
                rows={2}
                onPaste={(e) => void ingestPaste(e)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void onSubmit(e)
                  }
                }}
              />
              <span id="comm-composer-hint" className="sr-only">
                {voiceLive
                  ? 'Voice is engaged. Use End voice before typing a message.'
                  : 'Press Enter to send or Shift Enter for a new line. Paste or drop up to four images.'}
              </span>
              <button
                className="btn primary"
                type="submit"
                disabled={!canSend}
                aria-label={busy ? `${APP_NAME} is responding` : 'Send message'}
              >
                {busy ? 'Working…' : 'Send'}
              </button>
            </div>
          </form>
        </div>

        {dragOver ? (
          <div className="comm-drop-hint" aria-hidden="true">
            Drop image to attach
          </div>
        ) : null}
        <aside className="orb-dock" aria-label="A.L.B.E.R.T. orb dock">
          <div className="orb-dock__header">
            <span>Orb dock</span>
            <b>{voiceLabel}</b>
          </div>
          <div className="orb-dock__controls">
            <button
              type="button"
              className={`speech-orb__talk ${voiceLive ? 'live' : ''}`}
              onClick={() => onTalk()}
              aria-pressed={voiceLive}
              aria-label={voiceLive ? 'End voice session' : 'Engage voice session'}
            >
              {voiceLive ? 'End' : 'Talk'}
            </button>
            <button
              type="button"
              className={`speech-orb__pin ${roam ? '' : 'pinned'}`}
              onClick={() => {
                const next = !roam
                setRoam(next)
                void window.albert.setHudRoam(next)
              }}
              aria-pressed={!roam}
            >
              {roam ? 'Pin' : 'Unpin'}
            </button>
          </div>
          <div
            ref={dockRef}
            className={`orb-dock__berth${orbParked ? '' : ' is-empty'}`}
            onPointerDown={orbParked ? undockOrb : undefined}
            role={orbParked ? 'button' : undefined}
            tabIndex={orbParked ? 0 : -1}
            aria-label={orbParked ? 'Undock and move the orb' : undefined}
            title={orbParked ? 'Press to release the orb, then drag it from the dock' : undefined}
          >
            {orbParked ? (
              <AlbertCore
                state={voiceState}
                variant="orb"
                label={`Orb dock, ${voiceLabel.toLowerCase()}`}
              />
            ) : null}
          </div>
          <button type="button" className="orb-dock__button" onClick={() => parkOrb()}>
            Return orb
          </button>
        </aside>
      </div>
    </section>
  )
}
