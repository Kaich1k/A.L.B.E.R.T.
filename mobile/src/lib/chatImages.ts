import { Alert } from 'react-native'
import { newId } from './id'
import type { ChatImageMediaType, ChatImagePayload, ChatImageRef, ChatMessage } from '../types'

export const MAX_CHAT_IMAGES = 4
/** Soft cap per image after picker compression (~Mac companion limit). */
export const MAX_IMAGE_BYTES = 4_500_000

type ImagePickerModule = typeof import('expo-image-picker')
type ImagePickerAsset = {
  mimeType?: string | null
  base64?: string | null
}

const PICKER_OPTS = {
  mediaTypes: ['images'] as const,
  allowsMultipleSelection: true,
  selectionLimit: MAX_CHAT_IMAGES,
  quality: 0.72,
  base64: true
}

function isMissingNativeModule(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /ExponentImagePicker|Cannot find native module/i.test(message)
}

function rebuildRequiredAlert(): void {
  Alert.alert(
    'Rebuild required for photos',
    'Image attach needs a new native build (expo-image-picker). From mobile/: run npx expo run:ios, or an EAS development build, then reinstall that app.'
  )
}

/** Lazy-load so an old binary without the native module still boots Comm. */
async function loadImagePicker(): Promise<ImagePickerModule | null> {
  try {
    return await import('expo-image-picker')
  } catch (error) {
    if (isMissingNativeModule(error)) {
      rebuildRequiredAlert()
      return null
    }
    throw error
  }
}

function mediaTypeFromAsset(asset: ImagePickerAsset): ChatImageMediaType {
  const mime = (asset.mimeType || '').toLowerCase()
  if (mime === 'image/png' || mime === 'image/gif' || mime === 'image/webp') return mime
  // Picker base64 is typically JPEG after quality compression.
  return 'image/jpeg'
}

function approxBytesFromBase64(data: string): number {
  return Math.floor((data.length * 3) / 4)
}

export function chatImagePlaceholder(count: number): string {
  return count === 1 ? '(image)' : `(${count} images)`
}

export function draftImagesToRefs(images: ChatImagePayload[]): ChatImageRef[] {
  return images.slice(0, MAX_CHAT_IMAGES).map((img, index) => ({
    id: `img_${newId()}`,
    mediaType: img.mediaType,
    fileName: `phone_${Date.now()}_${index}.${img.mediaType.split('/')[1] || 'jpg'}`,
    dataUrl: `data:${img.mediaType};base64,${img.data}`
  }))
}

export function refsToPayloads(images: ChatImageRef[] | undefined): ChatImagePayload[] {
  if (!images?.length) return []
  const out: ChatImagePayload[] = []
  for (const img of images.slice(0, MAX_CHAT_IMAGES)) {
    if (!img.dataUrl) continue
    const match = img.dataUrl.match(/^data:([^;]+);base64,(.+)$/s)
    if (!match) continue
    const mediaType = mediaTypeFromMime(match[1]!)
    out.push({ mediaType, data: match[2]! })
  }
  return out
}

function mediaTypeFromMime(raw: string): ChatImageMediaType {
  const mime = raw.toLowerCase().trim()
  if (mime === 'image/png' || mime === 'image/gif' || mime === 'image/webp' || mime === 'image/jpeg') {
    return mime
  }
  return 'image/jpeg'
}

function assetsToPayloads(assets: ImagePickerAsset[]): ChatImagePayload[] {
  const out: ChatImagePayload[] = []
  for (const asset of assets) {
    const data = asset.base64?.trim()
    if (!data) continue
    if (approxBytesFromBase64(data) > MAX_IMAGE_BYTES) {
      Alert.alert('Image too large', 'Pick a smaller photo (under ~4.5 MB after compression).')
      continue
    }
    out.push({ mediaType: mediaTypeFromAsset(asset), data })
  }
  return out
}

async function ensureLibraryPermission(ImagePicker: ImagePickerModule): Promise<boolean> {
  const current = await ImagePicker.getMediaLibraryPermissionsAsync()
  if (current.granted) return true
  const next = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!next.granted) {
    Alert.alert(
      'Photos access needed',
      'Allow photo library access in Settings so you can attach images for Albert.'
    )
    return false
  }
  return true
}

async function ensureCameraPermission(ImagePicker: ImagePickerModule): Promise<boolean> {
  const current = await ImagePicker.getCameraPermissionsAsync()
  if (current.granted) return true
  const next = await ImagePicker.requestCameraPermissionsAsync()
  if (!next.granted) {
    Alert.alert(
      'Camera access needed',
      'Allow camera access in Settings so you can send a photo to Albert.'
    )
    return false
  }
  return true
}

/** Library / camera → compressed base64 payloads. */
export async function pickChatImages(source: 'library' | 'camera'): Promise<ChatImagePayload[]> {
  const ImagePicker = await loadImagePicker()
  if (!ImagePicker) return []

  try {
    if (source === 'camera') {
      if (!(await ensureCameraPermission(ImagePicker))) return []
      const result = await ImagePicker.launchCameraAsync({
        ...PICKER_OPTS,
        mediaTypes: ['images'],
        allowsMultipleSelection: false
      })
      if (result.canceled || !result.assets?.length) return []
      return assetsToPayloads(result.assets)
    }

    if (!(await ensureLibraryPermission(ImagePicker))) return []
    const result = await ImagePicker.launchImageLibraryAsync({
      ...PICKER_OPTS,
      mediaTypes: ['images']
    })
    if (result.canceled || !result.assets?.length) return []
    return assetsToPayloads(result.assets)
  } catch (error) {
    if (isMissingNativeModule(error)) {
      rebuildRequiredAlert()
      return []
    }
    throw error
  }
}

export function promptAttachSource(onPick: (source: 'library' | 'camera') => void): void {
  Alert.alert('Attach image', 'Send a photo for Albert to look at.', [
    { text: 'Photo library', onPress: () => onPick('library') },
    { text: 'Camera', onPress: () => onPick('camera') },
    { text: 'Cancel', style: 'cancel' }
  ])
}

/** Drop bulky dataUrls from older turns so AsyncStorage stays sane. */
export function compactChatImagesForStorage(messages: ChatMessage[]): ChatMessage[] {
  let keepFull = 0
  const out: ChatMessage[] = []
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!
    if (!message.images?.length) {
      out.push(message)
      continue
    }
    if (keepFull < 3) {
      keepFull += 1
      out.push(message)
      continue
    }
    out.push({
      ...message,
      images: message.images.map(({ dataUrl: _drop, ...rest }) => rest)
    })
  }
  return out.reverse()
}
