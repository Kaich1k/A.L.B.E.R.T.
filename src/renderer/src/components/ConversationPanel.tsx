import { FormEvent, useEffect, useRef, useState } from 'react'
import { APP_NAME } from '../../../shared/brand'
import type { ChatImageMediaType, ChatImagePayload, ChatImageRef } from '../../../shared/types'
import { useAlbertStore } from '../store'
import { isEndVoiceCommand } from '../voice/voiceCommands'

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
      {images.map((img) => {
        const src = urls[img.id] || img.dataUrl
        return src ? (
          <a key={img.id} href={src} target="_blank" rel="noreferrer" className="msg-image-link">
            <img src={src} alt="Attachment" className="msg-image" />
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
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const voiceLive = voiceState !== 'idle'
  const standbyDraft =
    draft.trim().length > 0 && draftImages.length === 0 && isEndVoiceCommand(draft)
  const canSend =
    (draft.trim().length > 0 || draftImages.length > 0) &&
    !busy &&
    (!voiceLive || standbyDraft)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  useEffect(() => {
    return () => {
      for (const img of draftImages) {
        if (img.previewUrl.startsWith('blob:')) URL.revokeObjectURL(img.previewUrl)
      }
    }
  }, [draftImages])

  async function addFiles(files: FileList | File[]): Promise<void> {
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
      // Always end voice if live; never let the brain roleplay standby
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
    await window.albert.clearChat()
    setMessages([])
  }

  return (
    <section className="panel panel-comm">
      <header className="comm-header">
        <div>
          <h2 className="section-title">Comm Link</h2>
          <p className="section-sub">
            Text, images, or voice. {APP_NAME} retains context and can act on your Mac.
          </p>
        </div>
        <button className="btn ghost" type="button" onClick={() => void clearChat()}>
          Purge
        </button>
      </header>

      {error ? (
        <div className="error-banner">
          <div>{error}</div>
          <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="comm-split">
        <div className="comm-chat">
          {(voiceStatus || routeInfo) && (
            <div className="comm-meta">
              {routeInfo ? <span>{routeInfo}</span> : null}
              {voiceStatus ? <span>{voiceStatus}</span> : null}
            </div>
          )}

          <div className="messages">
            {messages.length === 0 && !streamingText ? (
              <div className="empty">
                Channel open — type, attach an image, or engage voice. Ask anything; he can search
                the web when facts need a live check.
              </div>
            ) : null}
            {messages
              .filter((m) => m.role !== 'system')
              .map((m) => (
                <div key={m.id} className={`msg ${m.role}`}>
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
                </div>
              ))}
            {streamingText ? (
              <div className="msg assistant">
                <div className="role">{APP_NAME}</div>
                <div className="body">{streamingText}</div>
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>

          <form
            className={`composer ${dragOver ? 'drag-over' : ''}`}
            onSubmit={(e) => void onSubmit(e)}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files)
            }}
          >
            {draftImages.length > 0 ? (
              <div className="composer-previews">
                {draftImages.map((img) => (
                  <div key={img.id} className="composer-preview">
                    <img src={img.previewUrl} alt="" />
                    <button
                      type="button"
                      className="composer-preview-remove"
                      aria-label="Remove image"
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
                  if (e.target.files?.length) void addFiles(e.target.files)
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                className="btn ghost composer-attach"
                title="Attach image"
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
                rows={2}
                onPaste={(e) => {
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
              <button className="btn primary" type="submit" disabled={!canSend}>
                {busy ? '…' : 'Send'}
              </button>
            </div>
          </form>
        </div>

        <aside className={`comm-voice state-${voiceState}`}>
          <div className="voice-stage" aria-hidden>
            <div className="voice-blob core" />
            <div className="voice-blob mid" />
            <div className="voice-blob outer" />
            <div className="voice-ring" />
          </div>

          <div className="voice-caption">
            <span className={`status-dot ${voiceLive ? voiceState : ''}`} />
            {voiceCaption(voiceState)}
          </div>

          <button
            type="button"
            className={`voice-toggle ${voiceLive ? 'live' : 'idle'}`}
            onClick={onTalk}
            aria-pressed={voiceLive}
          >
            <span className="voice-toggle-track">
              <span className="voice-toggle-label idle-label">Engage voice</span>
              <span className="voice-toggle-label live-label">End voice</span>
            </span>
          </button>
        </aside>
      </div>
    </section>
  )
}
