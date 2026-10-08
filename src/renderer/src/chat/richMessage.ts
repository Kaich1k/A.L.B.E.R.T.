export type RichMessageToken =
  | { type: 'text'; value: string }
  | { type: 'link'; label: string; target: string; image: boolean; local: boolean }

const RICH_TOKEN =
  /(!?)\[([^\]]*)\]\((<?[^)\n]+>?)\)|:codex-file-citation\{path="([^"]+)"[^}]*\}/g

export function isLocalArtifactTarget(target: string): boolean {
  return target.startsWith('/')
}

export function isImageArtifactTarget(target: string): boolean {
  return /\.(?:png|jpe?g|gif|webp)$/i.test(target.split(/[?#]/, 1)[0] || '')
}

function cleanTarget(raw: string): string {
  const value = raw.trim()
  return value.startsWith('<') && value.endsWith('>') ? value.slice(1, -1) : value
}

function fallbackLabel(target: string): string {
  const clean = target.replace(/\/$/, '')
  return clean.split('/').pop() || 'Open artifact'
}

/**
 * Safe, deliberately small Markdown subset for Comm Link. It recognizes links,
 * images, and Codex file citations without ever evaluating arbitrary HTML.
 */
export function tokenizeRichMessage(content: string): RichMessageToken[] {
  const tokens: RichMessageToken[] = []
  let cursor = 0
  for (const match of content.matchAll(RICH_TOKEN)) {
    const index = match.index ?? 0
    if (index > cursor) tokens.push({ type: 'text', value: content.slice(cursor, index) })

    const citationTarget = match[4]
    const target = cleanTarget(citationTarget || match[3] || '')
    if (!target) {
      tokens.push({ type: 'text', value: match[0] })
    } else {
      const explicitImage = match[1] === '!'
      tokens.push({
        type: 'link',
        label: (citationTarget ? fallbackLabel(target) : match[2]) || fallbackLabel(target),
        target,
        image: explicitImage || isImageArtifactTarget(target),
        local: isLocalArtifactTarget(target)
      })
    }
    cursor = index + match[0].length
  }
  if (cursor < content.length) tokens.push({ type: 'text', value: content.slice(cursor) })
  return tokens.length ? tokens : [{ type: 'text', value: content }]
}

export function localImageTargets(tokens: RichMessageToken[]): Array<{ label: string; path: string }> {
  const seen = new Set<string>()
  const out: Array<{ label: string; path: string }> = []
  for (const token of tokens) {
    if (token.type !== 'link' || !token.local || !token.image || seen.has(token.target)) continue
    seen.add(token.target)
    out.push({ label: token.label, path: token.target })
  }
  return out
}
