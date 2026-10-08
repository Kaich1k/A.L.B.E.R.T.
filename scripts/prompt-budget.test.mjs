import assert from 'node:assert/strict'
import test from 'node:test'
import { ALBERT_SYSTEM_PROMPT, compressMemoryLines } from '../src/main/agent/prompt.ts'
import { activeSurfacePromptBlock } from '../src/shared/brainIdentity.ts'
import {
  buildPersonalityPromptBlock,
  buildPersonalityReminder,
  DEFAULT_PERSONALITY
} from '../src/shared/personality.ts'
import { codexTurnContext } from '../src/main/codex/turnContext.ts'
import { CLAUDE_MODEL_OPTIONS, GEMINI_MODEL_OPTIONS, withSavedModel } from '../src/shared/modelCatalog.ts'

/** Sizes measured before this compression, default dials, no memories. */
const BEFORE = {
  prompt: 14119,
  dials: 4366,
  reminder: 461,
  surface: 446
}

test('memory injection keeps four short distinct facts', () => {
  const lines = compressMemoryLines([
    { category: 'preference', content: 'Kai prefers terse replies after 9pm.' },
    { category: 'preference', content: '  Kai   prefers terse replies after 9pm.  ' },
    { category: 'project', content: 'Kai prefers terse replies after 9pm and hates recaps.' },
    { category: 'personal', content: 'x'.repeat(400) },
    { category: 'general', content: 'short' },
    { category: 'project', content: 'The workshop project lives in the ALBERT repo.' },
    { category: 'personal', content: 'Kai is building Albert on a Mac.' }
  ])
  assert.equal(lines.length, 4)
  assert.match(lines[0], /^• \[preference\] Kai prefers terse/)
  assert.equal(lines.filter((line) => line.includes('terse replies')).length, 1)
  const padded = lines.find((line) => line.includes('xxxx'))
  assert.ok(padded)
  assert.ok(padded.length <= 150 + '• [personal] '.length)
  assert.equal(lines.some((line) => line.includes('short')), false)
})

test('default system message is at least 40% smaller and still states the rules once', () => {
  const dials = buildPersonalityPromptBlock(DEFAULT_PERSONALITY)
  const reminder = buildPersonalityReminder(DEFAULT_PERSONALITY)
  const surface = activeSurfacePromptBlock('mac')
  const before = BEFORE.prompt + BEFORE.dials + BEFORE.reminder + BEFORE.surface
  const after = ALBERT_SYSTEM_PROMPT.length + dials.length + reminder.length + surface.length
  assert.ok(after <= before * 0.6, `expected <= ${Math.floor(before * 0.6)}, got ${after}`)

  assert.match(ALBERT_SYSTEM_PROMPT, /confirmDangerousTools is OFF/)
  assert.match(ALBERT_SYSTEM_PROMPT, /not a yes-man/)
  assert.match(ALBERT_SYSTEM_PROMPT, /web_search/)
  assert.match(ALBERT_SYSTEM_PROMPT, /cursor_agent/)
  assert.match(ALBERT_SYSTEM_PROMPT, /Never killall/)
  assert.match(ALBERT_SYSTEM_PROMPT, /snapshotId/)
  assert.equal(ALBERT_SYSTEM_PROMPT.includes('=== ACT'), false)
  assert.equal(dials.includes('COMBO TESTS'), false)
  assert.equal(reminder.includes('TRUTH'), false)
  assert.match(dials, /sarcasm=82/)
  assert.match(reminder, /sarcasm=82/)
  assert.match(surface, /Mac desktop/)
  assert.equal((dials.match(/=== DIALS|=== END DIALS/g) || []).length, 2)
})

test('settings can pin the latest Gemini and Claude models', () => {
  assert.equal(GEMINI_MODEL_OPTIONS[0].id, 'gemini-3.8-flash')
  assert.equal(CLAUDE_MODEL_OPTIONS[0].id, 'claude-opus-5-5')
  assert.ok(CLAUDE_MODEL_OPTIONS.some((model) => model.id === 'claude-fable-5-1'))
  assert.ok(CLAUDE_MODEL_OPTIONS.some((model) => model.id === 'claude-sonnet-5-5'))
  assert.ok(CLAUDE_MODEL_OPTIONS.some((model) => model.id === 'claude-haiku-5-5'))
  const saved = withSavedModel(GEMINI_MODEL_OPTIONS, 'gemini-custom')
  assert.equal(saved.at(-1)?.id, 'gemini-custom')
  assert.equal(withSavedModel(GEMINI_MODEL_OPTIONS, 'gemini-3.8-flash').length, GEMINI_MODEL_OPTIONS.length)
})

test('ChatGPT turn context sends the system text once', () => {
  const instructions = 'RULES'
  const context = codexTurnContext('gpt-test', 'low', instructions)
  const text = context.collaborationMode.settings.developer_instructions
  assert.equal(text.split('RULES').length - 1, 1)
  assert.match(text, /Active model: gpt-test/)
  assert.ok(text.length < 400)
})
