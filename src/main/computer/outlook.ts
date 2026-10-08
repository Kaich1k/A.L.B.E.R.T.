import { execFile } from 'child_process'
import { promisify } from 'util'
import type { MailHit } from '../../shared/computerIntent'
import { filterMail, summarizeThread } from '../../shared/computerIntent'
import { getSettings } from '../config'
import { automationEpoch, computerWorkStale } from './automation'
import { listGraphMail, readGraphRefreshToken } from './graph'

const execFileAsync = promisify(execFile)

export interface OutlookAccess {
  graph: boolean
  app: boolean
  detail: string
}

let lastDraftId = ''
let lastHits: MailHit[] = []

function applescriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function runScript(script: string, timeout = 20_000): Promise<string> {
  const epoch = automationEpoch()
  if (computerWorkStale(epoch)) return ''
  const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout })
  if (computerWorkStale(epoch)) {
    throw new Error('Stopped before Outlook could be confirmed.')
  }
  return stdout.trim()
}

function parseMailLines(raw: string): MailHit[] {
  const hits: MailHit[] = []
  for (const line of raw.split('\n')) {
    const parts = line.split('\t')
    if (parts.length < 6) continue
    const [id, subject, sender, received, unread, flagged, ...body] = parts
    hits.push({
      id: id || '',
      subject: subject || '',
      sender: sender || '',
      received: received || '',
      unread: unread === '1' || unread === 'true',
      flagged: flagged === '1' || flagged === 'true',
      body: body.join('\t')
    })
  }
  return hits
}

const LIST_SCRIPT = `
tell application "Microsoft Outlook"
  set output to ""
  set n to 0
  repeat with m in messages of inbox
    if n ≥ 25 then exit repeat
    set n to n + 1
    set sid to id of m as string
    set subj to subject of m as string
    set who to ""
    try
      set who to name of sender of m as string
    end try
    if who is "" then
      try
        set who to address of sender of m as string
      end try
    end if
    set whenReceived to ""
    try
      set whenReceived to time received of m as string
    end try
    set unreadFlag to "0"
    try
      if is read of m is false then set unreadFlag to "1"
    end try
    set pinned to "0"
    try
      if todo flag of m is not not flagged then set pinned to "1"
    end try
    set preview to ""
    try
      set preview to plain text content of m
      if (count of preview) > 600 then set preview to text 1 thru 600 of preview
    end try
    set output to output & sid & tab & subj & tab & who & tab & whenReceived & tab & unreadFlag & tab & pinned & tab & preview & linefeed
  end repeat
  return output
end tell
`

async function outlookAppInstalled(): Promise<boolean> {
  try {
    await execFileAsync('osascript', ['-e', 'id of application "Microsoft Outlook"'], { timeout: 4_000 })
    return true
  } catch {
    return false
  }
}

export async function describeOutlookAccess(): Promise<OutlookAccess> {
  const clientId = getSettings().microsoftClientId?.trim() || ''
  const refresh = await readGraphRefreshToken()
  const app = await outlookAppInstalled()
  if (refresh && clientId) {
    return { graph: true, app, detail: 'Microsoft Graph is connected for reading mail. The password is not stored.' }
  }
  if (app) {
    return {
      graph: false,
      app: true,
      detail: clientId
        ? 'Graph is not connected yet. Outlook for Mac is available as the fallback.'
        : 'Graph is not connected — no Azure application client id is set. Outlook for Mac is the fallback. Your Microsoft password is never requested.'
    }
  }
  return {
    graph: false,
    app: false,
    detail: 'Outlook is not connected. Add an Azure application client id for Graph, or install Outlook for Mac. Nothing was read from an inbox.'
  }
}

async function listViaApp(): Promise<MailHit[]> {
  const raw = await runScript(LIST_SCRIPT)
  return parseMailLines(raw)
}

export async function checkOutlook(query: string): Promise<string> {
  const access = await describeOutlookAccess()
  if (!access.app && !access.graph) return access.detail
  try {
    const graphMessages = access.graph ? await listGraphMail() : null
    const messages = graphMessages || (await listViaApp())
    lastHits = messages
    const matched = filterMail(messages, query)
    if (!matched.length) {
      return `Outlook is reachable, sir, but nothing matched “${query}”. I did not change any mail.`
    }
    const lines = matched.slice(0, 8).map((message, index) => {
      const flags = [message.unread ? 'unread' : 'read', message.flagged ? 'flagged' : ''].filter(Boolean).join(', ')
      return `${index + 1}. ${message.subject || '(no subject)'} — ${message.sender || 'unknown'} (${flags})`
    })
    return `Outlook, sir. ${lines.join(' ')} Nothing was sent or modified.`
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return `I could not read Outlook, sir. ${message} Inbox was not checked.`
  }
}

export async function openNewestOutlook(query = ''): Promise<string> {
  if (!lastHits.length) {
    const listed = await checkOutlook(query || 'unread')
    if (!lastHits.length) return listed
  }
  const pool = query ? filterMail(lastHits, query) : lastHits.filter((message) => message.unread)
  const message = (pool.length ? pool : lastHits)[0]
  return summarizeThread(message)
}

export async function draftOutlookReply(): Promise<string> {
  const source = lastHits.find((message) => message.unread) || lastHits[0]
  if (!source) return 'There is no open Outlook message to draft from, sir. I did not send anything.'
  const subject = applescriptString(source.subject.startsWith('Re:') ? source.subject : `Re: ${source.subject}`)
  const script = `
tell application "Microsoft Outlook"
  set draftMessage to make new outgoing message with properties {subject:"${subject}", content:"Sir — draft only. Not sent."}
  return id of draftMessage as string
end tell
`
  try {
    lastDraftId = await runScript(script)
    return `Draft created in Outlook${lastDraftId ? ` (${lastDraftId})` : ''}, sir. It has not been sent.`
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return `I could not create the Outlook draft, sir. ${message} Nothing was sent.`
  }
}

export async function sendLastOutlookDraft(): Promise<{ ok: boolean; result: string }> {
  if (!lastDraftId) {
    return { ok: false, result: 'There is no Outlook draft waiting, sir. Nothing was sent.' }
  }
  const script = `
tell application "Microsoft Outlook"
  send outgoing message id ${Number(lastDraftId) || 0}
end tell
`
  try {
    await runScript(script)
    const sent = lastDraftId
    lastDraftId = ''
    return { ok: true, result: `Outlook reported the draft ${sent} was sent, sir.` }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, result: `Outlook did not confirm a send, sir. ${message}` }
  }
}

export function rememberOutlookHitsForTests(hits: MailHit[]): void {
  lastHits = hits
}
