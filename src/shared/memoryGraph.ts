import type { MemoryFact, MemoryGraph, MemoryGraphEdge, MemoryGraphNode, MemoryKind } from './types'

const STOP = new Set([
  'this',
  'that',
  'with',
  'from',
  'have',
  'been',
  'will',
  'would',
  'could',
  'should',
  'about',
  'your',
  'their',
  'there',
  'what',
  'when',
  'where',
  'which',
  'into',
  'just',
  'than',
  'then',
  'them',
  'they',
  'were',
  'also',
  'only',
  'very',
  'some',
  'more',
  'most',
  'like',
  'want',
  'need',
  'make',
  'made',
  'using',
  'used',
  'albert',
  'please',
  'always',
  'never',
  'usually'
])

const KIND_ORDER: MemoryKind[] = ['person', 'project', 'preference', 'decision', 'place', 'general']

export const MEMORY_GRAPH_VIEW = { width: 920, height: 540 }

export function classifyMemoryKind(content: string, category = ''): MemoryKind {
  const cat = category.trim().toLowerCase()
  if (cat === 'person' || cat === 'people' || cat === 'family') return 'person'
  if (cat === 'project' || cat === 'repo' || cat === 'app') return 'project'
  if (cat === 'preference' || cat === 'pref' || cat === 'auto') return 'preference'
  if (cat === 'decision' || cat === 'plan') return 'decision'
  if (cat === 'place' || cat === 'location') return 'place'

  const t = content.trim()
  if (
    /\b(?:my|our)\s+(?:wife|husband|partner|girlfriend|boyfriend|son|daughter|kids?|parents?|mom|dad|professor|advisor|roommate|teammate|coworker|boss)\b/i.test(
      t
    ) ||
    /\b(?:named|called)\s+[A-Z][a-z]+/.test(t)
  ) {
    return 'person'
  }
  if (
    /\b(?:project|repo|app|codebase)\s+(?:is|called|named)\b/i.test(t) ||
    /\bwe(?:'re| are) (?:building|working on|shipping|using)\b/i.test(t)
  ) {
    return 'project'
  }
  if (
    /\b(?:from now on|keep in mind|i (?:always|never|usually|prefer|don't like|do not like))\b/i.test(
      t
    ) ||
    /\bi(?:'m| am) allergic\b/i.test(t)
  ) {
    return 'preference'
  }
  if (
    /\b(?:i (?:decided|chose)|we (?:decided|chose)|going with|deadline is|due)\b/i.test(t)
  ) {
    return 'decision'
  }
  if (/\bi live (?:in|at|near)\b/i.test(t) || /\b(?:school|university|timezone)\b/i.test(t)) {
    return 'place'
  }
  return 'general'
}

export function memoryLabel(content: string, max = 42): string {
  const first = (content || '')
    .split(/[\n.;]+/)
    .map((part) => part.trim())
    .find(Boolean) || 'Memory'
  return first.length > max ? `${first.slice(0, max - 1)}…` : first
}

export function memoryTokens(content: string): string[] {
  return (content || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !STOP.has(word))
}

function properNames(content: string): string[] {
  const found = new Set<string>()
  const re = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g
  let match: RegExpExecArray | null
  while ((match = re.exec(content))) {
    const name = match[1]!.trim()
    if (name.length < 3) continue
    if (/^(I|The|This|That|And|For|With|From|When)$/.test(name)) continue
    found.add(name.toLowerCase())
  }
  return [...found]
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const left = new Set(a)
  let overlap = 0
  for (const token of b) if (left.has(token)) overlap += 1
  const union = left.size + b.length - overlap
  return union ? overlap / union : 0
}

export function buildMemoryGraph(memories: MemoryFact[], limit = 48): MemoryGraph {
  const ranked = [...memories].sort((left, right) => {
    const kindDelta =
      KIND_ORDER.indexOf(classifyMemoryKind(left.content || '', left.category || '')) -
      KIND_ORDER.indexOf(classifyMemoryKind(right.content || '', right.category || ''))
    if (kindDelta) return kindDelta
    return (right.updatedAt - left.updatedAt) || left.id.localeCompare(right.id)
  })
  const source = ranked.slice(0, Math.max(8, limit))
  const prepared = source.map((memory) => {
    const kind = classifyMemoryKind(memory.content || '', memory.category || '')
    return {
      memory,
      kind,
      tokens: memoryTokens(memory.content || ''),
      names: properNames(memory.content || '')
    }
  })

  const groups = KIND_ORDER.map((kind) =>
    prepared
      .filter((item) => item.kind === kind)
      .sort(
        (left, right) =>
          (right.memory.updatedAt - left.memory.updatedAt) ||
          left.memory.id.localeCompare(right.memory.id)
      )
  ).filter((group) => group.length > 0)

  const { width, height } = MEMORY_GRAPH_VIEW
  const padX = 36
  const top = 46
  const bottom = 28
  const colWidth = groups.length ? (width - padX * 2) / groups.length : width
  const nodes: MemoryGraphNode[] = []

  groups.forEach((group, column) => {
    const x = padX + colWidth * column + colWidth / 2
    const gap = Math.min(42, (height - top - bottom) / Math.max(group.length, 1))
    const block = gap * Math.max(group.length - 1, 0)
    const startY = top + Math.max(0, (height - top - bottom - block) / 2)
    group.forEach((item, row) => {
      nodes.push({
        id: item.memory.id,
        kind: item.kind,
        label: memoryLabel(item.memory.content || '', 24),
        content: item.memory.content || '',
        source: item.memory.source || 'conversation',
        confidence: Number.isFinite(item.memory.confidence) ? Number(item.memory.confidence) : 1,
        category: item.memory.category || 'general',
        x: Math.round(x),
        y: Math.round(startY + row * gap)
      })
    })
  })

  const edges: MemoryGraphEdge[] = []
  const degree = new Map<string, number>()
  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      const left = prepared[i]!
      const right = prepared[j]!
      const sharedName = left.names.find((name) => right.names.includes(name))
      const score = jaccard(left.tokens, right.tokens)
      const mentions =
        left.memory.content.toLowerCase().includes(memoryLabel(right.memory.content, 18).toLowerCase()) ||
        right.memory.content.toLowerCase().includes(memoryLabel(left.memory.content, 18).toLowerCase())
      if (!sharedName && score < 0.18 && !mentions) continue
      if ((degree.get(left.memory.id) || 0) >= 3 || (degree.get(right.memory.id) || 0) >= 3) continue
      edges.push({
        from: left.memory.id,
        to: right.memory.id,
        reason: sharedName ? `shared ${sharedName}` : mentions ? 'direct mention' : 'overlapping facts'
      })
      degree.set(left.memory.id, (degree.get(left.memory.id) || 0) + 1)
      degree.set(right.memory.id, (degree.get(right.memory.id) || 0) + 1)
      if (edges.length >= 120) break
    }
    if (edges.length >= 120) break
  }

  return { nodes, edges }
}
