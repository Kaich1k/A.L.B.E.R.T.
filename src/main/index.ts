// Must be first: pins ~/Library/Application Support/albert before other imports.
import './userData'

import { app, BrowserWindow, globalShortcut, nativeImage, shell } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { APP_NAME } from '../shared/brand'
import { registerIpcHandlers } from './ipc/handlers'
import { closeDb, getDb } from './memory/db'
import { getSettings } from './config'
import { applyCompanionSettings, stopCompanionServer } from './companion/server'
import { startOperationsScheduler, stopOperationsScheduler } from './operations/scheduler'

// Load OPENAI_API_KEY from env if present
if (process.env.OPENAI_API_KEY) {
  // available via getSettings fallback
}

let mainWindow: BrowserWindow | null = null

function resolveAppIcon(): string | undefined {
  const candidates = [
    join(__dirname, '../../resources/icon.png'),
    join(process.resourcesPath, 'icon.png'),
    join(app.getAppPath(), 'resources/icon.png')
  ]
  return candidates.find((path) => existsSync(path))
}

function createWindow(): void {
  const iconPath = resolveAppIcon()
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 640,
    title: APP_NAME,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#03090e',
    show: false,
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      // Voice can be entered by the wake phrase without a click. Explicitly
      // permit that trusted app flow to resume Web Audio and play the reply.
      autoplayPolicy: 'no-user-gesture-required'
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function toggleWindow(): void {
  if (!mainWindow) {
    createWindow()
    return
  }
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide()
  } else {
    mainWindow.show()
    mainWindow.focus()
  }
}

app.whenReady().then(() => {
  getDb()
  registerIpcHandlers(() => mainWindow)
  // Do NOT load Kokoro/Whisper/onnxruntime in this process — it SIGTRAP/SIGSEGVs Electron.
  // Both run in child Node processes (ELECTRON_RUN_AS_NODE) on first use.

  const iconPath = resolveAppIcon()
  if (iconPath && process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(iconPath))
  }

  createWindow()
  startOperationsScheduler(() => mainWindow)

  globalShortcut.register('CommandOrControl+Shift+A', () => {
    toggleWindow()
  })

  // Warm settings read + optional phone companion LAN server
  getSettings()
  void applyCompanionSettings().catch((err) => {
    console.error('Companion server failed to start', err)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else mainWindow?.show()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  void stopCompanionServer()
  stopOperationsScheduler()
  closeDb()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
