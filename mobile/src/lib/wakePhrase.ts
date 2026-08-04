/** Same wake triad rules as desktop wakeWord.ts (phone-side copy). */

const TRAILING = /^(please|now|thanks|thank|you|already|man|dude|sir)$/i

function normalizeWakeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/a\.?\s*l\.?\s*b\.?\s*e\.?\s*r\.?\s*t\.?/g, 'albert')
    .replace(/\bal\s*bert\b/g, 'albert')
    .replace(/\b(elbert|alberts|albert'?s|olbert|allbert|albird|albertt|alburt|halbert)\b/g, 'albert')
    .replace(/\b(all|ol|old|ow|ill|i'?ll)\s+(bird|burt|bert|but|burp|bred|bet)\b/g, 'albert')
    .replace(/\ba\s+bert\b/g, 'albert')
    .replace(
      /\b(what|week|make|wakee|woke|wait|weigh|wayne|work|walk|way|weight|bake|fake|lake)\s+(up|cup|app|of|op)\b/g,
      'wake up'
    )
    .replace(/\bmakeup\b/g, 'wake up')
    .replace(/\bwake[\s\-]+up\b/g, 'wake up')
    .replace(/\bwakeup\b/g, 'wake up')
    .replace(/\b(waken|awaken)\b/g, 'wake')
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

  if (/\balbert\b.{0,24}\bwake(\s+up)?\b/.test(joined)) return true
  if (/\bwake(\s+up)?\b.{0,24}\balbert\b/.test(joined)) return true

  const last2 = words.slice(-2).join(' ')
  if (last2 === 'wake up' && words.includes('albert')) return true

  if (/\b(hey|yo|okay|ok|hi|hello)\s+albert\b/.test(joined)) return true
  if (last2 === 'hey albert' || last2 === 'okay albert' || last2 === 'ok albert') return true

  if (
    words.length <= 12 &&
    words.includes('albert') &&
    (/\bwake(\s+up)?\b/.test(joined) || words.includes('wakeup'))
  ) {
    return true
  }

  return false
}
