import { classifyComputerIntent, matchNamePrefix } from '../../shared/computerIntent'
import { homedir } from 'os'
import { readdir, readFile, stat } from 'fs/promises'
import { join } from 'path'
import { getAllowedRoots } from '../tools/paths'
import { checkOutlook, draftOutlookReply, openNewestOutlook, sendLastOutlookDraft } from './outlook'
import { getSettings } from '../config'

async function findDownload(prefix: string): Promise<string> {
  const downloads = join(homedir(), 'Downloads')
  const allowed = getAllowedRoots()
  if (!allowed.includes(downloads) && !getSettings().godMode) {
    return `Downloads is outside the allowed folders, sir. I did not search it.`
  }
  const names = await readdir(downloads)
  const matches = matchNamePrefix(names, prefix)
  if (!matches.length) return `No file in Downloads begins with “${prefix}”, sir.`
  const full = join(downloads, matches[0]!)
  const info = await stat(full)
  let preview = ''
  if (info.isFile() && info.size < 80_000) {
    const text = await readFile(full, 'utf8').catch(() => '')
    if (text && !text.includes('\u0000')) preview = ` It begins: ${text.replace(/\s+/g, ' ').trim().slice(0, 280)}`
  }
  return `Found ${matches[0]} in Downloads (${info.size} bytes).${preview}`
}

/** Run a clear computer request on the host so ChatGPT does not merely narrate the steps. */
export async function runComputerIntent(text: string): Promise<{ content: string; ok: boolean } | null> {
  const intent = classifyComputerIntent(text)
  if (!intent) return null
  if (intent.kind === 'outlook-check') {
    const content = await checkOutlook(intent.query)
    return { content, ok: !/could not|not connected|was not checked/i.test(content) }
  }
  if (intent.kind === 'outlook-open-newest') {
    const content = await openNewestOutlook('unread')
    return { content, ok: !/could not|not connected/i.test(content) }
  }
  if (intent.kind === 'outlook-draft') {
    const content = await draftOutlookReply()
    return { content, ok: /draft created/i.test(content) }
  }
  if (intent.kind === 'outlook-send') {
    if (getSettings().confirmDangerousTools) {
      const { executeTool } = await import('../tools/registry')
      const result = await executeTool('outlook_send', {})
      return { content: result.result, ok: result.ok }
    }
    const result = await sendLastOutlookDraft()
    return { content: result.result, ok: result.ok }
  }
  const content = await findDownload(intent.prefix)
  return { content, ok: content.startsWith('Found ') }
}
