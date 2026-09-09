/**
 * The Codex bridge A.L.B.E.R.T. actually talks to.
 *
 * Owns one long-lived `codex app-server` process, one persisted thread, and at
 * most one in-flight turn. Everything Electron-flavoured (settings, dialogs,
 * opening the browser for OAuth) lives here so the rest of `src/main/codex` can
 * stay pure and testable.
 */
import { BrowserWindow, dialog, shell } from 'electron'
import { homedir } from 'os'
import { CodexAppServer } from './appServer'
import {
  commandApprovalPaths,
  decideCodexApproval,
  declineUnknownCodexServerRequest,
  fileChangePaths,
  grantRequestedPermissions,
  type CodexApprovalKind
} from './approvals'
import {
  cancelChatGptLogin,
  describeAllowance,
  logoutCodex,
  readAccount,
  readRateLimits,
  remainingAllowancePercent,
  startChatGptLogin,
  SIGNED_OUT,
  type CodexAuthState
} from './auth'
import { codexVersion, findCodexBinary, CODEX_INSTALL_HINT } from './binary'
import { mapCodexNotification, type CodexBridgeEvent } from './events'
import {
  listCodexModels,
  normalizeEffort,
  pickModel,
  CODEX_ESCALATION_PREFERENCE,
  CODEX_MODEL_PREFERENCE,
  type CodexModel
} from './models'
import {
  CodexFault,
  classifyCodexError,
  type CodexApprovalDecision,
  type CodexRateLimitSnapshot,
  type CodexThreadStartResponse,
  type CodexTurnStartResponse,
  type CodexUserInput
} from './protocol'
import { commandLooksLikeLiveSourceWrite, liveSourceHit, pathsFromUnifiedDiff } from '../../shared/liveSource'
import { startAppUpdate, takeoverSelfLifecycleCommand } from '../appLifecycle'
import { getSettings, setSettings } from '../config'
import { albertSourceRoot, isDevLiveReload } from '../cursor/selfEdit'
import { isLiveHmrPaused, pauseLiveHmr, resumeLiveHmr } from '../cursor/hmrPause'
import { suspendHudForDialog } from '../hud/miniHud'
import { isAuxiliaryAlbertUrl } from '../../shared/albertWindows'
import type { CodexAllowance, CodexStatus } from '../../shared/types'

type StatusListener = (status: CodexStatus) => void

interface ActiveTurn {
  threadId: string
  turnId: string | null
  onEvent: (event: CodexBridgeEvent) => void
  resolve: (value: CodexTurnResult) => void
  reject: (err: Error) => void
  settled: boolean
  finalText: string
  streamedText: string
  interrupted: boolean
  liveSourceTouched: boolean
}

export interface CodexTurnResult {
  text: string
  threadId: string
  turnId: string | null
  interrupted: boolean
}

export interface CodexTurnOptions {
  input: CodexUserInput[]
  onEvent: (event: CodexBridgeEvent) => void
  /** Extra system-level guidance appended to Codex's own instructions. */
  developerInstructions?: string
  model?: string
  effort?: string
  /** Overall wall-clock ceiling for a turn. */
  timeoutMs?: number
}

let server: CodexAppServer | null = null
let models: CodexModel[] = []
let auth: CodexAuthState = SIGNED_OUT
let allowance: CodexAllowance | null = null
let activeTurn: ActiveTurn | null = null
/** Thread already loaded in this app-server process; avoids resume on every turn. */
let liveThreadId: string | null = null
let pendingLoginId: string | null = null
let lastError: string | null = null
let versionCache: string | null | undefined
const statusListeners = new Set<StatusListener>()

/** Codex needs a real directory; fall back to $HOME when no project is set. */
function codexCwd(): string {
  const project = getSettings().projectFolder?.trim()
  return project || homedir()
}

function notifyStatus(): void {
  const status = getCodexStatus()
  for (const listener of statusListeners) {
    try {
      listener(status)
    } catch {
      // A broken listener must not take down the bridge.
    }
  }
}

export function onCodexStatus(listener: StatusListener): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

function setAllowance(snapshot: CodexRateLimitSnapshot | null): void {
  if (!snapshot) return
  allowance = {
    remainingPercent: remainingAllowancePercent(snapshot),
    label: describeAllowance(snapshot),
    planType: snapshot.planType ?? auth.planType ?? null,
    updatedAt: Date.now()
  }
}

function markLiveSourceTouch(paths?: string[], command?: string): void {
  if (!activeTurn || activeTurn.liveSourceTouched) return
  const root = albertSourceRoot()
  if (!root) return
  if (paths?.length && liveSourceHit(paths, root)) {
    activeTurn.liveSourceTouched = true
    return
  }
  if (command && commandLooksLikeLiveSourceWrite(command)) {
    activeTurn.liveSourceTouched = true
  }
}

function rebuildIfLiveSourceTouched(turn: ActiveTurn): void {
  if (!turn.liveSourceTouched) {
    resumeLiveHmr()
    return
  }
  const started = startAppUpdate(true)
  if (started.result) {
    turn.finalText = [turn.finalText.trim(), started.result].filter(Boolean).join('\n\n')
    notifyRenderer({ type: 'codex_progress', content: started.result })
  }
  if (!started.ok) resumeLiveHmr()
}

function settleTurn(turn: ActiveTurn, error?: Error): void {
  if (turn.settled) return
  turn.settled = true
  if (activeTurn === turn) activeTurn = null
  // Source edits already landed on disk — rebuild even if Codex was interrupted
  // or never reached `npm run update:app`.
  rebuildIfLiveSourceTouched(turn)
  if (error) {
    turn.reject(error)
    return
  }
  turn.resolve({
    // Streamed deltas are the fallback when no completed message arrived.
    text: (turn.finalText || turn.streamedText).trim(),
    threadId: turn.threadId,
    turnId: turn.turnId,
    interrupted: turn.interrupted
  })
}

function handleNotification(method: string, params: unknown): void {
  const events = mapCodexNotification(method, params)
  const turn = activeTurn

  for (const event of events) {
    switch (event.kind) {
      case 'rateLimits':
        setAllowance(event.snapshot)
        notifyStatus()
        break
      case 'accountUpdated':
        void refreshAccount()
        break
      case 'loginCompleted':
        pendingLoginId = null
        lastError = event.success ? null : event.error || 'ChatGPT sign-in failed'
        void refreshAccount()
        break
      case 'turnStarted':
        if (turn && !turn.turnId) turn.turnId = event.turnId
        break
      case 'delta':
        if (turn) turn.streamedText += event.text
        break
      case 'agentMessage':
        // Commentary is progress narration; only a final message is the answer.
        if (turn && event.final) turn.finalText = event.text
        break
      case 'fileChange':
        markLiveSourceTouch(event.paths)
        break
      case 'diff':
        markLiveSourceTouch(pathsFromUnifiedDiff(event.diff))
        break
      case 'commandStart': {
        markLiveSourceTouch(undefined, event.command)
        const taken = takeoverSelfLifecycleCommand(event.command)
        if (taken) {
          notifyRenderer({ type: 'codex_progress', content: taken.result })
          queueMicrotask(() => {
            if (codexTurnActive()) void steerCodexTurn(taken.result)
          })
        }
        break
      }
      case 'commandEnd':
        markLiveSourceTouch(undefined, event.command)
        break
      case 'turnCompleted':
        if (turn) {
          turn.interrupted = event.status === 'interrupted'
          turn.onEvent(event)
          settleTurn(turn)
          continue
        }
        break
      case 'error':
        if (turn) {
          turn.onEvent(event)
          // Retryable errors keep the turn alive; Codex will try again itself.
          if (!event.willRetry) settleTurn(turn, event.fault)
          continue
        }
        lastError = event.fault.message
        notifyStatus()
        break
      default:
        break
    }

    if (turn && !turn.settled && event.kind !== 'ignored') turn.onEvent(event)
  }
}

function mainAlbertWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed())
  const main = windows.find((win) => !isAuxiliaryAlbertUrl(win.webContents.getURL()))
  return main ?? null
}

function notifyRenderer(event: { type: string; content?: string }): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('albert:chat:event', event)
  }
}

async function promptApproval(
  kind: CodexApprovalKind,
  summary: string,
  detail: string,
  reason: string
): Promise<boolean> {
  const restoreHud = suspendHudForDialog()
  const win = mainAlbertWindow()
  if (win) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
  notifyRenderer({
    type: 'codex_progress',
    content: `Waiting for Allow / Deny: ${summary.slice(0, 120)}`
  })
  const options = {
    type: 'warning' as const,
    buttons: ['Allow', 'Deny'],
    defaultId: 1,
    cancelId: 1,
    title: 'Codex needs permission',
    message:
      kind === 'command'
        ? `Allow Codex to run “${summary}”?`
        : `Allow Codex to change ${summary}?`,
    detail: `${reason}\n\n${detail}`.slice(0, 1400)
  }
  try {
    const result = win
      ? await dialog.showMessageBox(win, options)
      : await dialog.showMessageBox(options)
    return result.response === 0
  } finally {
    restoreHud()
  }
}

async function handleServerRequest(method: string, rawParams: unknown): Promise<unknown> {
  const params = (rawParams && typeof rawParams === 'object'
    ? rawParams
    : {}) as Record<string, unknown>

  if (method === 'item/permissions/requestApproval') {
    const settings = getSettings()
    const confirm =
      settings.codexApprovalMode === 'always'
        ? true
        : settings.codexApprovalMode === 'never'
          ? false
          : settings.confirmDangerousTools
    if (confirm) {
      const allowed = await promptApproval(
        'fileChange',
        'extra permissions',
        JSON.stringify(params.permissions || params).slice(0, 800),
        'Codex wants additional filesystem or network access'
      )
      return allowed
        ? grantRequestedPermissions(params)
        : { permissions: {}, scope: 'turn' }
    }
    return grantRequestedPermissions(params)
  }

  if (
    method !== 'item/commandExecution/requestApproval' &&
    method !== 'item/fileChange/requestApproval'
  ) {
    return declineUnknownCodexServerRequest(method, params)
  }

  const settings = getSettings()
  const isCommand = method === 'item/commandExecution/requestApproval'
  const kind: CodexApprovalKind = isCommand ? 'command' : 'fileChange'
  const paths = isCommand ? commandApprovalPaths(params) : fileChangePaths(params)
  const command = String(params.command ?? '').trim()
  const cwd = String(params.cwd ?? '').trim() || null
  const networkHost =
    ((params.networkApprovalContext as { host?: string } | undefined)?.host ?? '') || null

  if (isCommand) {
    const taken = takeoverSelfLifecycleCommand(command)
    if (taken) {
      notifyRenderer({ type: 'codex_progress', content: taken.result })
      queueMicrotask(() => {
        if (codexTurnActive()) void steerCodexTurn(taken.result)
      })
      return { decision: 'decline' satisfies CodexApprovalDecision }
    }
  }

  const liveReload = isDevLiveReload()
  const outcome = decideCodexApproval({
    kind,
    paths,
    cwd,
    projectFolder: settings.projectFolder || '',
    // 'always' forces a prompt; 'never' behaves like confirmations-off.
    confirmDangerousTools:
      settings.codexApprovalMode === 'always'
        ? true
        : settings.codexApprovalMode === 'never'
          ? false
          : settings.confirmDangerousTools,
    grantRoot: (params.grantRoot as string | null) ?? null,
    networkHost,
    liveReload,
    protectedRoot: albertSourceRoot(),
    hmrPaused: isLiveHmrPaused(),
    command: isCommand ? command : null
  })

  // Unpaused live src stays declined even when Kai chose 'never'.
  if (outcome.auto && outcome.decision === 'decline') {
    return { decision: 'decline' satisfies CodexApprovalDecision }
  }

  // 'never' means Kai explicitly opted out of prompting entirely.
  if (settings.codexApprovalMode === 'never' && !networkHost) {
    return { decision: 'acceptForSession' satisfies CodexApprovalDecision }
  }

  if (outcome.auto) {
    return { decision: outcome.decision }
  }

  const summary = isCommand
    ? command.split('\n')[0]!.slice(0, 90) || 'a command'
    : paths.length === 1
      ? paths[0]!
      : `${paths.length || 'some'} file(s)`
  const detail = [
    isCommand ? command : paths.join('\n'),
    cwd ? `\ncwd: ${cwd}` : '',
    params.reason ? `\n${String(params.reason)}` : ''
  ]
    .join('')
    .trim()

  const allowed = await promptApproval(kind, summary, detail, outcome.reason)
  return { decision: (allowed ? 'accept' : 'decline') satisfies CodexApprovalDecision }
}

function ensureServer(): CodexAppServer {
  if (server) return server
  server = new CodexAppServer({
    cwd: codexCwd(),
    onNotification: handleNotification,
    onServerRequest: handleServerRequest,
    // Requests are metadata calls; long work streams through notifications.
    requestTimeoutMs: 90_000,
    onExit: (code) => {
      const turn = activeTurn
      if (turn) {
        settleTurn(
          turn,
          new CodexFault('transport', `Codex stopped mid-turn (code ${code ?? 'null'}), sir.`)
        )
      }
      liveThreadId = null
      notifyStatus()
    }
  })
  return server
}

async function refreshAccount(): Promise<CodexAuthState> {
  const instance = ensureServer()
  auth = await readAccount(instance)
  if (auth.signedIn) setAllowance(await readRateLimits(instance))
  notifyStatus()
  return auth
}

/**
 * Bring the bridge up: spawn, handshake, read account, discover models.
 * Safe to call repeatedly; cheap once connected.
 */
export async function connectCodex(): Promise<CodexStatus> {
  if (!findCodexBinary()) {
    lastError = `The Codex CLI isn't installed, sir. ${CODEX_INSTALL_HINT}`
    notifyStatus()
    return getCodexStatus()
  }

  try {
    const instance = ensureServer()
    await instance.start()
    lastError = null
    auth = await readAccount(instance)
    if (!models.length) models = await listCodexModels(instance)
    if (auth.signedIn) setAllowance(await readRateLimits(instance))
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err)
  }
  notifyStatus()
  return getCodexStatus()
}

export function getCodexStatus(): CodexStatus {
  const settings = getSettings()
  const bin = findCodexBinary()
  if (versionCache === undefined) versionCache = bin ? codexVersion(bin) : null

  const model = pickModel(models, CODEX_MODEL_PREFERENCE, settings.codexModel)
  const escalationModel = pickModel(
    models,
    CODEX_ESCALATION_PREFERENCE,
    settings.codexEscalationModel
  )

  return {
    installed: Boolean(bin),
    version: versionCache ?? null,
    connected: Boolean(server?.running && server.initializeResult),
    signedIn: auth.signedIn,
    authMode: auth.mode,
    email: auth.email,
    planType: auth.planType,
    model,
    escalationModel,
    effort: normalizeEffort(models, model, settings.codexEffort),
    availableModels: models.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      efforts: m.efforts
    })),
    threadId: settings.codexThreadId || null,
    allowance,
    lastError,
    installHint: bin ? null : CODEX_INSTALL_HINT
  }
}

export async function refreshCodexAllowance(): Promise<CodexAllowance | null> {
  if (!server?.running) return allowance
  setAllowance(await readRateLimits(server))
  notifyStatus()
  return allowance
}

/** Opens the browser for ChatGPT OAuth. Completion arrives asynchronously. */
export async function loginCodex(): Promise<{ authUrl: string | null; error?: string }> {
  try {
    const instance = ensureServer()
    await instance.start()
    const handle = await startChatGptLogin(instance)
    pendingLoginId = handle.loginId
    if (handle.authUrl) await shell.openExternal(handle.authUrl)
    lastError = handle.authUrl ? null : 'Codex did not return a sign-in URL'
    notifyStatus()
    return { authUrl: handle.authUrl }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    lastError = message
    notifyStatus()
    return { authUrl: null, error: message }
  }
}

export async function cancelCodexLogin(): Promise<void> {
  if (!server || !pendingLoginId) return
  await cancelChatGptLogin(server, pendingLoginId)
  pendingLoginId = null
  notifyStatus()
}

export async function logoutCodexAccount(): Promise<CodexStatus> {
  try {
    if (server?.running) await logoutCodex(server)
    auth = SIGNED_OUT
    allowance = null
    liveThreadId = null
    // A signed-out thread is not resumable by the next account.
    setSettings({ codexThreadId: '' })
    lastError = null
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err)
  }
  notifyStatus()
  return getCodexStatus()
}

/** Forget the persisted thread so the next turn starts clean. */
export function newCodexThread(): void {
  setSettings({ codexThreadId: '' })
  liveThreadId = null
  notifyStatus()
}

async function startThread(instance: CodexAppServer, developerInstructions?: string): Promise<string> {
  const settings = getSettings()
  const model = pickModel(models, CODEX_MODEL_PREFERENCE, settings.codexModel)
  const response = await instance.request<CodexThreadStartResponse>('thread/start', {
    cwd: codexCwd(),
    model: model || undefined,
    approvalPolicy: 'on-request',
    sandbox: 'workspace-write',
    developerInstructions
  })
  const threadId = response?.thread?.id
  if (!threadId) throw new CodexFault('transport', 'Codex did not return a thread id, sir.')
  setSettings({ codexThreadId: threadId })
  liveThreadId = threadId
  return threadId
}

/**
 * Reuse the persisted thread so Codex keeps project context across restarts,
 * falling back to a fresh thread when the old one is gone or unusable.
 */
async function resolveThread(
  instance: CodexAppServer,
  developerInstructions?: string
): Promise<string> {
  const existing = getSettings().codexThreadId?.trim()
  if (existing) {
    if (liveThreadId === existing) return existing
    try {
      await instance.request('thread/resume', {
        threadId: existing,
        cwd: codexCwd(),
        approvalPolicy: 'on-request',
        sandbox: 'workspace-write',
        developerInstructions,
        excludeTurns: true
      })
      liveThreadId = existing
      return existing
    } catch {
      // Deleted, archived, or written by an incompatible version.
      setSettings({ codexThreadId: '' })
    }
  }
  return startThread(instance, developerInstructions)
}

export function codexTurnActive(): boolean {
  return Boolean(activeTurn && !activeTurn.settled)
}

/** Cancel the in-flight turn. Used by "standby" / "take 5". */
export async function interruptCodexTurn(): Promise<boolean> {
  const turn = activeTurn
  if (!turn || turn.settled) return false
  turn.interrupted = true
  setTimeout(() => {
    if (!turn.settled && activeTurn === turn) settleTurn(turn)
  }, 2_000)
  if (!server?.running) {
    settleTurn(turn)
    return true
  }
  try {
    await server.request('turn/interrupt', {
      threadId: turn.threadId,
      turnId: turn.turnId ?? undefined
    })
    return true
  } catch {
    // Turn may have finished between the check and the call.
    if (!turn.settled) settleTurn(turn)
    return false
  }
}

/** Add guidance to a turn already in flight without starting a new one. */
export async function steerCodexTurn(text: string): Promise<boolean> {
  const turn = activeTurn
  if (!turn || turn.settled || !server?.running || !text.trim()) return false
  try {
    await server.request('turn/steer', {
      threadId: turn.threadId,
      turnId: turn.turnId ?? undefined,
      input: [{ type: 'text', text }]
    })
    return true
  } catch {
    return false
  }
}

export async function runCodexTurn(options: CodexTurnOptions): Promise<CodexTurnResult> {
  if (activeTurn && !activeTurn.settled) {
    throw new CodexFault('transport', 'A Codex turn is already running, sir.')
  }

  const instance = ensureServer()
  await instance.start()

  // Account state is pushed through notifications and refreshed on connect.
  // Avoid another account/read round trip before every ordinary turn.
  if (!auth.signedIn) auth = await readAccount(instance)
  if (!auth.signedIn) {
    throw new CodexFault(
      'notSignedIn',
      'Codex is not signed in, sir — open Systems and sign in with ChatGPT.'
    )
  }
  if (!models.length) models = await listCodexModels(instance)

  const settings = getSettings()
  const model = options.model || pickModel(models, CODEX_MODEL_PREFERENCE, settings.codexModel)
  const effort = normalizeEffort(models, model, options.effort || settings.codexEffort)
  pauseLiveHmr()
  let threadId: string
  try {
    threadId = await resolveThread(instance, options.developerInstructions)
  } catch (err) {
    resumeLiveHmr()
    throw err
  }
  const project = settings.projectFolder?.trim()

  return new Promise<CodexTurnResult>((resolve, reject) => {
    const turn: ActiveTurn = {
      threadId,
      turnId: null,
      onEvent: options.onEvent,
      resolve,
      reject,
      settled: false,
      finalText: '',
      streamedText: '',
      interrupted: false,
      liveSourceTouched: false
    }
    activeTurn = turn

    const timeoutMs = options.timeoutMs ?? 15 * 60_000
    const timer = setTimeout(() => {
      void interruptCodexTurn()
      settleTurn(turn, new CodexFault('transport', 'Codex turn ran past its time limit, sir.'))
    }, timeoutMs)
    timer.unref?.()

    const finish = (): void => clearTimeout(timer)
    const wrappedResolve = turn.resolve
    const wrappedReject = turn.reject
    turn.resolve = (value) => {
      finish()
      wrappedResolve(value)
    }
    turn.reject = (err) => {
      finish()
      wrappedReject(err)
    }

    instance
      .request<CodexTurnStartResponse>('turn/start', {
        threadId,
        input: options.input,
        model: model || undefined,
        effort,
        approvalPolicy: 'on-request',
        sandboxPolicy: {
          type: 'workspaceWrite',
          writableRoots: project ? [project] : [],
          networkAccess: true
        }
      })
      .then((response) => {
        if (response?.turn?.id && !turn.turnId) turn.turnId = response.turn.id
      })
      .catch((err) => {
        const fault =
          err instanceof CodexFault
            ? err
            : classifyCodexError({ message: err instanceof Error ? err.message : String(err) })
        settleTurn(turn, fault)
      })
  })
}

export function shutdownCodex(): void {
  const turn = activeTurn
  if (turn) settleTurn(turn, new CodexFault('transport', 'Codex bridge shutting down, sir.'))
  server?.stop()
  server = null
  liveThreadId = null
  models = []
  auth = SIGNED_OUT
  allowance = null
}

/** Test seam. */
export function resetCodexServiceState(): void {
  shutdownCodex()
  lastError = null
  versionCache = undefined
  statusListeners.clear()
}
