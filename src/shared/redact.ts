const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/bearer\s+\S+/gi, 'bearer [redacted]'],
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted-jwt]'],
  [/(password|passwd|token|secret|otp|refresh_token|access_token|authorization)\s*[:=]\s*\S+/gi, '$1=[redacted]'],
  [/\b(?:code|otp|pin)\s*(?:is|:)?\s*\d{4,8}\b/gi, '[redacted-code]']
]

/** Strip credentials and auth codes before they land in activity history. */
export function redactSensitive(value: string): string {
  let out = value
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement)
  }
  return out
}

export function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redactSensitive(value)
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry))
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (/password|token|secret|authorization|otp/i.test(key)) {
      out[key] = '[redacted]'
    } else {
      out[key] = redactValue(entry)
    }
  }
  return out
}
