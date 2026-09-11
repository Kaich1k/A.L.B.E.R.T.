/**
 * Speech-only text pipeline. Displayed Comm stays verbatim; Kokoro / system
 * TTS consume this layer. No SSML — Kokoro does not support it.
 */

export type SpeechPause = 'none' | 'clause' | 'sentence' | 'paragraph'

export interface SpeechChunk {
  text: string
  pauseAfter: SpeechPause
}

export interface SpeechPronunciation {
  /** Case-insensitive whole-token / phrase matcher. */
  pattern: RegExp
  say: string | ((match: string, ...groups: string[]) => string)
}

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen'
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
const ORDINAL_ONES = [
  'zeroth',
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
  'eleventh',
  'twelfth',
  'thirteenth',
  'fourteenth',
  'fifteenth',
  'sixteenth',
  'seventeenth',
  'eighteenth',
  'nineteenth'
]
const MONTHS: Record<string, string> = {
  jan: 'January',
  january: 'January',
  feb: 'February',
  february: 'February',
  mar: 'March',
  march: 'March',
  apr: 'April',
  april: 'April',
  may: 'May',
  jun: 'June',
  june: 'June',
  jul: 'July',
  july: 'July',
  aug: 'August',
  august: 'August',
  sep: 'September',
  sept: 'September',
  september: 'September',
  oct: 'October',
  october: 'October',
  nov: 'November',
  november: 'November',
  dec: 'December',
  december: 'December'
}

const ABBREV_TITLES = String.raw`Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|St`
const UNIT_WORDS: Array<{ pattern: RegExp; say: string }> = [
  { pattern: /\b(\d+(?:\.\d+)?)\s*°\s*F\b/gi, say: 'degrees Fahrenheit' },
  { pattern: /\b(\d+(?:\.\d+)?)\s*°\s*C\b/gi, say: 'degrees Celsius' },
  { pattern: /\b(\d+(?:\.\d+)?)\s*°\b/g, say: 'degrees' },
  { pattern: /\b(\d+(?:\.\d+)?)\s*(?:km|kilometers?)\b/gi, say: 'kilometers' },
  { pattern: /\b(\d+(?:\.\d+)?)\s*(?:m|meters?)\b(?!\s*[A-Za-z])/gi, say: 'meters' },
  { pattern: /\b(\d+(?:\.\d+)?)\s*(?:cm|centimeters?)\b/gi, say: 'centimeters' },
  { pattern: /\b(\d+(?:\.\d+)?)\s*(?:mm|millimeters?)\b/gi, say: 'millimeters' },
  { pattern: /\b(\d+(?:\.\d+)?)\s*(?:mi|miles?)\b/gi, say: 'miles' },
  { pattern: /\b(\d+(?:\.\d+)?)\s*(?:ft|feet)\b/gi, say: 'feet' },
  { pattern: /\b(\d+(?:\.\d+)?)\s*(?:in|inches)\b/gi, say: 'inches' },
  { pattern: /\b(\d+(?:\.\d+)?)\s*(?:kg|kilograms?)\b/gi, say: 'kilograms' },
  { pattern: /\b(\d+(?:\.\d+)?)\s*(?:g|grams?)\b(?!\s*[A-Za-z])/gi, say: 'grams' },
  { pattern: /\b(\d+(?:\.\d+)?)\s*(?:mg|milligrams?)\b/gi, say: 'milligrams' },
  { pattern: /\b(\d+(?:\.\d+)?)\s*(?:lb|lbs|pounds?)\b/gi, say: 'pounds' },
  { pattern: /\b(\d+(?:\.\d+)?)\s*(?:gb|gigabytes?)\b/gi, say: 'gigabytes' },
  { pattern: /\b(\d+(?:\.\d+)?)\s*(?:mb|megabytes?)\b/gi, say: 'megabytes' },
  { pattern: /\b(\d+(?:\.\d+)?)\s*(?:kb|kilobytes?)\b/gi, say: 'kilobytes' },
  { pattern: /\b(\d+(?:\.\d+)?)\s*(?:ms|milliseconds?)\b/gi, say: 'milliseconds' },
  { pattern: /\b(\d+(?:\.\d+)?)\s*(?:seconds?|secs?)\b/gi, say: 'seconds' }
]

/**
 * Easy to extend. Applied after Markdown is stripped and before generic numbers.
 * Keep `say` as ordinary English — never SSML.
 */
/** Comma-separated letters so espeak cannot glue "P I" into "pie". */
export function speakLetters(raw: string): string {
  return [...String(raw).replace(/[^A-Za-z]/g, '').toUpperCase()].join(', ')
}

export const SPEECH_PRONUNCIATIONS: SpeechPronunciation[] = [
  { pattern: /\bA\.L\.B\.E\.R\.T\.?/gi, say: 'Albert' },
  { pattern: /\bChatGPT\b/gi, say: `Chat ${speakLetters('GPT')}` },
  { pattern: /\bOpenAI\b/g, say: `Open, ${speakLetters('AI')}` },
  { pattern: /\bElevenLabs\b/gi, say: 'Eleven Labs' },
  { pattern: /\bKokoro\b/g, say: 'Koh koh roh' },
  { pattern: /\bmacOS\b/g, say: `mac, ${speakLetters('OS')}` },
  { pattern: /\biOS\b/g, say: `i, ${speakLetters('OS')}` },
  { pattern: /\bAPI\b/g, say: speakLetters('API') },
  { pattern: /\bTTS\b/g, say: speakLetters('TTS') },
  { pattern: /\bURL\b/g, say: speakLetters('URL') },
  { pattern: /\bHTTP\b/g, say: speakLetters('HTTP') },
  { pattern: /\bHTTPS\b/g, say: speakLetters('HTTPS') },
  { pattern: /\bJSON\b/g, say: 'Jason' },
  { pattern: /\bSQL\b/g, say: 'sequel' },
  { pattern: /\bUUID\b/g, say: speakLetters('UUID') },
  { pattern: /\bCLI\b/g, say: speakLetters('CLI') },
  { pattern: /\bSDK\b/g, say: speakLetters('SDK') },
  { pattern: /\bGPU\b/g, say: speakLetters('GPU') },
  { pattern: /\bCPU\b/g, say: speakLetters('CPU') },
  { pattern: /\bLLM\b/g, say: speakLetters('LLM') },
  { pattern: /\bIPC\b/g, say: speakLetters('IPC') },
  { pattern: /\bWAV\b/g, say: 'wave' },
  { pattern: /\bPNPM\b/gi, say: speakLetters('PNPM') },
  { pattern: /\bnpm\b/g, say: speakLetters('NPM') },
  {
    pattern: /\bGPT-?(\d+(?:\.\d+)*)\b/gi,
    say: (_m, ver) => `${speakLetters('GPT')} ${speakDottedNumber(ver)}`
  },
  {
    pattern: /\bClaude[- ]?(Haiku|Sonnet|Opus)(?:[- ]?(\d+(?:\.\d+)*))?\b/gi,
    say: (_m, name, ver) => `Claude ${name}${ver ? ` ${speakDottedNumber(ver)}` : ''}`
  }
]

const normalizeCache = new Map<string, string>()
const CACHE_LIMIT = 240

function cacheGet(key: string): string | undefined {
  return normalizeCache.get(key)
}

function cacheSet(key: string, value: string): void {
  if (normalizeCache.size >= CACHE_LIMIT) {
    const first = normalizeCache.keys().next().value
    if (first != null) normalizeCache.delete(first)
  }
  normalizeCache.set(key, value)
}

export function clearSpeechNormalizeCache(): void {
  normalizeCache.clear()
}

export function under100(n: number): string {
  if (n < 20) return ONES[n] || String(n)
  const ten = Math.floor(n / 10)
  const one = n % 10
  return one ? `${TENS[ten]}-${ONES[one]}` : TENS[ten]!
}

export function integerToWords(n: number): string {
  if (!Number.isFinite(n)) return ''
  if (n < 0) return `negative ${integerToWords(-n)}`
  n = Math.floor(n)
  if (n < 100) return under100(n)
  if (n < 1000) {
    const hundreds = Math.floor(n / 100)
    const rest = n % 100
    return rest ? `${ONES[hundreds]} hundred ${under100(rest)}` : `${ONES[hundreds]} hundred`
  }
  if (n < 1_000_000) {
    const thousands = Math.floor(n / 1000)
    const rest = n % 1000
    return rest ? `${integerToWords(thousands)} thousand ${integerToWords(rest)}` : `${integerToWords(thousands)} thousand`
  }
  if (n < 1_000_000_000) {
    const millions = Math.floor(n / 1_000_000)
    const rest = n % 1_000_000
    return rest ? `${integerToWords(millions)} million ${integerToWords(rest)}` : `${integerToWords(millions)} million`
  }
  return String(n)
}

function digitRun(raw: string): string {
  return [...raw].map((ch) => (ch === '.' ? 'point' : integerToWords(Number(ch)))).join(' ')
}

export function speakDottedNumber(raw: string): string {
  return raw
    .split('.')
    .map((part) => {
      if (!part) return 'point'
      if (part.length <= 2) return integerToWords(Number(part))
      return digitRun(part)
    })
    .join(' and point and ')
}

export function yearToWords(year: number): string {
  if (year === 2000) return 'two thousand'
  if (year > 2000 && year < 2010) return `two thousand ${integerToWords(year - 2000)}`
  if (year >= 2010 && year <= 2099) {
    const rest = year - 2000
    return `twenty ${under100(rest)}`
  }
  if (year >= 1100 && year <= 1999) {
    const century = Math.floor(year / 100)
    const rest = year % 100
    if (rest === 0) return `${integerToWords(century)} hundred`
    return `${integerToWords(century)} ${under100(rest)}`
  }
  return integerToWords(year)
}

function ordinalToWords(n: number): string {
  if (n < 20) return ORDINAL_ONES[n] || `${integerToWords(n)}th`
  const ten = Math.floor(n / 10)
  const one = n % 10
  if (one === 0) {
    const tensOrd: Record<number, string> = {
      2: 'twentieth',
      3: 'thirtieth',
      4: 'fortieth',
      5: 'fiftieth',
      6: 'sixtieth',
      7: 'seventieth',
      8: 'eightieth',
      9: 'ninetieth'
    }
    if (n < 100) return tensOrd[ten] || `${integerToWords(n)}th`
  }
  if (n < 100) return `${TENS[ten]}-${ORDINAL_ONES[one]}`
  const base = integerToWords(n)
  if (one === 1 && n % 100 !== 11) return base.replace(/one$/, 'first')
  if (one === 2 && n % 100 !== 12) return base.replace(/two$/, 'second')
  if (one === 3 && n % 100 !== 13) return base.replace(/three$/, 'third')
  if (base.endsWith('y')) return `${base.slice(0, -1)}ieth`
  if (base.endsWith('t')) return `${base}th`
  return `${base}th`
}

function speakDecimal(raw: string): string {
  const [whole, frac] = raw.split('.')
  const digits = (whole || '0').replace(/,/g, '')
  if (!frac) return integerToWords(Number(digits))
  // All words, no digits, no "." / ",". Kokoro splits those and says "three… fourteen".
  return `${integerToWords(Number(digits))} and point and ${digitRun(frac)}`
}

function speakTime(hourRaw: string, minuteRaw: string, meridiem?: string): string {
  const hour = Number(hourRaw)
  const minute = Number(minuteRaw)
  const hourWords = integerToWords(hour === 0 ? 0 : hour)
  let clock = minute === 0 ? `${hourWords} o'clock` : `${hourWords} ${under100(minute)}`
  if (minute === 0 && meridiem) clock = hourWords
  if (meridiem) {
    const mer = meridiem.trim().toUpperCase().replace(/\./g, '')
    const letters = mer.split('').join(' ')
    clock = `${clock} ${letters}`
  }
  return clock
}

function speakMoney(sign: string, whole: string, cents?: string): string {
  const amount = Number(whole.replace(/,/g, ''))
  const major =
    sign === '£' ? { one: 'pound', many: 'pounds' } : sign === '€' ? { one: 'euro', many: 'euros' } : { one: 'dollar', many: 'dollars' }
  const minor =
    sign === '£' ? { one: 'penny', many: 'pence' } : sign === '€' ? { one: 'cent', many: 'cents' } : { one: 'cent', many: 'cents' }
  const wholeWords = integerToWords(amount)
  const majorWord = amount === 1 ? major.one : major.many
  if (!cents) return `${wholeWords} ${majorWord}`
  const c = Number(cents.padEnd(2, '0').slice(0, 2))
  if (c === 0) return `${wholeWords} ${majorWord}`
  if (amount === 0) return `${integerToWords(c)} ${c === 1 ? minor.one : minor.many}`
  return `${wholeWords} ${majorWord} and ${integerToWords(c)} ${c === 1 ? minor.one : minor.many}`
}

function speakPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  const groups: string[] = []
  if (digits.length === 11 && digits.startsWith('1')) {
    groups.push('one', digitRun(digits.slice(1, 4)), digitRun(digits.slice(4, 7)), digitRun(digits.slice(7)))
  } else if (digits.length === 10) {
    groups.push(digitRun(digits.slice(0, 3)), digitRun(digits.slice(3, 6)), digitRun(digits.slice(6)))
  } else {
    return digitRun(digits)
  }
  return groups.join(', ')
}

type Slot = { id: string; spoken: string }

function stash(slots: Slot[], spoken: string): string {
  const id = `\uE000${String.fromCharCode(0xe100 + slots.length)}\uE001`
  slots.push({ id, spoken })
  return id
}

function restoreSlots(text: string, slots: Slot[]): string {
  let out = text
  for (let i = slots.length - 1; i >= 0; i--) {
    const slot = slots[i]!
    out = out.split(slot.id).join(slot.spoken)
  }
  return out
}

export function stripMarkdownForSpeech(text: string): string {
  const slots: Slot[] = []
  let out = text.replace(/\r\n/g, '\n')

  out = out.replace(/```[\s\S]*?```/g, () => stash(slots, ''))
  out = out.replace(/`([^`]+)`/g, (_m, code: string) => {
    const trimmed = String(code).trim()
    if (!trimmed) return ''
    if (/^[\w./+-]{1,32}$/.test(trimmed)) return stash(slots, trimmed.replace(/[._]/g, ' '))
    return stash(slots, '')
  })
  out = out.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  out = out.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
  out = out.replace(/\bhttps?:\/\/[^\s)]+/gi, () => stash(slots, 'a link'))
  out = out.replace(/\bwww\.[^\s)]+/gi, () => stash(slots, 'a link'))
  out = out.replace(/\[[0-9]{1,3}\]/g, '')
  out = out.replace(/\[\^[^\]]+\]/g, '')
  out = out.replace(/^\s*#{1,6}\s+(.+)$/gm, '$1.')
  out = out.replace(/^\s*>\s?/gm, '')
  out = out.replace(/^\s*[-*•]\s+/gm, '')
  out = out.replace(/^\s*\d+\.\s+/gm, '')
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1')
  out = out.replace(/__([^_]+)__/g, '$1')
  out = out.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, '$1')
  out = out.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, '$1')
  out = out.replace(/~~([^~]+)~~/g, '$1')
  out = out.replace(/\*+/g, '')
  out = out.replace(/#+/g, '')
  out = out.replace(/~/g, '')
  out = out.replace(/\|/g, ', ')
  out = out.replace(/\n{3,}/g, '\n\n')
  return restoreSlots(out, slots).trim()
}

function applyPronunciations(text: string, slots: Slot[]): string {
  let out = text
  for (const entry of SPEECH_PRONUNCIATIONS) {
    out = out.replace(entry.pattern, (...args) => {
      const whole = String(args[0] ?? '')
      const groups = args.slice(1, -2).map((g) => String(g ?? ''))
      const said = typeof entry.say === 'function' ? entry.say(whole, ...groups) : entry.say
      return /\d/.test(said) ? stash(slots, said) : said
    })
  }
  return out
}

function protectIdentifiers(text: string, slots: Slot[]): string {
  let out = text
  out = out.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    () => stash(slots, 'an identifier')
  )
  out = out.replace(/\b[0-9a-f]{32,}\b/gi, () => stash(slots, 'an identifier'))
  out = out.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, () =>
    stash(slots, 'an email address')
  )
  out = out.replace(
    /(?:[A-Za-z]:\\|\/(?:Users|home|var|usr|tmp|etc)\/|\.\/|\.\.\/)[^\s,;:!?]+/g,
    () => stash(slots, 'a file path')
  )
  out = out.replace(/\bsrc\/[^\s,;:!?]+/g, () => stash(slots, 'a file path'))
  out = out.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, () => stash(slots, `an ${speakLetters('API')} key`))
  return out
}

function convertSpeechTokens(text: string, slots: Slot[]): string {
  let out = text
  const keep = (spoken: string): string =>
    /\d/.test(spoken) && /point/i.test(spoken) ? stash(slots, spoken) : spoken

  out = out.replace(
    /([$£€])\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?/g,
    (_m, sign: string, whole: string, cents?: string) => speakMoney(sign, whole, cents)
  )

  out = out.replace(
    /\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)\b/gi,
    (_m, h: string, min: string, mer: string) => speakTime(h, min, mer)
  )
  out = out.replace(/\b(\d{1,2}):(\d{2})\b/g, (_m, h: string, min: string) => speakTime(h, min))

  out = out.replace(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s+(\d{4})\b/gi,
    (_m, month: string, day: string, year: string) => {
      const name = MONTHS[month.toLowerCase().replace(/\./g, '')] || month
      return `${name} ${ordinalToWords(Number(day))}, ${yearToWords(Number(year))}`
    }
  )
  out = out.replace(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?,?\s+(\d{4})\b/gi,
    (_m, day: string, month: string, year: string) => {
      const name = MONTHS[month.toLowerCase().replace(/\./g, '')] || month
      return `${name} ${ordinalToWords(Number(day))}, ${yearToWords(Number(year))}`
    }
  )
  out = out.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (_m, a: string, b: string, y: string) => {
    const month = Number(a)
    const day = Number(b)
    if (month > 12) return `${integerToWords(month)} ${integerToWords(day)} ${yearToWords(Number(y))}`
    const names = [
      '',
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December'
    ]
    return `${names[month]} ${ordinalToWords(day)}, ${yearToWords(Number(y))}`
  })

  out = out.replace(/\b(\d{1,3}(?:,\d{3})*|\d+(?:\.\d+)?)%/g, (_m, n: string) => {
    const spoken = n.includes('.') ? speakDecimal(n.replace(/,/g, '')) : integerToWords(Number(n.replace(/,/g, '')))
    return `${keep(spoken)} percent`
  })

  out = out.replace(
    /\b(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)\s*°\s*F\b/gi,
    (_m, a: string, b: string) => `${keep(speakMaybeDecimal(a))} to ${keep(speakMaybeDecimal(b))} degrees Fahrenheit`
  )
  out = out.replace(
    /\b(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)\s*°\s*C\b/gi,
    (_m, a: string, b: string) => `${keep(speakMaybeDecimal(a))} to ${keep(speakMaybeDecimal(b))} degrees Celsius`
  )
  out = out.replace(
    /\b(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)\s*°\b/g,
    (_m, a: string, b: string) => `${keep(speakMaybeDecimal(a))} to ${keep(speakMaybeDecimal(b))} degrees`
  )

  out = out.replace(/\b(\d+(?:\.\d+)?)\s*°\s*F\b/gi, (_m, n: string) => `${keep(speakMaybeDecimal(n))} degrees Fahrenheit`)
  out = out.replace(/\b(\d+(?:\.\d+)?)\s*°\s*C\b/gi, (_m, n: string) => `${keep(speakMaybeDecimal(n))} degrees Celsius`)
  out = out.replace(/\b(\d+(?:\.\d+)?)\s*°\b/g, (_m, n: string) => `${keep(speakMaybeDecimal(n))} degrees`)

  for (const unit of UNIT_WORDS) {
    if (/°/.test(unit.pattern.source)) continue
    out = out.replace(unit.pattern, (_m, n: string) => `${keep(speakMaybeDecimal(n))} ${unit.say}`)
  }

  out = out.replace(
    /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s])\d{3}[-.\s]\d{4}\b/g,
    (m) => speakPhone(m)
  )

  out = out.replace(/\b(\d{1,3})(st|nd|rd|th)\b/gi, (_m, n: string) => ordinalToWords(Number(n)))

  out = out.replace(
    /\b(\d{4})\s*[-–—]\s*(\d{4})\b/g,
    (_m, a: string, b: string) => `${yearToWords(Number(a))} to ${yearToWords(Number(b))}`
  )
  out = out.replace(
    /\b(\d{1,3}(?:,\d{3})*|\d+)\s*[-–—]\s*(\d{1,3}(?:,\d{3})*|\d+)\b/g,
    (_m, a: string, b: string) => `${integerToWords(Number(a.replace(/,/g, '')))} to ${integerToWords(Number(b.replace(/,/g, '')))}`
  )

  out = out.replace(/\b(\d+\.\d+\.\d+(?:\.\d+)*)\b/g, (m) => keep(speakDottedNumber(m)))
  out = out.replace(/\bv(\d+\.\d+(?:\.\d+)*)\b/gi, (_m, ver: string) => keep(speakDottedNumber(ver)))

  out = out.replace(/\b(\d+)\.(\d+)\b/g, (_m, whole: string, frac: string) =>
    keep(speakDecimal(`${whole}.${frac}`))
  )

  out = out.replace(/\b(1[6-9]\d{2}|20\d{2})\b/g, (m, _y: string, offset: number, whole: string) => {
    if (offset > 0 && whole[offset - 1] === ',') return m
    return yearToWords(Number(m))
  })

  out = out.replace(/\b(\d{1,3}(?:,\d{3})+)\b/g, (_m, n: string) => integerToWords(Number(n.replace(/,/g, ''))))
  out = out.replace(/\b\d+\b/g, (m) => integerToWords(Number(m)))

  return out
}

function speakMaybeDecimal(raw: string): string {
  return raw.includes('.') ? speakDecimal(raw) : integerToWords(Number(raw))
}

function tidySpoken(text: string): string {
  return text
    .replace(/[—–]/g, ' to ')
    .replace(/\s+to\s+to\s+/g, ' to ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([.!?]){2,}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Convert a display string into spoken English. Does not mutate UI text. */
export function normalizeForSpeech(text: string): string {
  const key = text
  const hit = cacheGet(key)
  if (hit != null) return hit

  const slots: Slot[] = []
  let out = stripMarkdownForSpeech(text)
  if (!out.trim()) {
    cacheSet(key, '')
    return ''
  }
  out = protectIdentifiers(out, slots)
  out = applyPronunciations(out, slots)
  out = convertSpeechTokens(out, slots)
  out = restoreSlots(out, slots)
  out = tidySpoken(out)
  cacheSet(key, out)
  return out
}

export function inferPauseAfter(text: string): SpeechPause {
  const trimmed = text.replace(/[ \t]+$/u, '')
  if (/\n\s*\n\s*$/.test(trimmed) || /[.!?]["')\]]?\s*\n\s*\n/.test(trimmed)) return 'paragraph'
  if (/[.!?]["')\]]?\s*$/.test(trimmed)) return 'sentence'
  if (/[,;:—]\s*$/.test(trimmed)) return 'clause'
  if (/\n\s*$/.test(trimmed)) return 'sentence'
  return 'clause'
}

export function pauseSeconds(kind: SpeechPause): number {
  if (kind === 'paragraph') return 0.28
  if (kind === 'sentence') return 0.14
  if (kind === 'clause') return 0.07
  return 0
}

/** Timeline gap after a trimmed clip. Trailing generator silence is subtracted so it is not stacked. */
export function joinGapSeconds(pauseAfter: SpeechPause, trailingSilentSec = 0): number {
  if (pauseAfter === 'none') return 0
  return Math.max(0, pauseSeconds(pauseAfter) - Math.max(0, trailingSilentSec))
}

const TITLE_ABBREV = new RegExp(String.raw`(?:^|[\s("'])(?:${ABBREV_TITLES}|e\.g|i\.e)\.?["')\]]?$`, 'i')

export function endsWithAbbreviation(candidate: string): boolean {
  return TITLE_ABBREV.test(candidate.trim())
}

function splitAt(text: string, index: number): { speak: string; rest: string } {
  if (index <= 0) return { speak: '', rest: text }
  if (index >= text.length) return { speak: text, rest: '' }
  return {
    speak: text.slice(0, index).replace(/^\s+|\s+$/g, ''),
    rest: text.slice(index).replace(/^\s+/g, '')
  }
}

interface Span {
  start: number
  end: number
}

function protectedSpans(text: string): Span[] {
  const spans: Span[] = []
  const patterns = [
    /\bhttps?:\/\/[^\s)]+/gi,
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    /[$£€]\d[\d,]*(?:\.\d+)?/g,
    /\b\d+:\d{2}(?:\s*[ap]\.?m\.?)?/gi,
    /\b\d+\.\d+(?:\.\d+)*\b/g,
    /\b\d+(?:\.\d+)?\s*[-–—]\s*\d+/g,
    /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|St|e\.g|i\.e)\./gi,
    /\bA\.L\.B\.E\.R\.T\.?/gi,
    /"[^"]{1,80}"/g,
    /“[^”]{1,80}”/g,
    /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s])\d{3}[-.\s]\d{4}\b/g,
    /\b\d{1,3}(?:,\d{3})+\b/g
  ]
  for (const pattern of patterns) {
    pattern.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = pattern.exec(text))) {
      spans.push({ start: m.index, end: m.index + m[0].length })
    }
  }
  return spans.sort((a, b) => a.start - b.start)
}

function indexInsideSpan(index: number, spans: Span[]): boolean {
  return spans.some((span) => index > span.start && index < span.end)
}

function conjunctionCut(text: string, max: number): number {
  const window = text.slice(0, Math.min(text.length, max))
  const marks = [', and ', ', but ', ', or ', ', so ', ', because ', ', while ', '; ', ': ', ' — ', ', ']
  let best = -1
  for (const mark of marks) {
    const at = window.lastIndexOf(mark)
    if (at > best) best = at
  }
  return best
}

/**
 * Pull the next speakable unit from a streaming buffer (display text, not yet
 * normalized). Keeps first-audio latency low without splitting atoms.
 */
export function takeSpeakableUnits(
  buffer: string,
  final: boolean,
  eager = false
): { speak: string; rest: string } {
  const text = buffer
  if (!text.trim()) return { speak: '', rest: '' }
  const spans = protectedSpans(text)

  const re = /[.!?]["')\]]?(?:\s+|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length
    if (indexInsideSpan(m.index, spans)) continue
    const candidate = text.slice(0, end).replace(/\s+/g, ' ').trim()
    if (!candidate) continue
    if (endsWithAbbreviation(candidate)) continue
    if (/^[A-Za-z]\.$/.test(candidate)) continue
    if (candidate.length >= 5) return splitAt(text, end)
  }

  const lineRe = /\n+\s*(?:[-*•]\s+|\d+\.\s+)?/g
  let lineMatch: RegExpExecArray | null
  while ((lineMatch = lineRe.exec(text))) {
    const end = lineMatch.index
    if (indexInsideSpan(end, spans)) continue
    const candidate = text.slice(0, end).replace(/\s+/g, ' ').trim()
    if (candidate.length >= 12 && end > 0) {
      return splitAt(text, lineMatch.index + lineMatch[0].length)
    }
  }

  if (eager && !final) {
    const trimmed = text.replace(/\s+/g, ' ').trim()
    if (trimmed.length >= 48) {
      const soft = conjunctionCut(text, 120)
      if (soft >= 18 && !indexInsideSpan(soft, spans)) return splitAt(text, soft + 1)
    }
    if (trimmed.length >= 96) {
      const window = text.slice(0, Math.min(text.length, 88))
      let cut = window.lastIndexOf(' ')
      while (cut >= 36 && indexInsideSpan(cut, spans)) {
        cut = window.lastIndexOf(' ', cut - 1)
      }
      if (cut >= 36) return splitAt(text, cut)
    }
  }

  const collapsedLen = text.replace(/\s+/g, ' ').trim().length
  if (collapsedLen >= 280) {
    const window = text.slice(0, Math.min(text.length, 260))
    let cut = Math.max(
      window.lastIndexOf('. '),
      window.lastIndexOf('! '),
      window.lastIndexOf('? '),
      window.lastIndexOf('\n'),
      conjunctionCut(window, window.length)
    )
    if (cut < 80) cut = window.lastIndexOf(' ')
    if (cut >= 80 && !indexInsideSpan(cut, spans)) return splitAt(text, cut + 1)
  }

  if (final) {
    return { speak: text.replace(/\s+/g, ' ').trim(), rest: '' }
  }

  return { speak: '', rest: text }
}

export function drainSpeakableUnits(
  buffer: string,
  final: boolean,
  eagerFirst = false
): { units: string[]; rest: string } {
  const units: string[] = []
  let rest = buffer
  let eager = eagerFirst

  for (let i = 0; i < 32; i++) {
    const next = takeSpeakableUnits(rest, false, eager)
    if (!next.speak) {
      rest = next.rest
      break
    }
    units.push(next.speak)
    rest = next.rest
    eager = false
    if (!rest) break
  }

  if (final) {
    const tail = rest.replace(/\s+/g, ' ').trim()
    if (tail) units.push(tail)
    return { units, rest: '' }
  }

  return { units, rest }
}

/** Full-string neural segmentation after display text is known. */
export function segmentForSpeech(text: string, maxChars = 280): SpeechChunk[] {
  const cleaned = stripMarkdownForSpeech(text)
  if (!cleaned.trim()) return []
  const { units } = drainSpeakableUnits(cleaned, true, false)
  const chunks: SpeechChunk[] = []
  for (const unit of units) {
    const pauseAfter = inferPauseAfter(unit)
    const spoken = normalizeForSpeech(unit)
    if (!spoken) continue
    if (spoken.length <= maxChars) {
      chunks.push({ text: spoken, pauseAfter })
      continue
    }
    let remaining = spoken
    while (remaining.length > maxChars) {
      const window = remaining.slice(0, maxChars)
      let cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '))
      if (cut < maxChars * 0.4) {
        cut = window.lastIndexOf(', ')
        const around = window.slice(Math.max(0, cut - 10), cut + 12)
        if (/point/i.test(around) || /[A-Z],\s*$/.test(window.slice(0, cut + 1))) cut = -1
      }
      if (cut < maxChars * 0.4) cut = window.lastIndexOf(' ')
      if (cut < 24) cut = maxChars
      else cut += 1
      const piece = remaining.slice(0, cut).trim()
      remaining = remaining.slice(cut).trim()
      if (piece) chunks.push({ text: piece, pauseAfter: remaining ? 'clause' : pauseAfter })
    }
    if (remaining) chunks.push({ text: remaining, pauseAfter })
  }
  return chunks
}

/** System TTS: normalized speech, optional punctuation strip for macOS pauses. */
export function prepareForSystemSpeech(text: string, stripPunctuation: boolean): string {
  const spoken = normalizeForSpeech(text)
  if (!spoken) return ''
  if (!stripPunctuation) return spoken
  const protected_ = spoken.replace(
    /\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|e\.g|i\.e)\./gi,
    (_m, a: string) => `${a}·`
  )
  return protected_
    .replace(/[—–]/g, ' ')
    .replace(/\.\.\./g, ' ')
    .replace(/\s*[;:]\s*/g, ' ')
    .replace(/[.!?]+/g, ' ')
    .replace(/,/g, ' ')
    .replace(/·/g, '.')
    .replace(/\s+/g, ' ')
    .trim()
}

export function chunkForSystemTts(text: string, stripPunctuation: boolean): string[] {
  const cleaned = prepareForSystemSpeech(text, stripPunctuation)
  if (!cleaned) return []
  if (cleaned.length <= 1600) return [cleaned]
  const chunks: string[] = []
  let remaining = cleaned
  while (remaining.length > 1600) {
    let cut = remaining.lastIndexOf(' ', 1500)
    if (cut < 600) cut = 1500
    chunks.push(remaining.slice(0, cut).trim())
    remaining = remaining.slice(cut).trim()
  }
  if (remaining) chunks.push(remaining)
  return chunks
}
