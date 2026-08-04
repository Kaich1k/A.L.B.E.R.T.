import { execFile } from 'child_process'
import { promisify } from 'util'
import type { ToolDefinition } from './types'

const execFileAsync = promisify(execFile)

async function runOsascript(script: string): Promise<{ ok: boolean; result: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('osascript', ['-e', script], {
      timeout: 30_000
    })
    return { ok: true, result: (stdout || stderr || 'OK').trim() }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, result: `AppleScript failed: ${message}` }
  }
}

async function spotifyPlayerState(): Promise<{ state: string; track: string; raw: string }> {
  const res = await runOsascript(`
tell application "Spotify"
  if it is not running then return "not_running|(no track)"
  set st to player state as string
  try
    set tname to name of current track
    set tartist to artist of current track
    return st & "|" & tname & " — " & tartist
  on error
    return st & "|(no track info)"
  end try
end tell`)
  const raw = res.ok ? res.result : `error|${res.result}`
  const [state, track = ''] = raw.split('|')
  return { state: state || 'unknown', track, raw }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function escapeAs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** Significant words from the query for fuzzy track matching. */
function queryTokens(query: string): string[] {
  const stop = new Set(['the', 'a', 'an', 'and', 'or', 'by', 'feat', 'ft', 'official', 'video'])
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w))
}

function trackMatchesQuery(track: string, query: string): boolean {
  const t = track.toLowerCase()
  const tokens = queryTokens(query)
  if (!tokens.length) return t.includes(query.toLowerCase().slice(0, 12))
  const hits = tokens.filter((w) => t.includes(w)).length
  return hits >= Math.min(2, tokens.length) || hits / tokens.length >= 0.5
}

/**
 * Click the first Play control Spotify exposes via Accessibility.
 * Search results usually show a green Play on the top result — keyboard alone often
 * only highlights it without starting playback.
 */
async function clickPlayViaAX(): Promise<{ ok: boolean; result: string }> {
  // Prefer shallow AX + a couple of group levels — `entire contents` is too slow on Spotify.
  return runOsascript(`
tell application "Spotify" to activate
delay 0.35
tell application "System Events"
  tell process "Spotify"
    set frontmost to true
    delay 0.2
    set clicked to false
    set detail to "none"
    try
      if (count of windows) is 0 then return "ax_play:no_window"
      set w to window 1

      -- Window-level buttons
      try
        repeat with b in (buttons of w)
          set d to ""
          set n to ""
          try
            set d to description of b as string
          end try
          try
            set n to name of b as string
          end try
          if (d contains "Play" or n is "Play" or n contains "Play") and d does not contain "Pause" then
            click b
            set clicked to true
            set detail to "win:" & d & "/" & n
            exit repeat
          end if
        end repeat
      end try

      -- One level of groups / scroll areas
      if not clicked then
        try
          repeat with g in (groups of w)
            try
              repeat with b in (buttons of g)
                set d to ""
                set n to ""
                try
                  set d to description of b as string
                end try
                try
                  set n to name of b as string
                end try
                if (d contains "Play" or n is "Play") and d does not contain "Pause" then
                  click b
                  set clicked to true
                  set detail to "grp:" & d & "/" & n
                  exit repeat
                end if
              end repeat
            end try
            if clicked then exit repeat
            try
              repeat with sg in (groups of g)
                try
                  repeat with b in (buttons of sg)
                    set d to ""
                    set n to ""
                    try
                      set d to description of b as string
                    end try
                    try
                      set n to name of b as string
                    end try
                    if (d contains "Play" or n is "Play") and d does not contain "Pause" then
                      click b
                      set clicked to true
                      set detail to "grp2:" & d & "/" & n
                      exit repeat
                    end if
                  end repeat
                end try
                if clicked then exit repeat
              end repeat
            end try
            if clicked then exit repeat
          end repeat
        end try
      end if

      -- Scroll areas
      if not clicked then
        try
          repeat with s in (scroll areas of w)
            try
              repeat with b in (buttons of s)
                set d to ""
                try
                  set d to description of b as string
                end try
                if d contains "Play" and d does not contain "Pause" then
                  click b
                  set clicked to true
                  set detail to "scroll:" & d
                  exit repeat
                end if
              end repeat
            end try
            if clicked then exit repeat
          end repeat
        end try
      end if
    end try
    if clicked then
      return "ax_play:" & detail
    else
      return "ax_play:miss"
    end if
  end tell
end tell`)
}

/**
 * Keyboard path: open search, type query, arrow to a song row, Return, Space.
 * Often stops one click short of Play — AX pass finishes it.
 */
async function openSearchAndSelect(query: string): Promise<{ ok: boolean; result: string }> {
  const q = escapeAs(query)
  return runOsascript(`
tell application "Spotify" to activate
delay 0.5
tell application "System Events"
  tell process "Spotify"
    set frontmost to true
    delay 0.25
    keystroke "k" using command down
    delay 0.5
    keystroke "a" using command down
    delay 0.1
    keystroke "${q}"
    delay 1.6
    -- Move into results (Top result → Songs)
    key code 125
    delay 0.2
    key code 125
    delay 0.2
    key code 125
    delay 0.2
    -- Enter selects / opens; Space toggles play if already selected
    key code 36
    delay 0.7
    key code 49
    delay 0.4
  end tell
end tell
return "kbd_search_ok"`)
}

async function searchUriAndSelect(query: string): Promise<void> {
  const uri = `spotify:search:${encodeURIComponent(query)}`
  await execFileAsync('open', [uri])
  await sleep(1800)
  await runOsascript(`
tell application "Spotify" to activate
delay 0.4
tell application "System Events"
  tell process "Spotify"
    set frontmost to true
    delay 0.25
    key code 125
    delay 0.2
    key code 125
    delay 0.2
    key code 36
    delay 0.6
    key code 49
  end tell
end tell`)
}

/**
 * Open Spotify search, drive the top result into playback, verify track.
 * Plain \`tell Spotify to play\` only resumes the old queue — never use that for play_search.
 */
async function searchAndPlay(query: string): Promise<{ ok: boolean; result: string }> {
  const steps: string[] = []

  await execFileAsync('open', ['-a', 'Spotify'])
  await sleep(600)

  const kbd = await openSearchAndSelect(query)
  steps.push(kbd.result)
  await sleep(700)

  let ax = await clickPlayViaAX()
  steps.push(ax.result)
  await sleep(900)

  let status = await spotifyPlayerState()

  if (status.state !== 'playing' || !trackMatchesQuery(status.track, query)) {
    await searchUriAndSelect(query)
    steps.push('uri_search')
    await sleep(500)
    ax = await clickPlayViaAX()
    steps.push(ax.result)
    await sleep(900)
    status = await spotifyPlayerState()
  }

  // One more AX pass if still paused but a matching track is loaded
  if (status.state !== 'playing' && trackMatchesQuery(status.track, query)) {
    await runOsascript(`
tell application "Spotify"
  play
end tell`)
    await sleep(600)
    status = await spotifyPlayerState()
    steps.push('play_loaded_track')
  }

  const matched = trackMatchesQuery(status.track, query)
  const playing = status.state === 'playing'
  const trail = steps.join(' → ')

  if (playing && matched) {
    return {
      ok: true,
      result: `SUCCESS — Spotify is playing the matched track. State: ${status.raw}. Steps: ${trail}. Tell Kai it's playing in one short sentence — do not dump this tool text.`
    }
  }

  if (playing && !matched) {
    return {
      ok: false,
      result: `FAILURE — Spotify is playing something else, not “${query}”. State: ${status.raw}. Steps: ${trail}. Call play_search again with a tighter query. Do NOT ask Kai for permission. Do NOT dump raw tool output.`
    }
  }

  return {
    ok: false,
    result: `FAILURE — search ran but playback is NOT confirmed for “${query}”. State: ${status.raw}. Steps: ${trail}. Call spotify_control play_search again, or desktop_click the green Play on the top result (screenshot first only if you need coordinates — never ask Kai permission when confirmDangerousTools is OFF). Do NOT claim success. Do NOT dump raw tool paths to Kai.`
  }
}

export const spotifyTools: ToolDefinition[] = [
  {
    name: 'spotify_control',
    description:
      'Control macOS Spotify. Prefer play_search for “play X”. Returns SUCCESS/FAILURE — only tell Kai a song is playing on SUCCESS with state playing. Never invent success. Never ask permission to use this tool.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['open', 'play', 'pause', 'next', 'previous', 'play_search', 'status'],
          description:
            'play_search needs query (e.g. "Sign of the Times Harry Styles"). status = read player state.'
        },
        query: {
          type: 'string',
          description: 'Search/play query for play_search'
        }
      },
      required: ['action']
    },
    dangerous: true,
    execute: async (args) => {
      const action = String(args.action ?? '').trim()
      const query = String(args.query ?? '').trim()

      try {
        if (action === 'status') {
          const status = await spotifyPlayerState()
          return {
            ok: status.state === 'playing',
            result: `Spotify status: ${status.state}. Track: ${status.track || '(unknown)'}. Report playing to Kai ONLY if status is playing.`
          }
        }

        if (action === 'open') {
          await execFileAsync('open', ['-a', 'Spotify'])
          await sleep(800)
          const status = await spotifyPlayerState()
          return { ok: true, result: `Opened Spotify. State: ${status.raw}` }
        }

        await execFileAsync('open', ['-a', 'Spotify'])
        await sleep(500)

        if (action === 'play_search') {
          if (!query) return { ok: false, result: 'FAILURE — play_search requires query.' }
          return searchAndPlay(query)
        }

        if (action === 'play' || action === 'pause' || action === 'next' || action === 'previous') {
          const cmd =
            action === 'play'
              ? 'play'
              : action === 'pause'
                ? 'pause'
                : action === 'next'
                  ? 'next track'
                  : 'previous track'
          await runOsascript(`tell application "Spotify" to ${cmd}`)
          await sleep(400)
          const status = await spotifyPlayerState()
          return {
            ok: action === 'pause' ? status.state === 'paused' : status.state === 'playing' || action !== 'play',
            result: `Spotify ${action}. State: ${status.raw}`
          }
        }

        return { ok: false, result: `Unknown action: ${action}` }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, result: `spotify_control failed: ${message}` }
      }
    }
  }
]
