/** Where the speech orb should fly for a tool call — ChatGPT-agent-cursor style. */

export type HudWorkKind = 'click' | 'computer' | 'app' | 'frontmost' | 'main' | 'display'

export interface HudWorkHint {
  kind: HudWorkKind
  x?: number
  y?: number
  app?: string
}

export interface HudRect {
  x: number
  y: number
  width: number
  height: number
}

export interface HudPoint {
  x: number
  y: number
}

export function processNameForApp(app: string): string {
  const n = app.trim()
  const aliases: Record<string, string> = {
    chrome: 'Google Chrome',
    'google chrome': 'Google Chrome',
    brave: 'Brave Browser',
    'brave browser': 'Brave Browser',
    vscode: 'Code',
    'visual studio code': 'Code',
    code: 'Code',
    iterm: 'iTerm2',
    iterm2: 'iTerm2',
    finder: 'Finder',
    notes: 'Notes',
    spotify: 'Spotify',
    cursor: 'Cursor',
    safari: 'Safari',
    terminal: 'Terminal',
    mail: 'Mail',
    messages: 'Messages',
    slack: 'Slack',
    music: 'Music'
  }
  return aliases[n.toLowerCase()] || n
}

export function hintForTool(name: string, args: Record<string, unknown> = {}): HudWorkHint {
  if (name === 'desktop_click') {
    const x = Number(args.x)
    const y = Number(args.y)
    if (Number.isFinite(x) && Number.isFinite(y)) return { kind: 'click', x, y }
    return { kind: 'frontmost' }
  }
  if (name === 'desktop_screenshot') return { kind: 'display' }
  if (name.startsWith('desktop_')) return { kind: 'frontmost' }
  if (name.startsWith('computer_')) return { kind: 'computer' }
  if (name.startsWith('browser_')) {
    const browser = String(args.browser || '').trim()
    return { kind: 'app', app: processNameForApp(browser || 'Safari') }
  }
  if (name === 'open_app') return { kind: 'app', app: processNameForApp(String(args.name || 'Finder')) }
  if (name.startsWith('spotify')) return { kind: 'app', app: 'Spotify' }
  if (name.includes('cursor')) return { kind: 'app', app: 'Cursor' }
  if (name === 'open_path' || name === 'run_applescript' || name === 'run_shell' || name === 'run_project_command') {
    return { kind: 'frontmost' }
  }
  if (
    /^(write_|read_|apply_|delete_|list_dir|list_project|glob_|grep_|list_allowed)/.test(name)
  ) {
    return { kind: 'app', app: 'Cursor' }
  }
  return { kind: 'main' }
}

export function shouldFlyForHint(hint: HudWorkHint): boolean {
  return hint.kind !== 'main'
}

/** If the pointer is inside the orb, step away — never toward the cursor. */
export function yieldAwayFromCursor(orb: HudRect, cursor: HudPoint, pad = 28): HudPoint | null {
  const cx = orb.x + orb.width / 2
  const cy = orb.y + orb.height / 2
  const clear = orb.width / 2 + pad
  const dx = cx - cursor.x
  const dy = cy - cursor.y
  const dist = Math.hypot(dx, dy)
  if (dist >= clear) return null
  const ux = dist < 1 ? 1 : dx / dist
  const uy = dist < 1 ? 0 : dy / dist
  return {
    x: cursor.x + ux * clear - orb.width / 2,
    y: cursor.y + uy * clear - orb.height / 2
  }
}

export function overlaps(a: HudRect, b: HudRect, pad = 0): boolean {
  return !(
    a.x + a.width + pad <= b.x ||
    b.x + b.width + pad <= a.x ||
    a.y + a.height + pad <= b.y ||
    b.y + b.height + pad <= a.y
  )
}

export function clampRectToArea(pos: HudPoint, size: number, area: HudRect): HudPoint {
  return {
    x: Math.min(area.x + area.width - size, Math.max(area.x, Math.round(pos.x))),
    y: Math.min(area.y + area.height - size, Math.max(area.y, Math.round(pos.y)))
  }
}

/** Sit beside a click so the target stays visible — like an agent cursor, not on top of it. */
export function orbNearPoint(point: HudPoint, size: number, area: HudRect, gap = 18): HudPoint {
  const r = size / 2 + gap
  const centers: HudPoint[] = [
    { x: point.x + r, y: point.y + r * 0.4 },
    { x: point.x - r, y: point.y + r * 0.4 },
    { x: point.x + r, y: point.y - r * 0.4 },
    { x: point.x - r, y: point.y - r * 0.4 }
  ]
  const minDist = size / 2 + 8
  for (const center of centers) {
    const next = clampRectToArea({ x: center.x - size / 2, y: center.y - size / 2 }, size, area)
    const cx = next.x + size / 2
    const cy = next.y + size / 2
    const dx = cx - point.x
    const dy = cy - point.y
    if (dx * dx + dy * dy >= minDist * minDist) return next
  }
  return clampRectToArea({ x: point.x + r - size / 2, y: point.y + 24 }, size, area)
}

/** Park beside a work window on whatever display that window lives on. */
export function orbBesideWindow(host: HudRect, size: number, area: HudRect, gap = 28): HudPoint {
  const y = host.y + Math.min(Math.max(48, host.height * 0.22), Math.max(0, host.height - size - 16))
  const spots: HudPoint[] = [
    { x: host.x + host.width + gap, y },
    { x: host.x - size - gap, y },
    { x: host.x + host.width - size, y: host.y + host.height + gap },
    { x: host.x + host.width - size, y: host.y - size - gap }
  ]
  for (const spot of spots) {
    const next = clampRectToArea(spot, size, area)
    if (!overlaps({ x: next.x, y: next.y, width: size, height: size }, host, gap - 10)) return next
  }
  return clampRectToArea(spots[0]!, size, area)
}

/** Right edge of a display — watching the screen Albert is capturing. */
export function orbOnDisplay(area: HudRect, size: number): HudPoint {
  return clampRectToArea(
    {
      x: area.x + area.width - size - 24,
      y: area.y + Math.max(80, area.height * 0.28)
    },
    size,
    area
  )
}
