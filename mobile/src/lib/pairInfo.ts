/** Rank companion URLs for phone use. IPv4 LAN beats flaky .local mDNS on iOS. */
function urlPreference(url: string): number {
  if (/127\.0\.0\.1|localhost/i.test(url)) return 0
  try {
    const host = new URL(url).hostname
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return 4
    if (host.endsWith('.local')) return 1
    return 3
  } catch {
    return 2
  }
}

function pickBestUrl(urls: string[]): string | undefined {
  let best: string | undefined
  let bestScore = -1
  for (const url of urls) {
    const score = urlPreference(url)
    if (score > bestScore) {
      best = url
      bestScore = score
    }
  }
  return best
}

/** Parse Mac "Copy pair info" clipboard blobs into URL + token. */
export function parsePairInfo(raw: string): { macBaseUrl?: string; macToken?: string } {
  const text = raw.trim()
  if (!text) return {}

  const out: { macBaseUrl?: string; macToken?: string } = {}

  const tokenLine =
    text.match(/^\s*Token:\s*([a-f0-9]{16,})\s*$/im) ||
    text.match(/^\s*TOKEN\s*=\s*([a-f0-9]{16,})\s*$/im) ||
    text.match(/\bToken:\s*([a-f0-9]{16,})\b/i)
  if (tokenLine?.[1]) out.macToken = tokenLine[1].trim()

  const urls = [...text.matchAll(/https?:\/\/[^\s\]|'"]+/gi)].map((m) =>
    m[0].replace(/[.,;)]+$/, '')
  )

  const preferred = pickBestUrl(urls)
  if (preferred) out.macBaseUrl = preferred
  else if (/^https?:\/\//i.test(text) && !text.includes('\n')) {
    out.macBaseUrl = text.replace(/\/+$/, '')
  }

  // Bare hex token alone
  if (!out.macToken && /^[a-f0-9]{24,}$/i.test(text)) {
    out.macToken = text
  }

  return out
}

export function normalizeMacUrl(url: string): string {
  let input = url.trim()
  if (!input) return ''
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) input = `http://${input}`
  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    throw new Error('Enter a valid Mac companion address')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Mac companion addresses must use http:// or https://')
  }
  if (parsed.username || parsed.password) {
    throw new Error('Do not place credentials in the Mac companion URL')
  }
  if (!parsed.hostname) throw new Error('Mac companion address is missing a host')
  // Sync endpoints are fixed and credentials belong only in Authorization headers.
  return `${parsed.protocol}//${parsed.host}`
}

/** True when the URL can only work from the Mac itself / iOS Simulator. */
export function isLoopbackMacUrl(url: string): boolean {
  try {
    const host = normalizeMacUrl(url)
    if (!host) return false
    return /^(https?:\/\/)?(127\.0\.0\.1|localhost)(:|\/|$)/i.test(host)
  } catch {
    return /127\.0\.0\.1|localhost/i.test(url)
  }
}

/** True when the URL relies on Bonjour/mDNS, which is often unreliable on iPhone. */
export function isMdnsMacUrl(url: string): boolean {
  try {
    return new URL(normalizeMacUrl(url)).hostname.endsWith('.local')
  } catch {
    return /\.local(?::|\/|$)/i.test(url)
  }
}
