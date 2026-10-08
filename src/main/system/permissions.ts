import { execFile } from 'child_process'
import { promisify } from 'util'
import { systemPreferences } from 'electron'
import { desktopPermissions } from '../computer/nativeDesktop'

const execFileAsync = promisify(execFile)

export type MediaGrant = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'

export interface PermissionSnapshot {
  accessibility: boolean
  accessibilityStatus: 'granted' | 'denied' | 'unknown'
  screenRecording: MediaGrant
  microphone: MediaGrant
  automation: 'granted' | 'denied' | 'unknown'
  outlook: 'graph' | 'app' | 'web-only' | 'unavailable'
  outlookDetail: string
  controllerDetail: string
  checkedAt: number
}

function mediaGrant(kind: 'screen' | 'microphone'): MediaGrant {
  try {
    const status = systemPreferences.getMediaAccessStatus(kind)
    if (
      status === 'granted' ||
      status === 'denied' ||
      status === 'restricted' ||
      status === 'not-determined'
    ) {
      return status
    }
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

async function automationWorks(): Promise<'granted' | 'denied' | 'unknown'> {
  try {
    await execFileAsync(
      'osascript',
      ['-e', 'tell application "System Events" to return name of first process whose frontmost is true'],
      { timeout: 4_000 }
    )
    return 'granted'
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/not authorized|1743|1002|assistive|not allowed/i.test(message)) return 'denied'
    return 'unknown'
  }
}

export async function readPermissionSnapshot(outlook: {
  graph: boolean
  app: boolean
  detail: string
}): Promise<PermissionSnapshot> {
  const desktop = await desktopPermissions()
  return {
    accessibility: desktop.accessibility === true,
    accessibilityStatus: desktop.accessibilityStatus === 'granted' || desktop.accessibilityStatus === 'denied'
      ? desktop.accessibilityStatus : 'unknown',
    screenRecording: desktop.screenRecordingStatus === 'granted' || desktop.screenRecordingStatus === 'denied' ||
      desktop.screenRecordingStatus === 'restricted' || desktop.screenRecordingStatus === 'not-determined'
      ? desktop.screenRecordingStatus : 'unknown',
    controllerDetail: String(desktop.setup || ''),
    microphone: mediaGrant('microphone'),
    automation: await automationWorks(),
    outlook: outlook.graph ? 'graph' : outlook.app ? 'app' : 'unavailable',
    outlookDetail: outlook.detail,
    checkedAt: Date.now()
  }
}

export function permissionGap(snapshot: PermissionSnapshot, need: 'accessibility' | 'screen' | 'microphone' | 'automation'): string | null {
  if (need === 'accessibility' && !snapshot.accessibility) {
    return 'Accessibility is not granted. Click, type, and shortcuts stay unavailable until the desktop controller has access. Open ALBERT → Systems for setup.'
  }
  if (need === 'screen' && snapshot.screenRecording !== 'granted') {
    return 'Screen Recording is not granted. Screenshots and aiming at on-screen controls stay unavailable until ALBERT is enabled in System Settings → Privacy & Security → Screen Recording.'
  }
  if (need === 'microphone' && snapshot.microphone !== 'granted') {
    return 'Microphone access is not granted. Wake and conversation stay unavailable until ALBERT is enabled in System Settings → Privacy & Security → Microphone.'
  }
  if (need === 'automation' && snapshot.automation === 'denied') {
    return 'Automation is not granted. Controlling other apps via Apple Events stays unavailable until ALBERT is allowed in System Settings → Privacy & Security → Automation.'
  }
  return null
}
