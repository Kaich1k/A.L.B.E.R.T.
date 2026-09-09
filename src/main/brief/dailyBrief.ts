import { execFile } from 'child_process'
import { promisify } from 'util'
import type { DailyBrief } from '../../shared/types'
import { listActivity } from '../memory/service'
import { getOperationsSnapshot } from '../operations/service'
import { getProjectPulse } from '../pulse/projectPulse'

const execFileAsync = promisify(execFile)
let cache: DailyBrief | null = null
const TTL = 8 * 60_000

async function weatherLine(): Promise<string> {
  try {
    const res = await fetch('https://wttr.in/?format=%C+%t+%h+%w', {
      signal: AbortSignal.timeout(2500)
    })
    if (!res.ok) return 'Weather lookup failed.'
    const text = (await res.text()).replace(/\s+/g, ' ').trim()
    return text || 'Weather quiet.'
  } catch {
    return 'Weather unavailable (offline or blocked).'
  }
}

async function calendarLines(): Promise<string[]> {
  try {
    const script = `
      set out to {}
      set startDate to current date
      set endDate to startDate + (18 * hours)
      tell application "Calendar"
        repeat with cal in calendars
          try
            set evs to (every event of cal whose start date ≥ startDate and start date ≤ endDate)
            repeat with ev in evs
              set end of out to (summary of ev) as text
            end repeat
          end try
        end repeat
      end tell
      set AppleScript's text item delimiters to linefeed
      return out as text
    `
    const { stdout } = await execFileAsync('osascript', ['-e', script], {
      timeout: 2500,
      maxBuffer: 32_000
    })
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 6)
  } catch {
    return []
  }
}

export async function getDailyBrief(force = false): Promise<DailyBrief> {
  if (!force && cache && Date.now() - cache.generatedAt < TTL) return cache
  const ops = getOperationsSnapshot()
  const pulse = await getProjectPulse(false)
  const overnightCutoff = Date.now() - 16 * 60 * 60_000
  const overnight = listActivity(40)
    .filter((entry) => entry.createdAt >= overnightCutoff)
    .slice(0, 6)
    .map((entry) => `${entry.ok ? 'ok' : 'fault'} ${entry.toolName.replaceAll('_', ' ')}`)
  if (pulse.dirty[0]) overnight.unshift(`repo: ${pulse.dirty.length} dirty · ${pulse.branch || 'no branch'}`)
  const openMissions = ops.missions
    .filter((mission) => !['complete', 'cancelled'].includes(mission.state))
    .slice(0, 4)
    .map((mission) => `${mission.state} · ${mission.title}`)
  const first =
    ops.missions.find((m) => m.priority === 'critical' || m.priority === 'high') ||
    ops.missions.find((m) => m.state === 'active') ||
    ops.missions.find((m) => !['complete', 'cancelled'].includes(m.state))
  const [weather, calendar] = await Promise.all([weatherLine(), calendarLines()])
  cache = {
    generatedAt: Date.now(),
    weather,
    calendar,
    missions: openMissions,
    overnight: overnight.length ? overnight : ['No overnight tool traffic.'],
    firstMove: first
      ? `Recommended first move: ${first.title}${first.steps.find((s) => s.state !== 'complete') ? ` — ${first.steps.find((s) => s.state !== 'complete')!.title}` : ''}`
      : 'The deck is clear. Create a mission when the outcome should survive this chat.'
  }
  return cache
}
