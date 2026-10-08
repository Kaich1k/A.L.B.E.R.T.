export interface MailHit {
  id: string
  subject: string
  sender: string
  received: string
  body: string
  unread: boolean
  flagged: boolean
}

export type ComputerIntent =
  | { kind: 'outlook-check'; query: string }
  | { kind: 'outlook-open-newest' }
  | { kind: 'outlook-draft' }
  | { kind: 'outlook-send' }
  | { kind: 'find-download'; prefix: string }

/** Host-side routing for clear computer requests. Unrelated chat stays with the model. */
export function classifyComputerIntent(text: string): ComputerIntent | null {
  const raw = text.trim()
  if (!raw) return null

  if (/^send it\.?$/i.test(raw) || /\bsend (?:the|that|this) (?:reply|email|message)\b/i.test(raw)) {
    return { kind: 'outlook-send' }
  }
  if (/\bdraft (?:a |the )?(?:reply|response|email)\b/i.test(raw)) {
    return { kind: 'outlook-draft' }
  }
  if (/\b(?:open|summarize)\b[\s\S]{0,80}\b(?:newest|latest)\b[\s\S]{0,40}\b(?:reply|email|thread)\b/i.test(raw)) {
    return { kind: 'outlook-open-newest' }
  }

  const prefix = raw.match(/\b(?:beginning|starts?)\s+with\s+([A-Za-z0-9._-]+)/i)
  if (prefix && /\bdownloads?\b/i.test(raw)) {
    return { kind: 'find-download', prefix: prefix[1]! }
  }

  const outlookVerb = /\b(?:check|look(?:\s+at)?|read|show|open)\b/i.test(raw)
  const outlookNoun = /\b(?:outlook|inbox|pinned emails|unread)\b/i.test(raw)
  if (outlookVerb && outlookNoun) {
    return { kind: 'outlook-check', query: raw }
  }
  return null
}

export function filterMail(messages: MailHit[], query: string): MailHit[] {
  const q = query.toLowerCase()
  const wantUnread = /\bunread\b|\bnew\b|\breplies\b/.test(q)
  const wantFlagged = /\bpinned\b|\bflagged\b|\bfavorite\b|\bstarred\b/.test(q)
  const needles: string[] = []
  if (q.includes('universit')) needles.push('universit')
  const extra = q
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) =>
      word.length > 3 &&
      ![
        'check', 'outlook', 'inbox', 'email', 'emails', 'unread', 'pinned',
        'reply', 'replies', 'look', 'show', 'please', 'from', 'with', 'that',
        'this', 'your', 'mail', 'message', 'messages', 'newest', 'latest'
      ].includes(word)
    )
  for (const word of extra) {
    if (!needles.some((needle) => word.includes(needle) || needle.includes(word))) needles.push(word)
  }

  return messages.filter((message) => {
    if (wantUnread && !message.unread) return false
    if (wantFlagged && !message.flagged) return false
    if (!needles.length) return true
    const hay = `${message.subject} ${message.sender} ${message.body}`.toLowerCase()
    return needles.every((needle) => hay.includes(needle))
  })
}

export function matchNamePrefix(names: string[], prefix: string): string[] {
  const needle = prefix.trim().toLowerCase()
  if (!needle) return []
  return names.filter((name) => name.toLowerCase().startsWith(needle))
}

export function summarizeThread(message: MailHit | undefined): string {
  if (!message) return 'No matching message was open, sir.'
  const body = message.body.replace(/\s+/g, ' ').trim().slice(0, 700)
  return [
    `Newest matching message from ${message.sender || 'an unknown sender'}.`,
    `Subject: ${message.subject || '(no subject)'}.`,
    message.received ? `Received ${message.received}.` : '',
    body ? `It says: ${body}` : 'The body was empty.'
  ]
    .filter(Boolean)
    .join(' ')
}
