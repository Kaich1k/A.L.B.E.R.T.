export const app = {
  getPath(name) {
    if (name !== 'userData') throw new Error(`Unsupported Electron test path: ${name}`)
    const path = process.env.ALBERT_TEST_USER_DATA
    if (!path) throw new Error('ALBERT_TEST_USER_DATA is required for desktop integration tests')
    return path
  }
}

export class BrowserWindow {
  static getAllWindows() {
    const events = globalThis.__ALBERT_TEST_EVENTS__
    if (!Array.isArray(events)) return []
    return [{
      webContents: {
        send(channel, payload) {
          events.push({ channel, payload })
        }
      }
    }]
  }
}
