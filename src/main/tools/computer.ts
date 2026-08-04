import {
  closeComputerTab,
  focusComputerTab,
  getComputerState,
  navigateComputerTab,
  openComputerTab,
  requestComputerPage
} from '../computer/tabs'
import { showComputerWindow } from '../computer/window'
import type { ToolDefinition } from './types'

async function resolveYoutubeWatchUrl(query: string): Promise<{
  ok: boolean
  url: string
  detail: string
}> {
  const q = query.trim()
  if (!q) return { ok: false, url: '', detail: 'query required' }

  if (/youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts\//i.test(q)) {
    const url = /^https?:\/\//i.test(q) ? q : `https://${q}`
    return { ok: true, url, detail: 'direct url' }
  }

  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`
  try {
    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      signal: AbortSignal.timeout(12_000)
    })
    if (!res.ok) {
      return {
        ok: true,
        url: searchUrl,
        detail: `search page (lookup HTTP ${res.status})`
      }
    }
    const html = await res.text()
    const ids = [...html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)].map((m) => m[1]!)
    const unique = [...new Set(ids)]
    const videoId = unique[0]
    if (!videoId) {
      return { ok: true, url: searchUrl, detail: 'search results (no videoId parsed)' }
    }
    return {
      ok: true,
      url: `https://www.youtube.com/watch?v=${videoId}&autoplay=1`,
      detail: `watch ${videoId}`
    }
  } catch (err) {
    return {
      ok: true,
      url: searchUrl,
      detail: `search page (lookup failed: ${err instanceof Error ? err.message : String(err)})`
    }
  }
}

export const computerTools: ToolDefinition[] = [
  {
    name: 'computer_open_tab',
    description:
      'Open a new tab in YOUR sandbox Computer window (separate window inside A.L.B.E.R.T.). Prefer this over system browser tools when researching or working visibly. For YouTube videos, prefer computer_youtube instead.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL or search query' },
        title: { type: 'string', description: 'Optional tab title' }
      },
      required: ['url']
    },
    execute: async (args) => {
      showComputerWindow()
      const tab = openComputerTab(String(args.url || ''), String(args.title || ''))
      return {
        ok: true,
        result: `Opened Computer tab ${tab.id}: ${tab.title} → ${tab.url}. The Computer window should be visible — tell Kai briefly, do not dump tool syntax.`
      }
    }
  },
  {
    name: 'computer_youtube',
    description:
      'Find and play a YouTube video in YOUR Computer window. Use for “pull up a video on X”, tutorials, how-tos. Searches YouTube and opens the top result (watch URL with autoplay when possible).',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query, e.g. "arduino getting started tutorial"'
        },
        title: { type: 'string', description: 'Optional tab title' }
      },
      required: ['query']
    },
    execute: async (args) => {
      const query = String(args.query || '').trim()
      if (!query) return { ok: false, result: 'computer_youtube requires query.' }
      const resolved = await resolveYoutubeWatchUrl(query)
      showComputerWindow()
      const tab = openComputerTab(
        resolved.url,
        String(args.title || '').trim() || `YouTube · ${query.slice(0, 48)}`
      )
      return {
        ok: true,
        result: `Opened YouTube in Computer (${resolved.detail}): ${tab.url}. Tell Kai the video is up in your Computer window — one short sentence, no tool dumps.`
      }
    }
  },
  {
    name: 'computer_navigate',
    description: 'Navigate a Computer tab (defaults to the active tab).',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        tab_id: { type: 'string', description: 'Optional tab id' }
      },
      required: ['url']
    },
    execute: async (args) => {
      showComputerWindow()
      const tab = navigateComputerTab(
        args.tab_id ? String(args.tab_id) : undefined,
        String(args.url || '')
      )
      if (!tab) return { ok: false, result: 'No computer tab to navigate.' }
      return { ok: true, result: `Navigating ${tab.id} → ${tab.url}` }
    }
  },
  {
    name: 'computer_list_tabs',
    description: 'List all tabs in the sandbox Computer window.',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      const state = getComputerState()
      if (!state.tabs.length) return { ok: true, result: 'No computer tabs open.' }
      const lines = state.tabs.map(
        (t) =>
          `${t.id === state.activeTabId ? '* ' : '  '}${t.id.slice(0, 8)} | ${t.title} | ${t.url}${
            t.loading ? ' (loading)' : ''
          }`
      )
      return { ok: true, result: lines.join('\n') }
    }
  },
  {
    name: 'computer_focus_tab',
    description: 'Focus a Computer tab by id (brings Computer window forward).',
    parameters: {
      type: 'object',
      properties: { tab_id: { type: 'string' } },
      required: ['tab_id']
    },
    execute: async (args) => {
      showComputerWindow()
      const ok = focusComputerTab(String(args.tab_id || ''))
      return ok
        ? { ok: true, result: `Focused tab ${args.tab_id}` }
        : { ok: false, result: 'Tab not found.' }
    }
  },
  {
    name: 'computer_close_tab',
    description: 'Close a Computer tab by id.',
    parameters: {
      type: 'object',
      properties: { tab_id: { type: 'string' } },
      required: ['tab_id']
    },
    execute: async (args) => {
      const ok = closeComputerTab(String(args.tab_id || ''))
      return ok
        ? { ok: true, result: `Closed tab ${args.tab_id}` }
        : { ok: false, result: 'Tab not found.' }
    }
  },
  {
    name: 'computer_get_page',
    description:
      'Read the active (or specified) Computer tab: title, URL, and a text snippet of the page body.',
    parameters: {
      type: 'object',
      properties: { tab_id: { type: 'string' } }
    },
    execute: async (args) => {
      try {
        showComputerWindow()
        const page = await requestComputerPage(
          args.tab_id ? String(args.tab_id) : undefined
        )
        return {
          ok: true,
          result: `Title: ${page.title}\nURL: ${page.url}\n\n${page.text.slice(0, 4000)}`
        }
      } catch (err) {
        return {
          ok: false,
          result: err instanceof Error ? err.message : String(err)
        }
      }
    }
  }
]
