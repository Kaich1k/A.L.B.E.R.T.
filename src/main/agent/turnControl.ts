import { AsyncLocalStorage } from 'node:async_hooks'

interface TurnScope {
  generation: number
  signal: AbortSignal
}

const storage = new AsyncLocalStorage<TurnScope>()
let activeGeneration = 0
let activeController = new AbortController()

/** Generation of the turn that is allowed to render and speak. */
export function activeTurnGeneration(): number {
  return activeGeneration
}

export function activeTurnSignal(): AbortSignal {
  return activeController.signal
}

/**
 * A new typed or spoken message wins immediately.
 * The previous signal aborts, and later tokens from that turn are dropped.
 */
export function supersedeChatTurn(): TurnScope {
  activeController.abort()
  activeGeneration += 1
  activeController = new AbortController()
  const scope: TurnScope = {
    generation: activeGeneration,
    signal: activeController.signal
  }
  return scope
}

export function enterChatTurn<T>(scope: TurnScope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn)
}

export function currentTurnScope(): TurnScope | undefined {
  return storage.getStore()
}

/** True when `generation` is no longer the turn the UI should show. */
export function chatTurnStale(generation?: number): boolean {
  const gen = generation ?? storage.getStore()?.generation
  if (gen == null) return false
  return gen !== activeGeneration
}

/** Test-only reset. */
export function resetTurnControlForTests(): void {
  activeController.abort()
  activeGeneration = 0
  activeController = new AbortController()
}
