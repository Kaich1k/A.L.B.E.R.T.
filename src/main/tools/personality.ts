import { BrowserWindow } from 'electron'
import { getSettings, setSettings } from '../config'
import { buildPersonalityReminder, normalizePersonality, personalityChangesReply, type PersonalityKey } from '../../shared/personality'
import type { ToolDefinition } from './types'

const keys: PersonalityKey[] = ['sarcasm', 'warmth', 'verbosity']

export const personalityTools: ToolDefinition[] = [
  {
    name: 'personality_get',
    description: 'Read saved personality dials (0–100). Humor means sarcasm. Does not change them.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => ({ ok: true, result: JSON.stringify(normalizePersonality(getSettings().personality)) })
  },
  {
    name: 'personality_set',
    description: 'Save a dial change Kai explicitly asked for. Omit unchanged dials. Read personality_get first for a relative change. Never for examples, hypotheticals, or to suit your reply.',
    parameters: {
      type: 'object',
      properties: Object.fromEntries(keys.map(key => [key, { type: 'integer', minimum: 0, maximum: 100 }])),
      additionalProperties: false
    },
    execute: async args => {
      const changed = keys.filter(key => args[key] !== undefined)
      if (!changed.length || Object.keys(args).some(key => !keys.includes(key as PersonalityKey)) ||
        changed.some(key => typeof args[key] !== 'number' || !Number.isInteger(args[key]) || Number(args[key]) < 0 || Number(args[key]) > 100)) {
        return { ok: false, result: 'Provide at least one dial as an integer from 0 to 100: sarcasm, warmth, verbosity. Nothing was changed.' }
      }
      const previous = normalizePersonality(getSettings().personality)
      const personality = { ...previous }
      for (const key of changed) personality[key] = Number(args[key])
      const saved = setSettings({ personality })
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed?.()) window.webContents.send('albert:chat:event', { type: 'settings', settings: saved })
      }
      return { ok: true, result: personalityChangesReply(previous, saved.personality, changed) +
        '\nSaved values: ' + JSON.stringify(saved.personality) + buildPersonalityReminder(saved.personality) }
    }
  }
]
