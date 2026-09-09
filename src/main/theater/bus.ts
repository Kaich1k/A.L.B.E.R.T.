import { v4 as uuid } from 'uuid'
import type { TheaterEvent } from '../../shared/types'

const MAX = 48
const events: TheaterEvent[] = []

export function pushTheaterEvent(partial: Omit<TheaterEvent, 'id' | 'createdAt'> & { id?: string; createdAt?: number }): TheaterEvent {
  const event: TheaterEvent = {
    id: partial.id || uuid(),
    toolName: partial.toolName,
    argsPreview: String(partial.argsPreview || '').slice(0, 180),
    resultPreview: partial.resultPreview ? String(partial.resultPreview).slice(0, 180) : undefined,
    ok: partial.ok,
    phase: partial.phase,
    createdAt: partial.createdAt || Date.now()
  }
  events.unshift(event)
  if (events.length > MAX) events.length = MAX
  return event
}

export function listTheaterEvents(): TheaterEvent[] {
  return [...events]
}

export function clearTheater(): void {
  events.length = 0
}
