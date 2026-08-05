import { BrowserWindow, Notification } from 'electron'
import { createMission, getDueRoutines, markRoutineRun } from './service'

let timer: NodeJS.Timeout | null = null

function tick(getWindow: () => BrowserWindow | null): void {
  for (const routine of getDueRoutines()) {
    const mission = createMission({
      title: routine.name,
      outcome: routine.prompt,
      source: 'routine',
      risk: 'prepare',
      steps: ['Review trigger and available context', 'Prepare the requested outcome', 'Report results']
    })
    markRoutineRun(routine.id)
    getWindow()?.webContents.send('albert:operations:changed')
    if (Notification.isSupported()) {
      new Notification({
        title: `Routine ready: ${routine.name}`,
        body: `Mission created for review: ${mission.outcome}`,
        silent: true
      }).show()
    }
  }
}

export function startOperationsScheduler(getWindow: () => BrowserWindow | null): void {
  stopOperationsScheduler()
  tick(getWindow)
  timer = setInterval(() => tick(getWindow), 30_000)
}

export function stopOperationsScheduler(): void {
  if (timer) clearInterval(timer)
  timer = null
}
