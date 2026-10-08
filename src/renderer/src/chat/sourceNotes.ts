export type SourceNoteState = { state: 'pending' | 'saved' | 'error'; error?: string }

// Session-local status follows the page, including while the hub is unmounted.
// The artifact store keeps its existing versioning semantics.
export function createSourceNoteCache() {
  let snapshot = new Map<string, SourceNoteState>()
  const listeners = new Set<() => void>()
  const update = (key: string, value: SourceNoteState): void => {
    snapshot = new Map(snapshot).set(key, value)
    listeners.forEach((listener) => listener())
  }
  return {
    getSnapshot: () => snapshot as ReadonlyMap<string, SourceNoteState>,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    async save(key: string, write: () => Promise<unknown>): Promise<void> {
      const state = snapshot.get(key)?.state
      if (!key || state === 'pending' || state === 'saved') return
      update(key, { state: 'pending' })
      try {
        await write()
        update(key, { state: 'saved' })
      } catch (error) {
        update(key, { state: 'error', error: error instanceof Error ? error.message : 'Couldn’t save that note.' })
      }
    }
  }
}

export const sourceNoteCache = createSourceNoteCache()
