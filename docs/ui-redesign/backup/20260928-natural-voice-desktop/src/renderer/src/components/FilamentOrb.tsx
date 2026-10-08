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
type Filament = { points: Vec[]; weight: number }
const TAU = Math.PI * 2

function smoothstep(from: number, to: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

// One continuous envelope per layer: crossing the limb never switches a
// particle, radius, glint, or filament abruptly between front/back styles.
function nodeVisibility(depth: number): number {
  return smoothstep(-0.015, 0.36, depth)
}

function lineVisibility(depth: number): number {
  const front = smoothstep(-0.38, 0.42, depth)
  return 0.045 + front * (0.60 + 0.22 * Math.max(0, depth))
}

function randomSource(seed: number): () => number {
  return () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
}

function unit(p: Vec): Vec {
  const length = Math.hypot(p.x, p.y, p.z) || 1
  return { x: p.x / length, y: p.y / length, z: p.z / length }
}

function spherePoints(count: number, seed: number, jitter: number): Vec[] {
  const random = randomSource(seed)
  const golden = Math.PI * (3 - Math.sqrt(5))
  return Array.from({ length: count }, (_, index) => {
    const y = 1 - ((index + 0.5) / count) * 2
    const radius = Math.sqrt(1 - y * y)
    const theta = golden * index
    return unit({
      x: Math.cos(theta) * radius + (random() - 0.5) * jitter,
      y: y + (random() - 0.5) * jitter,
      z: Math.sin(theta) * radius + (random() - 0.5) * jitter
    })
  })
}

// Spherical interpolation keeps every connection on the curved surface.
// Geometry is generated once, not rebuilt during animation or mood changes.
function sphericalArc(a: Vec, b: Vec): Vec[] {
  const angle = Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z)))
  const denominator = Math.sin(angle)
  const steps = Math.max(10, Math.ceil(angle * 14))
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps
    const u = Math.sin((1 - t) * angle) / denominator
    const v = Math.sin(t * angle) / denominator
    return { x: a.x * u + b.x * v, y: a.y * u + b.y * v, z: a.z * u + b.z * v }
  })
}

const STARS = spherePoints(120, 97, 0.19)
const DUST = spherePoints(340, 619, 0.12)
const FILAMENTS: Filament[] = (() => {
  const random = randomSource(1847)
  const lines: Filament[] = []
  const seen = new Set<string>()
  for (let i = 0; i < STARS.length; i++) {
    // Unequal long connections avoid a regular nearest-neighbor triangle mesh.
    const wanted = i % 4 === 0 ? 3 : 2
    let added = 0
    for (let attempt = 0; attempt < 90 && added < wanted; attempt++) {
      const j = Math.floor(random() * STARS.length)
      const a = STARS[i]!
      const b = STARS[j]!
      const dot = a.x * b.x + a.y * b.y + a.z * b.z
      if (j === i || dot > 0.86 || dot < -0.4) continue
      const key = i < j ? `${i}:${j}` : `${j}:${i}`
      if (seen.has(key)) continue
      seen.add(key)
      lines.push({ points: sphericalArc(a, b), weight: i % 5 === 0 ? 0.94 : 0.23 + random() * 0.30 })
      added++
    }
  }
  // Oblique planes add broad crossing arcs without longitude/latitude bands.
  for (let i = 0; i < 16; i++) {
    const normal = unit({ x: random() * 2 - 1, y: random() * 2 - 1, z: random() * 2 - 1 })
    const u = unit(Math.abs(normal.y) < 0.9
      ? { x: normal.z, y: 0, z: -normal.x }
      : { x: 0, y: -normal.z, z: normal.y })
    const v = {
      x: normal.y * u.z - normal.z * u.y,
      y: normal.z * u.x - normal.x * u.z,
      z: normal.x * u.y - normal.y * u.x
    }
    lines.push({
      weight: 0.18 + random() * 0.20,
      points: Array.from({ length: 81 }, (_, index) => {
        const a = (index / 80) * TAU
        return { x: u.x * Math.cos(a) + v.x * Math.sin(a), y: u.y * Math.cos(a) + v.y * Math.sin(a), z: u.z * Math.cos(a) + v.z * Math.sin(a) }
      })
    })
  }
  return lines
})()

function targetSpeed(mood: OrbMood): number {
  if (mood === 'paused') return 0
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

export function FilamentOrb({ mood = 'idle', label = 'Albert', variant = 'float' }: {
  mood?: OrbMood
  label?: string
  variant?: 'hub' | 'float'
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const moodRef = useRef(mood)
  const variantRef = useRef(variant)
  const redrawRef = useRef<(() => void) | null>(null)
  moodRef.current = mood
  variantRef.current = variant

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let disposed = false
    let raf = 0
    let rot = 0.72
    let speed = targetSpeed('idle')
    let size = 0
    let pixelRatio = 0
    let last = performance.now()
    let lastFrame = 0
    const cosT = Math.cos(0.42)
    const sinT = Math.sin(0.42)
    const animated = (): boolean => !media.matches && !document.hidden && moodRef.current !== 'paused'

    const resize = (): void => {
      const next = Math.max(72, Math.round(canvas.clientWidth || 240))
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      if (next === size && dpr === pixelRatio) return
      size = next
      pixelRatio = dpr
      canvas.width = Math.round(size * dpr)
      canvas.height = Math.round(size * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const draw = (now: number): void => {
      resize()
      const dt = Math.min(50, Math.max(0, now - last))
      last = now
      const gain = moodGain(moodRef.current)
      speed += (targetSpeed(moodRef.current) - speed) * 0.1
      if (animated()) rot += speed * dt
      const t = animated() ? now : 0
      const c = size / 2
      // Preserve the existing hub/detached sizing and docking geometry.
      const R = size * (variantRef.current === 'hub' ? 0.48 : 0.36)
      const cosR = Math.cos(rot)
      const sinR = Math.sin(rot)
      const project = (p: Vec): Vec => {
        const y = p.y * cosT - p.z * sinT
        const z = p.y * sinT + p.z * cosT
        return { x: c + (p.x * cosR + z * sinR) * R, y: c - y * R, z: -p.x * sinR + z * cosR }
      }
      const disk = (radius: number, fill: CanvasGradient | string): void => {
        ctx.fillStyle = fill
        ctx.beginPath()
        ctx.arc(c, c, radius, 0, TAU)
        ctx.fill()
      }
      ctx.clearRect(0, 0, size, size)
      ctx.globalCompositeOperation = 'source-over'

      const haloR = Math.min(size * 0.499, R * 1.2)
      const halo = ctx.createRadialGradient(c, c, R * 0.84, c, c, haloR)
      halo.addColorStop(0, 'rgba(0,80,240,0)')
      halo.addColorStop(0.60, `rgba(0,115,255,${0.18 * gain})`)
      halo.addColorStop(0.82, `rgba(0,145,255,${0.10 * gain})`)
      halo.addColorStop(1, 'rgba(0,90,255,0)')
      disk(haloR, halo)

      const body = ctx.createRadialGradient(c - R * 0.2, c - R * 0.2, 0, c, c, R)
      body.addColorStop(0, 'rgba(5,45,105,0.18)')
      body.addColorStop(0.62, 'rgba(0,24,75,0.30)')
      body.addColorStop(0.91, 'rgba(0,38,100,0.27)')
      body.addColorStop(1, 'rgba(0,86,185,0.20)')
      disk(R, body)

      const projected = FILAMENTS.map((line) => ({ points: line.points.map(project), weight: line.weight }))
      ctx.save()
      ctx.beginPath()
      ctx.arc(c, c, R, 0, TAU)
      ctx.clip()
      ctx.globalCompositeOperation = 'lighter'
      ctx.lineCap = 'butt'
      ctx.lineJoin = 'round'

      const filaments = (): void => {
        ctx.shadowBlur = 0
        for (const line of projected) {
          const primary = line.weight > 0.8
          // Fixed short runs preserve the depth gradient without thousands of
          // per-segment shadows. Run membership never changes with rotation.
          for (let start = 0; start < line.points.length - 1; start += 3) {
            const end = Math.min(start + 3, line.points.length - 1)
            const first = line.points[start]!
            let depth = first.z
            ctx.beginPath()
            ctx.moveTo(first.x, first.y)
            for (let i = start + 1; i <= end; i++) {
              const point = line.points[i]!
              ctx.lineTo(point.x, point.y)
              depth += point.z
            }
            depth /= end - start + 1
            const front = smoothstep(-0.38, 0.42, depth)
            const alpha = lineVisibility(depth) * line.weight * gain
            const red = primary ? 75 + front * 125 : 35 + front * 70
            const green = primary ? 165 + front * 77 : 133 + front * 80
            ctx.strokeStyle = `rgba(${red},${green},255,${alpha})`
            const width = primary ? 0.0018 + front * 0.00065 : 0.0011 + front * 0.00065
            ctx.lineWidth = Math.max(0.32, size * width) * (0.75 + line.weight * 0.35)
            ctx.stroke()
          }
        }
      }
      filaments()

      for (let i = 0; i < DUST.length; i++) {
        const p = project(DUST[i]!)
        const front = smoothstep(-0.28, 0.42, p.z)
        const limb = smoothstep(0, 0.14, Math.abs(p.z))
        const r = Math.max(0.26, size * (0.0008 + front * 0.0005)) * (0.65 + limb * 0.35)
        const alpha = (0.045 + front * 0.35) * (0.12 + limb * 0.88) * gain
        ctx.fillStyle = `rgba(40,165,255,${alpha})`
        ctx.beginPath()
        ctx.arc(p.x, p.y, r, 0, TAU)
        ctx.fill()
      }

      for (let i = 0; i < STARS.length; i++) {
        const p = project(STARS[i]!)
        const hero = i % 5 === 0
        const bright = hero || i % 3 === 0
        const visibility = nodeVisibility(p.z)
        const limb = smoothstep(0.015, 0.34, p.z)
        const pulse = 0.92 + Math.sin(t * 0.0011 + i * 1.7) * 0.08
        const radius = Math.max(0.34, size * (hero ? 0.0047 : bright ? 0.0028 : 0.00155)) * (0.58 + limb * 0.42)
        if (bright) {
          const glowR = radius * (hero ? 4.8 : 3.8)
          const glowGain = visibility * limb * pulse * gain
          const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR)
          glow.addColorStop(0, `rgba(80,210,255,${0.61 * glowGain})`)
          glow.addColorStop(0.27, `rgba(0,135,255,${0.26 * glowGain})`)
          glow.addColorStop(1, 'rgba(0,90,255,0)')
          ctx.fillStyle = glow
          ctx.beginPath()
          ctx.arc(p.x, p.y, glowR, 0, TAU)
          ctx.fill()
        }
        ctx.fillStyle = bright ? `rgba(215,246,255,${0.86 * pulse * visibility * gain})` : `rgba(75,200,255,${0.48 * visibility * gain})`
        ctx.beginPath()
        ctx.arc(p.x, p.y, radius, 0, TAU)
        ctx.fill()
        if (hero) {
          const glint = smoothstep(0.20, 0.64, p.z) * visibility
          const arm = radius * (1.1 + glint * 1.2)
          ctx.strokeStyle = `rgba(135,230,255,${0.24 * pulse * glint * gain})`
          ctx.lineWidth = Math.max(0.4, size * 0.0011)
          ctx.beginPath()
          ctx.moveTo(p.x - arm, p.y)
          ctx.lineTo(p.x + arm, p.y)
          ctx.moveTo(p.x, p.y - arm)
          ctx.lineTo(p.x, p.y + arm)
          ctx.stroke()
        }
      }

      const coreR = R * 0.42
      const core = ctx.createRadialGradient(c, c, 0, c, c, coreR)
      core.addColorStop(0, 'rgba(245,255,255,0.98)')
      core.addColorStop(0.07, 'rgba(230,252,255,0.95)')
      core.addColorStop(0.19, `rgba(75,205,255,${0.78 * gain})`)
      core.addColorStop(0.5, `rgba(0,125,255,${0.36 * gain})`)
      core.addColorStop(1, 'rgba(0,90,255,0)')
      disk(coreR, core)
      ctx.restore()

      // A blue limb with several restrained bright accents, never a white disc.
      ctx.globalCompositeOperation = 'lighter'
      ctx.beginPath()
      ctx.arc(c, c, R * 0.995, 0, TAU)
      ctx.strokeStyle = `rgba(15,140,255,${0.48 * gain})`
      ctx.lineWidth = Math.max(1.2, size * 0.007)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(c, c, R * 0.991, 0, TAU)
      ctx.strokeStyle = `rgba(120,224,255,${0.48 * gain})`
      ctx.lineWidth = Math.max(0.6, size * 0.0028)
      ctx.stroke()
      ctx.strokeStyle = `rgba(190,246,255,${0.54 * gain})`
      for (const [a, b] of [[0.2, 0.6], [1.7, 2.2], [3.75, 4.5]]) {
        ctx.beginPath()
        ctx.arc(c, c, R * 0.989, a, b)
        ctx.stroke()
      }
      ctx.globalCompositeOperation = 'source-over'
    }

    const frame = (now: number): void => {
      raf = 0
      if (disposed) return
      // 30 fps is ample for this slowly turning object, including float windows.
      if (now - lastFrame >= 1000 / 30) {
        draw(now)
        lastFrame = now
      }
      if (animated()) raf = window.requestAnimationFrame(frame)
    }
    const refresh = (): void => {
      if (disposed) return
      if (raf) window.cancelAnimationFrame(raf)
      raf = 0
      last = performance.now()
      if (!document.hidden) {
        draw(last)
        lastFrame = last
        if (animated()) raf = window.requestAnimationFrame(frame)
      }
    }
    redrawRef.current = refresh
    const observer = new ResizeObserver(refresh)
    observer.observe(canvas)
    media.addEventListener('change', refresh)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('resize', refresh)
    refresh()
    return () => {
      disposed = true
      redrawRef.current = null
      window.cancelAnimationFrame(raf)
      observer.disconnect()
      media.removeEventListener('change', refresh)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('resize', refresh)
    }
  }, [])

  useEffect(() => { redrawRef.current?.() }, [mood, variant])

  return (
    <div className={`filament-orb mood-${mood}${mood === 'idle' || mood === 'paused' ? ' is-quiet' : ''}`} role="img" aria-label={label}>
      <canvas ref={canvasRef} style={{ background: 'transparent' }} />
    </div>
  )
}
