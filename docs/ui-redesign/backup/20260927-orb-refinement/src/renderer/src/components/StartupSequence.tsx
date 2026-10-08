import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FilamentOrb } from './FilamentOrb'
import '../styles/startup-sequence.css'

const DEFAULT_STORAGE_KEY = 'albert.startup-sequence.seen.v1'

interface StartupStage {
  code: string
  label: string
  detail: string
  progress: number
}

const STARTUP_STAGES: readonly StartupStage[] = [
  {
    code: 'SYS.01',
    label: 'Interface shell',
    detail: 'Local renderer initialized',
    progress: 16
  },
  {
    code: 'CORE.02',
    label: 'Cognitive core',
    detail: 'Routing matrix inspected',
    progress: 38
  },
  {
    code: 'MEM.03',
    label: 'Memory matrix',
    detail: 'Local context index mounted',
    progress: 62
  },
  {
    code: 'OPS.04',
    label: 'Voice & operations',
    detail: 'Interfaces standing by',
    progress: 84
  },
  {
    code: 'READY',
    label: 'Interface ready',
    detail: 'Standing by',
    progress: 100
  }
]

export interface StartupSequenceProps {
  /** Called after the overlay has fully handed control to the application. */
  onComplete?: () => void
  /** Replays the sequence even if it has already run in this renderer session. */
  force?: boolean
  /** Defaults to once per session. Set false when previewing the sequence. */
  oncePerSession?: boolean
  /** Override the sessionStorage key when embedding more than one sequence. */
  storageKey?: string
  /** Uses a shorter, lower-GPU sequence. Defaults to the body `perf-mode` class. */
  performanceMode?: boolean
  /** Optional name used in the final time-aware greeting. */
  operatorName?: string
  /** Whether at least one cognitive provider route is configured. */
  brainConfigured?: boolean
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
    // Storage can be disabled without preventing startup.
  }
}

function getGreeting(operatorName?: string): string {
  const hour = new Date().getHours()
  const salutation = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  return operatorName?.trim() ? `${salutation}, ${operatorName.trim()}.` : `${salutation}.`
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  )

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!query) return

    const update = (): void => setReduced(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return reduced
}

/**
 * Full-window, once-per-session startup presentation for A.L.B.E.R.T.
 *
 * The component owns no application state and can be mounted next to the app shell.
 * Escape or the visible Skip control immediately begins the handoff.
 */
export function StartupSequence({
  onComplete,
  force = false,
  oncePerSession = true,
  storageKey = DEFAULT_STORAGE_KEY,
  performanceMode,
  operatorName,
  brainConfigured = false
}: StartupSequenceProps): React.JSX.Element | null {
  const [visible, setVisible] = useState(
    () => force || !oncePerSession || !hasPlayed(storageKey)
  )
  const [activeStage, setActiveStage] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const leavingRef = useRef(false)
  const skipRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const notifiedRef = useRef(false)
  const onCompleteRef = useRef(onComplete)
  const reducedMotion = useReducedMotion()

  onCompleteRef.current = onComplete

  useEffect(() => {
    const replay = (): void => {
      leavingRef.current = false
      notifiedRef.current = false
      setActiveStage(0)
      setLeaving(false)
      setVisible(true)
    }
    window.addEventListener('albert:replay-startup', replay)
    return () => window.removeEventListener('albert:replay-startup', replay)
  }, [])

  const lowPower =
    performanceMode ??
    (typeof document !== 'undefined' && document.body.classList.contains('perf-mode'))
  const greeting = useMemo(() => getGreeting(operatorName), [operatorName])
  const stage = STARTUP_STAGES[activeStage]

  const notifyComplete = useCallback((): void => {
    if (notifiedRef.current) return
    notifiedRef.current = true
    onCompleteRef.current?.()
  }, [])

  const finish = useCallback((): void => {
    if (leavingRef.current) return
    leavingRef.current = true
    if (oncePerSession) markPlayed(storageKey)
    setActiveStage(STARTUP_STAGES.length - 1)
    setLeaving(true)
  }, [oncePerSession, storageKey])

  // A previously completed session should still notify consumers that startup is clear.
  useEffect(() => {
    if (!visible) notifyComplete()
  }, [notifyComplete, visible])

  useEffect(() => {
    if (!visible) return

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusTimer = window.setTimeout(() => skipRef.current?.focus(), 40)

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        finish()
        return
      }

      // The overlay is a modal with one control; keep keyboard focus inside it.
      if (event.key === 'Tab') {
        event.preventDefault()
        skipRef.current?.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [finish, visible])

  useEffect(() => {
    if (!visible || leaving) return

    if (reducedMotion) {
      setActiveStage(STARTUP_STAGES.length - 1)
      const timer = window.setTimeout(finish, 650)
      return () => window.clearTimeout(timer)
    }

    // Performance mode preserves the story beat while spending less time animating.
    const marks = lowPower ? [0, 220, 440, 660, 880] : [0, 410, 830, 1260, 1700]
    const timers = marks.map((delay, index) =>
      window.setTimeout(() => setActiveStage(index), delay)
    )
    timers.push(window.setTimeout(finish, lowPower ? 1180 : 2100))

    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [finish, leaving, lowPower, reducedMotion, visible])

  useEffect(() => {
    if (!visible || !leaving) return
    const exitDelay = reducedMotion ? 80 : lowPower ? 220 : 420
    const timer = window.setTimeout(() => {
      setVisible(false)
      previousFocusRef.current?.focus()
      notifyComplete()
    }, exitDelay)
    return () => window.clearTimeout(timer)
  }, [leaving, lowPower, notifyComplete, reducedMotion, visible])

  if (!visible) return null

  return (
    <section
      className={`startup-sequence${leaving ? ' startup-sequence--leaving' : ''}${lowPower ? ' startup-sequence--low-power' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="startup-title"
      aria-describedby="startup-status"
    >
      <div className="startup-dock" aria-hidden="true">
        <div className="workshop-home startup-home">
          <div />
          <div className="workshop-hub">
            <div className="workshop-ring">
              <div className="workshop-orb-dock">
                <FilamentOrb variant="hub" mood="idle" label="Albert starting" />
              </div>
            </div>
            <div className="startup-voice-spacer" />
            <div className="startup-chip-spacer" />
          </div>
          <div />
        </div>
      </div>
      <p className="startup-sequence__sr" id="startup-status">
        <span id="startup-title">
          {activeStage === STARTUP_STAGES.length - 1
            ? brainConfigured
              ? greeting
              : 'Core awaiting provider'
            : stage.label}
        </span>
      </p>
      <button ref={skipRef} type="button" className="startup-skip" onClick={finish}>
        Skip
      </button>
    </section>
  )
}

export default StartupSequence
