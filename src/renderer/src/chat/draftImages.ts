import type { ChatImageMediaType, ChatImagePayload } from '../../../shared/types'

export type DraftImage = {
  id: string
  mediaType: ChatImageMediaType
  data: string
  previewUrl: string
}

export const MAX_ATTACH = 4
export const MAX_BYTES = 4_500_000

export function normalizeMediaType(raw: string): ChatImageMediaType | null {
  const t = raw.toLowerCase().split(';')[0]!.trim()
  if (t === 'image/jpg') return 'image/jpeg'
  if (t === 'image/png' || t === 'image/jpeg' || t === 'image/gif' || t === 'image/webp') return t
  return null
}

export function fileToDraft(file: File): Promise<DraftImage | null> {
  return new Promise((resolve) => {
    const mediaType = mediaTypeForFile(file)
    if (!mediaType || file.size > MAX_BYTES) {
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

export function filesFromClipboard(data: DataTransfer | null): File[] {
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

export function clipboardLooksLikeImage(data: DataTransfer | null): boolean {
  return Array.from(data?.types || []).some(
    (type) =>
      type.startsWith('image/') ||
      /png|jpe?g|gif|webp|tiff/i.test(type) ||
      type === 'Files'
  )
}

export function payloadToDraft(clip: ChatImagePayload): DraftImage {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    mediaType: clip.mediaType,
    data: clip.data,
    previewUrl: `data:${clip.mediaType};base64,${clip.data}`
  }
}

export function mediaTypeForFile(file: { name?: string; type?: string }): ChatImageMediaType | null {
  const named = /\.(png|jpe?g|gif|webp)$/i.exec(file.name || '')
  return (
    normalizeMediaType(file.type || '') ||
    (named?.[1] === 'jpg' || named?.[1] === 'jpeg'
      ? 'image/jpeg'
      : named?.[1] === 'gif'
        ? 'image/gif'
        : named?.[1] === 'webp'
          ? 'image/webp'
          : named
            ? 'image/png'
            : null)
  )
}

export function fileIsAttachable(file: { name?: string; type?: string; size?: number }): boolean {
  return Boolean(mediaTypeForFile(file) && (file.size ?? 0) <= MAX_BYTES)
}

/** After reading files, fall back to native clipboard if nothing was accepted. */
export function pasteNeedsNativeFallback(foundFiles: number, accepted: number, looksLikeImage: boolean): boolean {
  if (accepted > 0) return false
  return foundFiles > 0 || looksLikeImage
}

export type DraftCache = { text: string; images: DraftImage[]; rev: number }

let draftCache: DraftCache = { text: '', images: [], rev: 0 }

export function getDraftCache(): DraftCache {
  return draftCache
}

export function writeDraftCache(text: string, images: DraftImage[]): number {
  draftCache = { text, images: images.slice(0, MAX_ATTACH), rev: draftCache.rev + 1 }
  return draftCache.rev
}

/** Keep current attachments; replace text. Never call from a React updater. */
export function setDraftText(text: string): DraftCache {
  writeDraftCache(text, draftCache.images)
  return draftCache
}

/** Merge new attachments onto the latest cached text. Never call from a React updater. */
export function mergeDraftImages(incoming: DraftImage[]): DraftCache {
  if (!incoming.length) return draftCache
  const kept = [...draftCache.images, ...incoming].slice(0, MAX_ATTACH)
  writeDraftCache(draftCache.text, kept)
  return draftCache
}

/** Drop one draft attachment by id; leave text and other images alone. */
export function removeDraftImage(id: string): DraftCache {
  const want = id.trim()
  if (!want) return draftCache
  const kept = draftCache.images.filter((image) => image.id !== want)
  if (kept.length === draftCache.images.length) return draftCache
  writeDraftCache(draftCache.text, kept)
  return draftCache
}

/** Pure helper for UI state that is not using the draft cache. */
export function withoutDraftImage(images: DraftImage[], id: string): DraftImage[] {
  const want = id.trim()
  if (!want) return images
  return images.filter((image) => image.id !== want)
}

export function resetDraftCache(): DraftCache {
  draftCache = { text: '', images: [], rev: 0 }
  return draftCache
}
