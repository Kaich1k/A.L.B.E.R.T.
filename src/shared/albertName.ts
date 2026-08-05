/**
 * Whisper often mangles “Albert” / A.L.B.E.R.T. into near-misses.
 * Shared repairs for wake matching and general voice transcripts.
 */

/** Words that are edit-close to albert but must NOT be rewritten. */
const ALBERT_BLOCKLIST = new Set([
  'alert',
  'about',
  'albeit',
  'always',
  'almost',
  'already',
  'album',
  'adult',
  'alter',
  'alberts', // handled explicitly as albert
  'robert',
  'roberts',
  'gilbert',
  'hilbert'
])

function editDistance(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  const prev = new Array<number>(n + 1)
  const cur = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost)
    }
    for (let j = 0; j <= n; j++) prev[j] = cur[j]!
  }
  return prev[n]!
}

function looksLikeAlbertToken(word: string): boolean {
  const w = word.toLowerCase().replace(/'/g, '')
  if (!w || w === 'albert') return w === 'albert'
  if (ALBERT_BLOCKLIST.has(w)) return false
  if (w.length < 5 || w.length > 9) return false
  if (editDistance(w, 'albert') > 2) return false
  // Prefer al-/el-/ol-/hal- starts or -bert/-burt/-bird ends
  return /^(al|el|ol|hal|ul|ab)/.test(w) || /(bert|burt|bird|vert|pert)$/.test(w)
}

export type RepairAlbertOptions = {
  /**
   * Wake path: also map alfred/alberta and looser two-word forms.
   * General chat stays a bit tighter to avoid rewriting real names in stories.
   */
  aggressive?: boolean
}

/**
 * Rewrite common STT mangling of the assistant’s name → “albert”.
 * Idempotent; safe to run before wake match or command detection.
 */
export function repairAlbertMentions(
  text: string,
  opts?: RepairAlbertOptions
): string {
  if (!text.trim()) return text
  const aggressive = opts?.aggressive !== false
  let t = text

  // Spelled acronym (with or without dots/spaces)
  t = t.replace(/a\.?\s*l\.?\s*b\.?\s*e\.?\s*r\.?\s*t\.?/gi, 'albert')

  // Split / spaced forms
  t = t.replace(/\bal[\s.\-]+bert\b/gi, 'albert')
  t = t.replace(/\ba\s+bert\b/gi, 'albert')
  t = t.replace(/\ball\s+bert\b/gi, 'albert')
  t = t.replace(/\bi'?ll\s+bert\b/gi, 'albert')

  // Two-word phonetic (“all bird”, “ow burt”, “our bear”)
  t = t.replace(
    /\b(all|ol|old|ow|ill|i'?ll|our|al|el|hal|uhl|ul|oh)\s+(bird|burt|bert|but|burp|bred|bet|bear|vert|pert|burger|birth|boat|bored)\b/gi,
    'albert'
  )

  // Explicit single-token near-misses Whisper loves
  t = t.replace(
    /\b(elbert|alberta|alberts|albert'?s|olbert|allbert|albird|albertt|alburt|halbert|alberti|alpert|alvert|abert|albrecht|albart|albar|uburt|obert|albat|albot|albern|albern?t)\b/gi,
    'albert'
  )

  if (aggressive) {
    // Wake: alfred/alfie-adjacent is almost always a mis-hear of Albert here
    t = t.replace(/\b(alfred|alfie|alberto|albertan)\b/gi, 'albert')
  }

  // Fuzzy pass for remaining close tokens
  t = t.replace(/\b[A-Za-z']{5,9}\b/g, (word) => {
    if (looksLikeAlbertToken(word)) return 'albert'
    return word
  })

  return t
}
