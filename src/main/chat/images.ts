import { mkdir, readFile, realpath, stat, writeFile } from 'fs/promises'
import { homedir, tmpdir } from 'os'
import { extname, isAbsolute, join, relative } from 'path'
import { v4 as uuid } from 'uuid'
import { getDataDir, getSettings } from '../config'
import type { ChatImageMediaType, ChatImagePayload, ChatImageRef } from '../../shared/types'

const MAX_IMAGES = 4
const MAX_BYTES = 4_500_000
const MAX_ARTIFACT_BYTES = 25_000_000

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

/**
 * Resolve an assistant-linked local artifact without giving rendered model text
 * arbitrary filesystem access. Symlinks are resolved before the allowlist
 * check, and only ordinary files under user-facing/project roots are admitted.
 */
export async function resolveAllowedLocalArtifactPath(rawPath: string): Promise<string | null> {
  const requested = String(rawPath || '').trim()
  if (!requested || !isAbsolute(requested)) return null

  let actual: string
  try {
    actual = await realpath(requested)
    if (!(await stat(actual)).isFile()) return null
  } catch {
    return null
  }

  const configuredProject = getSettings().projectFolder?.trim()
  const roots = [
    configuredProject,
    getDataDir(),
    join(homedir(), 'Documents'),
    join(homedir(), 'Desktop'),
    join(homedir(), 'Downloads'),
    tmpdir()
  ].filter((value): value is string => Boolean(value))

  for (const root of roots) {
    try {
      const allowedRoot = await realpath(root)
      const fromRoot = relative(allowedRoot, actual)
      if (fromRoot === '' || (!fromRoot.startsWith('..') && !isAbsolute(fromRoot))) return actual
    } catch {
      // Missing optional roots are harmless.
    }
  }
  return null
}

/** Load a safe local PNG/JPEG/GIF/WebP artifact for inline Comm Link display. */
export async function loadLocalArtifactImageData(filePath: string): Promise<string | null> {
  const actual = await resolveAllowedLocalArtifactPath(filePath)
  if (!actual) return null
  const mediaType: ChatImageMediaType | null =
    extname(actual).toLowerCase() === '.png'
      ? 'image/png'
      : /\.jpe?g$/i.test(actual)
        ? 'image/jpeg'
        : extname(actual).toLowerCase() === '.gif'
          ? 'image/gif'
          : extname(actual).toLowerCase() === '.webp'
            ? 'image/webp'
            : null
  if (!mediaType) return null
  try {
    const bytes = await readFile(actual)
    if (!bytes.length || bytes.length > MAX_ARTIFACT_BYTES) return null
    return `data:${mediaType};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}
