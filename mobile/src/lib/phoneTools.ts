import {
  executeWebTool,
  parseToolArguments,
  WEB_TOOL_DEFINITIONS,
  type WebToolResult
} from './webTools'

type LinkingLike = {
  openURL: (url: string) => Promise<void>
}

function getLinking(): LinkingLike {
  // Lazy require keeps Node provider tests from loading the RN runtime.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('react-native').Linking as LinkingLike
}

export type PhoneToolResult = WebToolResult

type AppTarget = {
  id: string
  label: string
  urls: string[]
}

const APP_TARGETS: AppTarget[] = [
  {
    id: 'spotify',
    label: 'Spotify',
    urls: ['spotify://', 'https://open.spotify.com']
  },
  {
    id: 'apple_music',
    label: 'Apple Music',
    urls: ['music://', 'https://music.apple.com']
  },
  {
    id: 'messages',
    label: 'Messages',
    urls: ['sms:', 'messages://']
  },
  {
    id: 'phone',
    label: 'Phone',
    urls: ['tel://']
  },
  {
    id: 'mail',
    label: 'Mail',
    urls: ['message://', 'mailto:']
  },
  {
    id: 'maps',
    label: 'Maps',
    urls: ['maps://', 'http://maps.apple.com']
  },
  {
    id: 'safari',
    label: 'Safari',
    urls: ['x-web-search://', 'https://www.google.com']
  },
  {
    id: 'camera',
    label: 'Camera',
    urls: ['camera://']
  },
  {
    id: 'photos',
    label: 'Photos',
    urls: ['photos-redirect://', 'photos-navigation://']
  },
  {
    id: 'calendar',
    label: 'Calendar',
    urls: ['calshow://']
  },
  {
    id: 'reminders',
    label: 'Reminders',
    urls: ['x-apple-reminderkit://', 'x-apple-reminder://']
  },
  {
    id: 'notes',
    label: 'Notes',
    urls: ['mobilenotes://']
  },
  {
    id: 'settings',
    label: 'Settings',
    urls: ['App-Prefs:', 'prefs:']
  },
  {
    id: 'youtube',
    label: 'YouTube',
    urls: ['youtube://', 'https://www.youtube.com']
  },
  {
    id: 'instagram',
    label: 'Instagram',
    urls: ['instagram://', 'https://www.instagram.com']
  },
  {
    id: 'twitter',
    label: 'X / Twitter',
    urls: ['twitter://', 'https://x.com']
  }
]

const APP_TOOL_DEFINITION = {
  name: 'open_app',
  description:
    'Open a phone app or URL for Kai (Spotify, Apple Music, Messages, Maps, Safari, YouTube, Settings, Camera, Photos, Calendar, Reminders, Notes, Instagram, X/Twitter, or a raw https/app URL). Use when he asks to open, launch, or switch to an app. This cannot control playback inside Spotify beyond opening the app.',
  parameters: {
    type: 'object',
    properties: {
      app: {
        type: 'string',
        description:
          'App id or name: spotify, apple_music, messages, phone, mail, maps, safari, camera, photos, calendar, reminders, notes, settings, youtube, instagram, twitter'
      },
      url: {
        type: 'string',
        description: 'Optional deep link or https URL to open instead of / in addition to the app shortcut'
      }
    }
  }
} as const

export const PHONE_TOOL_DEFINITIONS = [...WEB_TOOL_DEFINITIONS, APP_TOOL_DEFINITION] as const

export function toOpenAITools(): Array<{
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}> {
  return PHONE_TOOL_DEFINITIONS.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as Record<string, unknown>
    }
  }))
}

export function toAnthropicTools(): Array<{
  name: string
  description: string
  input_schema: Record<string, unknown>
}> {
  return PHONE_TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as Record<string, unknown>
  }))
}

function resolveApp(raw: string): AppTarget | null {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (!key) return null
  const aliases: Record<string, string> = {
    music: 'apple_music',
    applemusic: 'apple_music',
    apple_music: 'apple_music',
    sms: 'messages',
    imessage: 'messages',
    text: 'messages',
    x: 'twitter',
    x_twitter: 'twitter',
    browser: 'safari',
    web: 'safari',
    google_maps: 'maps',
    apple_maps: 'maps'
  }
  const id = aliases[key] || key
  return APP_TARGETS.find((target) => target.id === id || target.label.toLowerCase() === raw.trim().toLowerCase()) || null
}

async function tryOpenUrls(urls: string[]): Promise<{ ok: boolean; opened?: string; detail: string }> {
  const Linking = getLinking()
  for (const url of urls) {
    try {
      // Prefer openURL directly — canOpenURL is unreliable without every scheme declared.
      await Linking.openURL(url)
      return { ok: true, opened: url, detail: `Opened ${url}` }
    } catch {
      /* try next candidate */
    }
  }
  return {
    ok: false,
    detail: 'Could not open that app or URL on this phone. It may not be installed, or iOS blocked the scheme.'
  }
}

async function executeOpenApp(args: Record<string, unknown>): Promise<PhoneToolResult> {
  const rawUrl = String(args.url ?? '').trim()
  const appName = String(args.app ?? '').trim()
  const urls: string[] = []

  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol.length > 1) {
        urls.push(rawUrl)
      }
    } catch {
      if (/^[a-z][a-z0-9+.-]*:/i.test(rawUrl)) urls.push(rawUrl)
    }
  }

  const target = resolveApp(appName)
  if (target) urls.push(...target.urls)

  if (!urls.length) {
    return {
      ok: false,
      result:
        'Specify an app (spotify, apple_music, messages, maps, safari, youtube, …) or a url to open.'
    }
  }

  const result = await tryOpenUrls(urls)
  if (!result.ok) return { ok: false, result: result.detail }
  return {
    ok: true,
    result: target
      ? `Opened ${target.label} on this phone${result.opened ? ` via ${result.opened}` : ''}. In-app control (play/pause/search) still needs the Mac companion when available.`
      : result.detail
  }
}

export async function executePhoneTool(
  name: string,
  args: Record<string, unknown>
): Promise<PhoneToolResult> {
  if (name === 'open_app') return executeOpenApp(args)
  return executeWebTool(name, args)
}

export { parseToolArguments }
