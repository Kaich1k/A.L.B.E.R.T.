import { useCallback, useEffect, useRef, useState } from 'react'
import { FilamentOrb } from './FilamentOrb'
import '../styles/startup-sequence.css'

const DEFAULT_STORAGE_KEY = 'albert.startup-sequence.seen.v1'

interface StartupOptions {
  enabled: boolean
  performanceMode?: boolean
  oncePerSession?: boolean
  storageKey?: string
  force?: boolean
  onStart?: () => void
  onComplete?: () => void
}

export interface StartupPlayback {
  active: boolean
  finish: () => void
}

function hasPlayed(storageKey: string): boolean {
  try {
    return window.sessionStorage.getItem(storageKey) === '1'
  } catch {
    return false
  }
}

function markPlayed(storageKey: string): void {
  try {
    window.sessionStorage.setItem(storageKey, '1')
  } catch {
    // A blocked storage area must not block the interface.
  }
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  )
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!media) return
    const update = (): void => setReduced(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return reduced
}

/** Visual introduction only. Actual readiness and provider state come from the app. */
export function useStartupSequence(options: StartupOptions): StartupPlayback {
  const {
    enabled,
    performanceMode = false,
    oncePerSession = true,
    storageKey = DEFAULT_STORAGE_KEY,
    force = false
  } = options
  const optionsRef = useRef(options)
  optionsRef.current = options
  const [active, setActive] = useState(false)
  const [run, setRun] = useState(0)
  const activeRef = useRef(false)
  const notifiedRef = useRef(false)
  const attemptedKeyRef = useRef<string | null>(null)
  const reducedMotion = useReducedMotion()

  const notifyComplete = useCallback((): void => {
    if (notifiedRef.current) return
    notifiedRef.current = true
    optionsRef.current.onComplete?.()
  }, [])

  const finish = useCallback((): void => {
    if (!activeRef.current) return
    activeRef.current = false
    if (oncePerSession) markPlayed(storageKey)
    setActive(false)
    notifyComplete()
  }, [notifyComplete, oncePerSession, storageKey])

  const begin = useCallback((): void => {
    if (!optionsRef.current.enabled) return
    notifiedRef.current = false
    activeRef.current = true
    setRun((value) => value + 1)
    setActive(true)
    optionsRef.current.onStart?.()
  }, [])

  useEffect(() => {
    if (!enabled) {
      finish()
      return
    }
    // StrictMode's effect replay must not launch the same introduction twice.
    if (attemptedKeyRef.current === storageKey) return
    attemptedKeyRef.current = storageKey
    if (force || !oncePerSession || !hasPlayed(storageKey)) begin()
    else notifyComplete()
  }, [begin, enabled, finish, force, notifyComplete, oncePerSession, storageKey])

  useEffect(() => {
    const replay = (): void => begin()
    window.addEventListener('albert:replay-startup', replay)
    return () => window.removeEventListener('albert:replay-startup', replay)
  }, [begin])

  useEffect(() => {
    if (!active) return
    // No progress meter or simulated initialization stages: this is a brief animation.
    const timer = window.setTimeout(finish, reducedMotion ? 250 : performanceMode ? 1180 : 2100)
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') finish()
    }
    document.addEventListener('keydown', escape)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('keydown', escape)
    }
  }, [active, finish, performanceMode, reducedMotion, run])

  return { active: enabled && active, finish }
}

/** Inline controls for the existing Hub orb; this component never creates an orb. */
export function StartupDockControls({ playback }: { playback: StartupPlayback }): React.JSX.Element | null {
  if (!playback.active) return null
  return (
    <div className="startup-inline" role="group" aria-label="Startup animation">
      <span role="status">Starting Albert</span>
      <button type="button" className="startup-inline__skip" onClick={playback.finish}>
        Skip
      </button>
    </div>
  )
}

export interface StartupSequenceProps {
  onComplete?: () => void
  force?: boolean
  oncePerSession?: boolean
  storageKey?: string
  performanceMode?: boolean
}

/** Classic retains its separate presentation. Workshop uses the real Hub and hook above. */
export function StartupSequence(props: StartupSequenceProps): React.JSX.Element | null {
  const playback = useStartupSequence({ ...props, enabled: true })
  const skipRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!playback.active) return
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const timer = window.setTimeout(() => skipRef.current?.focus(), 40)
    const trapTab = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      event.preventDefault()
      skipRef.current?.focus()
    }
    document.addEventListener('keydown', trapTab)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('keydown', trapTab)
      const previous = previousFocusRef.current
      if (previous?.isConnected) previous.focus()
    }
  }, [playback.active])

  if (!playback.active) return null
  return (
    <section className="startup-sequence" role="dialog" aria-modal="true" aria-label="Albert startup animation">
      <div className="startup-dock" aria-hidden="true">
        <div className="workshop-home startup-home">
          <div />
          <div className="workshop-hub">
            <div className="workshop-ring">
              <div className="workshop-orb-dock">
                <FilamentOrb variant="hub" mood="connecting" label="Albert startup animation" />
              </div>
            </div>
            <div className="startup-voice-spacer" />
            <div className="startup-chip-spacer" />
          </div>
          <div />
        </div>
      </div>
      <button ref={skipRef} type="button" className="startup-skip" onClick={playback.finish}>
        Skip
      </button>
    </section>
  )
}

export default StartupSequence
