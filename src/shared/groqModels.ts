// Kept DOM/Electron-free so lifecycle rules can run in the Node regression suite.
const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-20b'

export const GROQ_TRANSITION_CUTOFF_MS = Date.parse('2026-08-16T00:00:00Z')

export const GROQ_TRANSITION_MODELS = [
  'llama-3.1-8b-instant',
  'llama-3.3-70b-versatile'
] as const

export function isGroqTransitionModel(model: string): boolean {
  return (GROQ_TRANSITION_MODELS as readonly string[]).includes(model)
}

export function groqTransitionWindowOpen(now = Date.now()): boolean {
  return now < GROQ_TRANSITION_CUTOFF_MS
}

/** Retiring bridge models must never remain pinned after Groq's cutoff. */
export function normalizeGroqModelForDate(model: string, now = Date.now()): string {
  if (isGroqTransitionModel(model) && !groqTransitionWindowOpen(now)) {
    return DEFAULT_GROQ_MODEL
  }
  return model || DEFAULT_GROQ_MODEL
}
