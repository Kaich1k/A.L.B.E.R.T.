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
  let u = url.trim().replace(/\/+$/, '')
  if (!u) return ''
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`
  return u
}
