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

  const urls = [
    ...text.matchAll(/https?:\/\/[^\s\]|'"]+/gi)
  ].map((m) => m[0].replace(/[.,;)]+$/, ''))

  const lan = urls.find((u) => !/127\.0\.0\.1|localhost/i.test(u))
  const local = urls.find((u) => /127\.0\.0\.1|localhost/i.test(u))
  if (lan) out.macBaseUrl = lan
  else if (local) out.macBaseUrl = local
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
