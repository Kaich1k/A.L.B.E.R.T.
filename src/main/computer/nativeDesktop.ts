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
    ? join(process.resourcesPath, '..', 'MacOS', 'albert-desktop-helper')
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

type ScreenGrant = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'

function hostScreenGrant(): ScreenGrant {
  try {
    const status = systemPreferences.getMediaAccessStatus('screen')
    return ['granted', 'denied', 'restricted', 'not-determined'].includes(status) ? status as ScreenGrant : 'unknown'
  } catch { return 'unknown' }
}

export async function desktopPermissions(): Promise<Record<string, unknown>> {
  let controller: Record<string, unknown>
  try { controller = await desktopRequest({ op: 'permissions' }) }
  catch (error) { controller = { error: error instanceof Error ? error.message : String(error) } }
  const screenRecordingStatus = hostScreenGrant()
  const host = {
    accessibility: systemPreferences.isTrustedAccessibilityClient(false),
    screenRecording: screenRecordingStatus === 'granted',
    screenRecordingStatus,
    processId: process.pid,
    executablePath: process.execPath,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    appName: app.getName(),
    packaged: app.isPackaged
  }
  return {
    accessibility: controller.accessibility === true,
    accessibilityStatus: typeof controller.accessibility === 'boolean'
      ? controller.accessibility ? 'granted' : 'denied' : 'unknown',
    // Electron captures the window. The helper's preflight is diagnostic only;
    // it does not capture pixels and need not have a separate screen grant.
    screenRecording: host.screenRecording,
    screenRecordingStatus,
    host, controller,
    setup: controller.error
      ? `Desktop controller unavailable: ${String(controller.error)}. Restart or rebuild ALBERT before checking permissions again.`
      : controller.accessibility !== true
      ? 'The desktop controller does not have verified Accessibility access. Use Request desktop control in ALBERT → Systems to register the running app, then recheck. If macOS shows an enabled older ALBERT copy, select the currently installed app.'
      : !host.screenRecording
      ? `ALBERT screen capture status is ${screenRecordingStatus}. Use Request Screen Recording in ALBERT → Systems, then follow the macOS prompt and restart if requested. Accessible window controls remain available.`
      : 'Desktop controller permissions are granted.'
  }
}

/** Only called by an explicit settings action. Status checks must never prompt. */
export async function requestDesktopPermission(kind: 'accessibility' | 'screen'): Promise<Record<string, unknown>> {
  if (kind !== 'accessibility' && kind !== 'screen') throw new Error('Unsupported desktop permission.')
  const errors: string[] = []
  try {
    if (kind === 'accessibility') systemPreferences.isTrustedAccessibilityClient(true)
    else {
      // Register the actual capture host without retaining window names or pixels.
      await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false })
    }
  } catch (error) { errors.push(`Host request: ${error instanceof Error ? error.message : String(error)}`) }
  let controllerRequest: Record<string, unknown> | undefined
  try { controllerRequest = await desktopRequest({ op: 'request_permission', kind }) }
  catch (error) { errors.push(`Controller request: ${error instanceof Error ? error.message : String(error)}`) }
  return { ...await desktopPermissions(), requestError: errors.length ? errors.join('; ') : undefined,
    request: { kind, controller: controllerRequest, errors } }
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
