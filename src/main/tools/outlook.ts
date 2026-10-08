import type { ToolDefinition } from './types'
import { checkOutlook, draftOutlookReply, openNewestOutlook, sendLastOutlookDraft } from '../computer/outlook'
import { openComputerTab } from '../computer/tabs'
import { showComputerWindow } from '../computer/window'

export const outlookTools: ToolDefinition[] = [
  {
    name: 'outlook_check',
    description:
      'Read Outlook inbox, unread, or flagged mail. Does not send, delete, or move.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Natural filter, e.g. unread university replies' } }
    },
    execute: async (args) => {
      const result = await checkOutlook(String(args.query || 'inbox'))
      const ok = !/could not read|not connected|was not checked/i.test(result)
      return { ok, result }
    }
  },
  {
    name: 'outlook_read',
    description: 'Summarize the newest matching Outlook message. Does not modify mail.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } }
    },
    execute: async (args) => {
      const result = await openNewestOutlook(String(args.query || ''))
      return { ok: !/could not|not connected/i.test(result), result }
    }
  },
  {
    name: 'outlook_draft',
    description: 'Create an Outlook reply draft. Never sends it.',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      const result = await draftOutlookReply()
      return { ok: /draft created/i.test(result), result }
    }
  },
  {
    name: 'outlook_send',
    description: 'Send the Outlook draft created earlier. Consequential — requires confirmation when that policy is on.',
    parameters: { type: 'object', properties: {} },
    dangerous: true,
    execute: async () => sendLastOutlookDraft()
  },
  {
    name: 'outlook_open_web',
    description: 'Open Outlook on the web in the Computer window when the app and Graph are unavailable. Does not pretend the inbox was read.',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      showComputerWindow()
      const tab = openComputerTab('https://outlook.office.com/mail/', 'Outlook')
      return {
        ok: true,
        result: `Opened Outlook on the web (${tab.url}). I have not read the inbox until the page is signed in and fetched.`
      }
    }
  }
]
