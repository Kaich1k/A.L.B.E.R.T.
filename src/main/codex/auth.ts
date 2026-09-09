/**
 * ChatGPT sign-in for Codex.
 *
 * `account/login/start` with `{ type: 'chatgpt' }` hands back a URL to open in
 * the browser; the app-server runs the OAuth loopback itself and reports the
 * outcome through `account/login/completed`. No OpenAI API key is involved, so
 * engineering turns draw on Kai's existing ChatGPT allowance.
 */
import type { CodexAppServer } from './appServer'
import type {
  CodexAccount,
  CodexAccountReadResponse,
  CodexLoginStartResponse,
  CodexRateLimitSnapshot
} from './protocol'

export interface CodexAuthState {
  signedIn: boolean
  mode: 'chatgpt' | 'apiKey' | 'bedrock' | null
  email: string | null
  planType: string | null
}

export const SIGNED_OUT: CodexAuthState = {
  signedIn: false,
  mode: null,
  email: null,
  planType: null
}

/** Normalize the several shapes `account/read` has shipped with. */
export function toAuthState(response: CodexAccountReadResponse | null | undefined): CodexAuthState {
  const account: CodexAccount | null =
    response?.account ?? (Array.isArray(response?.accounts) ? response!.accounts![0] ?? null : null)

  if (!account) {
    // Some builds only report `authMode` when an account exists.
    const mode = response?.authMode
    if (mode === 'chatgpt') {
      return { signedIn: true, mode: 'chatgpt', email: null, planType: response?.planType ?? null }
    }
    if (mode === 'apiKey') {
      return { signedIn: true, mode: 'apiKey', email: null, planType: null }
    }
    return SIGNED_OUT
  }

  if (account.type === 'chatgpt') {
    return {
      signedIn: true,
      mode: 'chatgpt',
      email: account.email ?? null,
      planType: account.planType ?? response?.planType ?? null
    }
  }
  if (account.type === 'apiKey') {
    return { signedIn: true, mode: 'apiKey', email: null, planType: null }
  }
  return { signedIn: true, mode: 'bedrock', email: null, planType: null }
}

export async function readAccount(server: CodexAppServer): Promise<CodexAuthState> {
  try {
    const response = await server.request<CodexAccountReadResponse>('account/read', {})
    return toAuthState(response)
  } catch {
    return SIGNED_OUT
  }
}

export interface CodexLoginHandle {
  loginId: string | null
  authUrl: string | null
}

/** Kick off the browser OAuth flow. Completion arrives as a notification. */
export async function startChatGptLogin(server: CodexAppServer): Promise<CodexLoginHandle> {
  const response = await server.request<CodexLoginStartResponse>('account/login/start', {
    type: 'chatgpt',
    // Let Codex host the "you're signed in" page instead of a blank loopback.
    useHostedLoginSuccessPage: true
  })
  return {
    loginId: response?.loginId ?? null,
    authUrl: response?.authUrl ?? null
  }
}

export async function cancelChatGptLogin(
  server: CodexAppServer,
  loginId: string | null
): Promise<void> {
  if (!loginId) return
  try {
    await server.request('account/login/cancel', { loginId })
  } catch {
    // Already finished or already cancelled — nothing to undo.
  }
}

export async function logoutCodex(server: CodexAppServer): Promise<void> {
  await server.request('account/logout', {})
}

export async function readRateLimits(
  server: CodexAppServer
): Promise<CodexRateLimitSnapshot | null> {
  try {
    const response = await server.request<{ rateLimits?: CodexRateLimitSnapshot } | CodexRateLimitSnapshot>(
      'account/rateLimits/read',
      {}
    )
    if (!response) return null
    const nested = (response as { rateLimits?: CodexRateLimitSnapshot }).rateLimits
    return nested ?? (response as CodexRateLimitSnapshot)
  } catch {
    return null
  }
}

/**
 * Remaining allowance as a percentage, using whichever window is tighter.
 * Codex reports *used* percent per window; Kai cares about what's left.
 */
export function remainingAllowancePercent(
  snapshot: CodexRateLimitSnapshot | null | undefined
): number | null {
  const used = [snapshot?.primary?.usedPercent, snapshot?.secondary?.usedPercent].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value)
  )
  if (!used.length) return null
  const worst = Math.max(...used)
  return Math.max(0, Math.min(100, Math.round(100 - worst)))
}

/** Short human sentence for the Systems panel and the status rail. */
export function describeAllowance(
  snapshot: CodexRateLimitSnapshot | null | undefined
): string {
  const remaining = remainingAllowancePercent(snapshot)
  if (remaining == null) return 'Allowance unknown'

  const reset = snapshot?.primary?.resetsAt ?? snapshot?.secondary?.resetsAt ?? null
  if (!reset) return `${remaining}% allowance left`

  // Codex has shipped both seconds and milliseconds here.
  const resetMs = reset > 1e11 ? reset : reset * 1000
  const minutes = Math.max(0, Math.round((resetMs - Date.now()) / 60_000))
  if (minutes <= 0) return `${remaining}% allowance left`
  if (minutes < 60) return `${remaining}% allowance left · resets in ${minutes}m`
  const hours = Math.round(minutes / 60)
  return `${remaining}% allowance left · resets in ${hours}h`
}
