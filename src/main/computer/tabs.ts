import { BrowserWindow, ipcMain } from 'electron'
import { v4 as uuid } from 'uuid'
import type { ComputerState, ComputerTab } from '../../shared/types'
import { IpcChannels } from '../../shared/ipc'
import { getComputerWindow, showComputerWindow } from './window'

let state: ComputerState = { tabs: [], activeTabId: null }

type PageResult = { title: string; url: string; text: string }
const pageWaiters = new Map<
  string,
  { resolve: (v: PageResult) => void; reject: (e: Error) => void }
>()

function targetWindow(): BrowserWindow {
  return showComputerWindow()
}

function broadcast(): void {
  const win = getComputerWindow()
  win?.webContents.send('albert:computer:changed', getComputerState())
}

export function getComputerState(): ComputerState {
  return {
    tabs: state.tabs.map((t) => ({ ...t })),
    activeTabId: state.activeTabId
  }
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return 'about:blank'
  if (/^https?:\/\//i.test(trimmed) || trimmed === 'about:blank') return trimmed
  if (trimmed.includes('.') && !trimmed.includes(' ')) {
    return `https://${trimmed}`
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}

export function openComputerTab(url: string, title?: string): ComputerTab {
  targetWindow()
  const tab: ComputerTab = {
    id: uuid(),
    title: title?.trim() || 'New tab',
    url: normalizeUrl(url),
    loading: true
  }
  state = {
    tabs: [...state.tabs, tab],
    activeTabId: tab.id
  }
  broadcast()
  return tab
}

export function navigateComputerTab(tabId: string | undefined, url: string): ComputerTab | null {
  targetWindow()
  const id = tabId || state.activeTabId
  if (!id) return null
  const nextUrl = normalizeUrl(url)
  state = {
    ...state,
    tabs: state.tabs.map((t) =>
      t.id === id ? { ...t, url: nextUrl, loading: true, lastError: undefined } : t
    )
  }
  broadcast()
  return state.tabs.find((t) => t.id === id) || null
}

export function focusComputerTab(tabId: string): boolean {
  targetWindow()
  if (!state.tabs.some((t) => t.id === tabId)) return false
  state = { ...state, activeTabId: tabId }
  broadcast()
  return true
}

export function closeComputerTab(tabId: string): boolean {
  const tabs = state.tabs.filter((t) => t.id !== tabId)
  let activeTabId = state.activeTabId
  if (activeTabId === tabId) {
    activeTabId = tabs.length ? tabs[tabs.length - 1].id : null
  }
  state = { tabs, activeTabId }
  broadcast()
  return true
}

export function updateComputerTab(
  tabId: string,
  patch: Partial<Pick<ComputerTab, 'title' | 'url' | 'loading' | 'lastError'>>
): void {
  state = {
    ...state,
    tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t))
  }
  broadcast()
}

export function requestComputerPage(tabId?: string): Promise<PageResult> {
  const win = targetWindow()
  const id = tabId || state.activeTabId
  if (!id) return Promise.reject(new Error('No active computer tab'))

  const requestId = uuid()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pageWaiters.delete(requestId)
      reject(new Error('Timed out reading page — is the Computer window open?'))
    }, 12000)
    pageWaiters.set(requestId, {
      resolve: (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      reject: (e) => {
        clearTimeout(timer)
        reject(e)
      }
    })
    // Give the window a moment to mount webviews after first open
    const send = (): void => {
      if (win.isDestroyed()) {
        pageWaiters.delete(requestId)
        reject(new Error('Computer window closed'))
        return
      }
      win.webContents.send('albert:computer:get-page', { requestId, tabId: id })
    }
    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', () => setTimeout(send, 200))
    } else {
      setTimeout(send, 150)
    }
  })
}

export function registerComputerIpc(): void {
  ipcMain.handle(IpcChannels.computerState, () => getComputerState())

  ipcMain.handle(IpcChannels.computerShow, () => {
    showComputerWindow()
    return getComputerState()
  })

  ipcMain.handle(IpcChannels.computerOpen, (_e, payload: { url: string; title?: string }) => {
    return openComputerTab(payload.url, payload.title)
  })

  ipcMain.handle(
    IpcChannels.computerNavigate,
    (_e, payload: { tabId?: string; url: string }) => {
      return navigateComputerTab(payload.tabId, payload.url)
    }
  )

  ipcMain.handle(IpcChannels.computerFocus, (_e, tabId: string) => {
    return focusComputerTab(tabId)
  })

  ipcMain.handle(IpcChannels.computerClose, (_e, tabId: string) => {
    return closeComputerTab(tabId)
  })

  ipcMain.handle(
    IpcChannels.computerUpdateTab,
    (
      _e,
      payload: {
        tabId: string
        title?: string
        url?: string
        loading?: boolean
        lastError?: string
      }
    ) => {
      updateComputerTab(payload.tabId, payload)
      return getComputerState()
    }
  )

  ipcMain.handle(IpcChannels.computerGetPage, async (_e, tabId?: string) => {
    return requestComputerPage(tabId)
  })

  ipcMain.on(
    'albert:computer:get-page-result',
    (
      _e,
      payload: {
        requestId: string
        ok: boolean
        title?: string
        url?: string
        text?: string
        error?: string
      }
    ) => {
      const waiter = pageWaiters.get(payload.requestId)
      if (!waiter) return
      pageWaiters.delete(payload.requestId)
      if (!payload.ok) {
        waiter.reject(new Error(payload.error || 'Failed to read page'))
        return
      }
      waiter.resolve({
        title: payload.title || '',
        url: payload.url || '',
        text: payload.text || ''
      })
    }
  )
}
