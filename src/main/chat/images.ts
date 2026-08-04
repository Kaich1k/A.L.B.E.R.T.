import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { v4 as uuid } from 'uuid'
import { getDataDir } from '../config'
import type { ChatImageMediaType, ChatImagePayload, ChatImageRef } from '../../shared/types'

const MAX_IMAGES = 4
const MAX_BYTES = 4_500_000

const EXT: Record<ChatImageMediaType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
}

function chatImagesDir(): string {
  return join(getDataDir(), 'chat-images')
}

export function normalizeMediaType(raw: string): ChatImageMediaType | null {
  const t = raw.toLowerCase().split(';')[0]!.trim()
  if (t === 'image/jpg') return 'image/jpeg'
  if (t === 'image/png' || t === 'image/jpeg' || t === 'image/gif' || t === 'image/webp') {
    return t
  }
  return null
}

export async function persistChatImages(
  payloads: ChatImagePayload[] | undefined
): Promise<ChatImageRef[]> {
  if (!payloads?.length) return []
  const dir = chatImagesDir()
  await mkdir(dir, { recursive: true })

  const out: ChatImageRef[] = []
  for (const payload of payloads.slice(0, MAX_IMAGES)) {
    const mediaType = normalizeMediaType(payload.mediaType)
    if (!mediaType) continue
    const data = String(payload.data || '').replace(/\s/g, '')
    if (!data) continue
    const buf = Buffer.from(data, 'base64')
    if (!buf.length || buf.length > MAX_BYTES) continue

    const id = uuid()
    const fileName = `${id}.${EXT[mediaType]}`
    await writeFile(join(dir, fileName), buf)
    out.push({
      id,
      mediaType,
      fileName,
      dataUrl: `data:${mediaType};base64,${data}`
    })
  }
  return out
}

export async function loadChatImageData(
  fileName: string
): Promise<{ mediaType: ChatImageMediaType; data: string; dataUrl: string } | null> {
  const safe = fileName.replace(/[/\\]/g, '')
  if (!safe || safe !== fileName) return null
  const ext = safe.split('.').pop()?.toLowerCase()
  const mediaType: ChatImageMediaType =
    ext === 'jpg' || ext === 'jpeg'
      ? 'image/jpeg'
      : ext === 'gif'
        ? 'image/gif'
        : ext === 'webp'
          ? 'image/webp'
          : 'image/png'
  try {
    const buf = await readFile(join(chatImagesDir(), safe))
    if (buf.length > MAX_BYTES) return null
    const data = buf.toString('base64')
    return { mediaType, data, dataUrl: `data:${mediaType};base64,${data}` }
  } catch {
    return null
  }
}
