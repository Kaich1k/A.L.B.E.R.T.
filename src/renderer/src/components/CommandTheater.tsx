import { useEffect, useState } from 'react'
import type { TheaterEvent } from '../../../shared/types'
import { useAlbertStore } from '../store'

export function CommandTheater(): React.JSX.Element {
  const activity = useAlbertStore((s) => s.activity)
  const [events, setEvents] = useState<TheaterEvent[]>([])

  useEffect(() => {
    void window.albert.listTheater().then(setEvents).catch(() => undefined)
  }, [activity])

  const nodes = events.slice(0, 16)

  return (
    <div className="command-theater">
      <header>
        <div className="eyebrow">COMMAND THEATER</div>
        <h3>{nodes.length ? 'Live operations map' : 'Waiting for the next tool'}</h3>
      </header>
      <svg viewBox="0 0 640 280" className="theater-map" aria-label="Tool operations map">
        {nodes.map((event, index) => {
          const x = 48 + (index % 8) * 74
          const y = 70 + Math.floor(index / 8) * 110
          const ok = event.phase === 'end' ? event.ok !== false : undefined
          return (
            <g key={event.id}>
              {index > 0 ? (
                <line
                  x1={48 + ((index - 1) % 8) * 74 + 18}
                  y1={70 + Math.floor((index - 1) / 8) * 110}
                  x2={x}
                  y2={y}
                  className="theater-edge"
                />
              ) : null}
              <circle cx={x} cy={y} r={16} className={ok === false ? 'fault' : event.phase === 'start' ? 'live' : 'ok'} />
              <text x={x} y={y + 36} textAnchor="middle">
                {(event.toolName || 'tool').replaceAll('_', ' ').slice(0, 14)}
              </text>
            </g>
          )
        })}
      </svg>
      <ol>
        {nodes.map((event) => (
          <li key={`${event.id}-row`}>
            <b>{event.phase === 'start' ? '▸' : event.ok === false ? '×' : '✓'}</b>
            <span>{event.toolName.replaceAll('_', ' ')}</span>
            <small>{event.resultPreview || event.argsPreview}</small>
          </li>
        ))}
      </ol>
    </div>
  )
}
