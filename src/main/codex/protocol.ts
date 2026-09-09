/**
 * Codex app-server protocol types.
 *
 * Hand-narrowed from `codex app-server generate-ts` (codex-cli 0.153.4) — only the
 * slice A.L.B.E.R.T. actually uses. The generated bindings are enormous and the
 * server tolerates unknown fields, so keeping this small is deliberate.
 */

export const CODEX_CLIENT_NAME = 'albert_mac'

/** Handshake flags so experimental turn fields (excludeTurns, etc.) are legal. */
export const CODEX_CLIENT_CAPABILITIES = {
  experimentalApi: true,
  optOutNotificationMethods: [
    'item/reasoning/textDelta',
    'item/reasoning/summaryTextDelta'
  ]
} as const

/** Codex spells these `on-request` / `untrusted` / `never` — not `unlessTrusted`. */
export type CodexApprovalPolicy = 'untrusted' | 'on-request' | 'never'

export type CodexSandboxPolicy =
  | { type: 'dangerFullAccess' }
  | { type: 'readOnly'; networkAccess?: boolean }
  | {
      type: 'workspaceWrite'
      writableRoots?: string[]
      networkAccess?: boolean
      excludeSlashTmp?: boolean
      excludeTmpdirEnvVar?: boolean
    }

export type CodexUserInput =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string }
  | { type: 'localImage'; path: string }

export interface CodexInitializeResult {
  userAgent?: string
  codexHome?: string
  platformOs?: string
  platformFamily?: string
}

export type CodexPlanType = string | null

/** `account/read` — discriminated on `type`. */
export type CodexAccount =
  | { type: 'apiKey' }
  | { type: 'chatgpt'; email: string | null; planType: CodexPlanType }
  | { type: 'amazonBedrock'; usesCodexManagedCredentials: boolean }

export interface CodexAccountReadResponse {
  account?: CodexAccount | null
  /** Older/newer servers have shipped both shapes; accept either. */
  accounts?: CodexAccount[] | null
  authMode?: string | null
  planType?: CodexPlanType
}

export interface CodexRateLimitWindow {
  usedPercent: number
  windowDurationMins: number | null
  resetsAt: number | null
}

export interface CodexRateLimitSnapshot {
  limitId?: string | null
  limitName?: string | null
  primary?: CodexRateLimitWindow | null
  secondary?: CodexRateLimitWindow | null
  credits?: { hasCredits: boolean; unlimited: boolean; balance: string | null } | null
  planType?: CodexPlanType
  rateLimitReachedType?: string | null
  spendControlReached?: boolean | null
}

export interface CodexLoginStartResponse {
  loginId?: string | null
  authUrl?: string | null
  /** Device-code flow only. */
  userCode?: string | null
  verificationUri?: string | null
}

export interface CodexModelListResponse {
  models?: Array<{
    id?: string
    slug?: string
    model?: string
    displayName?: string | null
    description?: string | null
    supportedReasoningEfforts?: string[] | null
    isDefault?: boolean | null
  }> | null
}

export interface CodexThreadStartResponse {
  thread: { id: string }
  model?: string
  reasoningEffort?: string | null
}

export interface CodexTurnStartResponse {
  turn: { id: string; status?: string }
}

/** `item/started` and `item/completed` carry a `ThreadItem` in `item`. */
export interface CodexThreadItem {
  type: string
  id: string
  /** agentMessage */
  text?: string
  phase?: string | null
  /** commandExecution */
  command?: string
  cwd?: string | null
  exitCode?: number | null
  aggregatedOutput?: string | null
  status?: string | null
  /** fileChange */
  changes?: Array<{ path?: string; kind?: string }> | null
  /** reasoning */
  summary?: string[] | null
  /** mcpToolCall / functionCallOutput */
  name?: string
  [key: string]: unknown
}

export interface CodexTurnError {
  message?: string
  codexErrorInfo?: { type?: string; [key: string]: unknown } | null
  [key: string]: unknown
}

/** Approval decisions accepted by both approval request types. */
export type CodexApprovalDecision =
  | 'accept'
  | 'acceptForSession'
  | 'decline'
  | 'cancel'

/**
 * Faults A.L.B.E.R.T. reports differently from a generic failure. Derived from
 * `codexErrorInfo.type` where available, otherwise sniffed from the message.
 */
export type CodexFaultKind =
  | 'notInstalled'
  | 'notSignedIn'
  | 'usageLimit'
  | 'contextWindow'
  | 'interrupted'
  | 'transport'
  | 'unknown'

export class CodexFault extends Error {
  readonly kind: CodexFaultKind
  readonly detail?: string

  constructor(kind: CodexFaultKind, message: string, detail?: string) {
    super(message)
    this.name = 'CodexFault'
    this.kind = kind
    this.detail = detail
  }
}

/** Map a Codex error payload to a fault A.L.B.E.R.T. can explain out loud. */
export function classifyCodexError(error: CodexTurnError | null | undefined): CodexFault {
  const infoType = String(error?.codexErrorInfo?.type ?? '')
  const message = String(error?.message ?? '').trim()
  const haystack = `${infoType} ${message}`.toLowerCase()

  if (/usagelimit|usage_limit|rate.?limit|quota/.test(haystack)) {
    return new CodexFault(
      'usageLimit',
      'Your ChatGPT Codex allowance is used up for now, sir.',
      message
    )
  }
  if (/unauthorized|unauthenticated|not.?signed.?in|invalid.?token|login/.test(haystack)) {
    return new CodexFault('notSignedIn', 'Codex is not signed in, sir.', message)
  }
  if (/contextwindow|context_window|context length|too many tokens/.test(haystack)) {
    return new CodexFault(
      'contextWindow',
      'That thread outgrew the context window, sir — I need a fresh one.',
      message
    )
  }
  if (/interrupt|abort|cancel/.test(haystack)) {
    return new CodexFault('interrupted', 'Codex turn interrupted, sir.', message)
  }
  return new CodexFault('unknown', message || 'Codex failed for an unknown reason, sir.', message)
}
