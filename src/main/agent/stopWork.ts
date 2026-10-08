import { BrowserWindow } from 'electron'
import { interruptCodexTurn } from '../codex/service'
import { cancelComputerWork } from '../computer/automation'
import { interruptCursorAgent } from '../cursor/agent'
import { cancelKokoroSynthesis } from '../voice/kokoro'
import { supersedeChatTurn } from './turnControl'

/** Same sequence as CommandOrControl+Shift+. — stops every live turn surface. */
export function stopCurrentWork(): boolean {
  supersedeChatTurn()
  cancelComputerWork()
  cancelKokoroSynthesis()
  void interruptCodexTurn()
  interruptCursorAgent()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('albert:chat:event', { type: 'done' })
    }
  }
  return true
}
