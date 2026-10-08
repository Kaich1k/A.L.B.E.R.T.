/** Gemini and Claude model ids Albert can be pointed at. Latest first. */

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash'
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5'

export const GEMINI_MODEL_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash — latest' },
  { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite — lightest' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro — preview' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash — legacy' },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite — legacy' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro — legacy' }
]

export const CLAUDE_MODEL_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 — latest Opus' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — latest Sonnet' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 — latest Haiku' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1 — deepest reasoning' },
  { id: 'claude-opus-5', label: 'Claude Opus 5' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' }
]

export function withSavedModel(
  options: Array<{ id: string; label: string }>,
  saved: string | null | undefined
): Array<{ id: string; label: string }> {
  const id = saved?.trim()
  if (!id || options.some((option) => option.id === id)) return options
  return [...options, { id, label: id }]
}
