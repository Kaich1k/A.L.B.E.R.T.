import { execFile } from 'child_process'
import { promisify } from 'util'
import type { ToolDefinition } from './types'

const execFileAsync = promisify(execFile)

type BrowserName = 'Google Chrome' | 'Brave Browser' | 'Safari'

async function detectBrowser(): Promise<BrowserName | null> {
  const candidates: BrowserName[] = ['Google Chrome', 'Brave Browser', 'Safari']
  for (const name of candidates) {
    try {
      const { stdout } = await execFileAsync('osascript', [
        '-e',
        `tell application "System Events" to (name of processes) contains "${name}"`
      ])
      if (stdout.trim() === 'true') return name
    } catch {
      // continue
    }
  }
  // Prefer Chrome if installed even if not running
  try {
    await execFileAsync('osascript', [
      '-e',
      'tell application "Finder" to exists application file id "com.google.Chrome"'
    ])
    return 'Google Chrome'
  } catch {
    return 'Safari'
  }
}

export const browserTools: ToolDefinition[] = [
  {
    name: 'browser_list_tabs',
    description: 'List open browser windows and tabs (Chrome, Brave, or Safari).',
    parameters: {
      type: 'object',
      properties: {
        browser: {
          type: 'string',
          description: 'Optional: "Google Chrome", "Brave Browser", or "Safari"'
        }
      }
    },
    execute: async (args) => {
      const browser = (String(args.browser || '').trim() || (await detectBrowser())) as BrowserName
      if (!browser) return { ok: false, result: 'No supported browser found.' }

      const script =
        browser === 'Safari'
          ? `
            tell application "Safari"
              set out to ""
              set wIndex to 0
              repeat with w in windows
                set wIndex to wIndex + 1
                set tIndex to 0
                repeat with t in tabs of w
                  set tIndex to tIndex + 1
                  set out to out & "w" & wIndex & "-t" & tIndex & " | " & (name of t) & " | " & (URL of t) & linefeed
                end repeat
              end repeat
              return out
            end tell
          `
          : `
            tell application "${browser}"
              set out to ""
              set wIndex to 0
              repeat with w in windows
                set wIndex to wIndex + 1
                set tIndex to 0
                repeat with t in tabs of w
                  set tIndex to tIndex + 1
                  set out to out & "w" & wIndex & "-t" & tIndex & " | " & (title of t) & " | " & (URL of t) & linefeed
                end repeat
              end repeat
              return out
            end tell
          `

      try {
        const { stdout } = await execFileAsync('osascript', ['-e', script])
        const text = stdout.trim() || 'No tabs open.'
        return { ok: true, result: `${browser}\n${text}` }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          ok: false,
          result: `Failed to list tabs (${browser}): ${message}. Grant Automation permission to A.L.B.E.R.T. for this browser.`
        }
      }
    }
  },
  {
    name: 'browser_open_url',
    description: 'Open a URL in the default browser or a specified browser.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        browser: {
          type: 'string',
          description: 'Optional browser name, e.g. "Google Chrome"'
        }
      },
      required: ['url']
    },
    execute: async (args) => {
      const url = String(args.url ?? '').trim()
      if (!url) return { ok: false, result: 'URL is required.' }
      const browser = String(args.browser || '').trim()
      try {
        if (browser) {
          await execFileAsync('open', ['-a', browser, url])
        } else {
          await execFileAsync('open', [url])
        }
        return { ok: true, result: `Opened ${url}${browser ? ` in ${browser}` : ''}.` }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, result: `Failed to open URL: ${message}` }
      }
    }
  },
  {
    name: 'browser_switch_tab',
    description: 'Activate a browser tab by window/tab indices (1-based) or by title substring.',
    parameters: {
      type: 'object',
      properties: {
        windowIndex: { type: 'number', description: '1-based window index' },
        tabIndex: { type: 'number', description: '1-based tab index' },
        title: { type: 'string', description: 'Substring of tab title to match' },
        browser: { type: 'string' }
      }
    },
    execute: async (args) => {
      const browser = (String(args.browser || '').trim() || (await detectBrowser())) as BrowserName
      const title = String(args.title || '').trim()
      const windowIndex = Number(args.windowIndex || 0)
      const tabIndex = Number(args.tabIndex || 0)

      let script = ''
      if (title) {
        script =
          browser === 'Safari'
            ? `
              tell application "Safari"
                activate
                repeat with w in windows
                  set tIndex to 0
                  repeat with t in tabs of w
                    set tIndex to tIndex + 1
                    if (name of t) contains ${JSON.stringify(title)} then
                      set current tab of w to t
                      set index of w to 1
                      return "Switched to: " & (name of t)
                    end if
                  end repeat
                end repeat
                return "No tab matched title"
              end tell
            `
            : `
              tell application "${browser}"
                activate
                repeat with w in windows
                  set tIndex to 0
                  repeat with t in tabs of w
                    set tIndex to tIndex + 1
                    if (title of t) contains ${JSON.stringify(title)} then
                      set active tab index of w to tIndex
                      set index of w to 1
                      return "Switched to: " & (title of t)
                    end if
                  end repeat
                end repeat
                return "No tab matched title"
              end tell
            `
      } else if (windowIndex > 0 && tabIndex > 0) {
        script =
          browser === 'Safari'
            ? `
              tell application "Safari"
                activate
                set current tab of window ${windowIndex} to tab ${tabIndex} of window ${windowIndex}
                set index of window ${windowIndex} to 1
                return "Switched to window ${windowIndex} tab ${tabIndex}"
              end tell
            `
            : `
              tell application "${browser}"
                activate
                set active tab index of window ${windowIndex} to ${tabIndex}
                set index of window ${windowIndex} to 1
                return "Switched to window ${windowIndex} tab ${tabIndex}"
              end tell
            `
      } else {
        return { ok: false, result: 'Provide title or windowIndex+tabIndex.' }
      }

      try {
        const { stdout } = await execFileAsync('osascript', ['-e', script])
        return { ok: true, result: stdout.trim() }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, result: `Failed to switch tab: ${message}` }
      }
    }
  },
  {
    name: 'browser_close_tab',
    description: 'Close a browser tab by window/tab indices (1-based) or title substring.',
    parameters: {
      type: 'object',
      properties: {
        windowIndex: { type: 'number' },
        tabIndex: { type: 'number' },
        title: { type: 'string' },
        browser: { type: 'string' }
      }
    },
    dangerous: true,
    execute: async (args) => {
      const browser = (String(args.browser || '').trim() || (await detectBrowser())) as BrowserName
      const title = String(args.title || '').trim()
      const windowIndex = Number(args.windowIndex || 0)
      const tabIndex = Number(args.tabIndex || 0)

      let script = ''
      if (title) {
        script =
          browser === 'Safari'
            ? `
              tell application "Safari"
                repeat with w in windows
                  repeat with t in tabs of w
                    if (name of t) contains ${JSON.stringify(title)} then
                      close t
                      return "Closed tab matching title"
                    end if
                  end repeat
                end repeat
                return "No tab matched"
              end tell
            `
            : `
              tell application "${browser}"
                repeat with w in windows
                  set tIndex to 0
                  repeat with t in tabs of w
                    set tIndex to tIndex + 1
                    if (title of t) contains ${JSON.stringify(title)} then
                      close t
                      return "Closed tab matching title"
                    end if
                  end repeat
                end repeat
                return "No tab matched"
              end tell
            `
      } else if (windowIndex > 0 && tabIndex > 0) {
        script =
          browser === 'Safari'
            ? `
              tell application "Safari"
                close tab ${tabIndex} of window ${windowIndex}
                return "Closed window ${windowIndex} tab ${tabIndex}"
              end tell
            `
            : `
              tell application "${browser}"
                close tab ${tabIndex} of window ${windowIndex}
                return "Closed window ${windowIndex} tab ${tabIndex}"
              end tell
            `
      } else {
        return { ok: false, result: 'Provide title or windowIndex+tabIndex.' }
      }

      try {
        const { stdout } = await execFileAsync('osascript', ['-e', script])
        return { ok: true, result: stdout.trim() }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, result: `Failed to close tab: ${message}` }
      }
    }
  }
]
