import { useEffect, useState, type RefObject } from 'react'

type Link = { id: string; d: string; x: number; y: number; endX: number; endY: number }

/** Side panel → the ring tab that belongs to it. */
const RING_FOR_PORT: Record<string, string> = {
  conversation: 'conversation',
  memory: 'memory',
  mission: 'missions',
  source: 'computer'
}

/** Structural links follow the actual panels and ring tabs. */
export function WorkshopConnections({ root }: { root: RefObject<HTMLElement | null> }): React.JSX.Element {
  const [links, setLinks] = useState<Link[]>([])
  useEffect(() => {
    const host = root.current
    if (!host) return
    const ring = host.querySelector<HTMLElement>('.workshop-ring')
    const panels = [...host.querySelectorAll<HTMLElement>('[data-workshop-port]')]
    if (!ring) return
    let frame = 0
    const measure = (): void => {
      const box = host.getBoundingClientRect()
      const hub = ring.getBoundingClientRect()
      if (hub.width > box.width * 0.65) {
        setLinks([])
        return
      }
      const local = (x: number, y: number): { x: number; y: number } => ({
        x: x - box.left + host.scrollLeft,
        y: y - box.top + host.scrollTop
      })
      const svg = host.querySelector<SVGSVGElement>('.ring-svg')
      const svgBox = svg?.getBoundingClientRect()
      if (!svgBox || svgBox.width < 8) {
        setLinks([])
        return
      }
      const next = panels.map((panel) => {
        const port = panel.dataset.workshopPort || ''
        const sector = host.querySelector<SVGGraphicsElement>(`[data-ring-id="${RING_FOR_PORT[port] || ''}"]`)
        const anchorX = Number(sector?.dataset.anchorX)
        const anchorY = Number(sector?.dataset.anchorY)
        if (!sector || !Number.isFinite(anchorX) || !Number.isFinite(anchorY)) return null
        const p = panel.getBoundingClientRect()
        if (p.width < 8) return null
        const end = local(
          svgBox.left + (anchorX / 700) * svgBox.width,
          svgBox.top + (anchorY / 640) * svgBox.height
        )
        const panelOnLeft = p.left + p.width / 2 < svgBox.left + (anchorX / 700) * svgBox.width
        const panelY = Math.min(p.bottom - 22, Math.max(p.top + 22, svgBox.top + (anchorY / 640) * svgBox.height))
        const start = local(panelOnLeft ? p.right : p.left, panelY)
        const direction = Math.sign(end.x - start.x) || (panelOnLeft ? 1 : -1)
        const reach = Math.abs(end.x - start.x)
        if (reach < 8) return null
        const lead = Math.min(26, reach * 0.22)
        const knee = start.x + direction * lead
        const near = end.x - direction * Math.min(10, reach * 0.12)
        return {
          id: port,
          x: start.x,
          y: start.y,
          endX: end.x,
          endY: end.y,
          d: `M${start.x.toFixed(1)} ${start.y.toFixed(1)} H${knee.toFixed(1)} L${near.toFixed(1)} ${end.y.toFixed(1)} H${end.x.toFixed(1)}`
        }
      }).filter((link): link is Link => link !== null)
      setLinks(next)
    }
    const schedule = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(host)
    observer.observe(ring)
    panels.forEach((panel) => observer.observe(panel))
    host.querySelectorAll('[data-ring-id]').forEach((sector) => observer.observe(sector))
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [root])

  return (
    <svg className="workshop-connections" aria-hidden="true">
      {links.map((link) => (
        <g key={link.id} className={`workshop-connection connection-${link.id}`}>
          <path d={link.d} />
          <circle cx={link.x} cy={link.y} r="2.4" />
          <circle cx={link.endX} cy={link.endY} r="2.4" />
        </g>
      ))}
    </svg>
  )
}
