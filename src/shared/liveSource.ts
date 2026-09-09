/**
 * Paths that crash the running Electron/Vite session if rewritten mid-flight.
 * Pure (no Electron) so Codex approvals and tests can share the same rule.
 */
const LIVE_REL =
  /^\/(src|scripts)(\/|$)|^\/(electron\.vite\.config[^/]*|package\.json)$/

export function resolveLivePath(path: string, root: string): string {
  const p = path.trim().replace(/\\/g, '/')
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!p || !base) return p
  if (p === base || p.startsWith(`${base}/`)) return p
  if (p.startsWith('/')) return p
  return `${base}/${p.replace(/^\.\//, '')}`
}

export function isLiveSourcePath(absPath: string, root: string): boolean {
  const target = resolveLivePath(absPath, root).replace(/\/+$/, '')
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!target || !base) return false
  if (target !== base && !target.startsWith(`${base}/`)) return false
  const rel = target.slice(base.length) || '/'
  return LIVE_REL.test(rel)
}

export function liveSourceHit(paths: string[], root: string): string | null {
  if (!root) return null
  for (const path of paths) {
    if (!path) continue
    const abs = resolveLivePath(path, root)
    if (isLiveSourcePath(abs, root)) return abs
  }
  return null
}

/** Paths mentioned in a Codex/unified diff — relative or absolute. */
export function pathsFromUnifiedDiff(diff: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const line of diff.split('\n')) {
    let path = ''
    const git = /^diff --git a\/(.+) b\/(.+)$/.exec(line)
    if (git) path = git[2] || git[1] || ''
    const plus = /^\+\+\+ (?:[ab]\/)?(.+)$/.exec(line)
    if (plus && plus[1] !== '/dev/null') path = plus[1]
    if (!path || path === '/dev/null') continue
    if (seen.has(path)) continue
    seen.add(path)
    out.push(path)
  }
  return out
}

/** Shell that would mutate live ALBERT source — not mere reads like rg/cat. */
export function commandLooksLikeLiveSourceWrite(command: string): boolean {
  const c = command.trim()
  if (!c) return false
  const mentionsLive =
    /(^|[\s'"=`])(\.\/)?(src|scripts)\//.test(c) ||
    /electron\.vite\.config/.test(c) ||
    /(^|[\s'"=`])package\.json\b/.test(c)
  if (!mentionsLive) return false

  if (/(>>?|tee\s+(-a\s+)?)\s*['"]?(?:\.\/)?(src|scripts)\//.test(c)) return true
  if (/(>>?|tee\s+(-a\s+)?)\s*['"]?[^'"\s]*(electron\.vite\.config|package\.json)/.test(c)) {
    return true
  }
  if (/\b(sed|perl|ruby)\s+[^\n]*-i[^\n]*\b(src|scripts|electron\.vite\.config|package\.json)/.test(c)) {
    return true
  }
  if (/\b(rm|mv|cp|install|truncate)\b/.test(c) && /\b(src|scripts)\//.test(c)) return true
  if (/\b(git\s+(apply|checkout|restore)|patch)\b/.test(c) && /\b(src|scripts)\//.test(c)) {
    return true
  }
  if (/\b(python[23]?|node|npx)\b[^\n]*\b(src|scripts)\//.test(c) && />|writeFile|output/.test(c)) {
    return true
  }
  return false
}
