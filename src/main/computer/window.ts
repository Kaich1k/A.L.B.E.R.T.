import { BrowserWindow, nativeImage } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { APP_NAME } from '../../shared/brand'

let computerWindow: BrowserWindow | null = null

function resolveAppIcon(): string | undefined {
  const candidates = [
    join(__dirname, '../../../resources/icon.png'),
    join(process.resourcesPath, 'icon.png'),
    join(process.cwd(), 'resources/icon.png')
  ]
  return candidates.find((path) => existsSync(path))
}

export function getComputerWindow(): BrowserWindow | null {
  return computerWindow
}

/** Create or focus Albert’s dedicated Computer browser window. */
export function showComputerWindow(): BrowserWindow {
  if (computerWindow && !computerWindow.isDestroyed()) {
    if (computerWindow.isMinimized()) computerWindow.restore()
    computerWindow.show()
    computerWindow.focus()
    return computerWindow
  }

  const iconPath = resolveAppIcon()
  computerWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 520,
    title: `${APP_NAME} Computer`,
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
      webviewTag: true
    }
  })

  if (iconPath && process.platform === 'darwin') {
    try {
      computerWindow.setIcon(nativeImage.createFromPath(iconPath))
    } catch {
      /* ignore */
    }
  }

  computerWindow.on('ready-to-show', () => {
    computerWindow?.show()
  })

  computerWindow.on('closed', () => {
    computerWindow = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void computerWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}#computer`)
  } else {
    void computerWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: 'computer'
    })
  }

  return computerWindow
}

export function closeComputerWindow(): void {
  if (computerWindow && !computerWindow.isDestroyed()) {
    computerWindow.close()
  }
  computerWindow = null
}
