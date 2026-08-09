/**
 * Multi-source public web tools for the phone brain.
 * Fans out across general web + Reddit + Wikipedia + YouTube (via DuckDuckGo),
 * then optionally deep-reads a couple of promising pages.
 */

export type WebToolResult = { ok: boolean; result: string }

type SearchHit = {
  title: string
  url: string
  snippet: string
  source: 'web' | 'reddit' | 'wikipedia' | 'youtube' | 'other'
}

export const WEB_TOOL_DEFINITIONS = [
  {
    name: 'web_search',
    description:
      'Search the live public web across multiple sources (general web, Reddit, Wikipedia, YouTube). Use for current facts, opinions, how-tos, news, or anything that can go stale. Returns mixed titles, URLs, snippets, and short page extracts when available. Follow with web_fetch on the best links when you need more depth.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: {
          type: 'number',
          description: 'Max results per source lane (1–6, default 4)'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'web_fetch',
    description:
      'Fetch a public URL and return readable text (HTML stripped). Use after web_search to read Reddit threads, docs, news, or Wikipedia in depth. Prefer https URLs. YouTube pages usually only yield titles/descriptions, not full transcripts.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'https URL to fetch' },
        max_chars: {
          type: 'number',
          description: 'Max characters to return (default 6000, max 12000)'
        }
      },
      required: ['url']
    }
  }
] as const

export function toOpenAITools(): Array<{
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}> {
  return WEB_TOOL_DEFINITIONS.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as Record<string, unknown>
    }
  }))
}

export function toAnthropicTools(): Array<{
  name: string
  description: string
  input_schema: Record<string, unknown>
}> {
  return WEB_TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as Record<string, unknown>
  }))
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function classifySource(url: string): SearchHit['source'] {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    if (host === 'reddit.com' || host.endsWith('.reddit.com')) return 'reddit'
    if (host === 'wikipedia.org' || host.endsWith('.wikipedia.org')) return 'wikipedia'
    if (
      host === 'youtube.com' ||
      host === 'youtu.be' ||
      host.endsWith('.youtube.com') ||
      host === 'm.youtube.com'
    ) {
      return 'youtube'
    }
  } catch {
    /* fall through */
  }
  return 'web'
}

function normalizeUrl(raw: string): string {
  let href = raw
  const uddg = href.match(/[?&]uddg=([^&]+)/)
  if (uddg?.[1]) {
    try {
      href = decodeURIComponent(uddg[1])
    } catch {
      /* keep */
    }
  }
  return href
}

function dedupeHits(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>()
  const out: SearchHit[] = []
  for (const hit of hits) {
    let key = hit.url
    try {
      const parsed = new URL(hit.url)
      parsed.hash = ''
      key = `${parsed.hostname}${parsed.pathname}`.toLowerCase().replace(/\/+$/, '')
    } catch {
      key = hit.url.toLowerCase()
    }
    if (seen.has(key)) continue
    seen.add(key)
    out.push(hit)
  }
  return out
}

async function duckDuckGoInstant(query: string): Promise<{
  abstract: string
  abstractUrl: string
  answer: string
  related: string[]
}> {
  const url =
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}` +
    `&format=json&no_html=1&skip_disambig=1`
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'ALBERT-Mobile/1.1 (personal assistant)' }
  })
  if (!res.ok) throw new Error(`DuckDuckGo API ${res.status}`)
  const data = (await res.json()) as {
    AbstractText?: string
    AbstractURL?: string
    Answer?: string
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string } | { Topics?: unknown }>
  }
  const related: string[] = []
  for (const item of data.RelatedTopics || []) {
    if ('Text' in item && item.Text) {
      related.push(item.FirstURL ? `${item.Text} — ${item.FirstURL}` : item.Text)
    }
    if (related.length >= 5) break
  }
  return {
    abstract: (data.AbstractText || '').trim(),
    abstractUrl: (data.AbstractURL || '').trim(),
    answer: (data.Answer || '').trim(),
    related
  }
}

async function duckDuckGoHtml(query: string, limit: number): Promise<SearchHit[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const res = await fetch(url, {
    headers: {
      Accept: 'text/html',
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    }
  })
  if (!res.ok) throw new Error(`DuckDuckGo HTML ${res.status}`)
  const html = await res.text()
  const hits: SearchHit[] = []

  const blockRe =
    /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a>|class="result__snippet"[^>]*>([\s\S]*?)<\/td>)/gi
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(html)) && hits.length < limit) {
    const href = normalizeUrl(m[1] || '')
    const title = stripTags(m[2] || '')
    const snippet = stripTags(m[3] || m[4] || '')
    if (!title || !href.startsWith('http')) continue
    hits.push({ title, url: href, snippet, source: classifySource(href) })
  }

  if (hits.length === 0) {
    const simple = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
    while ((m = simple.exec(html)) && hits.length < limit) {
      const href = normalizeUrl(m[1] || '')
      const title = stripTags(m[2] || '')
      if (!title || !href.startsWith('http')) continue
      hits.push({ title, url: href, snippet: '', source: classifySource(href) })
    }
  }

  return hits
}

async function wikipediaSearch(query: string, limit: number): Promise<SearchHit[]> {
  const api =
    `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}` +
    `&limit=${limit}&namespace=0&format=json`
  const res = await fetch(api, {
    headers: { Accept: 'application/json', 'User-Agent': 'ALBERT-Mobile/1.1 (personal assistant)' }
  })
  if (!res.ok) throw new Error(`Wikipedia ${res.status}`)
  const data = (await res.json()) as [string, string[], string[], string[]]
  const titles = data[1] || []
  const descs = data[2] || []
  const urls = data[3] || []
  const hits: SearchHit[] = []
  for (let i = 0; i < titles.length; i++) {
    const url = urls[i] || ''
    if (!url) continue
    hits.push({
      title: titles[i]!,
      url,
      snippet: descs[i] || '',
      source: 'wikipedia'
    })
  }
  return hits
}

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase()
  return (
    h === 'localhost' ||
    h.endsWith('.local') ||
    h === '0.0.0.0' ||
    h.startsWith('127.') ||
    h.startsWith('10.') ||
    h.startsWith('192.168.') ||
    h.startsWith('169.254.')
  )
}

async function fetchPageText(url: string, maxChars: number): Promise<string> {
  const res = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'ALBERT-Mobile/1.1 (personal assistant)'
    },
    redirect: 'follow'
  })
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`)
  const ctype = res.headers.get('content-type') || ''
  if (!/text|html|json|xml/i.test(ctype) && ctype) {
    return `(Non-text content-type: ${ctype})`
  }
  const raw = await res.text()
  return stripTags(raw).slice(0, maxChars) || '(empty page)'
}

function formatHitGroup(label: string, hits: SearchHit[]): string[] {
  if (!hits.length) return []
  const lines = [`${label}:`]
  hits.forEach((hit, index) => {
    lines.push(`${index + 1}. ${hit.title}`)
    lines.push(`   ${hit.url}`)
    if (hit.snippet) lines.push(`   ${hit.snippet}`)
  })
  return lines
}

function pickDeepReads(hits: SearchHit[], max = 2): SearchHit[] {
  const preferred = hits.filter((hit) => hit.source === 'web' || hit.source === 'reddit' || hit.source === 'wikipedia')
  const pool = preferred.length ? preferred : hits.filter((hit) => hit.source !== 'youtube')
  return pool.slice(0, max)
}

/** Exported for tests — runs the multi-source search fan-out. */
export async function multiSourceSearch(query: string, perSource = 4): Promise<string> {
  const limit = Math.min(6, Math.max(1, perSource))
  const [
    instant,
    general,
    reddit,
    youtube,
    wikiSite,
    wikiApi
  ] = await Promise.all([
    duckDuckGoInstant(query).catch(() => null),
    duckDuckGoHtml(query, limit + 2).catch(() => [] as SearchHit[]),
    duckDuckGoHtml(`${query} site:reddit.com`, limit).catch(() => [] as SearchHit[]),
    duckDuckGoHtml(`${query} site:youtube.com`, limit).catch(() => [] as SearchHit[]),
    duckDuckGoHtml(`${query} site:wikipedia.org`, Math.min(limit, 3)).catch(() => [] as SearchHit[]),
    wikipediaSearch(query, Math.min(limit, 4)).catch(() => [] as SearchHit[])
  ])

  const taggedGeneral = general.map((hit) => ({ ...hit, source: classifySource(hit.url) }))
  const taggedReddit = reddit.map((hit) => ({ ...hit, source: 'reddit' as const }))
  const taggedYoutube = youtube.map((hit) => ({ ...hit, source: 'youtube' as const }))
  const taggedWiki = dedupeHits([
    ...wikiApi,
    ...wikiSite.map((hit) => ({ ...hit, source: 'wikipedia' as const }))
  ])

  const webOnly = dedupeHits(
    taggedGeneral.filter((hit) => hit.source === 'web' || hit.source === 'other')
  ).slice(0, limit + 1)
  const redditHits = dedupeHits([
    ...taggedReddit,
    ...taggedGeneral.filter((hit) => hit.source === 'reddit')
  ]).slice(0, limit)
  const youtubeHits = dedupeHits([
    ...taggedYoutube,
    ...taggedGeneral.filter((hit) => hit.source === 'youtube')
  ]).slice(0, limit)
  const wikiHits = taggedWiki.slice(0, limit)

  const lines: string[] = [
    `Multi-source search: ${query}`,
    'Synthesize across these sources. Prefer primary docs / Wikipedia for facts; Reddit for lived experience; YouTube for demos/reviews. Cite links when helpful.'
  ]
  if (instant?.answer) lines.push(`Quick answer: ${instant.answer}`)
  if (instant?.abstract) {
    lines.push(
      `Encyclopedia-style summary: ${instant.abstract}${instant.abstractUrl ? ` (${instant.abstractUrl})` : ''}`
    )
  }

  lines.push(...formatHitGroup('Web', webOnly))
  lines.push(...formatHitGroup('Reddit', redditHits))
  lines.push(...formatHitGroup('Wikipedia', wikiHits))
  lines.push(...formatHitGroup('YouTube', youtubeHits))

  if (instant?.related?.length && webOnly.length + redditHits.length + wikiHits.length === 0) {
    lines.push('Related:')
    instant.related.forEach((row, index) => lines.push(`${index + 1}. ${row}`))
  }

  const deepCandidates = pickDeepReads(
    dedupeHits([...wikiHits, ...redditHits, ...webOnly]),
    2
  )
  if (deepCandidates.length) {
    lines.push('Deep reads (auto-fetched excerpts):')
    for (const hit of deepCandidates) {
      try {
        const parsed = new URL(hit.url)
        if (isPrivateHost(parsed.hostname)) continue
        const excerpt = await fetchPageText(parsed.toString(), 1_800)
        lines.push(`• ${hit.title} — ${hit.url}`)
        lines.push(`  ${excerpt}`)
      } catch (error) {
        lines.push(
          `• ${hit.title} — ${hit.url} (fetch failed: ${error instanceof Error ? error.message : String(error)})`
        )
      }
    }
  }

  if (lines.length <= 2) {
    throw new Error('No web results. Try a different query.')
  }
  return lines.join('\n')
}

export async function executeWebTool(
  name: string,
  args: Record<string, unknown>
): Promise<WebToolResult> {
  if (name === 'web_search') {
    const query = String(args.query ?? '').trim()
    if (!query) return { ok: false, result: 'Query is required.' }
    const limit = Math.min(6, Math.max(1, Number(args.limit) || 4))
    try {
      return { ok: true, result: await multiSourceSearch(query, limit) }
    } catch (error) {
      return {
        ok: false,
        result: `Web search failed: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }

  if (name === 'web_fetch') {
    const url = String(args.url ?? '').trim()
    if (!url) return { ok: false, result: 'URL is required.' }
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { ok: false, result: 'Invalid URL.' }
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, result: 'Only http/https URLs are allowed.' }
    }
    if (isPrivateHost(parsed.hostname)) {
      return { ok: false, result: 'Localhosts/private URLs are blocked.' }
    }
    const maxChars = Math.min(12_000, Math.max(500, Number(args.max_chars) || 6_000))
    try {
      const text = await fetchPageText(parsed.toString(), maxChars)
      return { ok: true, result: `URL: ${parsed}\n\n${text}` }
    } catch (error) {
      return {
        ok: false,
        result: `Fetch failed: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }

  return { ok: false, result: `Unknown tool: ${name}` }
}

export function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  if (typeof raw !== 'string' || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    /* ignore */
  }
  return {}
}
