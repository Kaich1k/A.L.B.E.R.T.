import type { ToolDefinition } from './types'

type SearchHit = {
  title: string
  url: string
  snippet: string
  source?: 'web' | 'reddit' | 'wikipedia' | 'youtube' | 'other'
}

function classifySource(url: string): NonNullable<SearchHit['source']> {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    if (host === 'reddit.com' || host.endsWith('.reddit.com')) return 'reddit'
    if (host === 'wikipedia.org' || host.endsWith('.wikipedia.org')) return 'wikipedia'
    if (host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com')) return 'youtube'
  } catch {
    /* fall through */
  }
  return 'web'
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
    headers: { Accept: 'application/json', 'User-Agent': 'ALBERT/0.1 (personal assistant)' }
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
      related.push(
        item.FirstURL ? `${item.Text} — ${item.FirstURL}` : item.Text
      )
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
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    }
  })
  if (!res.ok) throw new Error(`DuckDuckGo HTML ${res.status}`)
  const html = await res.text()
  const hits: SearchHit[] = []

  // result blocks: <a class="result__a" href="...">title</a> ... <a class="result__snippet">
  const blockRe =
    /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a>|class="result__snippet"[^>]*>([\s\S]*?)<\/td>)/gi
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(html)) && hits.length < limit) {
    let href = m[1] || ''
    // DDG wraps redirects sometimes
    const uddg = href.match(/[?&]uddg=([^&]+)/)
    if (uddg?.[1]) {
      try {
        href = decodeURIComponent(uddg[1])
      } catch {
        /* keep */
      }
    }
    const title = stripTags(m[2] || '')
    const snippet = stripTags(m[3] || m[4] || '')
    if (!title || !href.startsWith('http')) continue
    hits.push({ title, url: href, snippet })
  }

  // Fallback simpler parse
  if (hits.length === 0) {
    const simple =
      /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
    while ((m = simple.exec(html)) && hits.length < limit) {
      let href = m[1] || ''
      const uddg = href.match(/[?&]uddg=([^&]+)/)
      if (uddg?.[1]) {
        try {
          href = decodeURIComponent(uddg[1])
        } catch {
          /* keep */
        }
      }
      const title = stripTags(m[2] || '')
      if (!title || !href.startsWith('http')) continue
      hits.push({ title, url: href, snippet: '' })
    }
  }

  return hits
}

async function wikipediaSearch(query: string, limit: number): Promise<SearchHit[]> {
  const api =
    `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}` +
    `&limit=${limit}&namespace=0&format=json`
  const res = await fetch(api, {
    headers: { Accept: 'application/json', 'User-Agent': 'ALBERT/0.1 (personal assistant)' }
  })
  if (!res.ok) throw new Error(`Wikipedia ${res.status}`)
  const data = (await res.json()) as [string, string[], string[], string[]]
  const titles = data[1] || []
  const descs = data[2] || []
  const urls = data[3] || []
  const hits: SearchHit[] = []
  for (let i = 0; i < titles.length; i++) {
    hits.push({
      title: titles[i]!,
      url: urls[i] || '',
      snippet: descs[i] || ''
    })
  }
  return hits.filter((h) => h.url)
}

async function fetchPageText(url: string, maxChars: number): Promise<string> {
  const res = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'ALBERT/0.1 (personal assistant; +local)'
    },
    redirect: 'follow',
    signal: typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
      ? AbortSignal.timeout(12000)
      : undefined
  })
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`)
  const ctype = res.headers.get('content-type') || ''
  if (!/text|html|json|xml/i.test(ctype) && ctype) {
    return `(Non-text content-type: ${ctype})`
  }
  const raw = await res.text()
  const text = stripTags(raw).slice(0, maxChars)
  return text || '(empty page)'
}

export const webTools: ToolDefinition[] = [
  {
    name: 'web_search',
    description:
      'Search the live public web across multiple sources (general web, Reddit, Wikipedia, YouTube). Use for current facts, opinions, how-tos, news, or anything that can go stale. Synthesize across sources; follow with web_fetch on the best links.',
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
    },
    execute: async (args) => {
      const query = String(args.query ?? '').trim()
      if (!query) return { ok: false, result: 'Query is required.' }
      const limit = Math.min(6, Math.max(1, Number(args.limit) || 4))

      try {
        const [instant, general, reddit, youtube, wikiSite, wikiApi] = await Promise.all([
          duckDuckGoInstant(query).catch(() => null),
          duckDuckGoHtml(query, limit + 2).catch(() => [] as SearchHit[]),
          duckDuckGoHtml(`${query} site:reddit.com`, limit).catch(() => [] as SearchHit[]),
          duckDuckGoHtml(`${query} site:youtube.com`, limit).catch(() => [] as SearchHit[]),
          duckDuckGoHtml(`${query} site:wikipedia.org`, Math.min(limit, 3)).catch(() => [] as SearchHit[]),
          wikipediaSearch(query, Math.min(limit, 4)).catch(() => [] as SearchHit[])
        ])

        const taggedGeneral = general.map((hit) => ({ ...hit, source: classifySource(hit.url) }))
        const webOnly = dedupeHits(
          taggedGeneral.filter((hit) => hit.source === 'web' || hit.source === 'other')
        ).slice(0, limit + 1)
        const redditHits = dedupeHits([
          ...reddit.map((hit) => ({ ...hit, source: 'reddit' as const })),
          ...taggedGeneral.filter((hit) => hit.source === 'reddit')
        ]).slice(0, limit)
        const youtubeHits = dedupeHits([
          ...youtube.map((hit) => ({ ...hit, source: 'youtube' as const })),
          ...taggedGeneral.filter((hit) => hit.source === 'youtube')
        ]).slice(0, limit)
        const wikiHits = dedupeHits([
          ...wikiApi.map((hit) => ({ ...hit, source: 'wikipedia' as const })),
          ...wikiSite.map((hit) => ({ ...hit, source: 'wikipedia' as const }))
        ]).slice(0, limit)

        const lines: string[] = [
          `Multi-source search: ${query}`,
          'Synthesize across these sources. Prefer primary docs / Wikipedia for facts; Reddit for lived experience; YouTube for demos/reviews.'
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
          instant.related.forEach((r, i) => lines.push(`${i + 1}. ${r}`))
        }

        const deep = dedupeHits([...wikiHits, ...redditHits, ...webOnly]).slice(0, 2)
        if (deep.length) {
          lines.push('Deep reads (auto-fetched excerpts):')
          for (const hit of deep) {
            try {
              const excerpt = await fetchPageText(hit.url, 1_800)
              lines.push(`• ${hit.title} — ${hit.url}`)
              lines.push(`  ${excerpt}`)
            } catch (err) {
              lines.push(
                `• ${hit.title} — ${hit.url} (fetch failed: ${err instanceof Error ? err.message : String(err)})`
              )
            }
          }
        }

        if (lines.length <= 2) {
          return {
            ok: false,
            result: 'No web results. Try a different query or open Computer to browse.'
          }
        }
        return { ok: true, result: lines.join('\n') }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, result: `Web search failed: ${message}` }
      }
    }
  },
  {
    name: 'web_fetch',
    description:
      'Fetch a public URL and return readable text (HTML stripped). Use after web_search to deep-read Reddit threads, docs, news, or Wikipedia. Prefer https URLs.',
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
    },
    execute: async (args) => {
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
      // Block obvious local/metadata targets
      const host = parsed.hostname.toLowerCase()
      if (
        host === 'localhost' ||
        host.endsWith('.local') ||
        host === '0.0.0.0' ||
        host.startsWith('127.') ||
        host.startsWith('10.') ||
        host.startsWith('192.168.') ||
        host.startsWith('169.254.')
      ) {
        return { ok: false, result: 'Local/private URLs are blocked.' }
      }

      const maxChars = Math.min(12000, Math.max(500, Number(args.max_chars) || 6000))
      try {
        const text = await fetchPageText(parsed.toString(), maxChars)
        return { ok: true, result: `URL: ${parsed}\n\n${text}` }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, result: `Fetch failed: ${message}` }
      }
    }
  }
]
