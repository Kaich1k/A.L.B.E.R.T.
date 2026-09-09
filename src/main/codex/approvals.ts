/**
 * Approval gating for Codex `item/*\/requestApproval` server requests.
 *
 * Pure decision logic, separated from the Electron dialog so the security rule
 * ("auto-accept only inside the project folder") can be tested directly.
 */
import { isAbsolute, normalize, resolve, sep } from 'path'
import { commandLooksLikeLiveSourceWrite, liveSourceHit } from '../../shared/liveSource'
import { commandLooksLikeSelfRestart, commandLooksLikeSelfUpdate } from '../../shared/selfUpdate'
import type { CodexApprovalDecision } from './protocol'

export type CodexApprovalKind = 'command' | 'fileChange'

export interface CodexApprovalContext {
  kind: CodexApprovalKind
  /** Absolute paths the action touches. Empty means "unknown target". */
  paths: string[]
  /** Working directory for a command, when the server reports one. */
  cwd: string | null
  /** Configured project root; empty when Kai hasn't set one. */
  projectFolder: string
  /** Systems → "Confirm before dangerous tools". */
  confirmDangerousTools: boolean
  /** Codex asked for a write root beyond the sandbox — always a prompt. */
  grantRoot?: string | null
  /** Codex asked for network access to a host — always a prompt. */
  networkHost?: string | null
  /** Vite/Electron live reload is running — writing ALBERT src/ crashes the UI. */
  liveReload?: boolean
  /** Resolved ALBERT repo root, when this process is the live app. */
  protectedRoot?: string | null
  /** `.albert-hmr-pause` is active — live src writes will not HMR the UI. */
  hmrPaused?: boolean
  /** Shell text for command approvals, used to catch `sed -i src/…` etc. */
  command?: string | null
}

export type CodexApprovalOutcome =
  | { auto: true; decision: CodexApprovalDecision; reason: string }
  | { auto: false; reason: string }

/**
 * True when `child` is the same as `parent` or nested inside it.
 *
 * Compares resolved paths with a trailing separator so `/work/proj-evil` is not
 * treated as living inside `/work/proj`.
 */
export function isInsideRoot(child: string, parent: string): boolean {
  if (!child?.trim() || !parent?.trim()) return false
  if (!isAbsolute(child) || !isAbsolute(parent)) return false
  const target = resolve(normalize(child))
  const root = resolve(normalize(parent))
  if (target === root) return true
  return target.startsWith(root.endsWith(sep) ? root : root + sep)
}

/** Paths a command approval effectively touches, best-effort. */
export function approvalTargets(context: CodexApprovalContext): string[] {
  const targets = context.paths.filter((p) => p?.trim())
  if (targets.length) return targets
  return context.cwd?.trim() ? [context.cwd] : []
}

export function decideCodexApproval(context: CodexApprovalContext): CodexApprovalOutcome {
  // Self-update/restart shells suicide the running app — never accept, even
  // when confirmations are off or Codex also asked for a grantRoot.
  if (context.command && commandLooksLikeSelfUpdate(context.command)) {
    return {
      auto: true,
      decision: 'decline',
      reason: 'self-update must run detached'
    }
  }
  if (context.command && commandLooksLikeSelfRestart(context.command)) {
    return {
      auto: true,
      decision: 'decline',
      reason: 'restart must use app.relaunch'
    }
  }

  // Explicit escalations are never silently granted, whatever the settings say.
  if (context.grantRoot?.trim()) {
    return { auto: false, reason: `Codex wants write access to ${context.grantRoot}` }
  }
  if (context.networkHost?.trim()) {
    return { auto: false, reason: `Codex wants network access to ${context.networkHost}` }
  }

  const project = context.projectFolder?.trim()
  const liveRoot = context.protectedRoot?.trim() || project
  const liveHit =
    context.liveReload && liveRoot && !context.hmrPaused
      ? liveSourceHit(approvalTargets(context), liveRoot)
      : null
  if (liveHit) {
    return {
      auto: true,
      decision: 'decline',
      reason: `Live ALBERT source is protected (${liveHit})`
    }
  }
  if (
    context.liveReload &&
    !context.hmrPaused &&
    context.command &&
    commandLooksLikeLiveSourceWrite(context.command)
  ) {
    return {
      auto: true,
      decision: 'decline',
      reason: 'Live ALBERT source is protected from shell writes'
    }
  }

  if (context.confirmDangerousTools) {
    return { auto: false, reason: 'Confirmations are ON in Systems' }
  }

  if (!project) {
    return { auto: false, reason: 'No project folder is configured' }
  }

  const targets = approvalTargets(context)
  if (!targets.length) {
    return { auto: false, reason: 'Codex did not say which path it would touch' }
  }

  const outside = targets.filter((target) => !isInsideRoot(target, project))
  if (outside.length) {
    return { auto: false, reason: `Outside the project folder: ${outside[0]}` }
  }

  return {
    auto: true,
    decision: 'accept',
    reason: `Inside ${project} and confirmations are off`
  }
}

/** Absolute paths mentioned by a `fileChange` approval payload. */
export function fileChangePaths(params: Record<string, unknown>): string[] {
  const out: string[] = []
  const changes = params.changes
  if (Array.isArray(changes)) {
    for (const entry of changes) {
      if (typeof entry === 'string') out.push(entry)
      else if (entry && typeof entry === 'object') {
        const path = (entry as { path?: unknown }).path
        if (typeof path === 'string') out.push(path)
      }
    }
  } else if (changes && typeof changes === 'object') {
    out.push(...Object.keys(changes))
  }
  const single = params.path
  if (typeof single === 'string') out.push(single)
  return out.filter((p) => p.trim())
}

/**
 * Absolute paths a shell command will read or write, from Codex's own parsed
 * `commandActions`. Unparsed commands yield nothing, which forces a prompt.
 */
export function commandApprovalPaths(params: Record<string, unknown>): string[] {
  const actions = params.commandActions
  if (!Array.isArray(actions)) return []
  const out: string[] = []
  for (const entry of actions) {
    if (!entry || typeof entry !== 'object') continue
    const path = (entry as { path?: unknown }).path
    if (typeof path === 'string' && path.trim()) out.push(path)
  }
  return out
}

/**
 * Safe JSON-RPC *result* for a Codex server→client request we do not implement.
 * Throwing a protocol error aborts the whole ChatGPT turn (Gemini fallback).
 */
export function declineUnknownCodexServerRequest(
  method: string,
  _params: Record<string, unknown> = {}
): Record<string, unknown> {
  if (method === 'mcpServer/elicitation/request') {
    return { action: 'decline', content: null }
  }
  if (method === 'item/tool/requestUserInput' || method === 'tool/requestUserInput') {
    return { answers: {} }
  }
  if (method === 'item/permissions/requestApproval') {
    return { permissions: {}, scope: 'turn' }
  }
  if (method.endsWith('requestApproval') || method.endsWith('Approval')) {
    return { decision: 'decline' }
  }
  if (method === 'attestation/generate') {
    return { token: '' }
  }
  if (method === 'item/tool/call') {
    return {
      contentItems: [{ type: 'text', text: 'This host does not run that tool.' }],
      success: false
    }
  }
  return {}
}

/** Grant the subset Codex asked for, turn-scoped. */
export function grantRequestedPermissions(params: Record<string, unknown>): {
  permissions: Record<string, unknown>
  scope: 'turn' | 'session'
} {
  const raw = params.permissions
  const permissions =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}
  return { permissions, scope: 'session' }
}
