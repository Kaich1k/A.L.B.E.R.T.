import { useEffect, useRef } from 'react'

export type OrbMood = 'idle' | 'listening' | 'thinking' | 'speaking' | 'connecting' | 'working' | 'paused' | 'fault'

export function orbMood(voiceState: string, busy: boolean, fault = false): OrbMood {
  if (fault) return 'fault'
  if (voiceState === 'listening') return 'listening'
  if (voiceState === 'speaking') return 'speaking'
  if (voiceState === 'thinking' || voiceState === 'connecting') return voiceState
  if (busy) return 'working'
  return 'idle'
}

type Vec = { x: number; y: number; z: number }

function fibonacciSphere(count: number): Vec[] {
  const points: Vec[] = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / Math.max(1, count - 1)) * 2
    const radius = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = golden * i
    points.push({ x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius })
  }
  return points
}

function knnLinks(points: Vec[], k: number, maxDist: number): Array<[number, number]> {
  const links: Array<[number, number]> = []
  const seen = new Set<string>()
  const cap = maxDist * maxDist
  for (let i = 0; i < points.length; i++) {
    const near: Array<{ j: number; d: number }> = []
    const a = points[i]!
    for (let j = 0; j < points.length; j++) {
      if (i === j) continue
      const b = points[j]!
      const d = (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2
      if (d > cap) continue
      near.push({ j, d })
    }
    near.sort((x, y) => x.d - y.d)
    for (let n = 0; n < Math.min(k, near.length); n++) {
      const j = near[n]!.j
      const key = i < j ? `${i}-${j}` : `${j}-${i}`
      if (seen.has(key)) continue
      seen.add(key)
      links.push([i, j])
    }
  }
  return links
}

function latLonGrid(meridians: number, parallels: number, steps: number): Vec[][] {
  const lines: Vec[][] = []
  for (let m = 0; m < meridians; m++) {
    const theta = (m / meridians) * Math.PI * 2
    const line: Vec[] = []
    for (let s = 0; s <= steps; s++) {
      const phi = (s / steps) * Math.PI - Math.PI / 2
      const r = Math.cos(phi)
      line.push({ x: Math.cos(theta) * r, y: Math.sin(phi), z: Math.sin(theta) * r })
    }
    lines.push(line)
  }
  for (let p = 1; p < parallels; p++) {
    const phi = (p / parallels) * Math.PI - Math.PI / 2
    const r = Math.cos(phi)
    const line: Vec[] = []
    for (let s = 0; s <= steps; s++) {
      const theta = (s / steps) * Math.PI * 2
      line.push({ x: Math.cos(theta) * r, y: Math.sin(phi), z: Math.sin(theta) * r })
    }
    lines.push(line)
  }
  return lines
}

function extraChords(points: Vec[], count: number, minD: number, maxD: number): Array<[number, number]> {
  const links: Array<[number, number]> = []
  const seen = new Set<string>()
  let seed = 97
  const rand = (): number => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  let attempts = 0
  while (links.length < count && attempts < count * 80) {
    attempts += 1
    const i = Math.floor(rand() * points.length)
    const j = Math.floor(rand() * points.length)
    if (i === j) continue
    const a = points[i]!
    const b = points[j]!
    const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
    if (d < minD || d > maxD) continue
    const key = i < j ? `${i}-${j}` : `${j}-${i}`
    if (seen.has(key)) continue
    seen.add(key)
    links.push([i, j])
  }
  return links
}

const POINTS = fibonacciSphere(286)
const LINKS = [...knnLinks(POINTS, 5, 0.3), ...extraChords(POINTS, 46, 0.55, 1.15)]
const GRID = latLonGrid(12, 6, 36)

function targetSpeed(mood: OrbMood): number {
  if (mood === 'listening' || mood === 'speaking') return 0.00092
  if (mood === 'thinking' || mood === 'working' || mood === 'connecting') return 0.00058
  if (mood === 'fault') return 0.0012
  return 0.00028
}

function moodGain(mood: OrbMood): number {
  if (mood === 'listening' || mood === 'speaking') return 1.18
  if (mood === 'thinking' || mood === 'working' || mood === 'connecting') return 1.08
  if (mood === 'fault') return 0.85
  return 1
}

export function FilamentOrb({
  mood = 'idle',
  label = 'Albert'
}: {
  mood?: OrbMood
  label?: string
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const moodRef = useRef(mood)
  moodRef.current = mood

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    let rot = 0.72
    let speed = targetSpeed('idle')
    let size = 0
    let last = performance.now()

    const resize = (): void => {
      const next = Math.max(72, Math.round(canvas.clientWidth || 240))
      if (next === size) return
      size = next
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(next * dpr)
      canvas.height = Math.round(next * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const tilt = 0.42
    const cosT = Math.cos(tilt)
    const sinT = Math.sin(tilt)

    const project = (p: Vec, cosR: number, sinR: number, c: number, R: number): Vec => {
      const y1 = p.y * cosT - p.z * sinT
      const z1 = p.y * sinT + p.z * cosT
      const x2 = p.x * cosR + z1 * sinR
      const z2 = -p.x * sinR + z1 * cosR
      return { x: c + x2 * R, y: c - y1 * R, z: z2 }
    }

    const draw = (now: number): void => {
      resize()
      const dt = Math.min(40, now - last)
      last = now
      const moodNow = moodRef.current
      const gain = moodGain(moodNow)
      speed += (targetSpeed(moodNow) - speed) * 0.05
      if (!reduced) rot += speed * dt

      const c = size / 2
      const R = size * 0.34
      const breath = reduced ? 1 : 1 + Math.sin(now * 0.0014) * 0.03
      const haloR = Math.min(size * 0.495, R * 1.42 * breath)
      const cosR = Math.cos(rot)
      const sinR = Math.sin(rot)
      ctx.clearRect(0, 0, size, size)

      const halo = ctx.createRadialGradient(c, c, R * 0.02, c, c, haloR)
      halo.addColorStop(0, `rgba(255, 255, 255, ${0.95 * gain})`)
      halo.addColorStop(0.1, `rgba(160, 228, 255, ${0.7 * gain})`)
      halo.addColorStop(0.28, `rgba(40, 150, 255, ${0.38 * gain})`)
      halo.addColorStop(0.58, `rgba(16, 80, 220, ${0.1 * gain})`)
      halo.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = halo
      ctx.beginPath()
      ctx.arc(c, c, haloR, 0, Math.PI * 2)
      ctx.fill()

      const volume = ctx.createRadialGradient(c - R * 0.22, c - R * 0.28, R * 0.04, c, c, R)
      volume.addColorStop(0, `rgba(210, 240, 255, ${0.22 * gain})`)
      volume.addColorStop(0.22, `rgba(40, 130, 255, ${0.16 * gain})`)
      volume.addColorStop(0.55, 'rgba(6, 28, 80, 0.22)')
      volume.addColorStop(1, 'rgba(2, 8, 22, 0.08)')
      ctx.fillStyle = volume
      ctx.beginPath()
      ctx.arc(c, c, R, 0, Math.PI * 2)
      ctx.fill()

      ctx.save()
      ctx.beginPath()
      ctx.arc(c, c, R - 0.4, 0, Math.PI * 2)
      ctx.clip()
      ctx.globalCompositeOperation = 'lighter'

      const strokeGrid = (front: boolean): void => {
        ctx.lineWidth = Math.max(0.55, size * 0.0024)
        for (const line of GRID) {
          let prev: Vec | null = null
          for (const point of line) {
            const p = project(point, cosR, sinR, c, R)
            const isFront = p.z >= -0.04
            if (prev && isFront === front && prev.z >= -0.04 === front) {
              const z = (prev.z + p.z) / 2
              const limb = 1 - Math.abs(z)
              const depth = front ? 0.2 + Math.max(0, z) * 0.62 + limb * 0.3 : 0.05 + limb * 0.08
              ctx.strokeStyle = front
                ? `rgba(150, 224, 255, ${depth * 0.72 * gain})`
                : `rgba(50, 130, 220, ${depth * 0.7 * gain})`
              ctx.beginPath()
              ctx.moveTo(prev.x, prev.y)
              ctx.lineTo(p.x, p.y)
              ctx.stroke()
            }
            prev = p
          }
        }
      }

      strokeGrid(false)
      for (const [i, j] of LINKS) {
        const a = project(POINTS[i]!, cosR, sinR, c, R)
        const b = project(POINTS[j]!, cosR, sinR, c, R)
        const z = (a.z + b.z) / 2
        if (z >= -0.02) continue
        const limb = 1 - Math.abs(z)
        ctx.strokeStyle = `rgba(40, 120, 210, ${(0.05 + limb * 0.1) * gain})`
        ctx.lineWidth = Math.max(0.5, size * 0.002)
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }

      strokeGrid(true)
      for (const [i, j] of LINKS) {
        const a = project(POINTS[i]!, cosR, sinR, c, R)
        const b = project(POINTS[j]!, cosR, sinR, c, R)
        const z = (a.z + b.z) / 2
        if (z < -0.02) continue
        const limb = 1 - Math.abs(z)
        ctx.strokeStyle = `rgba(110, 210, 255, ${(0.18 + Math.max(0, z) * 0.62 + limb * 0.32) * gain})`
        ctx.lineWidth = Math.max(0.6, size * 0.0026)
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }

      for (const point of POINTS) {
        const p = project(point, cosR, sinR, c, R)
        if (p.z < -0.12) continue
        const limb = 1 - Math.abs(p.z)
        const r = Math.max(0.7, size * 0.0052 * (0.45 + Math.max(0, p.z) + limb * 0.25))
        ctx.fillStyle = `rgba(210, 242, 255, ${(0.38 + Math.max(0, p.z) * 0.62 + limb * 0.22) * gain})`
        ctx.beginPath()
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()

      ctx.globalCompositeOperation = 'lighter'
      const core = ctx.createRadialGradient(c, c, 0, c, c, R * 0.46)
      core.addColorStop(0, 'rgba(255, 255, 255, 1)')
      core.addColorStop(0.12, `rgba(220, 246, 255, ${0.95 * gain})`)
      core.addColorStop(0.32, `rgba(90, 180, 255, ${0.5 * gain})`)
      core.addColorStop(0.62, `rgba(30, 120, 255, ${0.12 * gain})`)
      core.addColorStop(1, 'rgba(20, 80, 220, 0)')
      ctx.fillStyle = core
      ctx.beginPath()
      ctx.arc(c, c, R * 0.46, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalCompositeOperation = 'source-over'

      ctx.beginPath()
      ctx.arc(c, c, R, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(200, 236, 255, ${0.42 * gain})`
      ctx.lineWidth = Math.max(1, size * 0.0042)
      ctx.stroke()

      raf = window.requestAnimationFrame(draw)
    }

    raf = window.requestAnimationFrame(draw)
    return () => window.cancelAnimationFrame(raf)
  }, [])

  return (
    <div className={`filament-orb mood-${mood}${mood === 'idle' || mood === 'paused' ? ' is-quiet' : ''}`} role="img" aria-label={label}>
      <canvas ref={canvasRef} style={{ background: 'transparent' }} />
    </div>
  )
}
