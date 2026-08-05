/** Same wake triad rules as desktop wakeWord.ts (phone-side copy). */

const TRAILING = /^(please|now|thanks|thank|you|already|man|dude|sir)$/i

/** Keep in sync with src/shared/albertName.ts (phone bundle can’t import desktop shared). */
function repairAlbertMentions(text: string): string {
  let t = text
  t = t.replace(/a\.?\s*l\.?\s*b\.?\s*e\.?\s*r\.?\s*t\.?/gi, 'albert')
  t = t.replace(/\bal[\s.\-]+bert\b/gi, 'albert')
  t = t.replace(/\ba\s+bert\b/gi, 'albert')
  t = t.replace(/\ball\s+bert\b/gi, 'albert')
  t = t.replace(/\bi'?ll\s+bert\b/gi, 'albert')
  t = t.replace(
    /\b(all|ol|old|ow|ill|i'?ll|our|al|el|hal|uhl|ul|oh)\s+(bird|burt|bert|but|burp|bred|bet|bear|vert|pert|burger|birth|boat|bored)\b/gi,
    'albert'
  )
  t = t.replace(
    /\b(elbert|alberta|alberts|albert'?s|olbert|allbert|albird|albertt|alburt|halbert|alberti|alpert|alvert|abert|albrecht|albart|alfred|alfie|alberto|albertan|uburt|obert)\b/gi,
    'albert'
  )
  return t
}

function normalizeWakeText(text: string): string {
  return repairAlbertMentions(text)
    .toLowerCase()
    .replace(
      /\b(what|week|make|wakee|woke|wait|weigh|wayne|work|walk|way|weight|bake|fake|lake|vague)\s+(up|cup|app|of|op)\b/g,
      'wake up'
    )
    .replace(/\bmakeup\b/g, 'wake up')
    .replace(/\bwake[\s\-]+up\b/g, 'wake up')
    .replace(/\bwakeup\b/g, 'wake up')
    .replace(/\b(waken|awaken|waking)\b/g, 'wake')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isWakePhrase(text: string): boolean {
  const t = normalizeWakeText(text)
  if (!t) return false
  const words = t.split(/\s+/).filter(Boolean)
  while (words.length && TRAILING.test(words[words.length - 1]!)) words.pop()
  if (!words.length || words.length > 40) return false

  const joined = words.join(' ')

  for (let i = 0; i <= words.length - 3; i++) {
    const triple = `${words[i]} ${words[i + 1]} ${words[i + 2]}`
    if (triple === 'albert wake up' || triple === 'wake up albert') return true
  }

  for (let i = 0; i <= words.length - 2; i++) {
    const pair = `${words[i]} ${words[i + 1]}`
    if (pair === 'albert wake' || pair === 'wake albert') return true
  }

  if (/\balbert\b.{0,32}\bwake(\s+up)?\b/.test(joined)) return true
  if (/\bwake(\s+up)?\b.{0,32}\balbert\b/.test(joined)) return true

  const last2 = words.slice(-2).join(' ')
  const last3 = words.slice(-3).join(' ')
  if (last3 === 'albert wake up' || last3 === 'wake up albert') return true
  if (last2 === 'wake up' && words.includes('albert')) return true
  if (last2 === 'albert wake' || last2 === 'wake albert') return true

  if (/\b(hey|yo|okay|ok|hi|hello)\s+albert\b/.test(joined)) return true
  if (last2 === 'hey albert' || last2 === 'okay albert' || last2 === 'ok albert') {
    return true
  }

  if (
    words.length <= 14 &&
    words.includes('albert') &&
    (/\bwake(\s+up)?\b/.test(joined) || words.includes('wakeup'))
  ) {
    return true
  }

  return false
}
