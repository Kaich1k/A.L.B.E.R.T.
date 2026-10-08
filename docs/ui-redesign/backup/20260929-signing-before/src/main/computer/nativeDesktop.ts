import { app, desktopCapturer, systemPreferences } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { NativeDesktopClient } from './nativeTransport'
import { automationSignal } from './automation'
import { currentTurnScope } from '../agent/turnControl'
import { sameDesktopBounds, type DesktopBounds } from '../../shared/desktopGeometry'
import type { ToolResult } from '../tools/types'

export function desktopHelperPath(): string {
  if (process.platform !== 'darwin') throw new Error('Native desktop control currently requires macOS.')
  const file = app.isPackaged
    ? join(process.resourcesPath, 'albert-desktop-helper')
    : join(app.getAppPath(), 'resources', 'albert-desktop-helper')
  if (!existsSync(file)) throw new Error('Desktop helper missing. Rebuild ALBERT to install native window control.')
  return file
}

const client = new NativeDesktopClient(desktopHelperPath)
let shutdownBound = false

export function desktopRequest(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!shutdownBound) { shutdownBound = true; app.once('before-quit', () => client.dispose()) }
  const turn = currentTurnScope()?.signal
  const signal = turn ? AbortSignal.any([turn, automationSignal()]) : automationSignal()
  return client.request(payload, signal)
}

export async function desktopPermissions(): Promise<Record<string, unknown>> {
  let controller: Record<string, unknown>
  try { controller = await desktopRequest({ op: 'permissions' }) }
  catch (error) { controller = { accessibility: false, screenRecording: false, error: error instanceof Error ? error.message : String(error) } }
  const host = {
    accessibility: systemPreferences.isTrustedAccessibilityClient(false),
    screenRecording: systemPreferences.getMediaAccessStatus('screen') === 'granted'
  }
  return {
    accessibility: controller.accessibility === true,
    screenRecording: controller.screenRecording === true && host.screenRecording,
    host, controller,
    setup: controller.error
      ? `Desktop controller unavailable: ${String(controller.error)}. Restart or rebuild ALBERT before checking permissions again.`
      : controller.accessibility !== true || controller.screenRecording !== true || !host.screenRecording
      ? 'Open ALBERT → Systems. If ALBERT is already enabled, add the desktop controller to the missing Privacy & Security categories, then restart ALBERT. Use Reveal desktop controller to locate it.'
      : 'Desktop controller permissions are granted.'
  }
}

export async function desktopWindowScreenshot(snapshotId: string): Promise<ToolResult> {
  if (systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
    throw new Error('Screen Recording is not granted. Enable ALBERT in System Settings → Privacy & Security → Screen Recording, then retry.')
  }
  const before = await desktopRequest({ op: 'validate_snapshot', snapshotId })
  const windowNumber = Number(before.captureWindowId)
  if (!Number.isInteger(windowNumber) || windowNumber <= 0) throw new Error('This window could not be matched unambiguously for a screenshot. Use its accessible controls instead.')
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1600, height: 1200 }, fetchWindowIcons: false })
  const source = sources.find((entry) => Number(entry.id.split(':')[1]) === windowNumber)
  if (!source || source.thumbnail.isEmpty()) throw new Error('Window capture is unavailable. Re-inspect the window or check Screen Recording permission.')
  const after = await desktopRequest({ op: 'validate_snapshot', snapshotId })
  if (after.captureWindowId !== before.captureWindowId || !sameDesktopBounds(before.bounds as unknown as DesktopBounds, after.bounds as unknown as DesktopBounds)) {
    throw new Error('Window changed during capture. Inspect it again before aiming.')
  }
  const pixels = source.thumbnail.getSize()
  return {
    ok: true,
    result: JSON.stringify({ snapshotId, windowId: before.windowId, app: before.app, title: before.title,
      coordinateSpace: 'desktop-points', bounds: before.bounds, imagePixels: pixels,
      conversion: 'desktopX = bounds.x + imageX * bounds.width / imagePixels.width; same for Y. Refresh after each action.' }),
    image: { mediaType: 'image/png', data: source.thumbnail.toPNG().toString('base64') }
  }
}
