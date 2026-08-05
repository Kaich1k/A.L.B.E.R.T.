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
    const mediaType = normalizeMediaType(file.type)
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
  const messagesRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLFormElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const purgeTimerRef = useRef(0)
  const scrollFrameRef = useRef(0)

  const voiceLive = voiceState !== 'idle'
  const voiceLabel = voiceCaption(voiceState)
  const micLabel =
    voiceState === 'listening'
      ? 'Open'
      : voiceState === 'speaking'
        ? 'Monitoring'
        : voiceState === 'connecting'
          ? 'Initializing'
          : voiceState === 'thinking'
            ? 'Processing'
            : 'Standby'
  const standbyDraft =
    draft.trim().length > 0 && draftImages.length === 0 && isEndVoiceCommand(draft)
  const canSend =
    (draft.trim().length > 0 || draftImages.length > 0) &&
    !busy &&
    (!voiceLive || standbyDraft)
  const voiceFault = /(?:^|·\s*)(?:Voice startup fault|Last turn fault|Voice output unavailable)\b/i.test(
    voiceStatus
  )

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

  async function addFiles(files: FileList | File[]): Promise<void> {
    if (busy || voiceLive) return
    const list = Array.from(files)
    const next: DraftImage[] = [...draftImages]
    for (const file of list) {
      if (next.length >= MAX_ATTACH) break
      if (!file.type.startsWith('image/')) continue
      const draftImg = await fileToDraft(file)
      if (draftImg) next.push(draftImg)
    }
    if (next.length === draftImages.length && list.some((f) => f.type.startsWith('image/'))) {
      setError('Couldn’t attach that image (use PNG/JPEG/GIF/WebP under ~4.5MB, max 4).')
    }
    const current = useAlbertStore.getState()
    if (current.busy || current.voiceState !== 'idle') return
    setDraftImages(next.slice(0, MAX_ATTACH))
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

  return (
    <section className="panel panel-comm" aria-labelledby="comm-link-title">
      <header className="comm-header">
        <div>
          <h2 className="section-title" id="comm-link-title">
            Comm Link
          </h2>
          <p className="section-sub">
            Text, images, or voice. {APP_NAME} retains context and can act on your Mac.
          </p>
        </div>
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

      <div className="comm-split">
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
                Channel open — type, attach an image, or engage voice. Ask anything; he can search
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
            onDragOver={(e) => {
              e.preventDefault()
              if (!busy && !voiceLive) setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              if (!busy && !voiceLive && e.dataTransfer.files?.length) {
                void addFiles(e.dataTransfer.files)
              }
            }}
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
                title="Attach image"
                aria-label="Attach images"
                disabled={busy || voiceLive || draftImages.length >= MAX_ATTACH}
                onClick={() => fileInputRef.current?.click()}
              >
                +
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
                onPaste={(e) => {
                  if (busy || voiceLive) return
                  const items = e.clipboardData?.items
                  if (!items) return
                  const files: File[] = []
                  for (const item of Array.from(items)) {
                    if (item.type.startsWith('image/')) {
                      const file = item.getAsFile()
                      if (file) files.push(file)
                    }
                  }
                  if (files.length) {
                    e.preventDefault()
                    void addFiles(files)
                  }
                }}
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
                  : 'Press Enter to send or Shift Enter for a new line. Up to four images may be attached.'}
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

        <aside
          className={`comm-voice state-${voiceState}`}
          aria-label="Voice link controls"
          aria-describedby="voice-link-caption"
        >
          <AlbertCore
            state={voiceState}
            variant="comm"
            fault={voiceFault}
            label={`Voice link ${voiceLabel.toLowerCase()}`}
          />

          <div className="voice-waveform" aria-hidden="true">
            {Array.from({ length: 19 }, (_, index) => (
              <i key={index} style={{ '--wave-index': index } as React.CSSProperties} />
            ))}
          </div>

          <div
            className="voice-caption"
            id="voice-link-caption"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <span className={`status-dot ${voiceLive ? voiceState : ''}`} aria-hidden="true" />
            {voiceLabel}
          </div>

          <button
            type="button"
            className={`voice-toggle ${voiceLive ? 'live' : 'idle'}`}
            onClick={onTalk}
            aria-pressed={voiceLive}
            aria-label={voiceLive ? 'End voice session' : 'Engage voice session'}
          >
            <span className="voice-toggle-track">
              <span className="voice-toggle-label idle-label">Engage voice</span>
              <span className="voice-toggle-label live-label">End voice</span>
            </span>
          </button>
          <div className="voice-diagnostics">
            <span>
              <b>Session</b> {voiceLive ? 'Active' : 'Standby'}
            </span>
            <span>
              <b>Input</b> {micLabel}
            </span>
            <span>
              <b>State</b> {voiceLabel}
            </span>
          </div>
        </aside>
      </div>
    </section>
  )
}
