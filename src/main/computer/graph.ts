import { execFile } from 'child_process'
import { promisify } from 'util'
import type { MailHit } from '../../shared/computerIntent'
import { getSettings } from '../config'

const execFileAsync = promisify(execFile)
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const DEVICE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/devicecode'
const SCOPE = 'https://graph.microsoft.com/Mail.ReadWrite offline_access'

let pendingDeviceCode = ''

async function security(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('security', args, { timeout: 8_000 })
  return stdout.trim()
}

export async function readGraphRefreshToken(): Promise<string> {
  try {
    return await security(['find-generic-password', '-s', 'albert.outlook.graph', '-a', 'refresh', '-w'])
  } catch {
    return ''
  }
}

async function saveGraphRefreshToken(token: string): Promise<void> {
  await security([
    'add-generic-password',
    '-U',
    '-s',
    'albert.outlook.graph',
    '-a',
    'refresh',
    '-w',
    token
  ])
}

export async function beginOutlookGraphLogin(): Promise<{ ok: boolean; message: string }> {
  const clientId = getSettings().microsoftClientId?.trim()
  if (!clientId) {
    return {
      ok: false,
      message: 'Graph needs your Azure application client id in Systems. ALBERT does not ship one, and it will not ask for your Microsoft password.'
    }
  }
  const body = new URLSearchParams({ client_id: clientId, scope: SCOPE })
  const response = await fetch(DEVICE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  const payload = (await response.json()) as { device_code?: string; message?: string; error?: string }
  if (!response.ok || !payload.device_code) {
    return { ok: false, message: payload.error || 'Microsoft did not start a device login.' }
  }
  pendingDeviceCode = payload.device_code
  return { ok: true, message: payload.message || 'Sign in at the Microsoft page, then confirm here.' }
}

export async function finishOutlookGraphLogin(): Promise<{ ok: boolean; message: string }> {
  const clientId = getSettings().microsoftClientId?.trim()
  if (!clientId || !pendingDeviceCode) {
    return { ok: false, message: 'Start the Microsoft sign-in first. No token was stored.' }
  }
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    client_id: clientId,
    device_code: pendingDeviceCode
  })
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  const payload = (await response.json()) as { refresh_token?: string; error?: string; error_description?: string }
  if (!payload.refresh_token) {
    return { ok: false, message: payload.error_description || payload.error || 'Microsoft has not issued a token yet.' }
  }
  await saveGraphRefreshToken(payload.refresh_token)
  pendingDeviceCode = ''
  return { ok: true, message: 'Graph is connected. The refresh token is in the Keychain, not in settings.' }
}

async function accessToken(): Promise<string> {
  const clientId = getSettings().microsoftClientId?.trim()
  const refresh = await readGraphRefreshToken()
  if (!clientId || !refresh) return ''
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refresh,
    scope: SCOPE
  })
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  const payload = (await response.json()) as { access_token?: string; refresh_token?: string }
  if (payload.refresh_token) await saveGraphRefreshToken(payload.refresh_token)
  return payload.access_token || ''
}

export async function listGraphMail(): Promise<MailHit[] | null> {
  const token = await accessToken()
  if (!token) return null
  const response = await fetch(
    'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=25&$select=id,subject,from,receivedDateTime,bodyPreview,isRead,flag',
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!response.ok) return null
  const payload = (await response.json()) as {
    value?: Array<{
      id?: string
      subject?: string
      from?: { emailAddress?: { name?: string; address?: string } }
      receivedDateTime?: string
      bodyPreview?: string
      isRead?: boolean
      flag?: { flagStatus?: string }
    }>
  }
  return (payload.value || []).map((row) => ({
    id: row.id || '',
    subject: row.subject || '',
    sender: row.from?.emailAddress?.name || row.from?.emailAddress?.address || '',
    received: row.receivedDateTime || '',
    body: row.bodyPreview || '',
    unread: row.isRead === false,
    flagged: row.flag?.flagStatus === 'flagged'
  }))
}
