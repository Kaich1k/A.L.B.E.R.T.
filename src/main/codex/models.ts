/**
 * Model discovery.
 *
 * Available slugs depend on Kai's ChatGPT plan and rotate over time, so nothing
 * here treats a model as guaranteed-present: the constants below are ordered
 * preferences applied against whatever `model/list` actually reports.
 *
 * Observed on codex-cli 0.153.4 (Plus): `gpt-6-astra` (server default),
 * `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4-mini`.
 * The response is keyed `data`, and each entry's `supportedReasoningEfforts`
 * is a list of objects, not strings.
 */
import type { CodexAppServer } from './appServer'

export interface CodexModel {
  id: string
  displayName: string
  description: string
  efforts: string[]
  defaultEffort: string | null
  isDefault: boolean
}

/**
 * Everyday engineering model. Terra before Astra deliberately — Astra is the
 * server default but burns the Plus allowance far faster.
 */
export const CODEX_MODEL_PREFERENCE = [
  'gpt-5.6-terra',
  'gpt-5.6-sol',
  'gpt-5.6-luna',
  'gpt-5.5'
]

/** Reserved for genuinely hard work. */
export const CODEX_ESCALATION_PREFERENCE = ['gpt-6-astra', 'gpt-5.6-terra', 'gpt-5.6-sol']

export const CODEX_DEFAULT_EFFORT = 'medium'

function effortList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const entry of raw) {
    if (typeof entry === 'string' && entry.trim()) {
      out.push(entry.trim())
      continue
    }
    // Current shape: { reasoningEffort, description }
    const value = (entry as { reasoningEffort?: unknown })?.reasoningEffort
    if (typeof value === 'string' && value.trim()) out.push(value.trim())
  }
  return [...new Set(out)]
}

/** Accepts the current `data` key and the older/documented `models` key. */
export function parseModelList(response: unknown): CodexModel[] {
  const root = (response && typeof response === 'object' ? response : {}) as Record<string, unknown>
  const rows = Array.isArray(root.data)
    ? root.data
    : Array.isArray(root.models)
      ? root.models
      : []

  const out: CodexModel[] = []
  const seen = new Set<string>()

  for (const entry of rows) {
    const row = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    // Hidden models are staged for other clients; don't offer them to Kai.
    if (row.hidden === true) continue
    const id = String(row.id || row.model || row.slug || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      displayName: String(row.displayName || id),
      description: String(row.description || ''),
      efforts: effortList(row.supportedReasoningEfforts),
      defaultEffort:
        typeof row.defaultReasoningEffort === 'string' ? row.defaultReasoningEffort : null,
      isDefault: row.isDefault === true
    })
  }

  return out
}

/**
 * First preference that actually exists, else the server's own default, else
 * the first listed model. Returns the request unchanged when nothing is known,
 * so a manual override still reaches Codex.
 */
export function pickModel(
  models: CodexModel[],
  preference: string[],
  requested?: string | null
): string | null {
  const want = requested?.trim() || ''
  if (!models.length) return want || null

  const ids = new Set(models.map((m) => m.id))
  if (want && ids.has(want)) return want

  for (const candidate of preference) {
    if (ids.has(candidate)) return candidate
  }
  // Loose match so a dated point release (`gpt-5.6-terra-2026-09`) still counts.
  for (const candidate of preference) {
    const hit = models.find((m) => m.id.startsWith(candidate))
    if (hit) return hit.id
  }
  return models.find((m) => m.isDefault)?.id ?? models[0]!.id
}

export function supportedEfforts(models: CodexModel[], modelId: string | null): string[] {
  if (!modelId) return []
  return models.find((m) => m.id === modelId)?.efforts ?? []
}

/**
 * Coerce to an effort the chosen model actually supports, so a stale setting
 * can't make every turn fail. Prefers Kai's choice, then `medium`, then the
 * model's own default.
 */
export function normalizeEffort(
  models: CodexModel[],
  modelId: string | null,
  requested: string | null | undefined
): string {
  const want = (requested || '').trim() || CODEX_DEFAULT_EFFORT
  const efforts = supportedEfforts(models, modelId)
  if (!efforts.length) return want
  if (efforts.includes(want)) return want
  if (efforts.includes(CODEX_DEFAULT_EFFORT)) return CODEX_DEFAULT_EFFORT
  const fallback = models.find((m) => m.id === modelId)?.defaultEffort
  return fallback && efforts.includes(fallback) ? fallback : efforts[0]!
}

export async function listCodexModels(server: CodexAppServer): Promise<CodexModel[]> {
  try {
    return parseModelList(await server.request<unknown>('model/list', {}))
  } catch {
    return []
  }
}
