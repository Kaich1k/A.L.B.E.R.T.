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
  const liveLabel = label || (state === 'idle' ? (wakeArmed ? 'Albert core, wake phrase armed' : 'Albert core, standing by') : `Albert core, ${state}`)
  return (
    <div
      className={`reactor-wrap albert-core albert-core--${variant} state-${state}${variant === 'home' ? ' jarvis-reactor' : ' voice-stage'}${wakeArmed ? ' is-wake-armed' : ''}${fault ? ' has-fault' : ''}`}
      role="img"
      aria-label={liveLabel}
    >
      <div className="reactor-ring outer" aria-hidden="true" />
      <div className="reactor-ring mid" aria-hidden="true" />
      <div className="reactor-ring inner" aria-hidden="true" />
      <div className="reactor-ring ticks" aria-hidden="true" />
      <div className="reactor-crosshair" aria-hidden="true" />
      <div className="reactor-dot n" aria-hidden="true" />
      <div className="reactor-dot e" aria-hidden="true" />
      <div className="reactor-dot s" aria-hidden="true" />
      <div className="reactor-dot w" aria-hidden="true" />
      <div className={`orb reactor-core ${state}`} aria-hidden="true" />
    </div>
  )
}
