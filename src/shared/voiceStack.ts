export type VoiceStackAction = 'short' | 'original' | 'pause' | 'show' | 'phone' | 'hold'

export function parseVoiceStackCommand(text: string): VoiceStackAction | null {
  const t = text.replace(/\s+/g, ' ').trim().toLowerCase()
  if (!t) return null
  if (/^(short(er)? version|make (it|that) short(er)?|tl;?dr|summarize that|too long)\.?$/.test(t)) {
    return 'short'
  }
  if (/^(restore|full|original) (version|answer)|show (the )?original|long version/.test(t)) {
    return 'original'
  }
  if (/^(pause that|hold that|stop talking|mute (that|yourself)|quiet)\.?$/.test(t)) {
    return 'pause'
  }
  if (/^(show me|pull it up|let me see( that)?|show (the )?(screen|file|diff|artifact))\b/.test(t)) {
    return 'show'
  }
  if (/^(send (that|this|it) to (my )?phone|package (that|this) for (the )?phone)\b/.test(t)) {
    return 'phone'
  }
  if (/^(hold (that )?thought|save (this|the) (thread|context) for later)\b/.test(t)) {
    return 'hold'
  }
  return null
}

export function shortenAnswer(text: string, maxChars = 280): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  if (clean.length <= maxChars) return clean
  const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean)
  let out = ''
  for (const sentence of sentences) {
    const next = out ? `${out} ${sentence}` : sentence
    if (next.length > maxChars) break
    out = next
  }
  if (!out) out = clean.slice(0, maxChars - 1)
  return out.endsWith('.') ? out : `${out.replace(/[,;:\s]+$/, '')}.`
}
