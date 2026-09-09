import { execFile } from 'child_process'
import { BrowserWindow, app, nativeImage, screen } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import { APP_NAME } from '../../shared/brand'
import {
  clampRectToArea,
  hintForTool,
  overlaps,
  orbBesideWindow,
  orbOnDisplay,
  processNameForApp,
  shouldFlyForHint,
  type HudPoint,
  type HudRect,
  type HudWorkHint
} from '../../shared/hudWork'
import type { VoiceState } from '../../shared/types'
import { getComputerWindow, showComputerWindow } from '../computer/window'
import { getSettings } from '../config'

const execFileAsync = promisify(execFile)
const ALBERT_PROCESS = /^(ALBERT|Electron)$/i

export const ORB_SIZE = 288
const TEXT_GAP = 52

let hudWindow: BrowserWindow | null = null
let roamAnim: ReturnType<typeof setInterval> | null = null
let obstructionTimer: ReturnType<typeof setInterval> | null = null
let obstructionCheckInFlight = false
let dockedToMain = false
let lastDockOrigin: HudPoint | null = null
let roamEnabled = true
let dragOrigin: { cursorX: number; cursorY: number; winX: number; winY: number } | null = null
let suppressRoamUntil = 0
let clickThrough: boolean | null = null

let runtime = {
  voiceState: 'idle' as VoiceState,
  busy: false,
  tool: ''
}
let workHint: HudWorkHint = { kind: 'main' }
let workHintAt = 0
let flightGen = 0
const boundsCache = new Map<string, { at: number; rect: HudRect | null }>()

interface HudBounds {
  x: number
  y: number
  roam: boolean
}

function boundsPath(): string {
  const dir = join(app.getPath('userData'), 'albert-data')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'hud-bounds.json')
}

function loadBounds(): HudBounds | null {
  try {
    const raw = JSON.parse(readFileSync(boundsPath(), 'utf8')) as Partial<HudBounds>
    if (typeof raw.x !== 'number' || typeof raw.y !== 'number') return null
    return { x: raw.x, y: raw.y, roam: raw.roam !== false }
  } catch {
    return null
  }
}

function saveBounds(): void {
  if (!hudWindow || hudWindow.isDestroyed()) return
  const [x, y] = hudWindow.getPosition()
  writeFileSync(boundsPath(), JSON.stringify({ x, y, roam: roamEnabled }))
}

function appWindow(): BrowserWindow | null {
  return (
    BrowserWindow.getAllWindows().find((win) => {
      if (win.isDestroyed() || win === hudWindow) return false
      const url = win.webContents.getURL()
      return !url.includes('#hud') && !url.includes('#computer')
    }) ?? null
  )
}

function defaultPosition(width: number, height: number): { x: number; y: number } {
  const main = appWindow()
  if (main && !main.isDestroyed() && main.isVisible()) {
    return parkBesideWindow(main.getBounds(), width, height)
  }
  const area = screen.getPrimaryDisplay().workArea
  return {
    x: Math.round(area.x + area.width - width - 28),
    y: Math.round(area.y + Math.max(area.height * 0.28, 120))
  }
}

function areaForPoint(x: number, y: number): HudRect {
  const displays = screen.getAllDisplays()
  const hit = displays.find((display) => {
    const b = display.bounds
    return x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height
  })
  return (hit || screen.getDisplayNearestPoint({ x, y })).workArea
}

function clampToWorkArea(x: number, y: number, width: number, height: number): HudPoint {
  return clampRectToArea({ x, y }, width, areaForPoint(x, y))
}

function parkBesideWindow(host: HudRect, width: number, height: number): HudPoint {
  return orbBesideWindow(host, width, areaForPoint(host.x + host.width / 2, host.y + host.height / 2), TEXT_GAP)
}

function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function readProcessBounds(processName: string): Promise<HudRect | null> {
  const key = processName.toLowerCase()
  const cached = boundsCache.get(key)
  if (cached && Date.now() - cached.at < 1200) return cached.rect
  const script = `
    tell application "System Events"
      if not (exists process "${escapeAppleScript(processName)}") then return ""
      tell process "${escapeAppleScript(processName)}"
        if (count of windows) is 0 then return ""
        set w to window 1
        set p to position of w
        set s to size of w
        return (item 1 of p as text) & "," & (item 2 of p as text) & "," & (item 1 of s as text) & "," & (item 2 of s as text)
      end tell
    end tell
  `
  try {
    const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 800 })
    const parts = stdout.trim().split(',').map((n) => Number(n.trim()))
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      boundsCache.set(key, { at: Date.now(), rect: null })
      return null
    }
    const rect = { x: parts[0]!, y: parts[1]!, width: parts[2]!, height: parts[3]! }
    boundsCache.set(key, { at: Date.now(), rect })
    return rect
  } catch {
    boundsCache.set(key, { at: Date.now(), rect: null })
    return null
  }
}

async function readFrontmostBounds(): Promise<{ name: string; rect: HudRect } | null> {
  const script = `
    tell application "System Events"
      set p to first process whose frontmost is true
      set n to name of p
      if (count of windows of p) is 0 then return n
      set w to window 1 of p
      set pos to position of w
      set sz to size of w
      return n & "," & (item 1 of pos as text) & "," & (item 2 of pos as text) & "," & (item 1 of sz as text) & "," & (item 2 of sz as text)
    end tell
  `
  try {
    const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 800 })
    const raw = stdout.trim()
    const parts = raw.split(',')
    const name = parts[0]?.trim() || ''
    if (!name || ALBERT_PROCESS.test(name)) return null
    if (parts.length !== 5) return null
    const nums = parts.slice(1).map((n) => Number(n.trim()))
    if (nums.some((n) => !Number.isFinite(n))) return null
    return { name, rect: { x: nums[0]!, y: nums[1]!, width: nums[2]!, height: nums[3]! } }
  } catch {
    return null
  }
}

function stayPut(): HudPoint | null {
  if (!hudWindow || hudWindow.isDestroyed()) return null
  const [x, y] = hudWindow.getPosition()
  return { x, y }
}

async function resolveWorkTarget(hint: HudWorkHint, width: number, height: number): Promise<HudPoint | null> {
  if (!shouldFlyForHint(hint)) return stayPut()
  // Pointer activity is deliberately ignored. The orb moves on its own terms;
  // tool context may still place it beside an app or the computer window.
  if (hint.kind === 'click') return stayPut()
  if (hint.kind === 'computer') {
    const existing = getComputerWindow()
    const computer =
      existing && !existing.isDestroyed() ? existing : showComputerWindow()
    if (computer && !computer.isDestroyed()) {
      return parkBesideWindow(computer.getBounds(), width, height)
    }
  }
  if (hint.kind === 'app' && hint.app) {
    const bounds = await readProcessBounds(processNameForApp(hint.app))
    if (bounds) return parkBesideWindow(bounds, width, height)
  }
  if (hint.kind === 'frontmost' || hint.kind === 'app') {
    const front = await readFrontmostBounds()
    if (front) return parkBesideWindow(front.rect, width, height)
    return stayPut()
  }
  if (hint.kind === 'display') {
    const main = appWindow()
    const origin = main && !main.isDestroyed() ? main.getBounds() : screen.getPrimaryDisplay().workArea
    return orbOnDisplay(areaForPoint(origin.x + origin.width / 2, origin.y + origin.height / 2), width)
  }
  return stayPut()
}

function resolveAppIcon(): string | undefined {
  const candidates = [
    join(__dirname, '../../../resources/icon.png'),
    join(process.resourcesPath, 'icon.png'),
    join(process.cwd(), 'resources/icon.png')
  ]
  return candidates.find((path) => existsSync(path))
}

function stopRoamAnim(): void {
  if (roamAnim) clearInterval(roamAnim)
  roamAnim = null
}

function stopYield(): void {
  if (obstructionTimer) clearInterval(obstructionTimer)
  obstructionTimer = null
  obstructionCheckInFlight = false
}

function stopRoam(): void {
  stopRoamAnim()
}

function broadcastHudDocked(docked: boolean): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send('albert:chat:event', { type: 'hud_docked', docked })
  }
}

function rememberDockSlot(slot?: { x: number; y: number; width: number; height: number } | null): void {
  const main = appWindow()
  if (!main || main.isDestroyed() || !slot || slot.width < 80 || slot.height < 80) return
  const content = main.getContentBounds()
  lastDockOrigin = clampToWorkArea(
    content.x + slot.x + (slot.width - ORB_SIZE) / 2,
    content.y + slot.y + (slot.height - ORB_SIZE) / 2,
    ORB_SIZE,
    ORB_SIZE
  )
}

function hideHudInDock(): void {
  if (!hudWindow || hudWindow.isDestroyed()) return
  stopRoamAnim()
  stopYield()
  try {
    hudWindow.hide()
  } catch {
    /* ignore */
  }
}

function revealHudFromDock(): void {
  const settings = getSettings()
  if (settings.ambientHudEnabled === false) return
  if (!hudWindow || hudWindow.isDestroyed()) {
    showHudWindow()
  }
  if (!hudWindow || hudWindow.isDestroyed()) return
  if (lastDockOrigin) {
    try {
      hudWindow.setPosition(lastDockOrigin.x, lastDockOrigin.y)
    } catch {
      /* ignore */
    }
  }
  try {
    hudWindow.showInactive()
    hudWindow.setAlwaysOnTop(true, 'floating')
    hudWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  } catch {
    /* ignore */
  }
  syncMotionMode()
}

async function tickObstructionCheck(): Promise<void> {
  if (obstructionCheckInFlight || roamAnim || !hudWindow || hudWindow.isDestroyed() || dragOrigin || !roamEnabled) return
  if (dockedToMain || !hudWindow.isVisible()) return
  if (Date.now() < suppressRoamUntil) return
  obstructionCheckInFlight = true
  try {
    const bounds = hudWindow.getBounds()
    const candidates: HudRect[] = []
    const main = appWindow()
    if (!dockedToMain && main && !main.isDestroyed() && main.isVisible()) candidates.push(main.getBounds())
    const computer = getComputerWindow()
    if (computer && !computer.isDestroyed() && computer.isVisible()) candidates.push(computer.getBounds())
    const front = await readFrontmostBounds()
    if (front) candidates.push(front.rect)
    const obstruction = candidates.find((candidate) => overlaps(bounds, candidate, 10))
    if (!obstruction) return
    const destination = parkBesideWindow(obstruction, bounds.width, bounds.height)
    await animateHudTo(destination, 28)
  } finally {
    obstructionCheckInFlight = false
  }
}

function syncMotionMode(): void {
  stopRoam()
  if (!hudWindow || hudWindow.isDestroyed() || !roamEnabled) {
    stopYield()
    return
  }
  if (!obstructionTimer) obstructionTimer = setInterval(() => void tickObstructionCheck(), 1400)
}

function animateHudTo(dest: HudPoint, steps = 24): Promise<void> {
  return new Promise((resolve) => {
    if (!hudWindow || hudWindow.isDestroyed()) {
      resolve()
      return
    }
    stopRoamAnim()
    const gen = ++flightGen
    const start = hudWindow.getBounds()
    if (Math.hypot(dest.x - start.x, dest.y - start.y) < 8) {
      resolve()
      return
    }
    let step = 0
    roamAnim = setInterval(() => {
      if (!hudWindow || hudWindow.isDestroyed() || gen !== flightGen) {
        if (roamAnim) {
          clearInterval(roamAnim)
          roamAnim = null
        }
        resolve()
        return
      }
      step += 1
      const t = Math.min(1, step / Math.max(1, steps))
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
      hudWindow.setPosition(
        Math.round(start.x + (dest.x - start.x) * ease),
        Math.round(start.y + (dest.y - start.y) * ease)
      )
      if (step >= steps) {
        stopRoamAnim()
        saveBounds()
        resolve()
      }
    }, 32)
  })
}

export async function guideHudForTool(
  name: string,
  args: Record<string, unknown> = {}
): Promise<void> {
  workHint = hintForTool(name, args)
  workHintAt = Date.now()
  if (!shouldFlyForHint(workHint)) return
  const takingOff = dockedToMain
  if (takingOff) {
    dockedToMain = false
    suppressRoamUntil = 0
    revealHudFromDock()
    broadcastHudDocked(false)
  }
  if (!roamEnabled || !hudWindow || hudWindow.isDestroyed() || dragOrigin) return
  if (!takingOff && Date.now() < suppressRoamUntil) return
  const { width, height } = hudWindow.getBounds()
  const dest = await resolveWorkTarget(workHint, width, height)
  if (!dest) return
  const flight = animateHudTo(dest, workHint.kind === 'click' ? 9 : 16)
  if (workHint.kind === 'click' || workHint.kind === 'computer') {
    await Promise.race([
      flight,
      new Promise<void>((resolve) => setTimeout(resolve, 480))
    ])
  }
}

/**
 * Park the floating HUD by hiding it. Comm renders AlbertCore inside the berth,
 * which is the only way to keep the orb centered in the gray circle.
 * `slot.park === false` only remembers the berth for takeoff.
 */
export function dockHud(
  slot?: { x: number; y: number; width: number; height: number; park?: boolean } | null
): void {
  rememberDockSlot(slot)
  if (slot?.park === false) return
  if (dragOrigin) return
  const main = appWindow()
  if (!main || main.isDestroyed() || !main.isVisible()) return
  if (dockedToMain) {
    hideHudInDock()
    return
  }
  dockedToMain = true
  hideHudInDock()
  broadcastHudDocked(true)
}

export function releaseHudDock(): void {
  if (!dockedToMain) return
  dockedToMain = false
  revealHudFromDock()
  broadcastHudDocked(false)
}

export function isHudDocked(): boolean {
  return dockedToMain
}

export function reportHudRuntime(partial: {
  voiceState?: VoiceState
  busy?: boolean
  tool?: string
}): void {
  runtime = { ...runtime, ...partial }
  if (partial.tool) {
    workHint = hintForTool(partial.tool)
    workHintAt = Date.now()
  }
  syncMotionMode()
}

export function getHudRuntime(): typeof runtime {
  return runtime
}

export function getHudWindow(): BrowserWindow | null {
  return hudWindow
}

/** Hide the always-on-top orb so macOS modal dialogs can be clicked. */
export function suspendHudForDialog(): () => void {
  if (!hudWindow || hudWindow.isDestroyed()) return () => undefined
  const wasVisible = hudWindow.isVisible()
  try {
    hudWindow.setAlwaysOnTop(false)
    hudWindow.hide()
  } catch {
    /* ignore */
  }
  return () => {
    if (!hudWindow || hudWindow.isDestroyed() || !wasVisible) return
    try {
      hudWindow.showInactive()
      hudWindow.setAlwaysOnTop(true, 'floating')
      hudWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    } catch {
      /* ignore */
    }
  }
}

export function setHudRoam(enabled: boolean): boolean {
  roamEnabled = enabled
  if (enabled) syncMotionMode()
  else {
    stopYield()
    stopRoam()
  }
  saveBounds()
  return roamEnabled
}

export function getHudRoam(): boolean {
  return roamEnabled
}

export function setHudClickThrough(ignore: boolean): void {
  if (!hudWindow || hudWindow.isDestroyed()) return
  if (clickThrough === ignore) return
  clickThrough = ignore
  if (ignore) hudWindow.setIgnoreMouseEvents(true, { forward: true })
  else hudWindow.setIgnoreMouseEvents(false)
}

export function dragAmbientHud(payload: {
  phase: 'start' | 'move' | 'end'
  screenX: number
  screenY: number
}): void {
  if (!hudWindow || hudWindow.isDestroyed()) return
  if (payload.phase === 'start') {
    if (dockedToMain) {
      dockedToMain = false
      broadcastHudDocked(false)
    }
    const [winX, winY] = hudWindow.getPosition()
    dragOrigin = { cursorX: payload.screenX, cursorY: payload.screenY, winX, winY }
    suppressRoamUntil = Date.now() + 18_000
    stopRoamAnim()
    setHudClickThrough(false)
    return
  }
  if (!dragOrigin) return
  const next = clampToWorkArea(
    dragOrigin.winX + (payload.screenX - dragOrigin.cursorX),
    dragOrigin.winY + (payload.screenY - dragOrigin.cursorY),
    hudWindow.getBounds().width,
    hudWindow.getBounds().height
  )
  hudWindow.setPosition(next.x, next.y)
  if (payload.phase === 'end') {
    dragOrigin = null
    saveBounds()
    syncMotionMode()
  }
}

export function setAmbientHud(enabled: boolean): void {
  if (enabled) showHudWindow()
  else closeHudWindow()
}

export function showHudWindow(): BrowserWindow {
  if (hudWindow && !hudWindow.isDestroyed()) {
    if (!dockedToMain) hudWindow.showInactive()
    syncMotionMode()
    return hudWindow
  }
  const stored = loadBounds()
  roamEnabled = stored ? stored.roam : getSettings().ambientHudRoam !== false
  const width = ORB_SIZE
  const height = ORB_SIZE
  const fallback = defaultPosition(width, height)
  const pos = stored ? clampToWorkArea(stored.x, stored.y, width, height) : fallback
  const iconPath = resolveAppIcon()
  hudWindow = new BrowserWindow({
    width,
    height,
    x: pos.x,
    y: pos.y,
    minWidth: ORB_SIZE,
    minHeight: ORB_SIZE,
    maxWidth: ORB_SIZE,
    maxHeight: ORB_SIZE,
    title: `${APP_NAME} Orb`,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    roundedCorners: false,
    focusable: true,
    acceptFirstMouse: true,
    show: false,
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  hudWindow.setAlwaysOnTop(true, 'floating')
  hudWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  hudWindow.setBackgroundColor('#00000000')
  hudWindow.setHasShadow(false)
  clickThrough = null
  setHudClickThrough(true)
  if (process.platform === 'darwin') {
    hudWindow.setWindowButtonVisibility(false)
  }
  if (iconPath) {
    try {
      hudWindow.setIcon(nativeImage.createFromPath(iconPath))
    } catch {
      /* ignore */
    }
  }
  hudWindow.on('ready-to-show', () => {
    if (!dockedToMain) hudWindow?.showInactive()
  })
  hudWindow.on('moved', () => {
    if (!dragOrigin) saveBounds()
  })
  hudWindow.on('closed', () => {
    stopYield()
    stopRoam()
    clickThrough = null
    hudWindow = null
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    void hudWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}#hud`)
  } else {
    void hudWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'hud' })
  }
  syncMotionMode()
  return hudWindow
}

export function closeHudWindow(): void {
  stopYield()
  stopRoam()
  if (hudWindow && !hudWindow.isDestroyed()) hudWindow.close()
  hudWindow = null
}

export function syncAmbientHudFromSettings(): void {
  const settings = getSettings()
  roamEnabled = settings.ambientHudRoam !== false
  setAmbientHud(settings.ambientHudEnabled !== false)
}
