import type { VoiceState } from '../../../shared/types'

export function AlbertCore({
  state,
  variant = 'home',
  wakeArmed = false,
  fault = false,
  label
}: {
  state: VoiceState
  variant?: 'home' | 'comm'
  wakeArmed?: boolean
  fault?: boolean
  label?: string
}): React.JSX.Element {
  const liveLabel =
    label ||
    (state === 'idle'
      ? wakeArmed
        ? 'Albert core, wake phrase armed'
        : 'Albert core, standing by'
      : `Albert core, ${state}`)
  return (
    <div
      className={`reactor-wrap albert-core albert-core--${variant} state-${state}${variant === 'home' ? ' jarvis-reactor' : ' voice-stage'}${wakeArmed ? ' is-wake-armed' : ''}${fault ? ' has-fault' : ''}`}
      role="img"
      aria-label={liveLabel}
    >
      {/* Slow forward sweep — matches mobile slowSpin */}
      <div className="reactor-ring sweep" aria-hidden="true" />
      {/* Two orbit nodes — spins opposite the mid/cardinal ring (mobile forward) */}
      <div className="reactor-ring outer" aria-hidden="true">
        <span className="reactor-sat n" />
        <span className="reactor-sat s" />
      </div>
      {/* Four cardinals — reverse of the two-dot outer ring (mobile reverseSpin) */}
      <div className="reactor-ring mid" aria-hidden="true">
        <span className="reactor-dot n" />
        <span className="reactor-dot e" />
        <span className="reactor-dot s" />
        <span className="reactor-dot w" />
      </div>
      <div className="reactor-ring inner" aria-hidden="true" />
      <div className="reactor-crosshair" aria-hidden="true" />
      <div className={`orb reactor-core ${state}`} aria-hidden="true" />
    </div>
  )
}
