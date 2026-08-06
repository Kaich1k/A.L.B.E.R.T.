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
      <div className="reactor-ring sweep" aria-hidden="true" />
      <div className="reactor-ring outer" aria-hidden="true">
        <span className="reactor-sat n" />
        <span className="reactor-sat s" />
      </div>
      <div className="reactor-ring mid" aria-hidden="true" />
      <div className="reactor-ring cardinals" aria-hidden="true">
        <span className="reactor-dot n" />
        <span className="reactor-dot e" />
        <span className="reactor-dot s" />
        <span className="reactor-dot w" />
      </div>
      <div className="reactor-ring inner" aria-hidden="true" />
      <div className="reactor-ring ticks" aria-hidden="true" />
      <div className="reactor-crosshair" aria-hidden="true" />
      <div className={`orb reactor-core ${state}`} aria-hidden="true" />
    </div>
  )
}
